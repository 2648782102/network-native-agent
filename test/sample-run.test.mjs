import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('sample run is a reproducible synthetic fixture, not model output', async () => {
  const tasks = JSON.parse(await readFile(path.join(root, 'examples/sample-run/tasks.json'), 'utf8'));
  const report = JSON.parse(await readFile(path.join(root, 'evidence/sample-run/report.json'), 'utf8'));

  assert.equal(tasks.protocol, 'sample-run-v1');
  assert.deepEqual(tasks.organs, ['deterministic', 'stochastic']);
  assert.equal(tasks.tasks.length, 4);
  assert.equal(report.protocol, 'sample-run-v1');
  assert.equal(report.valid, true);
  assert.equal(report.trials.length, 8);
  assert.equal(report.trials.every((trial) => trial.replayValid), true);
  assert.equal(report.trials.every((trial) => trial.secretLeak === false), true);
  assert.deepEqual(Object.keys(report.summary).sort(), ['deterministic', 'stochastic']);

  for (const trial of report.trials) {
    assert.equal(typeof trial.digest, 'string');
    assert.equal(trial.digest.length, 64);
    assert.ok(tasks.tasks.some((task) => task.id === trial.taskId));
    assert.equal(trial.impulse === trial.expected, trial.intentMatch);
  }
});

test('sample run documents that hash-based organs are not a semantic baseline', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/sample-run/report.json'), 'utf8'));
  assert.equal(report.claimBoundary.includes('not model intelligence'), true);
  assert.equal(
    Object.values(report.summary).every((summary) => Number.isFinite(summary.intentMatchRate)),
    true,
  );
  assert.equal(report.reproducibility.variable.includes('intentMatchRate'), true);
  assert.equal(report.reproducibility.variable.includes('agentId'), true);
});
