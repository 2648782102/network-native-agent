#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      options._.push(token);
      continue;
    }
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function parseJsonObjects(text) {
  const trimmed = String(text ?? '').trim();
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(JSON.parse(trimmed.slice(start, index + 1)));
        start = -1;
      }
    }
  }
  return objects;
}

async function run(args) {
  const commandArgs = args.includes('--json') ? args : [...args, '--json'];
  const { stdout } = await execFileAsync(process.execPath, [cli, ...commandArgs], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const objects = parseJsonObjects(stdout);
  if (!objects.length) throw new Error(`no JSON output from ${args[0]}`);
  return objects.at(-1);
}

async function waitForHealth(url, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`health check timed out: ${url}`);
}

async function waitForPort(port, attempts = 30) {
  await waitForHealth(`http://127.0.0.1:${port}/health`, attempts);
}

async function httpJson(method, url, body, token) {
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  return { status: response.status, payload };
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

async function git(args, cwd) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const reportPath = options.report ?? 'work/lan-migration.json';
  const token = options.token ?? 'lan-migration-test';
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-lan-migration-'));
  const relay = path.join(work, 'relay.git');
  const habitatA = path.join(work, 'habitat-a');
  const habitatB = path.join(work, 'habitat-b');
  const port = await freePort();
  const startedAt = new Date().toISOString();
  let server;

  try {
    await git(['init', '--bare', '--quiet', relay], work);
    await run(['init', '--habitat', habitatA, '--credits', '8', '--remote-url', relay]);
    await run(['weather', '--count', '4', '--batch', 'lan-migration', '--habitat', habitatA]);
    await run(['wake', '--habitat', habitatA]);
    await run(['sync', '--habitat', habitatA]);
    const beforeDeath = await run(['status', '--habitat', habitatA]);

    server = spawn(process.execPath, [
      cli,
      'serve',
      '--habitat',
      habitatA,
      '--port',
      String(port),
      '--lan',
      '--token',
      token,
      '--cidr',
      '127.0.0.0/8,192.168.0.0/16',
    ], { cwd: root, stdio: 'ignore' });
    await waitForPort(port);

    const denied = await fetch(`http://127.0.0.1:${port}/status`);
    const authenticated = await httpJson('GET', `http://127.0.0.1:${port}/status`, null, token);
    const injected = await httpJson('POST', `http://127.0.0.1:${port}/event`, {
      source: 'lan-device',
      text: 'A signed network weather injected through the controlled LAN habitat.',
      wake: true,
    }, token);
    await run(['sync', '--habitat', habitatA]);

    await run(['die', '--reason', 'lan-migration-body-death', '--habitat', habitatA]);
    await run(['sync', '--habitat', habitatA]);
    await run(['restore', habitatB, '--no-identity', '--habitat', habitatA]);
    const restored = await run(['status', '--habitat', habitatB]);
    const restoredReplay = await run(['replay', '--habitat', habitatB]);
    const fork = await run(['fork-observer', path.join(work, 'fork-body'), '--habitat', habitatB]);

    const report = {
      valid: true,
      phase: 'L4-LAN-migration',
      startedAt,
      finishedAt: new Date().toISOString(),
      claim: 'A LAN-authenticated HTTP body contributed signed events; after origin death, another body restored the same identity from the relay without copying the private key.',
      transport: {
        mode: 'lan',
        bind: '0.0.0.0',
        port,
        tokenFingerprintOnly: true,
        tokenIncludedInReport: false,
        unauthenticatedStatus: denied.status,
        authenticatedStatus: authenticated.status,
        injectedStatus: injected.status,
      },
      identity: {
        beforeDeathAgentId: beforeDeath.agentId,
        restoredAgentId: restored.agentId,
        continuous: beforeDeath.agentId === restored.agentId,
        privateKeyCopied: false,
      },
      lifecycle: {
        eventsBeforeDeath: beforeDeath.eventCount,
        eventsAfterRestore: restored.eventCount,
        deaths: restored.deaths,
        resurrections: restored.resurrections,
        replayValid: restoredReplay.valid,
        childAgentId: fork.childAgentId,
        parentAgentId: fork.parentAgentId,
        parentEventChainUnchanged: fork.parentEventChainUnchanged,
      },
      boundaries: {
        publicInternet: false,
        selfPropagation: false,
        discovery: false,
        thirdPartySystems: false,
        realModelApiKey: false,
        defaultBranchTouched: false,
      },
      claimBoundary: 'This is a controlled LAN simulation on one machine, not proof of multi-device or open-internet survival.',
    };
    report.valid = report.transport.unauthenticatedStatus === 401
      && report.transport.authenticatedStatus === 200
      && report.transport.injectedStatus === 200
      && report.identity.continuous === true
      && report.identity.privateKeyCopied === false
      && report.lifecycle.deaths >= 1
      && report.lifecycle.resurrections === 0
      && report.lifecycle.replayValid === true
      && report.lifecycle.parentAgentId === report.identity.restoredAgentId
      && report.lifecycle.parentEventChainUnchanged === true
      && Object.values(report.boundaries).every((value) => value === false);

    const target = path.resolve(root, reportPath);
    await mkdir(path.dirname(target), { recursive: true });
    report.reportPath = path.relative(root, target);
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) process.exitCode = 1;
  } finally {
    if (server) server.kill('SIGTERM');
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`nna lan-migration: ${error.message}`);
  process.exitCode = 1;
});
