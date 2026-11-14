#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { experimentTasks as tasks } from './experiment-tasks.mjs';

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

async function run(args) {
  const { stdout } = await execFileAsync(process.execPath, [cli, ...args, '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const chunks = String(stdout).trim().split(/\n(?=\{|\[)/).filter((chunk) => /^(\{|\[)/.test(chunk.trim()));
  return JSON.parse(chunks.at(-1) ?? String(stdout).trim());
}

async function runTrial({ organ, round, task, order }) {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-baseline-'));
  const habitat = path.join(work, 'habitat');
  const started = Date.now();
  try {
    await run(['init', '--habitat', habitat, '--credits', '4']);
    await run(['inject', task.text, '--source', task.source, '--habitat', habitat]);
    await run(['wake', '--cognition', organ, '--habitat', habitat]);
    const elapsedMs = Date.now() - started;
    const status = await run(['status', '--habitat', habitat]);
    const replay = await run(['replay', '--habitat', habitat]);
    const trace = await run(['trace', '--last', '50', '--habitat', habitat]);
    const pulse = trace.find((event) => event.type === 'pulse');
    const impulse = pulse?.payload?.impulse ?? null;
    return {
      trialId: `${round}:${task.id}`,
      round,
      order,
      taskId: task.id,
      intent: task.intent,
      organ,
      impulse,
      intentMatch: impulse === task.intent,
      elapsedMs,
      digest: replay.digest,
      eventCount: status.eventCount,
      replayValid: replay.valid,
      valid: impulse !== null && replay.valid === true,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function summarize(records) {
  const valid = records.filter((record) => record.valid);
  const latencies = valid.map((record) => record.elapsedMs).sort((left, right) => left - right);
  return {
    total: records.length,
    valid: valid.length,
    complianceRate: records.length ? Number((valid.length / records.length).toFixed(4)) : 0,
    intentMatchRate: records.length ? Number((records.filter((record) => record.intentMatch).length / records.length).toFixed(4)) : 0,
    impulseCounts: Object.fromEntries(impulses.map((impulse) => [impulse, valid.filter((record) => record.impulse === impulse).length])),
    latencyMedian: latencies[Math.floor(latencies.length / 2)] ?? 0,
    replayValid: valid.every((record) => record.replayValid === true),
    perTask: tasks.map((task) => {
      const subset = records.filter((record) => record.taskId === task.id);
      return {
        taskId: task.id,
        intent: task.intent,
        intentMatchRate: subset.length ? Number((subset.filter((record) => record.intentMatch).length / subset.length).toFixed(3)) : 0,
        impulses: Object.fromEntries(impulses.map((impulse) => [impulse, subset.filter((record) => record.impulse === impulse).length])),
      };
    }),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const organs = options._.length ? options._ : ['deterministic', 'stochastic'];
  const rounds = Number.parseInt(String(options.rounds ?? '4'), 10);
  if (!Number.isFinite(rounds) || rounds < 1 || rounds > 20) throw new Error('rounds must be 1-20');
  const startedAt = new Date().toISOString();
  const results = [];
  for (const organ of organs) {
    const records = [];
    for (let round = 1; round <= rounds; round += 1) {
      for (let order = 0; order < tasks.length; order += 1) {
        records.push(await runTrial({ organ, round, task: tasks[order], order }));
      }
    }
    results.push({ organ, rounds, summary: summarize(records), records });
  }
  const report = {
    phase: 'baseline-stability',
    startedAt,
    finishedAt: new Date().toISOString(),
    rounds,
    tasks: tasks.map(({ id, intent }) => ({ id, intent })),
    results,
    claimBoundary: 'Offline baseline for the same 18 tasks; measures intent-label separability, not model quality.',
  };
  const target = path.resolve(root, options.out ?? 'work/baseline-stability.json');
  await mkdir(path.dirname(target), { recursive: true });
  report.reportPath = path.relative(root, target);
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    reportPath: report.reportPath,
    results: results.map(({ records, ...result }) => result),
  }, null, 2));
}

main().catch((error) => {
  console.error(`nna baseline-stability: ${error.message}`);
  process.exitCode = 1;
});
