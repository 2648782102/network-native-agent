import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auditLabelRisk,
  buildAgreementReport,
  buildBlindSheet,
  cohensKappa,
} from '../src/annotation.mjs';
import { experimentTasks } from '../scripts/experiment-tasks.mjs';

test('Cohen kappa reports perfect and chance agreement', () => {
  const perfect = cohensKappa([['echo', 'echo'], ['sleep', 'sleep'], ['trace', 'trace'], ['migrate', 'migrate']]);
  assert.equal(perfect.kappa, 1);
  const disagreement = cohensKappa([['echo', 'sleep'], ['sleep', 'echo'], ['trace', 'migrate'], ['migrate', 'trace']]);
  assert.ok(disagreement.kappa < 0);
});

test('blind sheet hides existing intent labels', () => {
  const sheet = buildBlindSheet(experimentTasks);
  assert.equal(sheet.items.length, 18);
  assert.ok(sheet.items.every((item) => !('intent' in item)));
  assert.deepEqual(sheet.options, ['echo', 'trace', 'migrate', 'sleep']);
});

test('agreement report marks tasks without two agreeing annotators unusable', () => {
  const tasks = experimentTasks.slice(0, 3);
  const report = buildAgreementReport([
    { annotator: 'a', taskId: tasks[0].id, label: 'sleep' },
    { annotator: 'b', taskId: tasks[0].id, label: 'sleep' },
    { annotator: 'a', taskId: tasks[1].id, label: 'echo' },
    { annotator: 'b', taskId: tasks[1].id, label: 'trace' },
  ], tasks);
  assert.equal(report.annotatedTasks, 2);
  assert.deepEqual(report.unusableTasks.sort(), [tasks[1].id, tasks[2].id].sort());
  assert.equal(report.tasks[0].usable, true);
});

test('current 18-task labels carry cue conflict risk', () => {
  const risk = auditLabelRisk(experimentTasks);
  assert.equal(risk.total, 18);
  assert.ok(risk.contested > 0 || risk.unsupported > 0);
});
