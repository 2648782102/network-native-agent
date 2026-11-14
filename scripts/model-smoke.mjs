#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describeCognition } from '../src/cognition.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');

function secretPatterns() {
  const values = [
    process.env.NNA_MODEL_API_KEY,
    process.env.NNA_MODEL_BASE_URL,
    process.env.NNA_MODEL_URL,
  ].filter(Boolean).map((value) => String(value));
  const patterns = [/authorization/i, /bearer\s+[a-z0-9._-]+/i, /api[_-]?key/i, /sk-[a-z0-9_-]+/i];
  for (const value of values) {
    if (value.length >= 8) {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      patterns.push(new RegExp(escaped, 'i'));
    }
  }
  return patterns;
}

async function run(args) {
  const { stdout } = await execFileAsync(process.execPath, [cli, ...args, '--json'], {
    cwd: root,
    env: { ...process.env },
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const objects = stdout.trim().split(/\n(?=\{)/).filter(Boolean);
  return JSON.parse(objects.at(-1));
}

async function main() {
  const description = describeCognition('model');
  if (!description.model.configured) {
    throw new Error('model organ is not configured; set NNA_MODEL_BASE_URL (or NNA_MODEL_URL) and NNA_MODEL_API_KEY first');
  }

  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-model-smoke-'));
  const habitat = path.join(work, 'habitat');
  const startedAt = new Date().toISOString();
  try {
    await run(['init', '--habitat', habitat, '--credits', '2']);
    const perception = await run([
      'inject',
      'A synthetic network weather for one structured model impulse.',
      '--source',
      'model-smoke',
      '--habitat',
      habitat,
    ]);
    const wakeStarted = Date.now();
    let wake;
    let failure = null;
    try {
      wake = await execFileAsync(process.execPath, [cli, 'wake', '--habitat', habitat, '--json'], {
        cwd: root,
        env: { ...process.env, NNA_COGNITION: 'model' },
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (error) {
      failure = String(error.stderr ?? error.message).trim();
    }
    const elapsedMs = Date.now() - wakeStarted;
    const trace = JSON.parse(await readFile(path.join(habitat, 'events.ndjson'), 'utf8')
      .then((text) => `[${text.trim().split('\n').join(',')}]`));
    const pulses = trace.filter((event) => event.type === 'pulse');
    const pulse = pulses.at(-1);
    const rawEventText = await readFile(path.join(habitat, 'events.ndjson'), 'utf8');
    const leakPatterns = secretPatterns();
    const leaks = leakPatterns.filter((pattern) => pattern.test(rawEventText)).map(() => '<redacted>');
    const status = await run(['status', '--habitat', habitat]);

    const report = {
      valid: Boolean(pulse) && leaks.length === 0 && pulse?.payload?.cognition?.adapter === 'model',
      phase: 'model-smoke',
      startedAt,
      finishedAt: new Date().toISOString(),
      endpointHost: description.model.endpointHost,
      model: description.model.model,
      elapsedMs,
      perceptionId: perception.id,
      impulse: pulse?.payload?.impulse ?? null,
      adapter: pulse?.payload?.cognition?.adapter ?? null,
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
      claimBoundary: 'This smoke test checks structured impulse adaptation only, not model intelligence or agency.',
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) process.exitCode = 1;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`nna model-smoke: ${error.message}`);
  process.exitCode = 1;
});
