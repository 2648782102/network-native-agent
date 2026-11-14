#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { experimentTasks as tasks } from './experiment-tasks.mjs';
import { resolveModelGateway } from '../src/model-gateway.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');
const impulses = ['echo', 'trace', 'migrate', 'sleep'];

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

async function run(args, env = {}) {
  const { stdout } = await execFileAsync(process.execPath, [cli, ...args, '--json'], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const chunks = String(stdout).trim().split(/\n(?=\{|\[)/).filter((chunk) => /^(\{|\[)/.test(chunk.trim()));
  return JSON.parse(chunks.at(-1) ?? String(stdout).trim());
}

function responseClassFromError(message) {
  const match = /model organ returned ([a-z0-9_]+)/i.exec(String(message ?? ''));
  return match?.[1] ?? 'runtime_error';
}

async function runTrial({ model, round, task, order, timeoutMs }) {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-stability-'));
  const habitat = path.join(work, 'habitat');
  const started = Date.now();
  try {
    const gateway = resolveModelGateway();
    await run(['init', '--habitat', habitat, '--credits', '4']);
    await run(['inject', task.text, '--source', task.source, '--habitat', habitat]);
    let failure = null;
    try {
      await run(['wake', '--habitat', habitat], {
        NNA_COGNITION: 'model',
        NNA_MODEL_WIRE: 'responses',
        NNA_MODEL_URL: gateway.responsesUrl,
        NNA_MODEL_API_KEY: gateway.apiKey,
        NNA_MODEL_EXTRA_HEADERS: process.env.NNA_MODEL_EXTRA_HEADERS ?? '',
        NNA_MODEL_NAME: model,
        NNA_MODEL_TIMEOUT_MS: String(timeoutMs),
      });
    } catch (error) {
      failure = String(error.stderr ?? error.message).trim();
    }
    const elapsedMs = Date.now() - started;
    const status = await run(['status', '--habitat', habitat]);
    const replay = await run(['replay', '--habitat', habitat]);
    const trace = await run(['trace', '--last', '200', '--habitat', habitat]);
    const pulse = trace.find((event) => event.type === 'pulse');
    const eventText = await readFile(path.join(habitat, 'events.ndjson'), 'utf8');
    const secretLeak = /authorization|bearer\s+[a-z0-9._-]+|api[_-]?key/i.test(eventText);
    const impulse = pulse?.payload?.impulse ?? null;
    return {
      trialId: `${round}:${task.id}`,
      round,
      order,
      taskId: task.id,
      intent: task.intent,
      model,
      responseClass: failure ? responseClassFromError(failure) : impulse ? 'valid' : 'missing_pulse',
      impulse,
      intentMatch: impulse === task.intent,
      elapsedMs,
      digest: replay.digest,
      eventCount: status.eventCount,
      pulseCount: trace.filter((event) => event.type === 'pulse').length,
      replayValid: replay.valid,
      secretLeak,
      failure,
      valid: !failure && impulse !== null && replay.valid === true && !secretLeak,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function wilson(successes, total, z = 1.96) {
  if (!total) return { lower: 0, upper: 0 };
  const p = successes / total;
  const d = 1 + (z * z) / total;
  const c = (p + (z * z) / (2 * total)) / d;
  const m = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total) / d;
  return { lower: Number(Math.max(0, c - m).toFixed(4)), upper: Number(Math.min(1, c + m).toFixed(4)) };
}

function summarize(records) {
  const valid = records.filter((record) => record.valid);
  const failures = records.filter((record) => !record.valid);
  const latencies = valid.map((record) => record.elapsedMs).sort((left, right) => left - right);
  const impulseCounts = Object.fromEntries(impulses.map((impulse) => [impulse, valid.filter((record) => record.impulse === impulse).length]));
  const perTask = tasks.map((task) => {
    const subset = records.filter((record) => record.taskId === task.id);
    const matched = subset.filter((record) => record.intentMatch).length;
    return {
      taskId: task.id,
      intent: task.intent,
      total: subset.length,
      intentMatchRate: subset.length ? Number((matched / subset.length).toFixed(3)) : 0,
      impulses: Object.fromEntries(impulses.map((impulse) => [impulse, subset.filter((record) => record.impulse === impulse).length])),
    };
  });
  return {
    total: records.length,
    valid: valid.length,
    invalid: failures.length,
    complianceRate: records.length ? Number((valid.length / records.length).toFixed(4)) : 0,
    complianceWilson95: wilson(valid.length, records.length),
    responseClasses: failures.reduce((map, record) => {
      map[record.responseClass] = (map[record.responseClass] ?? 0) + 1;
      return map;
    }, {}),
    latency: {
      n: latencies.length,
      min: latencies[0] ?? 0,
      median: latencies[Math.floor(latencies.length / 2)] ?? 0,
      p95: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? 0,
      max: latencies.at(-1) ?? 0,
    },
    impulseCounts,
    intentMatchRate: records.length ? Number((records.filter((record) => record.intentMatch).length / records.length).toFixed(4)) : 0,
    perTask,
    replayValid: valid.every((record) => record.replayValid === true),
    secretLeaks: records.filter((record) => record.secretLeak).length,
  };
}

async function evaluateModel({ model, rounds, timeout }) {
  const records = [];
  for (let round = 1; round <= rounds; round += 1) {
    for (let order = 0; order < tasks.length; order += 1) {
      records.push(await runTrial({ model, round, task: tasks[order], order, timeoutMs: timeout }));
    }
  }
  return { model, rounds, tasks: tasks.length, summary: summarize(records), records };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const models = options._.length ? options._ : ['candidate-model-1', 'candidate-model-2'];
  const rounds = Number.parseInt(String(options.rounds ?? '4'), 10);
  const timeout = Number.parseInt(String(options.timeout ?? '20000'), 10);
  if (!Number.isFinite(rounds) || rounds < 1 || rounds > 20) throw new Error('rounds must be 1-20');
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 120000) throw new Error('timeout must be 1000-120000');

  const startedAt = new Date().toISOString();
  const results = [];
  for (const model of models) results.push(await evaluateModel({ model, rounds, timeout }));
  const report = {
    valid: results.every((result) => result.summary.invalid === 0),
    phase: 'model-stability',
    startedAt,
    finishedAt: new Date().toISOString(),
    models,
    rounds,
    tasks: tasks.map(({ id, intent }) => ({ id, intent })),
    results,
    claimBoundary: 'Stability and intent-match evidence for the structured cognition contract; not an intelligence benchmark.',
  };
  const target = path.resolve(root, options.out ?? 'work/model-stability.json');
  await mkdir(path.dirname(target), { recursive: true });
  report.reportPath = path.relative(root, target);
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    valid: report.valid,
    reportPath: report.reportPath,
    results: results.map(({ records, ...result }) => result),
  }, null, 2));
}

main().catch((error) => {
  console.error(`nna model-stability: ${error.message}`);
  process.exitCode = 1;
});
