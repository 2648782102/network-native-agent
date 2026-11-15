import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createEvent, generateIdentity } from '../src/crypto.mjs';
import { verifyChain } from '../src/events.mjs';
import {
  detectRollback,
  detectWithholding,
  headOf,
  stageEquivocation,
  verifyCrossCheck,
  verifyHeartbeat,
  verifySingleView,
} from '../src/relay-trust.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function chain(identity, count, from = 1, parent = null, branch = 'h') {
  const events = [];
  let previous = parent;
  for (let index = 0; index < count; index += 1) {
    const seq = from + index;
    const event = createEvent(identity.privatePem, {
      seq,
      parent: previous,
      type: seq === 1 ? 'genesis' : 'perception',
      bodyId: seq === 1 ? 'environment' : `body_${branch}_${seq}`,
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
        : { source: 'relay', text: `${branch}${seq}`, branch },
    });
    events.push(event);
    previous = event.id;
  }
  return events;
}

function splitViews(identity, total = 16, forkSeq = 6) {
  const source = chain(identity, total);
  const prefix = source.slice(0, forkSeq);
  const a = chain(identity, 3, forkSeq + 1, prefix.at(-1).id, 'a');
  const b = chain(identity, 5, forkSeq + 1, prefix.at(-1).id, 'b');
  return { source, viewA: [...prefix, ...a], viewB: [...prefix, ...b] };
}

test('a single valid chain cannot reveal equivocation', () => {
  const identity = generateIdentity();
  const { viewA, viewB } = splitViews(identity);
  const singleA = verifySingleView(viewA);
  const singleB = verifySingleView(viewB);
  assert.equal(singleA.valid, true);
  assert.equal(singleB.valid, true);
  assert.equal(singleA.equivocationDetected, false);
  assert.equal(singleB.equivocationDetected, false);
  assert.equal(singleA.freshnessKnown, false);
  assert.notEqual(singleA.digest, singleB.digest, 'the two views really do differ');
});

test('cross-check detects a split view at the first diverging sequence', () => {
  const identity = generateIdentity();
  const { viewA, viewB } = splitViews(identity, 16, 6);
  const result = verifyCrossCheck(viewA, viewB);
  assert.equal(result.equivocationDetected, true);
  assert.equal(result.divergenceAt, 7);
});

test('heartbeat interval trades detection lag against exchange count', () => {
  const identity = generateIdentity();
  const { viewA, viewB } = splitViews(identity, 16, 6);
  const tight = verifyHeartbeat({ viewA, viewB, every: 1 });
  const loose = verifyHeartbeat({ viewA, viewB, every: 8 });
  assert.equal(tight.equivocationDetected, true);
  assert.equal(loose.equivocationDetected, true);
  assert.ok(tight.divergenceAt <= loose.divergenceAt, 'tighter heartbeat detects no later');
  assert.ok(tight.checkpoints.length >= loose.checkpoints.length, 'tighter heartbeat costs more exchanges');
  assert.equal(tight.maxEventsHiddenBetweenExchanges, 0);
  assert.equal(loose.maxEventsHiddenBetweenExchanges, 7);
});

test('withholding and rollback need a remembered reference point', () => {
  const identity = generateIdentity();
  const source = chain(identity, 12);
  const behind = source.slice(0, 9);

  assert.equal(detectWithholding({ viewA: source, viewB: behind }).detected, true);
  assert.equal(detectWithholding({ viewA: source, viewB: source }).detected, false);

  assert.equal(detectRollback({ view: behind, knownHeadSeq: headOf(source).seq }).detected, true);
  assert.equal(detectRollback({ view: source, knownHeadSeq: headOf(source).seq }).detected, false);
});

test('both staged views are individually valid signed chains', () => {
  const identity = generateIdentity();
  const { viewA, viewB } = splitViews(identity, 16, 6);
  assert.doesNotThrow(() => verifyChain(viewA));
  assert.doesNotThrow(() => verifyChain(viewB));
  assert.equal(viewA[6].agentId, viewB[6].agentId, 'same identity signs both branches');
  assert.notEqual(viewA[6].id, viewB[6].id, 'but the events differ');
});

test('archived relay-trust evidence matches its own claims', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/relay-trust/report.json'), 'utf8'));
  assert.equal(report.protocol, 'relay-trust-v1');
  assert.equal(report.valid, true);
  assert.equal(report.results.equivocation.singleView.detected, false);
  assert.equal(report.results.equivocation.crossCheck.detected, true);
  assert.equal(report.results.equivocation.heartbeat.detected, true);
  assert.equal(report.results.withholding.crossCheck.detected, true);
  assert.equal(report.results.rollback.headComparison.detected, true);
  assert.ok(report.claims.every((claim) => claim.status === 'supported'));
  assert.equal(report.tradeoff.length >= 4, true);
  for (const row of report.tradeoff) {
    assert.equal(row.maxEventsHiddenBetweenExchanges, row.heartbeatEvery - 1);
    assert.ok(row.detectionLag !== null && row.detectionLag >= 0);
  }
  assert.match(report.boundary, /Simulation only/);
  assert.equal(report.limitations.length >= 3, true);
});

test('RELAY_TRUST.md quotes the archived numbers', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/relay-trust/report.json'), 'utf8'));
  const doc = await readFile(path.join(root, 'RELAY_TRUST.md'), 'utf8');

  assert.match(doc, new RegExp(`seq ${report.results.equivocation.crossCheck.divergenceAt}`));
  assert.match(doc, new RegExp(`落后 ${report.results.withholding.crossCheck.gap} 个事件`));
  assert.match(doc, new RegExp(`head ${report.results.rollback.headComparison.head.seq} < ${report.results.rollback.headComparison.knownHeadSeq}`));

  for (const row of report.tradeoff) {
    assert.match(
      doc,
      new RegExp(`\\| ${row.heartbeatEvery} \\| ${row.exchangesBeforeDetection} \\| ${row.detectedAtSeq} \\| ${row.detectionLag} \\| ${row.maxEventsHiddenBetweenExchanges} \\|`),
      `trade-off row for every=${row.heartbeatEvery}`,
    );
  }
});
