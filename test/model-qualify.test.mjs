import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('model qualification keeps strict response classes and explicit thresholds', async () => {
  const source = await readFile(path.join(root, 'scripts/model-qualify.mjs'), 'utf8');
  assert.match(source, /classifyModelResponse/);
  assert.match(source, /strictImpulse/);
  assert.match(source, /complianceRate: 0\.9/);
  assert.match(source, /medianLatencyMs: 5000/);
  assert.match(source, /if \(result\.qualifies\) break/);
});

test('model qualification parser does not treat option values as models', async () => {
  const source = await readFile(path.join(root, 'scripts/model-qualify.mjs'), 'utf8');
  assert.match(source, /const options = \{ _: \[\], command: 'run' \};/);
  assert.match(source, /const rest = argv;/);
});

test('model qualification discovers models from the gateway model list', async () => {
  const source = await readFile(path.join(root, 'scripts/model-qualify.mjs'), 'utf8');
  assert.match(source, /async function listModels\(\)/);
  assert.match(source, /gateway\.modelsUrl/);
  assert.match(source, /modelSource:/);
  assert.match(source, /modelsDiscovered:/);
});
