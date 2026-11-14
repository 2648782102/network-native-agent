import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');

function run(args) {
  return execFileAsync(process.execPath, [cli, ...args, '--json'])
    .then(({ stdout }) => JSON.parse(stdout));
}

function git(args, cwd) {
  return execFileAsync('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

async function main() {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-network-demo-'));
  const bare = path.join(work, 'event-relay.git');
  const bodyA = path.join(work, 'body-a');
  const bodyB = path.join(work, 'body-b');
  try {
    await git(['init', '--bare', '--quiet', bare], work);
    const genesis = await run(['init', '--habitat', bodyA, '--credits', '8', '--remote-url', bare]);
    const relay = await run(['relay', 'status', '--habitat', bodyA]);
    await run(['weather', '--count', '4', '--batch', 'network-demo', '--habitat', bodyA]);
    await run(['wake', '--habitat', bodyA]);
    const beforeDeath = await run(['status', '--habitat', bodyA]);
    const death = await run(['die', '--reason', 'network-demo-body-death', '--habitat', bodyA]);
    const syncAfterDeath = await run(['sync', '--habitat', bodyA]);
    const recovered = await run(['restore', bodyB, '--habitat', bodyA]);
    const recoveredStatus = await run(['status', '--habitat', bodyB]);
    const resurrection = await run(['resurrect', '--wake', '--credits', '6', '--habitat', bodyB]);
    const bodyBStatus = await run(['status', '--habitat', bodyB]);
    const bodyBMetrics = await run(['metrics', '--habitat', bodyB]);
    const replayB = await run(['replay', '--habitat', bodyB]);
    const finalRelay = await run(['relay', 'status', '--habitat', bodyA]);

    const sameAgent = genesis.agentId === recoveredStatus.agentId
      && recoveredStatus.agentId === bodyBStatus.agentId;
    const deathPersisted = death.status === 'death'
      && recoveredStatus.alive === false
      && recoveredStatus.deaths >= 1;
    const resurrectedElsewhere = resurrection.alive === true
      && bodyBStatus.resurrections >= 1
      && bodyBStatus.bodyCount > beforeDeath.bodyCount;
    const relayPreserved = relay.remoteEventCount >= 1
      && syncAfterDeath.mergedEventCount >= beforeDeath.eventCount
      && recovered.eventCount === syncAfterDeath.mergedEventCount
      && finalRelay.remoteEventCount >= bodyBStatus.eventCount - 1;
    const valid = sameAgent && deathPersisted && resurrectedElsewhere && relayPreserved
      && replayB.valid === true && bodyBMetrics.identityContinuity === true;

    console.log(JSON.stringify({
      valid,
      genesisAgentId: genesis.agentId,
      relayBranch: relay.branch,
      originalBodyCount: beforeDeath.bodyCount,
      deathRecorded: death.status,
      deathReason: recoveredStatus.deathReason,
      eventsAtSync: syncAfterDeath.mergedEventCount,
      recoveredTo: bodyB,
      restoredAgentId: recovered.agentId,
      restoredDigestEqualsOriginalHistory: recovered.digest === recoveredStatus.digest,
      resurrectedAlive: resurrection.alive,
      finalBodyCount: bodyBStatus.bodyCount,
      finalResurrections: bodyBStatus.resurrections,
      finalEventCount: bodyBStatus.eventCount,
      observerPollution: bodyBMetrics.observerPollution,
      driftDistance: bodyBMetrics.driftDistance,
      replayValid: replayB.valid,
      finalRelayEventCount: finalRelay.remoteEventCount,
    }, null, 2));
    if (!valid) process.exitCode = 1;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
