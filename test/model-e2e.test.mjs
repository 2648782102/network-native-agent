import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('archived end-to-end model evidence is complete and internally consistent', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/model-e2e/report.json'), 'utf8'));
  const records = (await readFile(path.join(root, 'evidence/model-e2e/raw.ndjson'), 'utf8'))
    .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));

  assert.equal(report.valid, true);
  assert.equal(report.model, 'candidate-model-1');
  assert.equal(report.rounds, 10);
  assert.equal(records.length, 60);
  assert.equal(report.summary.valid, 60);
  assert.equal(report.summary.invalid, 0);
  assert.equal(report.summary.secretLeaks, 0);
  assert.equal(report.summary.replayValid, true);
  assert.ok(records.every((record) => record.valid === true));
  assert.ok(records.every((record) => record.adapter === 'model'));
  assert.ok(records.every((record) => record.impulse === record.runtimeImpulse));
  assert.ok(records.every((record) => record.replayValid === true));
  assert.ok(records.every((record) => record.digest?.length === 64));
  assert.ok(records.every((record) => record.secretLeak === false));
});
