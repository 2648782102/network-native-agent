import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testEnv = path.join(root, 'scripts', 'test-env.mjs');

function command(args, environment = {}) {
  return execFileAsync(process.execPath, [testEnv, ...args], {
    cwd: root,
    env: { ...process.env, ...environment },
    maxBuffer: 4 * 1024 * 1024,
  }).then(({ stdout }) => stdout.trim() ? JSON.parse(stdout) : null);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForUrl(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status > 0) return;
    } catch {
      // The loopback server is still starting.
    }
    await sleep(50);
  }
  throw new Error(`loopback server did not start: ${url}`);
}

async function startCommand(args, environment = {}) {
  const child = spawn(process.execPath, [testEnv, ...args], {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  return {
    child,
    output: () => ({ stdout, stderr }),
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    },
  };
}

test('test environment initializes, checks and reports without leaving secrets in events', async (context) => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-test-env-'));
  const testRoot = path.join(work, 'environment');
  const environment = {
    NNA_TEST_ROOT: testRoot,
    NNA_TEST_HABITAT_PORT: '18877',
    NNA_TEST_MODEL_PORT: '18878',
  };
  context.after(async () => rm(work, { recursive: true, force: true }));

  const initialized = await command(['init'], environment);
  assert.equal(initialized.status, 'test_environment_ready');
  assert.match(initialized.agentId, /^nna_[0-9a-f]{16}$/);
  assert.match(initialized.relayBranch, /^nna-events\/nna_/);

  const manifest = JSON.parse(await readFile(path.join(testRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.boundaries.includes('local bare Git relay only'), true);
  assert.equal(await readFile(path.join(testRoot, 'README.md'), 'utf8') !== '', true);
  assert.equal(await readFile(path.join(testRoot, 'body-a', 'relay.json'), 'utf8') !== '', true);
  await assert.rejects(readFile(path.join(testRoot, 'observer', 'identity.key'), 'utf8'));
  await assert.rejects(readFile(path.join(testRoot, 'observer', 'relay.json'), 'utf8'));

  const checked = await command(['check'], environment);
  assert.equal(checked.valid, true);
  assert.deepEqual(checked.failedChecks, []);
  assert.ok(checked.checkCount >= 15);

  const report = await command(['report'], environment);
  assert.equal(report.status, 'test_environment_report');
  assert.equal(report.bodyA.agentId, initialized.agentId);
  assert.equal(report.bodyA.relay.divergent, false);

  const reset = await command(['reset', '--yes'], environment);
  assert.equal(reset.status, 'test_environment_ready');
  assert.notEqual(reset.agentId, initialized.agentId);
});

test('test environment serves a loopback habitat and fake model organ', async (context) => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-test-env-servers-'));
  const testRoot = path.join(work, 'environment');
  const modelPort = 18879;
  const habitatPort = 18880;
  const environment = {
    NNA_TEST_ROOT: testRoot,
    NNA_TEST_HABITAT_PORT: String(habitatPort),
    NNA_TEST_MODEL_PORT: String(modelPort),
  };
  const servers = [];
  context.after(async () => {
    for (const server of servers) await server.stop();
    await rm(work, { recursive: true, force: true });
  });

  await command(['init'], environment);
  const habitatServer = await startCommand(['serve'], environment);
  servers.push(habitatServer);
  await waitForUrl(`http://127.0.0.1:${habitatPort}/health`);
  const health = await fetch(`http://127.0.0.1:${habitatPort}/health`).then((response) => response.json());
  assert.equal(health.agentId.startsWith('nna_'), true);

  const modelServer = await startCommand(['model'], {
    ...environment,
    NNA_TEST_MODEL_IMPULSE: 'sleep',
  });
  servers.push(modelServer);
  await waitForUrl(`http://127.0.0.1:${modelPort}/v1/chat/completions`);
  const modelOutput = JSON.parse(modelServer.output().stdout);
  assert.equal(modelOutput.status, 'fake_model_organ_listening');
  assert.equal(modelOutput.impulse, 'sleep');
  assert.equal(modelOutput.fakeApiKey, 'test-only-cognition-key');
  assert.equal(modelOutput.exportCommands.includes('export NNA_COGNITION=model'), true);
});

test('test environment rejects an unsafe test root', async () => {
  await assert.rejects(
    command(['init'], { NNA_TEST_ROOT: '.' }),
    (error) => /dedicated directory/.test(String(error.stderr ?? error)),
  );
  await assert.rejects(
    command(['reset', '--yes'], { NNA_TEST_ROOT: '.' }),
    (error) => /dedicated directory/.test(String(error.stderr ?? error)),
  );
});
