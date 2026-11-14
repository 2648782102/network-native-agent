import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');

test('incomplete model response writes no pulse and leaves perception pending', async (context) => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-incomplete-model-'));
  const habitat = path.join(work, 'habitat');
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'migrate' }] }],
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(work, { recursive: true, force: true });
  });

  const env = {
    ...process.env,
    NNA_COGNITION: 'model',
    NNA_MODEL_WIRE: 'responses',
    NNA_MODEL_URL: `http://127.0.0.1:${port}/v1/responses`,
    NNA_MODEL_API_KEY: 'test-only-key',
    NNA_MODEL_NAME: 'incomplete-organ',
  };
  const run = (args) => execFileAsync(process.execPath, [cli, ...args, '--json'], {
    cwd: root,
    env,
    encoding: 'utf8',
  });

  await run(['init', '--habitat', habitat, '--credits', '2']);
  await run(['inject', 'a model response without final text', '--source', 'relay', '--habitat', habitat]);
  await assert.rejects(
    run(['wake', '--habitat', habitat]),
    (error) => /incomplete_max_output_tokens/.test(String(error.stderr ?? error)),
  );
  const eventsText = await readFile(path.join(habitat, 'events.ndjson'), 'utf8');
  const events = eventsText.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.some((event) => event.type === 'pulse'), false);
  const status = JSON.parse((await run(['status', '--habitat', habitat])).stdout.trim().split(/\n(?=\{)/).at(-1));
  assert.equal(status.pending, 1);
  assert.equal(status.pulses, 0);
});
