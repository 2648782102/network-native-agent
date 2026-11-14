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

async function runOrgan(work, name) {
  const habitat = path.join(work, name);
  const genesis = await run(['init', '--habitat', habitat, '--credits', '8']);
  for (let index = 0; index < 6; index += 1) {
    await run(['inject', `network weather ${index}`, '--source', 'relay', '--habitat', habitat]);
  }
  await run(['wake', '--cognition', name, '--habitat', habitat]);
  await run(['die', '--reason', 'cognition-organ-swap', '--habitat', habitat]);
  await run(['resurrect', '--wake', '--credits', '8', '--cognition', name, '--habitat', habitat]);
  const status = await run(['status', '--habitat', habitat]);
  const metrics = await run(['metrics', '--habitat', habitat]);
  const replay = await run(['replay', '--habitat', habitat]);
  return { name, genesis, status, metrics, replay };
}

async function main() {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-cognition-demo-'));
  try {
    const deterministic = await runOrgan(work, 'deterministic');
    const stochastic = await runOrgan(work, 'stochastic');
    const model = await run(['cognition']);
    const sameLifecycle = deterministic.status.deaths === stochastic.status.deaths
      && deterministic.status.resurrections === stochastic.status.resurrections
      && deterministic.status.alive === stochastic.status.alive;
    const sameEventShape = deterministic.status.eventCount === stochastic.status.eventCount
      && deterministic.metrics.cognition.deterministic > 0
      && stochastic.metrics.cognition.stochastic > 0;
    const differentOrgans = deterministic.status.agentId !== stochastic.status.agentId
      && deterministic.status.digest !== stochastic.status.digest;
    const valid = sameLifecycle && sameEventShape && differentOrgans
      && deterministic.replay.valid === true
      && stochastic.replay.valid === true
      && model.adapters.includes('model');

    console.log(JSON.stringify({
      valid,
      question: 'Does replacing the cognition organ change the subject?',
      result: 'identity and lifecycle are carried by the event log; impulses change the trajectory, not the runtime ontology',
      deterministic: {
        agentId: deterministic.status.agentId,
        digest: deterministic.status.digest,
        eventCount: deterministic.status.eventCount,
        deaths: deterministic.status.deaths,
        resurrections: deterministic.status.resurrections,
        driftDistance: deterministic.metrics.driftDistance,
        cognition: deterministic.metrics.cognition,
      },
      stochastic: {
        agentId: stochastic.status.agentId,
        digest: stochastic.status.digest,
        eventCount: stochastic.status.eventCount,
        deaths: stochastic.status.deaths,
        resurrections: stochastic.status.resurrections,
        driftDistance: stochastic.metrics.driftDistance,
        cognition: stochastic.metrics.cognition,
      },
      modelOrgan: {
        available: model.adapters.includes('model'),
        configuredInThisEnvironment: model.model.configured,
        note: model.model.configured
          ? 'model organ is configured; this demo still keeps explicit deterministic and stochastic organs'
          : 'set NNA_MODEL_BASE_URL (or NNA_MODEL_URL) and NNA_MODEL_API_KEY to enable it',
      },
      claimBoundaries: [
        'This demo compares event trajectories, not intelligence.',
        'The model organ is optional and is not called without explicit environment configuration.',
        'A changed impulse is an event, not an external action.',
      ],
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
