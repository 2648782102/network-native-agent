import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('cost model is measured, monotonic, and self-consistent', async () => {
  const report = JSON.parse(await readFile(path.join(root, 'evidence/cost-model/report.json'), 'utf8'));
  assert.equal(report.protocol, 'cost-model-v1');
  assert.equal(report.valid, true);
  assert.ok(report.read.length >= 4);

  const sizes = report.read.map((row) => row.events);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b), 'sizes must be ascending');

  for (let index = 1; index < report.read.length; index += 1) {
    assert.ok(
      report.read[index].verifyChainMs > report.read[index - 1].verifyChainMs,
      'chain verification must grow with event count',
    );
  }

  for (const row of report.read) {
    assert.ok(row.merkleRootMs > 0 && row.inclusionVerifyMs >= 0);
    assert.ok(row.verifyChainMs > row.merkleRootMs, 'signature verification dominates Merkle work');
    assert.ok(row.inclusionProofLength > 0);
  }

  // Proof length must stay logarithmic-ish, not linear.
  for (const row of report.read) {
    assert.ok(row.inclusionProofLength <= Math.ceil(Math.log2(row.events)) + 1, `proof too long for ${row.events}`);
  }

  assert.ok(report.write.signEvent.medianMs > 0);
  assert.ok(report.write.signCheckpoint.medianMs > 0);
  assert.ok(report.storage.bytesPerEvent.every((bytes) => bytes > 100));
  assert.ok(report.limitations.length >= 3);
});

test('ADVERSARY.md quotes measured numbers, not guesses', async () => {
  const cost = JSON.parse(await readFile(path.join(root, 'evidence/cost-model/report.json'), 'utf8'));
  const doc = await readFile(path.join(root, 'ADVERSARY.md'), 'utf8');

  assert.match(doc, /对手模型/);
  assert.match(doc, /不可信存储/);

  // Only quotes that are stable across runs are asserted. Sub-millisecond sign
  // timings jitter by ~20% between runs, so the doc rounds them deliberately.
  const largest = cost.read.at(-1);
  assert.ok(doc.includes(`${Math.round(largest.verifyChainMs)} ms`), 'chain verification at the largest size');
  assert.ok(
    doc.includes(largest.merkleRootMs.toFixed(1)) || doc.includes(largest.merkleRootMs.toFixed(2)),
    'merkle root time at the largest size',
  );
  assert.match(doc, /约 0\.2 ms/, 'sign timings must be quoted as a rounded magnitude');
  assert.doesNotMatch(doc, /0\.163 ms|0\.157 ms/, 'stale single-run timings must not be quoted');
  assert.match(doc, /抖动|噪声/, 'the doc must admit measurement noise');

  const perEvent = Math.round(cost.storage.bytesPerEvent.at(-1) / 10) * 10;
  assert.ok(doc.includes(String(perEvent)), `bytes per event (${perEvent})`);
});

test('the ledger covers every attack the experiments actually test', async () => {
  const doc = await readFile(path.join(root, 'ADVERSARY.md'), 'utf8');
  const rows = doc.split('\n').filter((line) => /^\| \d+ \|/.test(line));
  assert.ok(rows.length >= 12, 'ledger should list at least 12 attacker capabilities');

  for (const keyword of ['篡改', '不同历史', '一致撒谎', '截断', '冒用日志私钥', '拒绝服务']) {
    assert.ok(rows.some((row) => row.includes(keyword)), `ledger must cover: ${keyword}`);
  }

  const unimplemented = rows.filter((row) => row.includes('空缺'));
  assert.ok(unimplemented.length >= 2, 'the ledger must name what is still missing');
  assert.ok(unimplemented.some((row) => row.includes('两个 root')), 'the dual-root log attack must be listed as a gap');
});

test('the exit condition is written down', async () => {
  const doc = await readFile(path.join(root, 'ADVERSARY.md'), 'utf8');
  assert.match(doc, /退出条件/);
  assert.match(doc, /工程练习/);
});
