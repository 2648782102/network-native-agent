import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');
let work;
let habitat;

function command(args) {
  return execFileAsync(process.execPath, [cli, ...args, '--habitat', habitat, '--json'])
    .then(({ stdout }) => JSON.parse(stdout));
}

before(async () => {
  work = await mkdtemp(path.join(os.tmpdir(), 'nna-test-'));
  habitat = path.join(work, 'habitat');
  await command(['init', '--credits', '3']);
});

after(async () => {
  await rm(work, { recursive: true, force: true });
});

test('genesis creates a signed identity and empty state', async () => {
  const status = await command(['status']);
  assert.match(status.agentId, /^nna_[0-9a-f]{16}$/);
  assert.equal(status.eventCount, 1);
  assert.equal(status.alive, true);
  assert.equal(status.credits, 3);
  const replayResult = await command(['replay']);
  assert.equal(replayResult.valid, true);
  assert.equal(replayResult.eventCount, 1);
});

test('different bodies preserve one agent identity', async () => {
  await command(['inject', '第一条网络天气', '--source', 'relay']);
  const first = await command(['wake']);
  await command(['inject', '第二条网络天气', '--source', 'feed']);
  const second = await command(['wake']);
  const status = await command(['status']);
  assert.notEqual(first.bodyId, second.bodyId);
  assert.equal(first.agentId, second.agentId);
  assert.equal(status.agentId, first.agentId);
  assert.equal(status.pulses, 2);
  assert.equal(status.bodyCount, 2);
  assert.equal(status.pending, 0);
});

test('death is a lifecycle event and blocks the next body', async () => {
  await command(['inject', '耗尽代谢'], '--source', 'relay').catch(() => command(['inject', '耗尽代谢', '--source', 'relay']));
  await command(['wake']);
  let status = await command(['status']);
  assert.equal(status.alive, false);
  assert.equal(status.deathReason, 'budget_exhausted');
  const blocked = await command(['wake']);
  assert.equal(blocked.status, 'dead');
  assert.equal(blocked.events, 0);
  const death = await command(['die', '--reason', 'test']);
  assert.equal(death.status, 'already_dead');
  status = await command(['status']);
  assert.equal(status.deaths, 1);
});

test('resurrection preserves history and creates another body', async () => {
  const before = await command(['status']);
  const result = await command(['resurrect', '--wake', '--credits', '3']);
  const afterStatus = await command(['status']);
  assert.equal(result.alive, true);
  assert.equal(afterStatus.resurrections, 1);
  assert.equal(afterStatus.deaths, before.deaths);
  assert.equal(afterStatus.agentId, before.agentId);
  assert.ok(afterStatus.eventCount > before.eventCount);
  assert.equal(afterStatus.lineage, null);
});

test('fork creates a new signed identity with parent lineage', async () => {
  const child = path.join(work, 'child');
  const parent = await command(['status']);
  const fork = await command(['fork', child]);
  const childStatus = await execFileAsync(process.execPath, [cli, 'status', '--habitat', child, '--json'])
    .then(({ stdout }) => JSON.parse(stdout));
  assert.notEqual(fork.childAgentId, parent.agentId);
  assert.equal(childStatus.agentId, fork.childAgentId);
  assert.equal(childStatus.lineage.parentAgentId, parent.agentId);
  assert.equal(childStatus.eventCount, 1);
  const parentAfter = await command(['status']);
  assert.equal(parentAfter.forks, 1);
});

test('tampered event stream fails replay', async () => {
  const tamperedHabitat = path.join(work, 'tampered');
  const eventsPath = path.join(habitat, 'events.ndjson');
  const eventsText = await readFile(eventsPath, 'utf8');
  const tampered = eventsText.replace('第一条网络天气', '被篡改的网络天气');
  await execFileAsync(process.execPath, [cli, 'init', '--habitat', tamperedHabitat, '--force', '--json']).catch(() => {});
  await writeFile(path.join(tamperedHabitat, 'events.ndjson'), tampered, 'utf8');
  await assert.rejects(
    execFileAsync(process.execPath, [cli, 'replay', '--habitat', tamperedHabitat, '--json']),
    (error) => /id does not match|invalid signature|parent does not match/.test(String(error.stderr ?? error)),
  );
});
