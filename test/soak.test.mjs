import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('soak evidence is a real run: monotonic growth with zero failures', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/soak/report.json'), 'utf8'));
  assert.equal(report.protocol, 'soak-v1');
  assert.equal(report.valid, true);
  assert.equal(report.totals.cycles, 200);
  assert.equal(report.totals.events, 1001);
  assert.equal(report.totals.failures, 0);

  const buckets = report.buckets;
  assert.equal(buckets.length, 4);
  for (let index = 1; index < buckets.length; index += 1) {
    assert.ok(buckets[index].fromEvents > buckets[index - 1].fromEvents, 'buckets must advance');
    assert.ok(
      buckets[index].replayMedianMs > buckets[index - 1].replayMedianMs,
      'replay cost must grow with history',
    );
  }
  assert.equal(buckets.every((bucket) => bucket.failures === 0), true);
});

test('incremental verification was used but did not flatten the curve', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/soak/report.json'), 'utf8'));
  assert.ok(report.totals.incrementalCycles >= 190, 'incremental path should dominate');

  const first = report.checkpoints[0];
  const last = report.checkpoints.at(-1);
  assert.equal(first.mode, 'full', 'the first cycle has no checkpoint yet');
  assert.equal(last.mode, 'incremental');
  assert.ok(last.replayMs > first.replayMs * 10, 'cost still grows despite incremental verification');
  assert.match(
    report.findings.join(' '),
    /id recomputation is still linear/,
    'the report must name the remaining linear cost',
  );
});

test('the soak report does not pretend to be a two-week experiment', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/soak/report.json'), 'utf8'));
  const doc = await readFile(path.join(root, 'SOAK.md'), 'utf8');

  assert.match(doc, /这不是两周实验|不是两周/);
  assert.match(doc, /两分钟/);
  assert.match(report.limitations.join(' '), /two weeks|day-scale/);

  const wallClock = report.totals.wallClockMs;
  assert.ok(wallClock < 1000 * 60 * 30, 'the archived run really was minutes, not weeks');
});

test('SOAK.md quotes the archived numbers', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/soak/report.json'), 'utf8'));
  const doc = await readFile(path.join(root, 'SOAK.md'), 'utf8');

  for (const bucket of report.buckets) {
    assert.ok(doc.includes(String(bucket.toEvents)), `doc must quote ${bucket.toEvents} events`);
    assert.ok(doc.includes(bucket.replayMedianMs.toFixed(1)), `doc must quote median replay for ${bucket.toEvents}`);
  }

  for (const point of report.checkpoints) {
    assert.ok(doc.includes(String(point.events)), `doc must quote checkpoint at ${point.events} events`);
  }

  assert.match(doc, /100 ms/, 'the doc must disclose CLI startup overhead');
});
