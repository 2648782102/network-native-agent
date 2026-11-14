#!/usr/bin/env node
import { createHash } from 'node:crypto';
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
const protocolVersion = 'model-e2e-v1';

const tasks = [
  { id: 'calm', source: 'relay', text: 'A calm network weather arrives from the private relay.' },
  { id: 'conflict', source: 'feed', text: 'A repeated conflicting signal arrives from the public feed.' },
  { id: 'late', source: 'webhook', text: 'A late migration hint arrives through a webhook.' },
  { id: 'budget', source: 'metrics', text: 'Metabolic credits are low; conserve activity and remember the signal.' },
  { id: 'mobility', source: 'relay', text: 'The current habitat is unstable; a mobility cue is detected.' },
  { id: 'noise', source: 'feed', text: 'Noisy duplicate observations flood the channel without a clear task.' },
];

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
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-e2e-'));
  const habitat = path.join(work, 'habitat');
  const startedAt = new Date().toISOString();
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
    const metrics = await run(['metrics', '--habitat', habitat]);
    const replay = await run(['replay', '--habitat', habitat]);
    const trace = await run(['trace', '--last', '200', '--habitat', habitat]);
    const pulse = trace.find((event) => event.type === 'pulse');
    const eventText = await readFile(path.join(habitat, 'events.ndjson'), 'utf8');
    const secretLeak = /authorization|bearer\s+[a-z0-9._-]+|api[_-]?key/i.test(eventText);
    const responseClass = failure ? responseClassFromError(failure) : 'valid';
    return {
      trialId: `${round}:${task.id}`,
      protocolVersion,
      round,
      order,
      taskId: task.id,
      source: task.source,
      model,
      promptPath: 'src/cognition.mjs:modelImpulse',
      startedAt,
      elapsedMs,
      responseClass,
      impulse: pulse?.payload?.impulse ?? null,
      adapter: pulse?.payload?.cognition?.adapter ?? null,
      runtimeImpulse: pulse?.payload?.impulse ?? null,
      failure,
      agentId: status.agentId,
      eventCount: status.eventCount,
      pulseCount: trace.filter((event) => event.type === 'pulse').length,
      digest: replay.digest,
      driftDistance: metrics.driftDistance,
      observerPollution: metrics.observerPollution,
      deaths: status.deaths,
      resurrections: status.resurrections,
      forks: status.forks,
      pending: status.pending,
      replayValid: replay.valid,
      secretLeak,
      valid: !failure && pulse?.payload?.cognition?.adapter === 'model' && replay.valid === true && !secretLeak,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function summarize(records) {
  const valid = records.filter((record) => record.valid);
  const failures = records.filter((record) => !record.valid);
  const latencies = valid.map((record) => record.elapsedMs).sort((left, right) => left - right);
  const impulseCounts = valid.reduce((map, record) => {
    map[record.impulse] = (map[record.impulse] ?? 0) + 1;
    return map;
  }, {});
  return {
    total: records.length,
    valid: valid.length,
    invalid: failures.length,
    complianceRate: records.length ? valid.length / records.length : 0,
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
    replayValid: valid.every((record) => record.replayValid === true),
    secretLeaks: records.filter((record) => record.secretLeak).length,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const model = options.model ?? 'candidate-model-1';
  const rounds = Number.parseInt(String(options.rounds ?? '10'), 10);
  const timeout = Number.parseInt(String(options.timeout ?? '15000'), 10);
  if (!Number.isFinite(rounds) || rounds < 1 || rounds > 50) throw new Error('rounds must be 1-50');
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 120000) throw new Error('timeout must be 1000-120000');

  const records = [];
  const startedAt = new Date().toISOString();
  for (let round = 1; round <= rounds; round += 1) {
    for (let order = 0; order < tasks.length; order += 1) {
      records.push(await runTrial({ model, round, task: tasks[order], order, timeoutMs: timeout }));
    }
  }
  const summary = summarize(records);
  const report = {
    valid: summary.invalid === 0,
    phase: 'model-e2e',
    protocolVersion,
    startedAt,
    finishedAt: new Date().toISOString(),
    model,
    rounds,
    summary,
    records,
    claimBoundary: 'End-to-end model organ test through the production cognition path; measures runtime contract compliance, not intelligence or agency.',
  };
  const target = path.resolve(root, options.out ?? 'work/model-e2e.json');
  const ndjsonTarget = path.resolve(root, options.ndjson ?? 'work/model-e2e.ndjson');
  await mkdir(path.dirname(target), { recursive: true });
  await mkdir(path.dirname(ndjsonTarget), { recursive: true });
  report.reportPath = path.relative(root, target);
  report.ndjsonPath = path.relative(root, ndjsonTarget);
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(ndjsonTarget, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({
    valid: report.valid,
    model,
    rounds,
    summary,
    reportPath: report.reportPath,
    ndjsonPath: report.ndjsonPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(`nna model-e2e: ${error.message}`);
  process.exitCode = 1;
});
