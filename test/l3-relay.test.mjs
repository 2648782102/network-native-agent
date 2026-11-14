import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { writeReportForTest } from '../scripts/l3-relay.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'l3-relay.mjs');
const cli = path.join(root, 'bin', 'nna.mjs');

function command(args, environment = {}) {
  return execFileAsync(process.execPath, [script, ...args], {
    cwd: root,
    env: { ...process.env, ...environment },
    maxBuffer: 4 * 1024 * 1024,
  });
}

test('L3 help documents private relay gates without requiring network', async () => {
  const { stdout } = await command(['help']);
  assert.match(stdout, /private GitHub event relay only/);
  assert.match(stdout, /preflight/);
  assert.match(stdout, /experiment .* --yes/);
  assert.match(stdout, /touch the default branch/);
});

test('L3 experiment refuses to write without explicit yes', async () => {
  await assert.rejects(
    command(['experiment', 'git@github.com:OWNER/private-relay.git']),
    (error) => /pass --yes/.test(String(error.stderr ?? error)),
  );
});

test('L3 preflight rejects non-GitHub remotes before any network access', async () => {
  await assert.rejects(
    command(['preflight', 'https://example.com/owner/repo.git']),
    (error) => /GitHub HTTPS or SSH URL/.test(String(error.stderr ?? error)),
  );
});

test('L3 preflight explains gh authentication requirement when gh is unavailable', async () => {
  const emptyBin = await mkdtemp(path.join(os.tmpdir(), 'nna-l3-empty-bin-'));
  try {
    await assert.rejects(
      command(['preflight', 'git@github.com:OWNER/private-relay.git'], {
        PATH: emptyBin,
      }),
      (error) => /NNA_L3_REPO_ATTESTATION|gh is unavailable/.test(String(error.stderr ?? error)),
    );
  } finally {
    await rm(emptyBin, { recursive: true, force: true });
  }
});

test('L3 report files record their own report path', async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-l3-report-'));
  const reportPath = path.join(work, 'report.json');
  try {
    const report = { valid: true, phase: 'test' };
    const relativePath = await writeReportForTest(reportPath, report);
    const stored = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(relativePath, path.relative(root, reportPath));
    assert.equal(report.reportPath, relativePath);
    assert.equal(stored.reportPath, relativePath);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('L3 experiment requires explicit preflight approval', async () => {
  await assert.rejects(
    command(['experiment', 'git@github.com:OWNER/private-relay.git', '--yes'], {
      NNA_L3_PREFLIGHT_APPROVED: '',
    }),
    (error) => /NNA_L3_PREFLIGHT_APPROVED/.test(String(error.stderr ?? error)),
  );
});

test('observer lineage fork creates a new identity without a parent private key', async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-observer-fork-'));
  const observer = path.join(work, 'observer');
  const child = path.join(work, 'child');
  try {
    await execFileAsync(process.execPath, [cli, 'init', '--habitat', observer, '--json'], { cwd: root });
    await rm(path.join(observer, 'identity.key'));
    const { stdout: forkStdout } = await execFileAsync(process.execPath, [cli, 'fork-observer', child, '--habitat', observer, '--json'], { cwd: root });
    const fork = JSON.parse(forkStdout);
    const observerStatus = JSON.parse((await execFileAsync(process.execPath, [cli, 'status', '--habitat', observer, '--json'], { cwd: root })).stdout);
    const childStatus = JSON.parse((await execFileAsync(process.execPath, [cli, 'status', '--habitat', child, '--json'], { cwd: root })).stdout);
    const parentEventsBefore = await readFile(path.join(observer, 'events.ndjson'), 'utf8');
    assert.notEqual(fork.childAgentId, observerStatus.agentId);
    assert.equal(childStatus.agentId, fork.childAgentId);
    assert.equal(childStatus.lineage.parentAgentId, observerStatus.agentId);
    assert.equal(childStatus.lineage.observerFork, true);
    assert.equal(fork.parentEventChainUnchanged, true);
    assert.equal(parentEventsBefore.trim().split('\n').length, 1);
    await assert.rejects(execFileAsync(process.execPath, [cli, 'inject', 'should fail', '--habitat', observer, '--json'], { cwd: root }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
