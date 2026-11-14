#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');

async function run(args) {
  const { stdout } = await execFileAsync(process.execPath, [cli, ...args, '--json'], {
    cwd: root,
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function main() {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-lifecycle-report-'));
  const habitatA = path.join(work, 'body-a');
  const child = path.join(work, 'observer-child');
  try {
    const genesis = await run(['init', '--habitat', habitatA, '--credits', '4']);
    const perception = await run(['inject', '一条网络天气', '--source', 'relay', '--habitat', habitatA]);
    await run(['wake', '--habitat', habitatA]);
    const beforeDeath = await run(['status', '--habitat', habitatA]);
    const death = await run(['die', '--reason', 'lifecycle-report', '--habitat', habitatA]);
    const blocked = await run(['wake', '--habitat', habitatA]);
    const observerFork = await run(['fork-observer', child, '--habitat', habitatA]);
    const childStatus = await run(['status', '--habitat', child]);
    const replay = await run(['replay', '--habitat', habitatA]);

    const report = {
      valid: genesis.agentId === beforeDeath.agentId
        && death.status === 'death'
        && blocked.status === 'dead'
        && observerFork.parentAgentId === genesis.agentId
        && childStatus.lineage?.observerFork === true
        && childStatus.lineage?.parentAgentId === genesis.agentId
        && replay.valid === true,
      phase: 'L3-lifecycle-report',
      runtimeClaim: 'Private-key loss prevents original-body resurrection; signed history supports same-identity observation and a new lineage fork.',
      stages: [
        {
          id: 'genesis',
          label: '创世',
          agentId: genesis.agentId,
          genesisId: genesis.genesisId,
          publicKeyFingerprint: genesis.publicKeyFingerprint,
        },
        {
          id: 'perception',
          label: '感知',
          eventId: perception.id,
          bodyCount: beforeDeath.bodyCount,
          traits: beforeDeath.traits,
        },
        {
          id: 'death',
          label: '身体死亡',
          status: death.status,
          reason: death.reason,
          alive: false,
          blockedWake: blocked.status,
        },
        {
          id: 'observer-fork',
          label: '只读观察与血缘分叉',
          parentAgentId: observerFork.parentAgentId,
          childAgentId: observerFork.childAgentId,
          parentEventChainUnchanged: observerFork.parentEventChainUnchanged,
          lineage: childStatus.lineage,
        },
        {
          id: 'replay',
          label: '重放校验',
          valid: replay.valid,
          eventCount: replay.eventCount,
          digest: replay.digest,
        },
      ],
      boundaries: {
        publicInternet: false,
        realModelApiKey: false,
        originalIdentityResurrected: false,
        identityKeyCopiedToObserver: false,
      },
    };

    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) process.exitCode = 1;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`nna lifecycle-report: ${error.message}`);
  process.exitCode = 1;
});
