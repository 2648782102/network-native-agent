#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createEvent, generateIdentity } from '../src/crypto.mjs';
import {
  chainDigest,
  detectRollback,
  detectWithholding,
  headOf,
  stageEquivocation,
  stageRollback,
  stageWithholding,
  verifyCrossCheck,
  verifyHeartbeat,
  verifySingleView,
} from '../src/relay-trust.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protocol = 'relay-trust-v1';
const EVENTS = 24;
const FORK_SEQ = 10;
const HEARTBEAT_EVERY = 4;

function buildChain(identity, count) {
  const events = [];
  let parent = null;
  for (let seq = 1; seq <= count; seq += 1) {
    const event = createEvent(identity.privatePem, {
      seq,
      parent,
      type: seq === 1 ? 'genesis' : 'perception',
      bodyId: seq === 1 ? 'environment' : `body_${String(seq).padStart(3, '0')}`,
      at: new Date(Date.UTC(2026, 10, 15, 0, 0, seq)).toISOString(),
      payload: seq === 1
        ? {
          publicPem: identity.publicPem,
          publicKeyFingerprint: identity.publicKeyFingerprint,
          maxCredits: 12,
          ttlSeconds: 3600,
          initialTraits: { novelty: 0.3, persistence: 0.5, mobility: 0.2, rest: 0.3 },
          lineage: null,
          note: 'relay-trust genesis',
        }
        : {
          source: 'relay',
          text: `synthetic event ${seq}`,
          metadata: { fixture: 'relay-trust' },
        },
    });
    events.push(event);
    parent = event.id;
  }
  return events;
}

async function main() {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-relay-trust-'));
  try {
    const identity = generateIdentity();
    const source = buildChain(identity, EVENTS);

    // A malicious relay builds two divergent continuations from a shared prefix.
    // Both are legitimately signed by the same identity, so signatures cannot
    // distinguish them from an honest history.
    // Re-sign each continuation so ids and parent links stay valid.
    const viewA = [];
    let parent = source[FORK_SEQ - 1].id;
    for (let index = 0; index < 3; index += 1) {
      const seq = FORK_SEQ + index + 1;
      const event = createEvent(identity.privatePem, {
        seq,
        parent,
        type: 'perception',
        bodyId: `body_a_${seq}`,
        at: new Date(Date.UTC(2026, 10, 15, 1, 0, seq)).toISOString(),
        payload: { source: 'relay', text: `view A event ${seq}`, branch: 'A' },
      });
      viewA.push(event);
      parent = event.id;
    }
    const viewB = [];
    parent = source[FORK_SEQ - 1].id;
    for (let index = 0; index < 5; index += 1) {
      const seq = FORK_SEQ + index + 1;
      const event = createEvent(identity.privatePem, {
        seq,
        parent,
        type: 'perception',
        bodyId: `body_b_${seq}`,
        at: new Date(Date.UTC(2026, 10, 15, 2, 0, seq)).toISOString(),
        payload: { source: 'relay', text: `view B event ${seq}`, branch: 'B' },
      });
      viewB.push(event);
      parent = event.id;
    }

    const equivocation = stageEquivocation({ source, forkSeq: FORK_SEQ, viewA, viewB });
    const withholding = stageWithholding({ source, withheldFrom: EVENTS - 5 });
    const rollback = stageRollback({ source, rollbackTo: EVENTS - 8 });

    const single = verifySingleView(equivocation.views.a);
    const crossCheck = verifyCrossCheck(equivocation.views.a, equivocation.views.b);
    const heartbeat = verifyHeartbeat({
      viewA: equivocation.views.a,
      viewB: equivocation.views.b,
      every: HEARTBEAT_EVERY,
    });
    const withholdingCheck = detectWithholding({ viewA: withholding.views.a, viewB: withholding.views.b });
    const rollbackCheck = detectRollback({ view: rollback.views.b, knownHeadSeq: headOf(rollback.views.a).seq });

    // Trade-off curve: how many events can a split view stay hidden, and how many
    // head exchanges does detection cost, for each heartbeat interval?
    const tradeoff = [];
    for (const every of [1, 2, 4, 8, 16]) {
      const outcome = verifyHeartbeat({
        viewA: equivocation.views.a,
        viewB: equivocation.views.b,
        every,
      });
      const exchanges = Math.ceil(Math.min(equivocation.views.a.length, equivocation.views.b.length) / every);
      tradeoff.push({
        heartbeatEvery: every,
        exchangesBeforeDetection: exchanges,
        detectedAtSeq: outcome.divergenceAt,
        detectionLag: outcome.divergenceAt === null ? null : Math.max(0, outcome.divergenceAt - (FORK_SEQ + 1)),
        maxEventsHiddenBetweenExchanges: outcome.maxEventsHiddenBetweenExchanges,
      });
    }

    const results = {
      equivocation: {
        singleView: {
          detected: single.equivocationDetected,
          reasoning: single.reason,
        },
        crossCheck: {
          detected: crossCheck.equivocationDetected,
          divergenceAt: crossCheck.divergenceAt,
        },
        heartbeat: {
          detected: heartbeat.equivocationDetected,
          divergenceAt: heartbeat.divergenceAt,
          maxEventsHiddenBetweenExchanges: heartbeat.maxEventsHiddenBetweenExchanges,
          checkpoints: heartbeat.checkpoints.length,
        },
      },
      withholding: {
        crossCheck: { detected: withholdingCheck.detected, gap: withholdingCheck.gap },
      },
      rollback: {
        headComparison: { detected: rollbackCheck.detected, head: rollbackCheck.head, knownHeadSeq: rollbackCheck.knownHeadSeq },
      },
    };

    const report = {
      valid: true,
      protocol,
      generatedAt: new Date().toISOString(),
      parameters: {
        events: EVENTS,
        forkSeq: FORK_SEQ,
        heartbeatEvery: HEARTBEAT_EVERY,
        bodyAEvents: viewA.length,
        bodyBEvents: viewB.length,
      },
      identities: {
        agentId: identity.agentId,
        publicKeyFingerprint: identity.publicKeyFingerprint,
      },
      heads: {
        honest: headOf(source),
        viewA: headOf(equivocation.views.a),
        viewB: headOf(equivocation.views.b),
        digests: {
          honest: chainDigest(source),
          viewA: chainDigest(equivocation.views.a),
          viewB: chainDigest(equivocation.views.b),
        },
      },
      results,
      tradeoff,
      claims: [
        {
          claim: 'A single reader cannot detect equivocation from one internally valid chain.',
          status: single.equivocationDetected ? 'refuted' : 'supported',
          evidence: 'single-view strategy saw a valid chain with a valid signature and no comparison point',
        },
        {
          claim: 'Two readers comparing heads detect a split view at the first diverging sequence.',
          status: crossCheck.equivocationDetected ? 'supported' : 'refuted',
          evidence: `divergence first appears at seq ${crossCheck.divergenceAt}`,
        },
        {
          claim: 'Heartbeat head exchange bounds how long a split view stays hidden.',
          status: heartbeat.equivocationDetected ? 'supported' : 'refuted',
          evidence: `detected at heartbeat seq ${heartbeat.divergenceAt}; at most ${heartbeat.maxEventsHiddenBetweenExchanges} events can hide between exchanges, but the split itself began earlier`,
        },
        {
          claim: 'Withholding is invisible without an expected head, and visible with one.',
          status: withholdingCheck.detected ? 'supported' : 'refuted',
          evidence: `length gap ${withholdingCheck.gap}; detection needs a second reference or a known head`,
        },
        {
          claim: 'A rollback is detectable only if the reader remembers a higher head.',
          status: rollbackCheck.detected ? 'supported' : 'refuted',
          evidence: `relay head ${rollbackCheck.head.seq} < known head ${rollbackCheck.knownHeadSeq}`,
        },
      ],
      limitations: [
        'This is a deterministic simulation of relay behaviour, not a live network experiment.',
        'Signatures prove authorship and integrity, not uniqueness or freshness.',
        'Cross-check assumes readers can reach each other; a partitioned reader cannot.',
        'Nothing here detects a relay that consistently serves one view to everyone.',
      ],
      boundary: 'Simulation only. No public network, no third-party relay, no real model call.',
    };

    const target = path.resolve(root, process.env.NNA_RELAY_TRUST_OUT ?? 'evidence/relay-trust/report.json');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      valid: report.valid,
      reportPath: path.relative(root, target),
      equivocation: results.equivocation,
      withholding: results.withholding,
      rollback: results.rollback,
      claims: report.claims.map((claim) => `${claim.status}: ${claim.claim}`),
    }, null, 2));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`nna relay-trust-experiment: ${error.message}`);
  process.exitCode = 1;
});
