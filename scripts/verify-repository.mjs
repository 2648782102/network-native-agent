#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
}

function parseRecords(text) {
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function main() {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-verify-repository-'));
  const clone = path.join(work, 'clone');
  try {
    const { stdout: status } = await run('git', ['status', '--porcelain']);
    if (status.trim()) {
      throw new Error(`source worktree is not clean:\n${status.trim()}`);
    }
    await run('git', ['clone', '--quiet', root, clone], { cwd: work });
    const checks = [];

    const { stdout: testOutput } = await run('npm', ['test'], { cwd: clone });
    const failedMatch = /fail\s+(\d+)/.exec(testOutput);
    const passedMatch = /pass\s+(\d+)/.exec(testOutput);
    checks.push({
      name: 'npm test',
      ok: Boolean(passedMatch) && passedMatch[1] !== '0' && (!failedMatch || failedMatch[1] === '0'),
      passed: Number(passedMatch?.[1] ?? 0),
      failed: Number(failedMatch?.[1] ?? 0),
    });

    const rawText = await readFile(path.join(clone, 'evidence/formal-experiment/raw.ndjson'), 'utf8');
    const records = parseRecords(rawText);
    const analysis = JSON.parse(await readFile(path.join(clone, 'evidence/formal-experiment/analysis.json'), 'utf8'));
    checks.push({ name: 'formal evidence', ok: records.length === 180 && analysis.includedRecords === 180 && analysis.byOrgan.model.included === 60 });

    const secretPattern = /github_pat_|ghp_|sk-[A-Za-z0-9_-]{16,}|Authorization|Bearer|api[_-]?key/i;
    checks.push({ name: 'evidence secret scan', ok: !secretPattern.test(rawText) });

    const packageJson = JSON.parse(await readFile(path.join(clone, 'package.json'), 'utf8'));
    checks.push({ name: 'retired scripts', ok: !['model:benchmark', 'model:compare', 'model:ui', 'l4:ui'].some((name) => name in packageJson.scripts) });

    const ok = checks.every((check) => check.ok);
    await writeFile(path.join(root, 'work', 'repository-verification.json'), `${JSON.stringify({
      valid: ok,
      generatedAt: new Date().toISOString(),
      checks,
    }, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ valid: ok, checks }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`nna verify-repository: ${error.message}`);
  process.exitCode = 1;
});
