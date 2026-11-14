import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'formal-experiment.mjs');

test('formal analyzer reproduces archived summary from raw NDJSON', async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-formal-analyzer-'));
  const raw = path.join(work, 'raw.ndjson');
  const out = path.join(work, 'analysis.json');
  const chart = path.join(work, 'chart.svg');
  try {
    const source = await readFile(path.join(root, 'evidence/formal-experiment/raw.ndjson'), 'utf8');
    await writeFile(raw, source, 'utf8');
    await execFileAsync(process.execPath, [script, 'analyze', '--raw', raw, '--out', out, '--chart', chart], {
      cwd: root,
      encoding: 'utf8',
    });
    const expected = JSON.parse(await readFile(path.join(root, 'evidence/formal-experiment/analysis.json'), 'utf8'));
    const actual = JSON.parse(await readFile(out, 'utf8'));
    const svg = await readFile(chart, 'utf8');
    assert.equal(actual.totalRecords, expected.totalRecords);
    assert.equal(actual.includedRecords, expected.includedRecords);
    assert.equal(actual.excludedRecords, expected.excludedRecords);
    assert.deepEqual(actual.impulseTable, expected.impulseTable);
    assert.equal(actual.cramersV, expected.cramersV);
    assert.equal(actual.byOrgan.model.complianceRate, expected.byOrgan.model.complianceRate);
    assert.match(svg, /<svg/);
    assert.match(svg, /正式实验/);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('formal model calls use the same output budget as qualification', async () => {
  const formal = await readFile(path.join(root, 'scripts/formal-experiment.mjs'), 'utf8');
  const qualification = await readFile(path.join(root, 'scripts/model-qualify.mjs'), 'utf8');
  assert.match(formal, /max_output_tokens: 256/);
  assert.match(qualification, /max_output_tokens: 256/);
});

test('runtime impulse mismatch exclusion applies only to model injection replay', async () => {
  const source = await readFile(path.join(root, 'scripts/formal-experiment.mjs'), 'utf8');
  assert.match(source, /organ === 'model' && runtime\?\.runtimeImpulse !== impulse/);
});
