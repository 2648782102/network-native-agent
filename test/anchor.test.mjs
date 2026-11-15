import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createEvent, generateIdentity } from '../src/crypto.mjs';
import { verifyChain } from '../src/events.mjs';
import {
  auditAgainstCheckpoint,
  inclusionProof,
  merkleRoot,
  signCheckpoint,
  verifyCheckpoint,
  verifyInclusion,
  verifyPrefix,
} from '../src/transparency-log.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function chain(identity, count, from = 1, parent = null, tag = 'h') {
  const events = [];
  let previous = parent;
  for (let index = 0; index < count; index += 1) {
    const seq = from + index;
    const event = createEvent(identity.privatePem, {
      seq,
      parent: previous,
      type: seq === 1 ? 'genesis' : 'perception',
      bodyId: seq === 1 ? 'environment' : `body_${tag}_${seq}`,
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
      payload: seq === 1
        ? {
          publicPem: identity.publicPem,
          publicKeyFingerprint: identity.publicKeyFingerprint,
          maxCredits: 12,
          ttlSeconds: 3600,
          initialTraits: { novelty: 0.3, persistence: 0.5, mobility: 0.2, rest: 0.3 },
          lineage: null,
        }
        : { source: 'relay', text: `event ${seq} ${tag}`, tag },
    });
    events.push(event);
    previous = event.id;
  }
  return events;
}

test('inclusion proofs accept only the anchored leaf', () => {
  const leaves = Array.from({ length: 16 }, (_, index) => `leaf-${index}`);
  const anchored = merkleRoot(leaves);
  for (const index of [0, 3, 8, 9, 15]) {
    const proof = inclusionProof(leaves, index);
    assert.equal(verifyInclusion({ leaf: leaves[index], index, treeSize: 16, proof, root: anchored }).valid, true);
    assert.equal(verifyInclusion({ leaf: `forged-${index}`, index, treeSize: 16, proof, root: anchored }).valid, false);
  }
});

test('inclusion proof for a shared-prefix leaf proves nothing about the forged region', () => {
  // Regression guard: this is the mistake the first version of the experiment made.
  const honest = Array.from({ length: 16 }, (_, index) => (index < 9 ? `shared-${index}` : `honest-${index}`));
  const forged = Array.from({ length: 16 }, (_, index) => (index < 9 ? `shared-${index}` : `forged-${index}`));
  const anchored = merkleRoot(honest);

  const sharedIndex = 3;
  assert.equal(honest[sharedIndex], forged[sharedIndex]);
  const sharedProof = inclusionProof(honest, sharedIndex);
  assert.equal(
    verifyInclusion({ leaf: forged[sharedIndex], index: sharedIndex, treeSize: 16, proof: sharedProof, root: anchored }).valid,
    true,
    'a shared prefix leaf is legitimately in both histories',
  );

  const divergentIndex = 15;
  assert.notEqual(honest[divergentIndex], forged[divergentIndex]);
  const divergentProof = inclusionProof(honest, divergentIndex);
  assert.equal(
    verifyInclusion({ leaf: forged[divergentIndex], index: divergentIndex, treeSize: 16, proof: divergentProof, root: anchored }).valid,
    false,
    'a forged leaf must not verify against the honest root',
  );
});

test('a checkpoint catches a forged history that every reader sees identically', () => {
  const agent = generateIdentity();
  const log = generateIdentity();
  const honest = chain(agent, 12, 1, null, 'honest');
  const prefix = honest.slice(0, 7);
  const forged = [...prefix, ...chain(agent, 5, 8, prefix.at(-1).id, 'forged')];

  assert.doesNotThrow(() => verifyChain(honest));
  assert.doesNotThrow(() => verifyChain(forged), 'the forgery is internally valid');

  const checkpoint = signCheckpoint(log.privatePem, {
    seq: 1,
    size: honest.length,
    root: merkleRoot(honest.map((event) => event.id)),
    headId: honest.at(-1).id,
    headSeq: honest.at(-1).seq,
  });

  const audited = auditAgainstCheckpoint({
    leaves: forged.map((event) => event.id),
    checkpoint,
    pinnedLogPublicPem: log.publicPem,
  });
  assert.equal(audited.valid, false);
  assert.equal(audited.anchored, false);
  assert.match(audited.reason, /does not match the anchored root/);
});

test('checkpoint verification rejects truncation and a swapped log key', () => {
  const agent = generateIdentity();
  const log = generateIdentity();
  const events = chain(agent, 10);
  const leaves = events.map((event) => event.id);
  const checkpoint = signCheckpoint(log.privatePem, {
    seq: 1,
    size: leaves.length,
    root: merkleRoot(leaves),
    headId: events.at(-1).id,
    headSeq: events.at(-1).seq,
  });

  const truncated = auditAgainstCheckpoint({
    leaves: leaves.slice(0, 4),
    checkpoint,
    pinnedLogPublicPem: log.publicPem,
  });
  assert.equal(truncated.valid, false);
  assert.match(truncated.reason, /anchors 10/);

  const impostor = generateIdentity();
  const fakeCheckpoint = signCheckpoint(impostor.privatePem, {
    seq: 1,
    size: leaves.length,
    root: merkleRoot(leaves),
    headId: events.at(-1).id,
    headSeq: events.at(-1).seq,
  });
  assert.equal(verifyCheckpoint(fakeCheckpoint, log.publicPem).valid, false);
});

test('an older checkpoint stays valid after the log grows', () => {
  const agent = generateIdentity();
  const log = generateIdentity();
  const first = chain(agent, 8);
  const oldRoot = merkleRoot(first.map((event) => event.id));
  const checkpoint = signCheckpoint(log.privatePem, {
    seq: 1,
    size: first.length,
    root: oldRoot,
    headId: first.at(-1).id,
    headSeq: first.at(-1).seq,
  });
  const grown = [...first, ...chain(agent, 3, 9, first.at(-1).id, 'grown')];
  const leaves = grown.map((event) => event.id);

  assert.equal(verifyPrefix({ oldSize: checkpoint.payload.size, oldRoot, leaves }).valid, true);
  const stillValid = auditAgainstCheckpoint({
    leaves,
    checkpoint,
    pinnedLogPublicPem: log.publicPem,
    knownCheckpoint: checkpoint.payload,
  });
  assert.equal(stillValid.valid, true);
  assert.equal(stillValid.unanchoredEvents, 3);
});

test('archived anchor evidence supports every claim and stays bounded', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/anchor/report.json'), 'utf8'));
  assert.equal(report.protocol, 'anchor-v1');
  assert.equal(report.valid, true);
  assert.equal(report.results.forgedHistoryUnaudited.detected, true);
  assert.equal(report.results.honestHistoryAudited.valid, true);
  assert.equal(report.results.sizeRegression.detected, true);
  assert.equal(report.results.impostorLog.detected, true);
  assert.equal(report.results.inclusionProof.valid, true);
  assert.equal(report.results.inclusionProof.forgedRejected, true);
  assert.equal(report.results.inclusionProof.inForgedRegion, true, 'inclusion test must target a divergent leaf');
  assert.equal(report.results.prefixConsistency.valid, true);
  assert.ok(report.claims.every((claim) => claim.status === 'supported'));
  assert.equal(report.limitations.length >= 3, true);
  assert.match(report.boundary, /Simulation only/);
});

test('ANCHORING.md quotes the archived numbers', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/anchor/report.json'), 'utf8'));
  const doc = await readFile(path.join(root, 'ANCHORING.md'), 'utf8');

  assert.match(doc, new RegExp(`诚实历史 ${report.parameters.events} 个事件`));
  assert.match(doc, new RegExp(`第 ${report.parameters.divergeAt} 个之后`));
  assert.match(doc, new RegExp(`路径长 ${report.results.inclusionProof.pathLength}`));

  const truncated = report.results.sizeRegression.reason.match(/served (\d+) events/);
  assert.ok(truncated, 'size-regression reason should state how many events were served');
  assert.match(doc, new RegExp(`${truncated[1]} < ${report.anchors.checkpoint.size}`));
});
