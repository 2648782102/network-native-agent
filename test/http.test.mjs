import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('server did not become healthy');
}

async function freePort() {
  const { stdout } = await execFileAsync(process.execPath, ['-e', `
    const net = require('node:net');
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      console.log(server.address().port);
      server.close();
    });
  `], { encoding: 'utf8' });
  return Number(stdout.trim());
}

test('loopback habitat accepts network weather and wakes a body', async (context) => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-http-'));
  const habitat = path.join(work, 'habitat');
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const init = spawn(process.execPath, [cli, 'init', '--habitat', habitat, '--credits', '2', '--json'], { stdio: 'pipe' });
  await new Promise((resolve, reject) => init.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`init failed: ${code}`))));
  const server = spawn(process.execPath, [cli, 'serve', '--habitat', habitat, '--port', String(port)], { stdio: 'pipe' });
  context.after(async () => {
    if (!server.killed && server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM');
      await new Promise((resolve) => {
        if (server.exitCode !== null || server.signalCode !== null) resolve();
        else server.once('exit', resolve);
      });
    }
    await rm(work, { recursive: true, force: true });
  });
  await waitForHealth(url);

  const before = await fetch(`${url}/status`).then((response) => response.json());
  const eventResponse = await fetch(`${url}/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'relay', text: 'HTTP 网络天气' }),
  });
  const event = await eventResponse.json();
  assert.ok(eventResponse.ok);
  assert.match(event.eventId, /^[0-9a-f]{64}$/);
  assert.equal(event.wake.alive, true);

  const after = await fetch(`${url}/status`).then((response) => response.json());
  assert.equal(after.agentId, before.agentId);
  assert.equal(after.pulses, 1);
  assert.equal(after.bodyCount, 1);
  assert.equal(after.pending, 0);

  const trace = await fetch(`${url}/trace?last=10`).then((response) => response.json());
  assert.ok(trace.some((item) => item.type === 'perception'));
  assert.ok(trace.some((item) => item.type === 'pulse'));
  assert.ok(trace.some((item) => item.type === 'heartbeat'));
});
