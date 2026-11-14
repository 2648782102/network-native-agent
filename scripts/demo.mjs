import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');

async function run(args, habitat) {
  const { stdout } = await execFileAsync(process.execPath, [cli, ...args, '--habitat', habitat, '--json']);
  return JSON.parse(stdout);
}

async function main() {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-demo-'));
  const habitat = path.join(work, 'habitat');
  const child = path.join(work, 'child');
  try {
    const genesis = await run(['init', '--credits', '4'], habitat);
    const first = await run(['inject', '第一条 relay 天气', '--source', 'relay'], habitat);
    await run(['wake'], habitat);
    await run(['inject', '第二条 feed 天气', '--source', 'feed'], habitat);
    const secondWake = await run(['wake'], habitat);
    const status = await run(['status'], habitat);
    const replayResult = await run(['replay'], habitat);
    const death = await run(['die', '--reason', 'demo-death'], habitat);
    const blocked = await run(['wake'], habitat);
    const resurrection = await run(['resurrect', '--wake', '--credits', '4'], habitat);
    const fork = await run(['fork', child], habitat);
    const finalStatus = await run(['status'], habitat);
    const childStatus = await run(['status'], child);
    const valid = replayResult.valid === true
      && status.bodyCount >= 2
      && finalStatus.agentId === genesis.agentId
      && death.status === 'death'
      && blocked.status === 'dead'
      && resurrection.alive === true
      && fork.childAgentId !== genesis.agentId
      && childStatus.lineage.parentAgentId === finalStatus.agentId
      && finalStatus.deaths >= 1
      && finalStatus.resurrections >= 1
      && finalStatus.forks >= 1;

    const eventsPath = path.join(habitat, 'events.ndjson');
    const eventsText = await readFile(eventsPath, 'utf8');
    const tampered = eventsText.replace('第一条 relay 天气', '被篡改的消息');
    const tamperedHabitat = path.join(work, 'tampered');
    await execFileAsync(process.execPath, [cli, 'init', '--habitat', tamperedHabitat, '--force', '--json']).catch(() => {});
    await writeFile(path.join(tamperedHabitat, 'events.ndjson'), tampered, 'utf8');
    let tamperDetected = false;
    try {
      await execFileAsync(process.execPath, [cli, 'replay', '--habitat', tamperedHabitat, '--json']);
    } catch {
      tamperDetected = true;
    }

    console.log(JSON.stringify({
      valid: valid && tamperDetected,
      agentId: finalStatus.agentId,
      bodyCount: finalStatus.bodyCount,
      eventCount: finalStatus.eventCount,
      pulses: finalStatus.pulses,
      deaths: finalStatus.deaths,
      resurrections: finalStatus.resurrections,
      forks: finalStatus.forks,
      firstPerception: first.id,
      secondWakeBody: secondWake.bodyId,
      replayDigest: replayResult.digest,
      childAgentId: childStatus.agentId,
      tamperDetected,
    }, null, 2));
    if (!valid || !tamperDetected) process.exitCode = 1;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
