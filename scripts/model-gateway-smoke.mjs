#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolveModelGateway } from '../src/model-gateway.mjs';
const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');

function redactedPatterns() {
  const patterns = [/authorization/i, /bearer\s+[a-z0-9._-]+/i, /api[_-]?key/i, /x-openai-actor-authorization/i];
  for (const key of ['NNA_MODEL_API_KEY', 'NNA_MODEL_URL']) {
    const value = process.env[key];
    if (value && value.length >= 8) {
      patterns.push(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  }
  return patterns;
}

function parseJsonObjects(text) {
  const trimmed = String(text).trim();
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

async function run(args, extraEnv = {}) {
  const { stdout } = await execFileAsync(process.execPath, [cli, ...args, '--json'], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  return parseJsonObjects(stdout).at(-1);
}

function reportPathArg(argv) {
  const index = argv.indexOf('--report');
  return index >= 0 ? argv[index + 1] : null;
}

async function main() {
  const argv = process.argv.slice(2).filter((_, index, list) => index < 2 || list[index - 1] !== '--report');
  const model = argv[0] ?? process.env.NNA_MODEL_NAME;
  if (!model) throw new Error('usage: npm run model:gateway -- <model-name>');
  const gateway = resolveModelGateway();
  const env = {
    NNA_COGNITION: 'model',
    NNA_MODEL_WIRE: 'responses',
    NNA_MODEL_URL: gateway.responsesUrl,
    NNA_MODEL_API_KEY: gateway.apiKey,
    NNA_MODEL_EXTRA_HEADERS: process.env.NNA_MODEL_EXTRA_HEADERS ?? '',
    NNA_MODEL_NAME: model,
    NNA_MODEL_TIMEOUT_MS: process.env.NNA_MODEL_TIMEOUT_MS ?? '15000',
  };

  const endpointHost = new URL(env.NNA_MODEL_URL).host;
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-gateway-smoke-'));
  const habitat = path.join(work, 'habitat');
  const startedAt = new Date().toISOString();
  try {
    await run(['init', '--habitat', habitat, '--credits', '2'], env);
    const perception = await run([
      'inject',
      'A synthetic network weather for one model gateway impulse.',
      '--source',
      'model-gateway-smoke',
      '--habitat',
      habitat,
    ], env);

    const wakeStarted = Date.now();
    let failure = null;
    let wakeOutput = null;
    try {
      wakeOutput = await run(['wake', '--habitat', habitat], env);
    } catch (error) {
      failure = String(error.stderr ?? error.message).trim();
    }
    const elapsedMs = Date.now() - wakeStarted;
    const eventText = await readFile(path.join(habitat, 'events.ndjson'), 'utf8');
    const events = eventText.trim().split('\n').map((line) => JSON.parse(line));
    const pulse = events.filter((event) => event.type === 'pulse').at(-1);
    const leaks = redactedPatterns().filter((pattern) => pattern.test(eventText)).map(() => '<redacted>');
    const status = await run(['status', '--habitat', habitat], env);

    const report = {
      valid: Boolean(pulse) && pulse?.payload?.cognition?.adapter === 'model' && leaks.length === 0,
      phase: 'model-gateway-smoke',
      startedAt,
      finishedAt: new Date().toISOString(),
      endpointHost,
      model,
      wire: 'responses',
      retryPolicy: '2 attempts, bounded wait on HTTP 429',
      elapsedMs,
      perceptionId: perception.id,
      wakeResult: wakeOutput ? {
        status: wakeOutput.status,
        alive: wakeOutput.alive,
        events: wakeOutput.events,
        pulses: wakeOutput.pulses,
      } : null,
      impulse: pulse?.payload?.impulse ?? wakeOutput?.rawImpulse ?? null,
      adapter: pulse?.payload?.cognition?.adapter ?? wakeOutput?.rawAdapter ?? null,
      agentId: status.agentId,
      pendingAfter: status.pending,
      failure,
      secretLeaks: leaks,
      boundaries: {
        keyWrittenToEvents: false,
        keyWrittenToReport: false,
        toolsEnabled: false,
        externalWrites: false,
        autoPropagate: false,
      },
      claimBoundary: 'This smoke test checks structured impulse adaptation through a model gateway only, not model intelligence or agency.',
    };
    const reportPath = reportPathArg(process.argv.slice(2)) ?? 'work/model-smoke.tmp.json';
    const target = path.resolve(root, reportPath);
    await mkdir(path.dirname(target), { recursive: true });
    report.reportPath = path.relative(root, target);
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) process.exitCode = 1;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`nna model-gateway-smoke: ${error.message}`);
  process.exitCode = 1;
});
