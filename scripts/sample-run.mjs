#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');
const fixture = path.resolve(root, process.env.NNA_SAMPLE_TASKS ?? 'examples/sample-run/tasks.json');
const output = path.resolve(root, process.env.NNA_SAMPLE_OUT ?? 'work/sample-run/report.json');

async function run(args, habitat) {
  const { stdout } = await execFileAsync(process.execPath, [cli, ...args, '--habitat', habitat, '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function trial({ organ, task, habitat }) {
  await run(['init', '--credits', '4'], habitat);
  await run(['inject', task.text, '--source', task.source], habitat);
  await run(['wake', '--cognition', organ], habitat);
  const status = await run(['status'], habitat);
  const trace = await run(['trace', '--last', '20'], habitat);
  const replay = await run(['replay'], habitat);
  const pulse = trace.find((event) => event.type === 'pulse');
  const impulse = pulse?.payload?.impulse ?? null;
  const eventText = await readFile(path.join(habitat, 'events.ndjson'), 'utf8');
  return {
    organ,
    taskId: task.id,
    impulse,
    expected: task.expected,
    intentMatch: impulse === task.expected,
    replayValid: replay.valid === true,
    secretLeak: /authorization|bearer\s+[a-z0-9._-]+|api[_-]?key/i.test(eventText),
    agentId: status.agentId,
    digest: replay.digest,
  };
}

async function main() {
  const config = JSON.parse(await readFile(fixture, 'utf8'));
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-sample-run-'));
  const trials = [];
  try {
    for (const organ of config.organs) {
      for (const [index, task] of config.tasks.entries()) {
        const habitat = path.join(work, `${organ}-${index}`);
        trials.push(await trial({ organ, task, habitat }));
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  const summary = Object.fromEntries(config.organs.map((organ) => {
    const subset = trials.filter((item) => item.organ === organ);
    const matched = subset.filter((item) => item.intentMatch).length;
    return [organ, {
      total: subset.length,
      intentMatchRate: Number((matched / subset.length).toFixed(4)),
      replayValid: subset.every((item) => item.replayValid),
      secretLeaks: subset.filter((item) => item.secretLeak).length,
      impulses: subset.reduce((map, item) => {
        map[item.impulse] = (map[item.impulse] ?? 0) + 1;
        return map;
      }, {}),
    }];
  }));

  const report = {
    valid: trials.every((item) => item.replayValid && !item.secretLeak),
    protocol: config.protocol,
    fixture: path.relative(root, fixture),
    generatedAt: new Date().toISOString(),
    summary,
    trials,
    reproducibility: {
      stable: ['event chain replays', 'impulse is one of four words', 'secretLeak is false'],
      variable: ['agentId', 'digest', 'impulse distribution', 'intentMatchRate'],
      reason: 'init generates a new identity; deterministic and stochastic seeds include agentId.',
    },
    claimBoundary: 'Synthetic fixture run for onboarding; it demonstrates the event-chain contract, not model intelligence or semantic labeling quality.',
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ valid: report.valid, summary, reportPath: path.relative(root, output) }, null, 2));
  if (!report.valid) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`nna sample-run: ${error.message}`);
  process.exitCode = 1;
});
