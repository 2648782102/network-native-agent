#!/usr/bin/env node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { hashText } from '../src/crypto.mjs';
import { appendEvent, ensureHabitatDir, verifyChain, writePrivatePem } from '../src/events.mjs';
import { generateIdentity, createEvent } from '../src/crypto.mjs';
import { writeCheckpoint } from '../src/checkpoint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [1000, 5000, 10000];

function buildEvents(identity, count) {
  const events = [];
  let parent = null;
  for (let seq = 1; seq <= count; seq += 1) {
    const event = createEvent(identity.privatePem, {
      seq,
      parent,
      type: seq === 1 ? 'genesis' : 'perception',
      bodyId: seq === 1 ? 'environment' : `body_${seq}`,
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
        : { source: 'relay', text: 'x'.repeat(80) },
    });
    events.push(event);
    parent = event.id;
  }
  return events;
}

function timed(fn) {
  const started = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - started) / 1e6;
}

async function main() {
  const rows = [];
  for (const count of SIZES) {
    const identity = generateIdentity();
    const events = buildEvents(identity, count);
    const habitat = await mkdtemp(path.join(os.tmpdir(), 'nna-incremental-'));
    try {
      const paths = await ensureHabitatDir(habitat);
      await writePrivatePem(habitat, identity.privatePem);
      for (const event of events) {
        await appendEvent(habitat, event);
      }

      const fullMs = timed(() => verifyChain(events));

      const covered = Math.floor(count * 0.99);
      await writeCheckpoint(habitat, {
        size: covered,
        headId: events[covered - 1].id,
        headSeq: events[covered - 1].seq,
        chainDigest: hashText(events.slice(0, covered).map((event) => event.id).join('\n')),
        privatePem: identity.privatePem,
      });
      const incrementalMs = timed(() => verifyChain(events, { skipSignatureBefore: covered }));

      rows.push({
        events: count,
        fullVerifyMs: Number(fullMs.toFixed(1)),
        incrementalVerifyMs: Number(incrementalMs.toFixed(1)),
        speedup: Number((fullMs / Math.max(incrementalMs, 0.001)).toFixed(1)),
        signaturesSkipped: covered,
        signaturesRechecked: count - covered,
      });
      void paths;
    } finally {
      await rm(habitat, { recursive: true, force: true });
    }
  }

  const report = {
    valid: rows.every((row) => row.incrementalVerifyMs < row.fullVerifyMs),
    protocol: 'incremental-verify-v1',
    generatedAt: new Date().toISOString(),
    note: 'Local CPU only. The incremental path still recomputes every event id; it skips only Ed25519 verification for the checkpointed prefix.',
    rows,
    interpretation: [
      'Skipping signatures removes the dominant cost while keeping id recomputation, so prefix tampering is still caught.',
      'The saving grows with history length because signature verification is linear in event count.',
      'A checkpoint is only trusted after its own signature, size, head and subject are validated against the chain.',
    ],
    limitations: [
      'No disk or network timings; both paths read from memory here.',
      'The checkpoint must be stored somewhere a relay cannot rewrite, otherwise it proves nothing.',
      'Skipping signatures trusts the checkpoint; a forged checkpoint is rejected, but a checkpoint signed by a stolen key is not detectable locally.',
    ],
  };

  const target = path.resolve(root, process.env.NNA_INCREMENTAL_OUT ?? 'evidence/incremental-verify/report.json');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ valid: report.valid, reportPath: path.relative(root, target), rows }, null, 2));
}

main().catch((error) => {
  console.error(`nna measure-incremental: ${error.message}`);
  process.exitCode = 1;
});
