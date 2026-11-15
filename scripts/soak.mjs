#!/usr/bin/env node
/**
 * Long-running soak harness.
 *
 * Each cycle: inject a perception, wake a body, record verification timing and
 * event-chain size. State lives in a resumable JSON log so the run can be
 * stopped and continued without losing history.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

const workDir = path.resolve(root, process.env.NNA_SOAK_DIR ?? 'work/soak');
const habitat = path.join(workDir, 'habitat');
const logPath = path.join(workDir, 'cycles.ndjson');

async function run(args, env = {}) {
  const { stdout } = await execFileAsync(process.execPath, [cli, ...args, '--json'], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const text = String(stdout).trim();
  const chunks = text.split(/\n(?=\{|\[)/).filter((chunk) => /^(\{|\[)/.test(chunk.trim()));
  return JSON.parse(chunks.at(-1) ?? text);
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

async function existingEvents() {
  try {
    const text = await readFile(path.join(habitat, 'events.ndjson'), 'utf8');
    return text.trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(ratio * sorted.length))];
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
    const summarize = (subset) => ({
      cycles: subset.length,
      verifyIncrementalMs: {
        median: percentile(subset.map((c) => c.verifyMs), 0.5),
        p95: percentile(subset.map((c) => c.verifyMs), 0.95),
        max: Math.max(...subset.map((c) => c.verifyMs), 0),
      },
      incrementalUsed: subset.filter((c) => c.verificationMode === 'incremental').length,
      failures: subset.filter((c) => c.error).length,
    });
    const report = {
      cycles: cycles.length,
      firstAt: cycles[0]?.at ?? null,
      lastAt: cycles.at(-1)?.at ?? null,
      events: cycles.at(-1)?.events ?? 0,
      bytes: cycles.at(-1)?.bytes ?? 0,
      overall: summarize(cycles),
      firstQuarter: summarize(cycles.slice(0, Math.max(1, Math.floor(cycles.length / 4)))),
      lastQuarter: summarize(cycles.slice(-Math.max(1, Math.floor(cycles.length / 4)))),
    };
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (command !== 'run') throw new Error(`unknown command: ${command}`);

  const cycles = Number.parseInt(String(options.cycles ?? '10'), 10);
  const gapMs = Number.parseInt(String(options.gapMs ?? '0'), 10);
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 100000) throw new Error('cycles must be 1-100000');
  if (!Number.isInteger(gapMs) || gapMs < 0 || gapMs > 3600000) throw new Error('gap-ms must be 0-3600000');

  await mkdir(workDir, { recursive: true });
  const prior = await readLog();
  const startCycle = prior.length;
  if (startCycle === 0) {
    await run(['init', '--habitat', habitat, '--credits', '9999', '--ttl', '86400']);
  }

  for (let index = 0; index < cycles; index += 1) {
    const cycle = startCycle + index + 1;
    const started = Date.now();
    let record;
    try {
      await run(['inject', `soak signal ${cycle}`, '--source', cycle % 2 ? 'relay' : 'feed', '--habitat', habitat]);
      await run(['wake', '--cognition', 'deterministic', '--habitat', habitat]);
      const verifyStarted = process.hrtime.bigint();
      const replay = await run(['replay', '--habitat', habitat]);
      const verifyMs = Number(process.hrtime.bigint() - verifyStarted) / 1e6;
      const info = await stat(path.join(habitat, 'events.ndjson'));
      record = {
        cycle,
        at: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        verifyMs: Number(verifyMs.toFixed(2)),
        verificationMode: replay.verification?.mode ?? 'unknown',
        events: replay.eventCount,
        bytes: info.size,
        digest: replay.digest,
        error: null,
      };
    } catch (error) {
      record = {
        cycle,
        at: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        verifyMs: 0,
        verificationMode: 'failed',
        events: await existingEvents(),
        bytes: 0,
        digest: null,
        error: String(error.stderr ?? error.message).trim().slice(0, 500),
      };
    }
    await writeFile(logPath, `${JSON.stringify(record)}\n`, { flag: 'a' });
    if (gapMs > 0 && index < cycles - 1) {
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }

  const all = await readLog();
  console.log(JSON.stringify({
    cycles: all.length,
    events: all.at(-1)?.events ?? 0,
    failures: all.filter((c) => c.error).length,
    logPath: path.relative(root, logPath),
  }, null, 2));
}

main().catch((error) => {
  console.error(`nna soak: ${error.message}`);
  process.exitCode = 1;
});
