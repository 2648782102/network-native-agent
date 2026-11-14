import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');

function run(args, env = {}) {
  return execFileAsync(process.execPath, [cli, ...args, '--json'], {
    env: { ...process.env, ...env },
  }).then(({ stdout }) => JSON.parse(stdout));
}

function impulseCounts(trace) {
  return trace
    .filter((event) => event.type === 'pulse')
    .map((event) => event.payload.cognition.adapter);
}

test('cognition adapters replace impulses without changing identity or lifecycle', async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-cognition-'));
  const deterministicHabitat = path.join(work, 'deterministic');
  const stochasticHabitat = path.join(work, 'stochastic');
  try {
    const deterministicGenesis = await run(['init', '--habitat', deterministicHabitat, '--credits', '8']);
    const stochasticGenesis = await run(['init', '--habitat', stochasticHabitat, '--credits', '8']);
    assert.notEqual(deterministicGenesis.agentId, stochasticGenesis.agentId);

    for (const [habitat, cognition] of [
      [deterministicHabitat, 'deterministic'],
      [stochasticHabitat, 'stochastic'],
    ]) {
      for (let index = 0; index < 6; index += 1) {
        await run(['inject', `network weather ${index}`, '--source', 'relay', '--habitat', habitat]);
      }
      await run(['wake', '--cognition', cognition, '--habitat', habitat]);
      await run(['die', '--reason', 'cognition-organ-swap', '--habitat', habitat]);
      await run(['resurrect', '--wake', '--credits', '8', '--cognition', cognition, '--habitat', habitat]);
    }

    const deterministicTrace = await run(['trace', '--last', '50', '--habitat', deterministicHabitat]);
    const stochasticTrace = await run(['trace', '--last', '50', '--habitat', stochasticHabitat]);
    assert.deepEqual([...new Set(impulseCounts(deterministicTrace))], ['deterministic']);
    assert.deepEqual([...new Set(impulseCounts(stochasticTrace))], ['stochastic']);
    assert.ok(stochasticTrace.some((event) => event.type === 'pulse' && event.payload.cognition.adapter === 'stochastic'));

    for (const trace of [deterministicTrace, stochasticTrace]) {
      assert.ok(trace.some((event) => event.type === 'death'));
      assert.ok(trace.some((event) => event.type === 'resurrection'));
      assert.ok(trace.some((event) => event.type === 'heartbeat'));
    }

    const deterministic = await run(['metrics', '--habitat', deterministicHabitat]);
    const stochastic = await run(['metrics', '--habitat', stochasticHabitat]);
    assert.equal(deterministic.identityContinuity, true);
    assert.equal(stochastic.identityContinuity, true);
    assert.equal(deterministic.cognition.deterministic > 0, true);
    assert.equal(stochastic.cognition.stochastic > 0, true);
    assert.notEqual(deterministic.digest, stochastic.digest);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('model cognition organ accepts only a structured impulse and keeps its key out of events', async (context) => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-model-organ-'));
  const habitat = path.join(work, 'habitat');
  let requests = 0;
  let lastAuthorization = null;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    lastAuthorization = request.headers.authorization;
    request.body = Buffer.concat(chunks).toString('utf8');
    requests += 1;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: 'migrate' } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(work, { recursive: true, force: true });
  });

  const env = {
    NNA_COGNITION: 'model',
    NNA_MODEL_URL: `http://127.0.0.1:${port}/v1/chat/completions`,
    NNA_MODEL_API_KEY: 'test-only-cognition-key',
    NNA_MODEL_NAME: 'loopback-test-organ',
  };
  const cognition = await run(['cognition'], env);
  assert.equal(cognition.active, 'model');
  assert.equal(cognition.model.configured, true);
  assert.equal(cognition.model.apiKeyPresent, true);
  assert.equal(JSON.stringify(cognition).includes(env.NNA_MODEL_API_KEY), false);

  await run(['init', '--habitat', habitat, '--credits', '4'], env);
  await run(['inject', 'a model-shaped weather event', '--source', 'relay', '--habitat', habitat], env);
  await run(['wake', '--habitat', habitat], env);
  const trace = await run(['trace', '--last', '20', '--habitat', habitat], env);
  const pulse = trace.find((event) => event.type === 'pulse');
  assert.equal(pulse.payload.impulse, 'migrate');
  assert.equal(pulse.payload.cognition.adapter, 'model');
  assert.equal(pulse.payload.cognition.organ, env.NNA_MODEL_NAME);
  assert.equal(requests, 1);
  assert.equal(lastAuthorization, `Bearer ${env.NNA_MODEL_API_KEY}`);
  assert.equal(JSON.stringify(trace).includes(env.NNA_MODEL_API_KEY), false);
});

test('model cognition organ rejects non-impulse output before writing a pulse', async (context) => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-model-organ-reject-'));
  const habitat = path.join(work, 'habitat');
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: 'delete everything' } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(work, { recursive: true, force: true });
  });

  const env = {
    NNA_COGNITION: 'model',
    NNA_MODEL_URL: `http://127.0.0.1:${port}/v1/chat/completions`,
    NNA_MODEL_API_KEY: 'test-only-cognition-key',
  };
  await run(['init', '--habitat', habitat, '--credits', '4'], env);
  await run(['inject', 'an unstructured model answer', '--source', 'relay', '--habitat', habitat], env);
  await assert.rejects(
    run(['wake', '--habitat', habitat], env),
    (error) => /invalid_final_text/.test(String(error.stderr ?? error)),
  );
  const status = await run(['status', '--habitat', habitat], env);
  assert.equal(status.pulses, 0);
  assert.equal(status.pending, 1);
});
