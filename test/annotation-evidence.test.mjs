import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('archived label audit records contested and unsupported tasks', async () => {
  const risk = JSON.parse(await readFile(path.join(root, 'evidence/annotation/label-risk.json'), 'utf8'));
  const sheet = JSON.parse(await readFile(path.join(root, 'evidence/annotation/blind-sheet.json'), 'utf8'));
  assert.equal(risk.total, 18);
  assert.ok(risk.contested >= 1);
  assert.ok(risk.unsupported >= 1);
  assert.equal(sheet.items.length, 18);
  assert.ok(sheet.items.every((item) => !('intent' in item)));
});
