import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('release notes quote the archived evidence verbatim', async () => {
  const notes = await readFile(path.join(root, 'RELEASE_NOTES_v0.1.0.md'), 'utf8');
  const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  const stability = JSON.parse(await readFile(path.join(root, 'evidence/model-stability/report.json'), 'utf8'));
  const baseline = JSON.parse(await readFile(path.join(root, 'evidence/baseline-stability/report.json'), 'utf8'));
  const agreement = JSON.parse(await readFile(path.join(root, 'evidence/annotation/simulated-agreement.json'), 'utf8'));

  assert.match(changelog, /## \[0\.1\.0\] - 2026-11-15/);
  assert.match(notes, /v0\.1\.0/);

  for (const result of stability.results) {
    assert.ok(notes.includes(`| \`${result.model}\` | ${result.summary.valid}/${result.summary.total} |`), result.model);
    assert.ok(notes.includes(result.summary.intentMatchRate.toFixed(4)), result.model);
  }
  for (const result of baseline.results) {
    assert.ok(notes.includes(`| \`${result.organ}\` | 72/72 | ${result.summary.intentMatchRate.toFixed(4)} |`), result.organ);
  }
  assert.ok(notes.includes(agreement.pairwise[0].kappa.toFixed(4)), 'kappa');
  assert.ok(notes.includes(`${agreement.unusableTasks.length} of ${agreement.annotatedTasks}`), 'annotation disagreement');
});

test('public repository templates stay free of credentials prompts', async () => {
  const { readFile: read } = await import('node:fs/promises');
  const files = [
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/protocol_question.yml',
    '.github/pull_request_template.md',
  ];
  for (const file of files) {
    const text = await read(path.join(root, file), 'utf8');
    assert.ok(text.length > 0, `${file} is empty`);
    assert.doesNotMatch(text, /paste your (?:api )?key here/i);
  }
  assert.match(await read(path.join(root, '.github/pull_request_template.md'), 'utf8'), /audit:public/);
});
