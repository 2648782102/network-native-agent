import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyReport } from '../scripts/l4-open-network.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('L4 sample report verifies its bounded simulation claims', async () => {
  const sample = JSON.parse(await readFile(path.join(root, 'examples', 'l4-report.sample.json'), 'utf8'));
  const result = verifyReport(sample);
  assert.equal(result.valid, true);
  assert.equal(result.checks.noPublicInternet, true);
  assert.equal(result.checks.conflictObserved, true);
  assert.equal(result.checks.identityContinuous, true);
  assert.equal(result.checks.originNotResurrected, true);
  assert.equal(result.checks.noPrivateKeyCopy, true);
  assert.equal(result.checks.lineageToOrigin, true);
});

test('L4 verifier rejects inflated public-network claims', () => {
  const result = verifyReport({
    valid: true,
    phase: 'L4-simulation',
    boundaries: {
      publicInternet: true,
      thirdPartySystems: false,
      realModelApiKey: false,
    },
    networkConditions: { conflictDetected: true },
    identity: {
      genesisAgentId: 'nna_test',
      restoredAgentId: 'nna_test',
      originResurrected: false,
      privateKeyCopied: false,
    },
    lifecycle: {
      observerReplayValid: true,
      lineageParentAgentId: 'nna_test',
    },
  });
  assert.equal(result.valid, false);
  assert.equal(result.checks.noPublicInternet, false);
});
