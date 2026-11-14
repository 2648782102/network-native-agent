import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('stability evidence covers 18 tasks, two models, and separates compliance from intent', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/model-stability/report.json'), 'utf8'));
  assert.equal(report.tasks.length, 18);
  assert.equal(report.models.length, 2);
  assert.equal(report.results.length, 2);
  for (const result of report.results) {
    assert.equal(result.summary.total, 72);
    assert.ok(Number.isFinite(result.summary.intentMatchRate));
    assert.ok(result.summary.intentMatchRate < 0.9);
    assert.equal(result.summary.secretLeaks, 0);
  }
  const f = report.results.find((result) => result.model === 'candidate-model-1');
  const h = report.results.find((result) => result.model === 'candidate-model-2');
  assert.equal(f.summary.invalid, 0);
  assert.ok(h.summary.invalid > 0);
});
