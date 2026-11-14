import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function freePort() {
  const { stdout } = await execFileAsync(process.execPath, ['-e', `
    const net = require('node:net');
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      console.log(server.address().port);
      server.close();
    });
  `], { encoding: 'utf8' });
  return Number(stdout.trim());
}

test('evidence console exposes JSON health, formal chart, and no retired actions', async (context) => {
  const port = await freePort();
  const child = execFileAsync(process.execPath, [path.join(root, 'scripts', 'viz-server.mjs')], {
    cwd: root,
    env: { ...process.env, NNA_VIZ_PORT: String(port), NNA_VIZ_HOST: '127.0.0.1' },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  const base = `http://127.0.0.1:${port}`;
  let response;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      response = await fetch(`${base}/health`);
      if (response.ok) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(response, 'server did not start');
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  const health = await response.json();
  assert.equal(health.ok, true);

  const page = await (await fetch(base)).text();
  assert.match(page, /正式实验控制台/);
  assert.doesNotMatch(page, /运行模型测试|运行认知对比|开发期基准|model:benchmark/);

  const chart = await fetch(`${base}/formal-chart.svg`);
  assert.equal(chart.status, 200);
  assert.match(chart.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await chart.text(), /<svg/);

  const figure = await fetch(`${base}/figures/compliance-vs-intent.png`);
  assert.equal(figure.status, 200);
  assert.equal(figure.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await figure.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');

  context.after(async () => {
    await fetch(`${base}/health`).catch(() => {});
  });
  await Promise.race([
    child.catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 50)),
  ]);
  process.kill(child.child.pid, 'SIGTERM');
  await child.catch(() => {});
});
