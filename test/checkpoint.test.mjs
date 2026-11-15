import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createEvent, generateIdentity, hashText } from '../src/crypto.mjs';
import { verifyChain } from '../src/events.mjs';
import {
  checkpointSubject,
  readCheckpoint,
  validateCheckpoint,
  writeCheckpoint,
} from '../src/checkpoint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function buildChain(identity, count, tag = 'event') {
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
        : { source: 'relay', text: `${tag} ${seq}` },
    });
    events.push(event);
    parent = event.id;
  }
  return events;
}

function digestOf(events) {
  return hashText(events.map((event) => event.id).join('\n'));
}

test('skipping signatures still recomputes ids and catches prefix tampering', () => {
  const identity = generateIdentity();
  const events = buildChain(identity, 8);
  assert.doesNotThrow(() => verifyChain(events, { skipSignatureBefore: 8 }));

  const tampered = events.map((event) => ({ ...event }));
  tampered[3] = {
    ...tampered[3],
    payload: { ...tampered[3].payload, text: 'forged payload' },
  };
  assert.throws(
    () => verifyChain(tampered, { skipSignatureBefore: 8 }),
    /id does not match canonical content/,
    'skipping signatures must not skip id recomputation',
  );
});

test('skipping signatures still catches broken parent linkage', () => {
  const identity = generateIdentity();
  const events = buildChain(identity, 6);
  const reordered = [events[0], events[2], events[1], ...events.slice(3)];
  assert.throws(() => verifyChain(reordered, { skipSignatureBefore: 6 }), /seq|parent/);
});

test('a valid checkpoint lets verification skip exactly the covered prefix', () => {
  const identity = generateIdentity();
  const events = buildChain(identity, 10);
  const checkpoint = createEvent(identity.privatePem, {
    seq: 1,
    parent: null,
    type: 'checkpoint',
    bodyId: 'local',
    at: new Date().toISOString(),
    payload: {
      version: 1,
      size: 6,
      headId: events[5].id,
      headSeq: events[5].seq,
      chainDigest: digestOf(events.slice(0, 6)),
      subject: checkpointSubject({
        size: 6,
        headId: events[5].id,
        headSeq: events[5].seq,
        chainDigest: digestOf(events.slice(0, 6)),
      }),
    },
  });

  const verdict = validateCheckpoint(checkpoint, events, identity.agentId);
  assert.equal(verdict.usable, true);
  assert.equal(verdict.size, 6);
});

test('a checkpoint is rejected when its head does not match the chain', () => {
  const identity = generateIdentity();
  const events = buildChain(identity, 10);
  const wrongHead = buildChain(identity, 10, 'different');
  assert.notEqual(events[5].id, wrongHead[5].id, 'the two chains must actually differ');
  const checkpoint = createEvent(identity.privatePem, {
    seq: 1,
    parent: null,
    type: 'checkpoint',
    bodyId: 'local',
    at: new Date().toISOString(),
    payload: {
      version: 1,
      size: 6,
      headId: wrongHead[5].id,
      headSeq: 6,
      chainDigest: digestOf(events.slice(0, 6)),
      subject: checkpointSubject({
        size: 6,
        headId: wrongHead[5].id,
        headSeq: 6,
        chainDigest: digestOf(events.slice(0, 6)),
      }),
    },
  });
  assert.equal(validateCheckpoint(checkpoint, events, identity.agentId).usable, false);
});

test('a checkpoint from another agent is rejected', () => {
  const identity = generateIdentity();
  const other = generateIdentity();
  const events = buildChain(identity, 5);
  const strangerEvents = buildChain(other, 5);
  const checkpoint = createEvent(other.privatePem, {
    seq: 1,
    parent: null,
    type: 'checkpoint',
    bodyId: 'local',
    at: new Date().toISOString(),
    payload: {
      version: 1,
      size: 5,
      headId: strangerEvents[4].id,
      headSeq: 5,
      chainDigest: digestOf(strangerEvents),
      subject: checkpointSubject({
        size: 5,
        headId: strangerEvents[4].id,
        headSeq: 5,
        chainDigest: digestOf(strangerEvents),
      }),
    },
  });
  const verdict = validateCheckpoint(checkpoint, events, identity.agentId);
  assert.equal(verdict.usable, false);
  assert.match(verdict.reason, /different agent/);
});

test('a checkpoint claiming more events than the chain is rejected', () => {
  const identity = generateIdentity();
  const events = buildChain(identity, 4);
  const checkpoint = createEvent(identity.privatePem, {
    seq: 1,
    parent: null,
    type: 'checkpoint',
    bodyId: 'local',
    at: new Date().toISOString(),
    payload: {
      version: 1,
      size: 99,
      headId: events[3].id,
      headSeq: 4,
      chainDigest: digestOf(events),
      subject: checkpointSubject({ size: 99, headId: events[3].id, headSeq: 4, chainDigest: digestOf(events) }),
    },
  });
  const verdict = validateCheckpoint(checkpoint, events, identity.agentId);
  assert.equal(verdict.usable, false);
  assert.match(verdict.reason, /covers 99 events/);
});

test('checkpoint round-trips through disk and survives a tampered file', async () => {
  const identity = generateIdentity();
  const events = buildChain(identity, 5);
  const habitat = await mkdtemp(path.join(os.tmpdir(), 'nna-checkpoint-'));
  try {
    await writeCheckpoint(habitat, {
      size: 5,
      headId: events[4].id,
      headSeq: 5,
      chainDigest: digestOf(events),
      privatePem: identity.privatePem,
    });
    const stored = await readCheckpoint(habitat);
    assert.equal(validateCheckpoint(stored, events, identity.agentId).usable, true);

    const file = path.join(habitat, 'checkpoint.json');
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    parsed.payload.size = 4;
    await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    const tampered = await readCheckpoint(habitat);
    assert.equal(validateCheckpoint(tampered, events, identity.agentId).usable, false);
  } finally {
    await rm(habitat, { recursive: true, force: true });
  }
});

test('the checkpoint file is git-ignored so local state stays local', async () => {
  const ignore = await readFile(path.join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /habitat\//, 'habitat directory must stay untracked');
});

test('incremental verification is measured and strictly cheaper than full', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/incremental-verify/report.json'), 'utf8'));
  assert.equal(report.protocol, 'incremental-verify-v1');
  assert.equal(report.valid, true);
  assert.ok(report.rows.length >= 3);

  const sizes = report.rows.map((row) => row.events);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b));

  for (const row of report.rows) {
    assert.ok(row.incrementalVerifyMs < row.fullVerifyMs, `incremental must win at ${row.events}`);
    assert.ok(row.speedup > 3, `speedup should be meaningful at ${row.events}`);
    assert.ok(row.signaturesRechecked < row.signaturesSkipped);
  }
});

test('INCREMENTAL_VERIFY.md reports the real speedup, not a marketing number', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/incremental-verify/report.json'), 'utf8'));
  const doc = await readFile(path.join(root, 'INCREMENTAL_VERIFY.md'), 'utf8');

  for (const row of report.rows) {
    assert.ok(doc.includes(String(row.events)), `doc must mention ${row.events} events`);
    assert.ok(doc.includes(String(Math.round(row.fullVerifyMs))), `doc must quote full time for ${row.events}`);
    assert.ok(doc.includes(String(Math.round(row.incrementalVerifyMs))), `doc must quote incremental time for ${row.events}`);
    assert.ok(doc.includes(`${row.speedup.toFixed(1)}x`), `doc must quote speedup for ${row.events}`);
  }

  assert.match(doc, /不是数量级改善|只有 7 倍/, 'the doc must admit the gain is not asymptotic');
  assert.match(doc, /id 重算/, 'the doc must name the remaining linear cost');
  assert.match(doc, /不是常数时间/, 'the doc must reject the constant-time claim');
});

test('a habitat without an identity key still replays (read-only observer)', async () => {
  const { spawn } = await import('node:child_process');
  const habitat = await mkdtemp(path.join(os.tmpdir(), 'nna-observer-'));
  const run = (args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'bin/nna.mjs'), ...args, '--json'], {
      cwd: root,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`))));
  });

  try {
    await run(['init', '--habitat', habitat]);
    await run(['inject', 'one signal', '--source', 'relay', '--habitat', habitat]);
    const identityPath = path.join(habitat, 'identity.key');
    await rm(identityPath, { force: true });

    const output = await run(['replay', '--habitat', habitat]);
    const parsed = JSON.parse(output);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.verification.mode, 'full');
    assert.equal(parsed.verification.checkpointWritten, false);
    assert.match(parsed.verification.checkpointSkippedReason, /read-only observer/);
  } finally {
    await rm(habitat, { recursive: true, force: true });
  }
});
