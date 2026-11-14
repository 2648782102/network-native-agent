import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('baseline evidence shows intent labels are not a model ranking signal', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/baseline-stability/report.json'), 'utf8'));
  assert.equal(report.tasks.length, 18);
  assert.equal(report.results.length, 2);
  for (const result of report.results) {
    assert.equal(result.summary.total, 72);
    assert.equal(result.summary.complianceRate, 1);
    assert.ok(result.summary.intentMatchRate < 0.5);
  }
  const decisions = await readFile(path.join(root, 'DECISIONS.md'), 'utf8');
  assert.match(decisions, /ADR-018/);
});
