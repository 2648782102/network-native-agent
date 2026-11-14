import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('simulated annotation run proves agreement tooling and low label stability', async () => {
  const agreement = JSON.parse(await readFile(path.join(root, 'evidence/annotation/simulated-agreement.json'), 'utf8'));
  const annotations = JSON.parse(await readFile(path.join(root, 'evidence/annotation/simulated-annotations.json'), 'utf8'));
  assert.equal(annotations.length, 36);
  assert.ok(annotations.every((item) => item.simulated === true));
  assert.equal(agreement.annotatedTasks, 18);
  assert.equal(agreement.pairwise.length, 1);
  assert.ok(agreement.pairwise[0].kappa < 0.7);
  assert.ok(agreement.unusableTasks.length > 0);
});
