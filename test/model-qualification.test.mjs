import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('model qualification report records candidate failures and no selected model', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/model-qualification/screening.json'), 'utf8'));
  assert.equal(report.valid, false);
  assert.equal(report.selected, null);
  assert.equal(report.results.length, 4);
  assert.ok(report.results.every((result) => result.valid === 0 && result.invalid === 10));
  assert.deepEqual([...new Set(report.results.map((result) => result.model))], [
    'candidate-model-6',
    'candidate-model-8',
    'candidate-model-9',
    'candidate-model-14',
  ]);
});

test('full model list screening and candidate-model-2 recheck remain negative', async () => {
  const quick = JSON.parse(await readFile(path.join(root, 'evidence/model-qualification/all-models-quick.json'), 'utf8'));
  const recheck = JSON.parse(await readFile(path.join(root, 'evidence/model-qualification/candidate-model-2-recheck.json'), 'utf8'));
  assert.equal(quick.valid, false);
  assert.equal(quick.selected, null);
  assert.equal(quick.results.length, 11);
  assert.equal(recheck.valid, false);
  assert.equal(recheck.selected, null);
  assert.equal(recheck.results[0].model, 'candidate-model-2');
  assert.ok(recheck.results[0].complianceRate < 0.9);
});
