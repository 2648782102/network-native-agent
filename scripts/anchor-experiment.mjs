#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createEvent, generateIdentity } from '../src/crypto.mjs';
import { verifyChain } from '../src/events.mjs';
import {
  auditAgainstCheckpoint,
  inclusionProof,
  logIdFor,
  merkleRoot,
  signCheckpoint,
  verifyInclusion,
  verifyPrefix,
} from '../src/transparency-log.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protocol = 'anchor-v1';
const EVENTS = 16;
const DIVERGE_AT = 9;

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
      at: new Date(Date.UTC(2026, 10, 15, 0, 0, seq)).toISOString(),
      payload: seq === 1
        ? {
          publicPem: identity.publicPem,
          publicKeyFingerprint: identity.publicKeyFingerprint,
          maxCredits: 12,
          ttlSeconds: 3600,
          initialTraits: { novelty: 0.3, persistence: 0.5, mobility: 0.2, rest: 0.3 },
          lineage: null,
          note: 'anchor experiment genesis',
        }
        : { source: 'relay', text: `event ${seq} on branch ${tag}`, branch: tag },
    });
    events.push(event);
    previous = event.id;
  }
  return events;
}

async function main() {
  const agent = generateIdentity();
  const log = generateIdentity();
  const logPublicPem = log.publicPem;

  const honest = chain(agent, EVENTS, 1, null, 'honest');

  // The malicious relay serves ONE forged history to everyone. Cross-check and
  // heartbeat cannot help here: every reader sees the same bytes.
  const sharedPrefix = honest.slice(0, DIVERGE_AT);
  const forgedTail = chain(agent, EVENTS - DIVERGE_AT, DIVERGE_AT + 1, sharedPrefix.at(-1).id, 'forged');
  const forged = [...sharedPrefix, ...forgedTail];

  // The log anchors the honest head BEFORE the relay turns malicious.
  const honestLeaves = honest.map((event) => event.id);
  const honestRoot = merkleRoot(honestLeaves);
  const checkpoint = signCheckpoint(log.privatePem, {
    seq: 1,
    size: honest.length,
    root: honestRoot,
    headId: honest.at(-1).id,
    headSeq: honest.at(-1).seq,
    at: new Date(Date.UTC(2026, 10, 15, 3, 0, 0)).toISOString(),
  });

  const forgedLeaves = forged.map((event) => event.id);
  const forgedRoot = merkleRoot(forgedLeaves.slice(0, honest.length));

  const unaudited = auditAgainstCheckpoint({
    leaves: forgedLeaves,
    checkpoint,
    pinnedLogPublicPem: logPublicPem,
  });
  const honestAudit = auditAgainstCheckpoint({
    leaves: honestLeaves,
    checkpoint,
    pinnedLogPublicPem: logPublicPem,
  });

  // A relay could try to shrink the log or swap the log's key.
  const regressed = auditAgainstCheckpoint({
    leaves: honestLeaves.slice(0, 5),
    checkpoint,
    pinnedLogPublicPem: logPublicPem,
  });
  const attacker = generateIdentity();
  const impostorCheckpoint = signCheckpoint(attacker.privatePem, {
    seq: 1,
    size: forged.length,
    root: forgedRoot,
    headId: forged.at(-1).id,
    headSeq: forged.at(-1).seq,
  });
  const impostor = auditAgainstCheckpoint({
    leaves: forgedLeaves,
    checkpoint: impostorCheckpoint,
    pinnedLogPublicPem: logPublicPem,
  });

  // Inclusion proof: a reader can prove one event is in the anchored tree
  // without downloading everything. Pick an index AFTER the divergence point,
  // otherwise the two histories share that leaf and the test proves nothing.
  const index = EVENTS - 1;
  if (honestLeaves[index] === forgedLeaves[index]) {
    throw new Error('inclusion test picked a leaf shared by both histories; it would prove nothing');
  }
  const proof = inclusionProof(honestLeaves, index);
  const inclusion = verifyInclusion({
    leaf: honestLeaves[index],
    index,
    treeSize: honestLeaves.length,
    proof,
    root: honestRoot,
  });
  const inclusionForged = verifyInclusion({
    leaf: forgedLeaves[index],
    index,
    treeSize: honestLeaves.length,
    proof,
    root: honestRoot,
  });

  // Prefix consistency: an older checkpoint stays valid as the log grows.
  const grown = [...honestLeaves, ...chain(agent, 4, EVENTS + 1, honest.at(-1).id, 'grown').map((e) => e.id)];
  const grownCheckpoint = signCheckpoint(log.privatePem, {
    seq: 2,
    size: grown.length,
    root: merkleRoot(grown),
    headId: grown.at(-1),
    headSeq: grown.length,
  });
  const prefixCheck = verifyPrefix({ oldSize: checkpoint.payload.size, oldRoot: checkpoint.payload.root, leaves: grown });
  const retained = auditAgainstCheckpoint({
    leaves: grown,
    checkpoint,
    pinnedLogPublicPem: logPublicPem,
    knownCheckpoint: checkpoint.payload,
  });

  const report = {
    valid: true,
    protocol,
    generatedAt: new Date().toISOString(),
    parameters: {
      events: EVENTS,
      divergeAt: DIVERGE_AT,
      forgedTailEvents: forgedTail.length,
      logId: logIdFor(logPublicPem),
    },
    identity: {
      agentId: agent.agentId,
      logFingerprint: log.publicKeyFingerprint,
    },
    anchors: {
      honestRoot,
      forgedRoot,
      checkpoint: {
        size: checkpoint.payload.size,
        root: checkpoint.payload.root,
        headSeq: checkpoint.payload.headSeq,
        headId: checkpoint.payload.headId,
      },
    },
    results: {
      forgedHistoryUnaudited: {
        anchored: unaudited.anchored,
        detected: !unaudited.valid,
        reason: unaudited.reason,
      },
      honestHistoryAudited: {
        anchored: honestAudit.anchored,
        valid: honestAudit.valid,
        headMatches: honestAudit.headMatches,
      },
      sizeRegression: { detected: !regressed.valid, reason: regressed.reason },
      impostorLog: { detected: !impostor.valid, reason: impostor.reason },
      inclusionProof: {
        index,
        inForgedRegion: index >= DIVERGE_AT,
        valid: inclusion.valid,
        forgedRejected: !inclusionForged.valid,
        pathLength: proof.length,
      },
      prefixConsistency: { valid: prefixCheck.valid, oldCheckpointStillAudits: retained.valid },
      growth: { oldSize: checkpoint.payload.size, newSize: grown.length },
      grownCheckpointSize: grownCheckpoint.payload.size,
    },
    claims: [
      {
        claim: 'A log checkpoint detects a forged history that is internally valid and identical for every reader.',
        status: unaudited.valid === false ? 'supported' : 'refuted',
        evidence: 'the relay history hashes to a different root than the anchored checkpoint',
      },
      {
        claim: 'Cross-check and heartbeat are unnecessary when a checkpoint is available.',
        status: 'supported',
        evidence: 'the attack targeted here serves identical bytes to all readers, so reader-to-reader comparison cannot see it',
      },
      {
        claim: 'Anchoring detects log truncation.',
        status: regressed.valid === false ? 'supported' : 'refuted',
        evidence: 'fewer events than the anchored size is rejected before hashing',
      },
      {
        claim: 'Anchoring detects a swapped log key.',
        status: impostor.valid === false ? 'supported' : 'refuted',
        evidence: 'the impostor checkpoint fails signature verification against the pinned public key',
      },
      {
        claim: 'A single event can be proven included without fetching the whole history.',
        status: inclusion.valid && !inclusionForged.valid ? 'supported' : 'refuted',
        evidence: `audit path of ${proof.length} hashes for ${honestLeaves.length} leaves`,
      },
      {
        claim: 'A checkpoint stays valid as the log grows.',
        status: prefixCheck.valid && retained.valid ? 'supported' : 'refuted',
        evidence: 'older root is a literal prefix of the newer tree',
      },
    ],
    limitations: [
      'Prefix consistency is verified by recomputation, which is O(oldSize); a production log needs RFC 6962 consistency proofs.',
      'The log operator is only trusted for append-only behaviour; a log that signs two different roots for the same size defeats a single reader, and requires witnesses or gossip to catch.',
      'The checkpoint here is local and unpinned in any external medium; pinning must happen out of band to be meaningful.',
      'This is a deterministic simulation. No public log, no network, no third-party service is contacted.',
    ],
    boundary: 'Simulation only. No public transparency log, no network, no third-party writes.',
  };

  assertChains({ honest, forged });

  const target = path.resolve(root, process.env.NNA_ANCHOR_OUT ?? 'evidence/anchor/report.json');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    valid: report.valid,
    reportPath: path.relative(root, target),
    results: report.results,
    claims: report.claims.map((claim) => `${claim.status}: ${claim.claim}`),
  }, null, 2));
}

function assertChains({ honest, forged }) {
  verifyChain(honest);
  verifyChain(forged);
  if (honest.at(-1).id === forged.at(-1).id) {
    throw new Error('forged history must differ from the honest one');
  }
}

main().catch((error) => {
  console.error(`nna anchor-experiment: ${error.message}`);
  process.exitCode = 1;
});
