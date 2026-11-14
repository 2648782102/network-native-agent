import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('stability experiment declares an 18-task set and multi-model support', async () => {
  const source = await readFile(path.join(root, 'scripts/model-stability.mjs'), 'utf8');
  assert.match(source, /import \{ experimentTasks as tasks \} from '\.\/experiment-tasks\.mjs'/);
  const shared = await readFile(path.join(root, 'scripts/experiment-tasks.mjs'), 'utf8');
  const taskIds = [...shared.matchAll(/\{ id: '([^']+)'/g)].map((match) => match[1]);
  assert.equal(taskIds.length, 18);
  assert.match(source, /const models = options\._\.length \? options\._ : \[/);
  assert.match(source, /for \(const model of models\)/);
  assert.match(source, /intentMatchRate/);
  assert.match(source, /complianceWilson95/);
});
