#!/usr/bin/env node
/**
 * In-process soak: measures the runtime directly, so process startup does not
 * pollute the numbers. The CLI path is measured separately because that is what
 * a user actually feels.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  getStatus,
  injectPerception,
  initHabitat,
  replay,
  wake,
} from '../src/runtime.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');
const workDir = path.resolve(root, process.env.NNA_SOAK_DIR ?? 'work/soak-inproc');
const habitat = path.join(workDir, 'habitat');
const logPath = path.join(workDir, 'cycles.ndjson');

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      options._.push(token);
      continue;
    }
    const [rawKey, inline] = token.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    let value = inline;
    if (value === undefined) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) value = true;
      else {
        value = next;
        index += 1;
      }
    }
    options[key] = value;
  }
  return options;
}

async function readLog() {
  try {
    const text = await readFile(logPath, 'utf8');
    return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(ratio * sorted.length))];
}

async function cliMs() {
  const started = process.hrtime.bigint();
  await execFileAsync(process.execPath, [cli, 'status', '--habitat', habitat, '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  return Number(process.hrtime.bigint() - started) / 1e6;
}

async function summarize(cycles) {
  const subset = cycles.filter((cycle) => !cycle.error);
  return {
    cycles: subset.length,
    failures: cycles.length - subset.length,
    replayMedianMs: percentile(subset.map((c) => c.replayMs), 0.5),
    replayP95Ms: percentile(subset.map((c) => c.replayMs), 0.95),
    wakeMedianMs: percentile(subset.map((c) => c.wakeMs), 0.5),
    injectMedianMs: percentile(subset.map((c) => c.injectMs), 0.5),
    cliStatusMedianMs: percentile(subset.map((c) => c.cliStatusMs), 0.5),
    incrementalUsed: subset.filter((c) => c.verificationMode === 'incremental').length,
    events: subset.at(-1)?.events ?? 0,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const command = options._[0] ?? 'run';

  if (command === 'reset') {
    await rm(workDir, { recursive: true, force: true });
    console.log(JSON.stringify({ reset: true, dir: path.relative(root, workDir) }, null, 2));
    return;
  }

  if (command === 'report') {
    const cycles = await readLog();
    const quarter = Math.max(1, Math.floor(cycles.length / 4));
    console.log(JSON.stringify({
      cycles: cycles.length,
      firstAt: cycles[0]?.at ?? null,
      lastAt: cycles.at(-1)?.at ?? null,
      overall: await summarize(cycles),
      firstQuarter: await summarize(cycles.slice(0, quarter)),
      lastQuarter: await summarize(cycles.slice(-quarter)),
    }, null, 2));
    return;
  }

  if (command !== 'run') throw new Error(`unknown command: ${command}`);

  const count = Number.parseInt(String(options.cycles ?? '10'), 10);
  const gapMs = Number.parseInt(String(options.gapMs ?? '0'), 10);
  if (!Number.isInteger(count) || count < 1 || count > 100000) throw new Error('cycles must be 1-100000');
  if (!Number.isInteger(gapMs) || gapMs < 0 || gapMs > 3600000) throw new Error('gap-ms must be 0-3600000');

  await mkdir(workDir, { recursive: true });
  const prior = await readLog();
  if (prior.length === 0) {
    await initHabitat(habitat, { credits: 9999, ttl: 86400 });
  }

  for (let index = 0; index < count; index += 1) {
    const cycle = prior.length + index + 1;
    let record;
    try {
      const injectStarted = process.hrtime.bigint();
      await injectPerception(habitat, `inproc signal ${cycle}`, {
        source: cycle % 2 ? 'relay' : 'feed',
      });
      const injectMs = Number(process.hrtime.bigint() - injectStarted) / 1e6;

      const wakeStarted = process.hrtime.bigint();
      await wake(habitat, { cognition: 'deterministic' });
      const wakeMs = Number(process.hrtime.bigint() - wakeStarted) / 1e6;

      const replayStarted = process.hrtime.bigint();
      const result = await replay(habitat);
      const replayMs = Number(process.hrtime.bigint() - replayStarted) / 1e6;

      const cliStatusMs = await cliMs();
      const info = await stat(path.join(habitat, 'events.ndjson'));
      record = {
        cycle,
        at: new Date().toISOString(),
        injectMs: Number(injectMs.toFixed(2)),
        wakeMs: Number(wakeMs.toFixed(2)),
        replayMs: Number(replayMs.toFixed(2)),
        cliStatusMs: Number(cliStatusMs.toFixed(2)),
        verificationMode: result.verification?.mode ?? 'unknown',
        events: result.eventCount,
        bytes: info.size,
        error: null,
      };
    } catch (error) {
      const status = await getStatus(habitat).catch(() => null);
      record = {
        cycle,
        at: new Date().toISOString(),
        injectMs: 0,
        wakeMs: 0,
        replayMs: 0,
        cliStatusMs: 0,
        verificationMode: 'failed',
        events: status?.eventCount ?? 0,
        bytes: 0,
        error: String(error.message).slice(0, 500),
      };
    }
    await writeFile(logPath, `${JSON.stringify(record)}\n`, { flag: 'a' });
    if (gapMs > 0 && index < count - 1) {
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }

  const all = await readLog();
  console.log(JSON.stringify({
    cycles: all.length,
    events: all.at(-1)?.events ?? 0,
    failures: all.filter((cycle) => cycle.error).length,
    logPath: path.relative(root, logPath),
  }, null, 2));
}

main().catch((error) => {
  console.error(`nna soak-inproc: ${error.message}`);
  process.exitCode = 1;
});
