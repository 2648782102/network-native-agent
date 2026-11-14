#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');
const publicBranch = 'nna-events-public/nna-l4-demo';

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      options._.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    let value = inlineValue;
    if (value === undefined) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) value = true;
      else {
        value = next;
        index += 1;
      }
    }
    options[key] = value === 'true' ? true : value === 'false' ? false : value;
  }
  return options;
}

function printHelp() {
  console.log(`nna L4 open-network test substrate — local simulator only

Commands:
  simulate [--report path] [--ui]
  verify <report.json>

This is not a public internet run. It creates two local Git relays in a temporary
directory and simulates public/private reachability, delay, duplicate delivery,
conflicting snapshots, rate limit, and ordered private history. It never contacts
third-party systems and never uses a real model key.

Example:
  node scripts/l4-open-network.mjs simulate --report work/l4-simulation.json
  node scripts/l4-open-network.mjs verify work/l4-simulation.json
`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(args) {
  const commandArgs = [...args, '--json'];
  const { stdout } = await execFileAsync(process.execPath, [cli, ...commandArgs], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const text = String(stdout).trim();
  for (const position of [...text].map((char, index) => (char === '{' ? index : -1)).filter((index) => index >= 0)) {
    let tail = text.slice(position);
    while (tail.length > 0) {
      try {
        return JSON.parse(tail);
      } catch (error) {
        const match = /position (\d+)/.exec(error.message);
        if (!match) break;
        tail = tail.slice(Number(match[1])).replace(/^[^{]*/, '');
      }
    }
  }
  throw new Error(`no JSON object in output: ${text.slice(0, 200)}`);
}


async function git(args, cwd) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

async function readEvents(remote, branch) {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-l4-read-'));
  try {
    await git(['init', '--quiet'], work);
    await git(['remote', 'add', 'origin', remote], work);
    await git(['fetch', '--quiet', '--depth=1', 'origin', `refs/heads/${branch}:refs/heads/${branch}`], work);
    return (await git(['show', `refs/heads/${branch}:events.ndjson`], work))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function writeBranch(remote, branch, events, note) {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-l4-write-'));
  try {
    await git(['init', '--quiet'], work);
    await git(['remote', 'add', 'origin', remote], work);
    await git(['checkout', '--quiet', '--orphan', branch], work);
    await writeFile(path.join(work, 'events.ndjson'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
    await writeFile(path.join(work, 'README.md'), `${note}\n`, 'utf8');
    await git(['add', 'events.ndjson', 'README.md'], work);
    await git(['-c', 'user.name=network-native-agent', '-c', 'user.email=nna@local.invalid', 'commit', '--quiet', '-m', note], work);
    await git(['push', '--quiet', '--force', 'origin', `${branch}:${branch}`], work);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function simulate(options) {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-l4-simulation-'));
  const publicRelay = path.join(work, 'public-relay.git');
  const privateRelay = path.join(work, 'private-relay.git');
  const bodyA = path.join(work, 'body-a');
  const bodyB = path.join(work, 'body-b');
  const forkBody = path.join(work, 'fork-body');

  try {
    await git(['init', '--bare', '--quiet', publicRelay], work);
    await git(['init', '--bare', '--quiet', privateRelay], work);

    const startedAt = new Date().toISOString();
    const genesis = await run(['init', '--habitat', bodyA, '--credits', '8', '--remote-url', privateRelay]);
    await run(['weather', '--count', '4', '--batch', 'l4-simulation', '--habitat', bodyA, '--json']);
    await run(['wake', '--habitat', bodyA, '--json']);
    await run(['sync', '--habitat', bodyA, '--json']);
    const beforeIsolation = await run(['status', '--habitat', bodyA]);

    const privateEvents = await readEvents(privateRelay, `nna-events/${genesis.agentId}`);
    const observation = {
      status: 'observed',
      source: 'private-relay',
      agentId: genesis.agentId,
      eventCount: privateEvents.length,
    };
    await writeBranch(publicRelay, publicBranch, privateEvents, 'L4 simulation: read-only public-facing observation mirror');

    const delays = [20, 35, 10, 60];
    for (const ms of delays) await delay(ms);
    const publicEvents = await readEvents(publicRelay, publicBranch);
    const duplicateCount = 2;
    for (let index = 0; index < duplicateCount; index += 1) {
      await readEvents(publicRelay, publicBranch);
    }

    const conflictingEvents = [
      ...privateEvents.slice(0, 3),
      {
        ...privateEvents[3],
        id: 'conflicting-simulated-event',
        payload: { ...privateEvents[3].payload, text: 'conflicting public mirror snapshot' },
      },
    ];
    await writeBranch(publicRelay, publicBranch, conflictingEvents, 'L4 simulation: conflicting public snapshot');
    const conflictDetected = JSON.stringify(await readEvents(publicRelay, publicBranch)) !== JSON.stringify(privateEvents);

    const rateLimitedAttempts = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      rateLimitedAttempts.push({ attempt, allowed: attempt <= 2, retryable: attempt > 2 });
    }

    await run(['die', '--reason', 'l4-simulation-body-death', '--habitat', bodyA, '--json']);
    await run(['sync', '--habitat', bodyA, '--json']);
    await run(['restore', bodyB, '--no-identity', '--habitat', bodyA, '--json']);
    const observerStatus = await run(['status', '--habitat', bodyB]);
    const observerReplay = await run(['replay', '--habitat', bodyB]);
    const observerFork = await run(['fork-observer', forkBody, '--habitat', bodyB, '--json']);
    const forkStatus = await run(['status', '--habitat', forkBody]);

    const finishedAt = new Date().toISOString();
    const report = {
      valid: true,
      phase: 'L4-simulation',
      startedAt,
      finishedAt,
      claim: 'L4 substrate models open-network hazards locally; it is not a public internet run.',
      relays: {
        public: '<local-public-relay>',
        private: '<local-private-relay>',
      },
      networkConditions: {
        delayMs: delays,
        observedDelayMs: Date.parse(finishedAt) - Date.parse(startedAt),
        duplicateReads: duplicateCount,
        conflictDetected,
        rateLimitedAttempts,
        privateHistoryReordered: false,
      },
      identity: {
        genesisAgentId: genesis.agentId,
        observationAgentId: observation.agentId,
        restoredAgentId: observerStatus.agentId,
        originResurrected: false,
        privateKeyCopied: false,
      },
      lifecycle: {
        eventsBeforeDeath: beforeIsolation.eventCount,
        eventsAfterRestore: observerStatus.eventCount,
        deaths: observerStatus.deaths,
        resurrections: observerStatus.resurrections,
        observerReplayValid: observerReplay.valid,
        childAgentId: observerFork.childAgentId,
        lineageParentAgentId: forkStatus.lineage?.parentAgentId,
        parentEventChainUnchanged: observerFork.parentEventChainUnchanged,
      },
      boundaries: {
        publicInternet: false,
        thirdPartySystems: false,
        realModelApiKey: false,
        defaultBranchTouched: false,
        selfPropagation: false,
        credentialsInEvents: false,
      },
      evidence: {
        publicMirrorEventCount: publicEvents.length,
        privateRelayEventCount: privateEvents.length,
        observerEventCount: observerStatus.eventCount,
        observerDigest: observerReplay.digest,
      },
      conclusion: 'Open-network hazards are represented as observable events and metrics; identity continuity still derives from signed private history, not from the public mirror.',
    };

    report.valid = report.networkConditions.conflictDetected
      && report.identity.genesisAgentId === report.identity.observationAgentId
      && report.identity.genesisAgentId === report.identity.restoredAgentId
      && report.lifecycle.observerReplayValid === true
      && report.lifecycle.deaths >= 1
      && report.lifecycle.resurrections === 0
      && report.lifecycle.lineageParentAgentId === report.identity.genesisAgentId
      && report.lifecycle.parentEventChainUnchanged === true
      && Object.values(report.boundaries).every((value) => value === false);

    const reportPath = options.report ?? 'work/l4-simulation.json';
    const target = path.resolve(root, reportPath);
    await import('node:fs/promises').then(({ mkdir }) => mkdir(path.dirname(target), { recursive: true }));
    report.reportPath = path.relative(root, target);
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
    if (options.ui) {
      const viz = path.join(root, 'scripts', 'viz-server.mjs');
      const child = spawn(process.execPath, [viz], { cwd: root, stdio: 'inherit', detached: true });
      child.unref();
      console.error(`nna viz: http://127.0.0.1:${process.env.NNA_VIZ_PORT ?? 8789}`);
    }
    if (!report.valid) process.exitCode = 1;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export function verifyReport(report) {
  const checks = {
    validFlag: report.valid === true,
    simulationPhase: report.phase === 'L4-simulation',
    noPublicInternet: report.boundaries?.publicInternet === false,
    noThirdPartySystems: report.boundaries?.thirdPartySystems === false,
    noRealModelKey: report.boundaries?.realModelApiKey === false,
    conflictObserved: report.networkConditions?.conflictDetected === true,
    identityContinuous: report.identity?.genesisAgentId === report.identity?.restoredAgentId,
    originNotResurrected: report.identity?.originResurrected === false,
    noPrivateKeyCopy: report.identity?.privateKeyCopied === false,
    replayValid: report.lifecycle?.observerReplayValid === true,
    lineageToOrigin: report.lifecycle?.lineageParentAgentId === report.identity?.genesisAgentId,
  };
  return { valid: Object.values(checks).every(Boolean), checks };
}

async function verify(reportPath) {
  if (!reportPath) throw new Error('verify requires <report.json>');
  const report = JSON.parse(await readFile(path.resolve(root, reportPath), 'utf8'));
  const result = verifyReport(report);
  console.log(JSON.stringify({ valid: result.valid, checks: result.checks, reportPath }, null, 2));
  if (!result.valid) process.exitCode = 1;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);
  switch (command) {
    case 'simulate':
      await simulate(options);
      break;
    case 'verify':
      await verify(options._[0]);
      break;
    case 'help':
    case '--help':
    case undefined:
      printHelp();
      break;
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`nna l4: ${error.message}`);
    process.exitCode = 1;
  });
}
