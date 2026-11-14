import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const figureDir = path.join(root, 'evidence/figures');

async function png(pathname) {
  const info = await stat(pathname);
  const header = await readFile(pathname).then((buffer) => buffer.subarray(0, 8));
  return { bytes: info.size, magic: header.toString('hex') };
}

test('archived figures are real PNG files', async () => {
  const manifest = JSON.parse(await readFile(path.join(figureDir, 'manifest.json'), 'utf8'));
  assert.ok(manifest.figures.length >= 5);
  for (const figure of manifest.figures) {
    const info = await png(path.join(root, figure.file));
    assert.equal(info.magic, '89504e470d0a1a0a', `${figure.file} is not a PNG`);
    assert.ok(info.bytes > 10000, `${figure.file} is suspiciously small`);
    assert.equal(figure.bytes > 0, true);
    const digest = createHash('sha256').update(await readFile(path.join(root, figure.file))).digest('hex');
    assert.equal(digest, figure.sha256, `${figure.file} does not match manifest hash`);
  }
});

test('figure manifest stays consistent with archived evidence', async () => {
  const manifest = JSON.parse(await readFile(path.join(figureDir, 'manifest.json'), 'utf8'));
  const formal = JSON.parse(await readFile(path.join(root, 'evidence/formal-experiment/analysis.json'), 'utf8'));
  const stability = JSON.parse(await readFile(path.join(root, 'evidence/model-stability/report.json'), 'utf8'));

  const names = manifest.figures.map((figure) => figure.name).sort();
  assert.deepEqual(names, [
    'annotation-agreement',
    'compliance-vs-intent',
    'e2e-impulses',
    'impulse-distribution',
    'latency-comparison',
    'qualification-outcome',
  ]);

  assert.equal(
    formal.byOrgan.model.impulseCounts.trace,
    0,
    'impulse-distribution figure asserts model emits no trace; evidence must agree',
  );
  assert.equal(
    stability.results.every((result) => result.summary.intentMatchRate < 0.9),
    true,
    'compliance-vs-intent figure asserts intent match stays below 0.9',
  );
});

test('reports embed the archived figures instead of remote images', async () => {
  const stability = await readFile(path.join(root, 'MODEL_STABILITY_REPORT.md'), 'utf8');
  const qualification = await readFile(path.join(root, 'MODEL_QUALIFICATION.md'), 'utf8');
  assert.match(stability, /evidence\/figures\/compliance-vs-intent\.png/);
  assert.match(stability, /evidence\/figures\/impulse-distribution\.png/);
  assert.match(qualification, /evidence\/figures\/qualification-outcome\.png/);
  assert.doesNotMatch(stability, /https:\/\/mdn\.alipayobjects\.com/);
});
