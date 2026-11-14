import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('formal evidence is archived, real-runtime, and internally consistent', async () => {
  const rawText = await readFile(path.join(root, 'evidence/formal-experiment/raw.ndjson'), 'utf8');
  const records = rawText.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const analysis = JSON.parse(await readFile(path.join(root, 'evidence/formal-experiment/analysis.json'), 'utf8'));

  assert.equal(records.length, 180);
  assert.equal(analysis.totalRecords, 180);
  assert.equal(records.filter((record) => !record.excluded).length, analysis.includedRecords);
  assert.equal(records.filter((record) => record.excluded).length, analysis.excludedRecords);
  assert.ok(records.every((record) => record.protocolVersion === 'formal-structured-impulse-v2'));
  assert.ok(records.every((record) => !record.syntheticRuntime));
  assert.ok(records.every((record) => record.modelCallLatencyMs === null || Number.isFinite(record.modelCallLatencyMs)));
  assert.ok(records.every((record) => record.runtimeElapsedMs === null || Number.isFinite(record.runtimeElapsedMs)));
  for (const record of records.filter((item) => !item.excluded)) {
    assert.equal(typeof record.digest, 'string');
    assert.equal(record.digest.length, 64);
    assert.equal(record.replayValid, true);
    assert.equal(record.secretLeak, false);
    assert.ok(record.eventTypes && typeof record.eventTypes === 'object');
    assert.equal(record.pulseCount, 1);
    if (record.organ === 'model') assert.equal(record.runtimeImpulse, record.impulse);
  }
  assert.ok(analysis.byOrgan.model.complianceRate >= 0.9);
});

test('formal chart numbers match archived analysis', async () => {
  const analysis = JSON.parse(await readFile(path.join(root, 'evidence/formal-experiment/analysis.json'), 'utf8'));
  const svg = await readFile(path.join(root, 'evidence/formal-experiment/formal-experiment.svg'), 'utf8');

  assert.match(svg, new RegExp(`${analysis.totalRecords} 条原始记录`));
  assert.match(svg, new RegExp(`${analysis.includedRecords} 条纳入`));
  assert.match(svg, new RegExp(`${analysis.excludedRecords} 条排除`));
  assert.match(svg, new RegExp(`Cramer's V ${analysis.cramersV}`));
  assert.match(svg, new RegExp(`${analysis.byOrgan.model.included}/${analysis.byOrgan.model.n}`));
  assert.match(svg, new RegExp(`合规率 ${analysis.byOrgan.model.complianceRate.toFixed(3)}`));
  assert.match(svg, new RegExp(`\\[${analysis.byOrgan.model.complianceWilson95.lower}, ${analysis.byOrgan.model.complianceWilson95.upper}\\]`));
  assert.match(svg, new RegExp(`排除 ${analysis.byOrgan.model.excluded}`));
});

test('formal evidence has unique trials, fixed prompt, and complete round structure', async () => {
  const rawText = await readFile(path.join(root, 'evidence/formal-experiment/raw.ndjson'), 'utf8');
  const records = rawText.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const trialIds = records.map((record) => record.trialId);

  assert.equal(trialIds.length, 180);
  assert.equal(new Set(trialIds).size, 180);
  assert.deepEqual([...new Set(records.map((record) => record.round))].sort((left, right) => left - right), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual([...new Set(records.map((record) => record.organ))].sort(), ['deterministic', 'model', 'stochastic']);
  assert.equal(new Set(records.map((record) => record.promptHash)).size, 1);
  assert.deepEqual([...new Set(records.map((record) => record.promptVersion))], ['formal-structured-impulse-v2']);

  for (let round = 1; round <= 10; round += 1) {
    const subset = records.filter((record) => record.round === round);
    const counts = new Map();
    for (const record of subset) counts.set(record.order, (counts.get(record.order) ?? 0) + 1);
    assert.deepEqual([...counts.keys()].sort(), [0, 1, 2, 3, 4, 5]);
    assert.ok([...counts.values()].every((count) => count === 3));
  }
});

test('formal report discloses two-stage and prompt-boundary limitations', async () => {
  const protocol = await readFile(path.join(root, 'EXPERIMENT_PROTOCOL.md'), 'utf8');
  const report = await readFile(path.join(root, 'FORMAL_EXPERIMENT_REPORT.md'), 'utf8');
  assert.match(protocol, /本地注入服务器/);
  assert.match(protocol, /不验证端到端真实模型重试或网络行为/);
  assert.match(protocol, /提示词边界/);
  assert.match(protocol, /runtime_failed/);
  assert.match(protocol, /runtime_impulse_mismatch/);
  assert.match(report, /不是端到端真实模型写入测试/);
  assert.match(report, /结论只在这些条件下成立/);
});

test('every included formal sample preserves lifecycle invariants', async () => {
  const rawText = await readFile(path.join(root, 'evidence/formal-experiment/raw.ndjson'), 'utf8');
  const records = rawText.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const included = records.filter((record) => !record.excluded);
  const expectedEventTypes = {
    genesis: 1,
    perception: 1,
    pulse: 1,
    action: 1,
    memory: 1,
    heartbeat: 1,
  };

  assert.equal(included.length, 180);
  for (const record of included) {
    assert.equal(record.eventCount, 6);
    assert.deepEqual(record.eventTypes, expectedEventTypes);
    assert.equal(record.deaths, 0);
    assert.equal(record.resurrections, 0);
    assert.equal(record.forks, 0);
    assert.equal(record.replayValid, true);
    assert.equal(record.secretLeak, false);
    assert.equal(record.pulseCount, 1);
  }
});

test('archived formal evidence contains no runtime failures or impulse mismatches', async () => {
  const rawText = await readFile(path.join(root, 'evidence/formal-experiment/raw.ndjson'), 'utf8');
  const records = rawText.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(records.some((record) => record.exclusionReason === 'runtime_failed'), false);
  assert.equal(records.some((record) => record.exclusionReason === 'runtime_impulse_mismatch'), false);
  assert.ok(records.filter((record) => record.organ === 'model').every((record) => record.excluded || record.runtimeImpulse === record.impulse));
});
