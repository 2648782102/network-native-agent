import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { experimentTasks } from '../scripts/experiment-tasks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('baseline uses the same 18 shared tasks as the model stability study', async () => {
  const baseline = await readFile(path.join(root, 'scripts/baseline-stability.mjs'), 'utf8');
  const stability = await readFile(path.join(root, 'scripts/model-stability.mjs'), 'utf8');
  assert.equal(experimentTasks.length, 18);
  assert.match(baseline, /from '\.\/experiment-tasks\.mjs'/);
  assert.match(stability, /from '\.\/experiment-tasks\.mjs'/);
});
