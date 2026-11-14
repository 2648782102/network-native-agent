import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');

function run(args) {
  return execFileAsync(process.execPath, [cli, ...args, '--json'])
    .then(({ stdout }) => JSON.parse(stdout));
}

function git(args, cwd) {
  return execFileAsync('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

test('private Git relay restores the same agent into an independent body', async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-relay-test-'));
  const bare = path.join(work, 'event-relay.git');
  const primary = path.join(work, 'primary');
  const recovered = path.join(work, 'recovered');
  try {
    await git(['init', '--bare', '--quiet', bare], work);
    const genesis = await run(['init', '--habitat', primary, '--credits', '8', '--remote-url', bare]);
    await run(['relay', 'attach', bare, '--habitat', primary]);
    await run(['weather', '--count', '4', '--habitat', primary]);
    await run(['wake', '--habitat', primary]);
    await run(['sync', '--habitat', primary]);
    const before = await run(['status', '--habitat', primary]);
    const relay = await run(['relay', 'status', '--habitat', primary]);
    assert.equal(relay.localEventCount, relay.remoteEventCount);
    assert.equal(relay.divergent, false);

    const relayList = await run(['relay', 'ls', bare]);
    assert.equal(relayList.branchCount, 1);
    assert.equal(relayList.summaries[0].valid, true);
    assert.equal(relayList.summaries[0].agentId, genesis.agentId);
    assert.equal(relayList.summaries[0].eventCount, relay.remoteEventCount);

    await run(['restore', recovered, '--habitat', primary]);
    const after = await run(['status', '--habitat', recovered]);
    assert.equal(after.agentId, genesis.agentId);
    assert.equal(after.digest, before.digest);
    assert.equal(after.eventCount, before.eventCount);
    assert.equal(after.bodyCount, before.bodyCount);

    const replayResult = await run(['replay', '--habitat', recovered]);
    assert.equal(replayResult.valid, true);
    assert.equal(replayResult.agentId, genesis.agentId);

    await run(['relay', 'attach', bare, '--habitat', recovered]);
    const primaryOnly = await run(['inject', 'primary-only', '--habitat', primary]);
    assert.match(primaryOnly.id, /^[0-9a-f]{64}$/);
    const recoveredOnly = await run(['inject', 'recovered-only', '--habitat', recovered]);
    assert.match(recoveredOnly.id, /^[0-9a-f]{64}$/);
    const relayAfterDivergence = await run(['relay', 'status', '--habitat', primary]);
    assert.ok(relayAfterDivergence.localEventCount >= 1);
    assert.ok(relayAfterDivergence.remoteEventCount >= 1);
    const recoveredStatus = await run(['status', '--habitat', recovered]);
    assert.equal(recoveredStatus.agentId, genesis.agentId);

    const metrics = await run(['metrics', '--habitat', recovered]);
    assert.equal(metrics.identityContinuity, true);
    assert.ok(metrics.bodyTurnover >= 1);
    assert.ok(metrics.observerPollution >= 0 && metrics.observerPollution <= 1);
    assert.ok(metrics.eventCount > 1);

    const child = path.join(work, 'child');
    const fork = await run(['fork', child, '--habitat', recovered]);
    assert.equal(fork.publishedToRelay, true);
    const relayAfterChildFork = await run(['relay', 'status', '--habitat', primary]);
    assert.ok(relayAfterChildFork.remoteEventCount >= recoveredStatus.eventCount);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('relay detects a different genesis identity without overwriting it', async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-relay-conflict-'));
  const bare = path.join(work, 'event-relay.git');
  const primary = path.join(work, 'primary');
  try {
    await git(['init', '--bare', '--quiet', bare], work);
    await run(['init', '--habitat', primary, '--credits', '4', '--remote-url', bare]);
    const foreign = path.join(work, 'foreign');
    const foreignGenesis = await run(['init', '--habitat', foreign, '--credits', '4', '--force']);
    const primaryRelay = await run(['relay', 'status', '--habitat', primary]);
    await assert.rejects(
      run(['relay', 'attach', bare, '--branch', primaryRelay.branch, '--habitat', foreign]),
      (error) => /different genesis/i.test(String(error.stderr ?? error)),
    );
    await assert.rejects(
      run(['relay', 'attach', bare, '--branch', primaryRelay.branch, '--habitat', foreign, '--push=false']),
      (error) => /different genesis/i.test(String(error.stderr ?? error)),
    );
    assert.notEqual(foreignGenesis.agentId, '');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
