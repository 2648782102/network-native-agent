#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repositoryRoot, 'bin', 'nna.mjs');

function parsePort(rawValue, fallback) {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

const testRoot = path.resolve(
  repositoryRoot,
  process.env.NNA_TEST_ROOT ?? path.join('work', 'test-env'),
);

if (testRoot === repositoryRoot || repositoryRoot.startsWith(`${testRoot}${path.sep}`)) {
  throw new Error('NNA_TEST_ROOT must be a dedicated directory, not the repository root or one of its parents');
}
const habitatPort = parsePort(process.env.NNA_TEST_HABITAT_PORT, 8787);
const modelPort = parsePort(process.env.NNA_TEST_MODEL_PORT, 8788);

const paths = {
  root: testRoot,
  relay: path.join(testRoot, 'relay.git'),
  bodyA: path.join(testRoot, 'body-a'),
  bodyB: path.join(testRoot, 'body-b'),
  observer: path.join(testRoot, 'observer'),
  small: path.join(testRoot, 'small'),
  model: path.join(testRoot, 'model'),
  manifest: path.join(testRoot, 'manifest.json'),
  readme: path.join(testRoot, 'README.md'),
};

const habitatPaths = [paths.bodyA, paths.bodyB, paths.observer, paths.small, paths.model];
const gitEnvironment = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_NOSYSTEM: '1',
};
const nnaEnvironment = {
  ...gitEnvironment,
  NNA_COGNITION: 'deterministic',
};

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function relativeToRepository(target) {
  return toPosixPath(path.relative(repositoryRoot, target));
}

async function runExecutable(command, args, options = {}) {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: { ...process.env, ...options.env },
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

async function runGit(args, cwd = repositoryRoot) {
  return runExecutable('git', args, { cwd, env: gitEnvironment });
}

async function runNna(args) {
  const stdout = await runExecutable(process.execPath, [cli, ...args, '--json'], {
    cwd: repositoryRoot,
    env: nnaEnvironment,
  });
  return JSON.parse(stdout);
}

function versionAtLeast(current, minimum) {
  const currentParts = current.split('.').map(Number);
  const minimumParts = minimum.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const left = currentParts[index] ?? 0;
    const right = minimumParts[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

function assertEngine() {
  if (!versionAtLeast(process.versions.node, '20.11.0')) {
    throw new Error(`Node.js 20.11+ is required, found ${process.versions.node}`);
  }
}

async function assertGit() {
  try {
    return await runExecutable('git', ['--version'], { env: gitEnvironment });
  } catch {
    throw new Error('git is required for the local bare relay test environment');
  }
}

async function fileExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function portFree(port) {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

function relayConfigFor(habitat) {
  return path.join(habitat, 'relay.json');
}

function identityFor(habitat) {
  return path.join(habitat, 'identity.key');
}

function testEnvironmentReadme(manifest) {
  const lines = [
    '# 本地测试环境',
    '',
    '这是由 `npm run env:init` 生成的隔离实验台，不进入 Git，不包含真实凭据。',
    '',
    '## 目录',
    '',
    '| 路径 | 用途 |',
    '| --- | --- |',
    `| ${relativeToRepository(paths.relay)} | 本地 bare Git relay |`,
    `| ${relativeToRepository(paths.bodyA)} | 可写主体，绑定 relay |`,
    `| ${relativeToRepository(paths.bodyB)} | 恢复体，继承身份与 relay 配置 |`,
    `| ${relativeToRepository(paths.observer)} | 只读观察体，无 identity.key、无 relay 配置 |`,
    `| ${relativeToRepository(paths.small)} | 2 credits 代谢死亡样本 |`,
    `| ${relativeToRepository(paths.model)} | 待处理感知，供假模型器官使用 |`,
    `| ${relativeToRepository(paths.manifest)} | 环境元数据 |`,
    '',
    '## 常用命令',
    '',
    '在仓库根目录执行：',
    '',
    '```bash',
    'npm run env:check',
    'npm run env:report',
    'npm run env:serve',
    'npm run env:model',
    'npm run env:reset',
    '```',
    '',
    '端口：',
    '',
    `- habitat HTTP: ${manifest.ports.habitat}`,
    `- fake model organ: ${manifest.ports.model}`,
    '',
    '详细说明见仓库根目录的 `TEST_ENVIRONMENT.md`。',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(paths.manifest, 'utf8'));
  } catch {
    throw new Error('test environment is not initialized; run npm run env:init first');
  }
}

async function initEnvironment(options) {
  assertEngine();
  const gitVersion = await assertGit();
  const rootExists = await fileExists(paths.root);
  if (rootExists && !options.force) {
    throw new Error('test environment directory already exists; use npm run env:reset or node scripts/test-env.mjs init --force');
  }
  if (options.force) {
    await rm(paths.root, { recursive: true, force: true });
  }
  await mkdir(paths.root, { recursive: true });
  await runGit(['init', '--bare', '--quiet', paths.relay], paths.root);

  const genesis = await runNna(['init', '--habitat', paths.bodyA, '--credits', '12', '--remote-url', paths.relay]);
  await runNna(['relay', 'attach', paths.relay, '--habitat', paths.bodyA]);
  await runNna(['weather', '--count', '4', '--batch', 'test-env', '--habitat', paths.bodyA]);
  await runNna(['wake', '--cognition', 'deterministic', '--habitat', paths.bodyA]);
  await runNna(['sync', '--habitat', paths.bodyA]);
  const relay = await runNna(['relay', 'status', '--habitat', paths.bodyA]);
  await runNna(['restore', paths.bodyB, '--habitat', paths.bodyA]);
  await runNna(['restore', paths.observer, '--no-identity', '--habitat', paths.bodyA]);
  await rm(relayConfigFor(paths.observer), { force: true });
  await runNna(['init', '--habitat', paths.small, '--credits', '2', '--force']);
  await runNna(['init', '--habitat', paths.model, '--credits', '4', '--force']);
  await runNna(['inject', 'model organ test weather', '--source', 'relay', '--habitat', paths.model]);

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    node: process.versions.node,
    platform: process.platform,
    gitVersion,
    root: relativeToRepository(paths.root),
    relay: relativeToRepository(paths.relay),
    ports: { habitat: habitatPort, model: modelPort },
    agentId: genesis.agentId,
    genesisId: genesis.genesisId,
    relayBranch: relay.branch,
    habitats: Object.fromEntries(habitatPaths.map((habitat) => [path.basename(habitat), relativeToRepository(habitat)])),
    boundaries: [
      'local loopback only',
      'local bare Git relay only',
      'synthetic events only',
      'no real API keys',
      'no third-party writes',
    ],
  };
  await writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(paths.readme, testEnvironmentReadme(manifest), 'utf8');

  console.log(JSON.stringify({
    status: 'test_environment_ready',
    root: manifest.root,
    agentId: manifest.agentId,
    relayBranch: manifest.relayBranch,
    habitats: Object.keys(manifest.habitats).length,
    ports: manifest.ports,
    next: [
      'npm run env:check',
      'npm run env:report',
      'npm run env:serve',
      'npm run env:model',
    ],
  }, null, 2));
}

async function findSecretLikeText() {
  const candidates = [];
  for (const habitat of habitatPaths) {
    candidates.push(path.join(habitat, 'events.ndjson'));
    candidates.push(path.join(habitat, 'genesis.json'));
    candidates.push(relayConfigFor(habitat));
    const outbox = path.join(habitat, 'outbox');
    const entries = await readdir(outbox, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        candidates.push(path.join(outbox, entry.name));
      }
    }
  }
  const pattern = /test-only-cognition-key|NNA_MODEL_API_KEY|Authorization\s*:|Bearer\s+/i;
  const leaks = [];
  for (const candidate of candidates) {
    const text = await readFile(candidate, 'utf8').catch(() => '');
    if (text && pattern.test(text)) leaks.push(relativeToRepository(candidate));
  }
  return leaks;
}

async function checkEnvironment() {
  assertEngine();
  const gitVersion = await assertGit();
  const manifest = await readManifest();
  const checks = [];
  const warnings = [];
  const addCheck = (name, passed, detail) => {
    checks.push({ name, passed, detail });
  };

  addCheck('node', versionAtLeast(process.versions.node, '20.11.0'), process.versions.node);
  addCheck('git', Boolean(gitVersion), gitVersion);

  const isBare = await runGit(['rev-parse', '--is-bare-repository'], paths.relay).catch(() => '');
  addCheck('bare relay', isBare === 'true', isBare || 'unavailable');

  const identityExpectations = [
    ['body-a identity', paths.bodyA, true],
    ['body-b identity', paths.bodyB, true],
    ['observer identity', paths.observer, false],
    ['small identity', paths.small, true],
    ['model identity', paths.model, true],
  ];
  for (const [name, habitat, expected] of identityExpectations) {
    const present = await fileExists(identityFor(habitat));
    addCheck(name, present === expected, present ? 'present' : 'absent');
  }

  for (const habitat of habitatPaths) {
    const name = path.basename(habitat);
    const replayResult = await runNna(['replay', '--habitat', habitat]);
    addCheck(`${name} replay`, replayResult.valid === true, {
      eventCount: replayResult.eventCount,
      agentId: replayResult.agentId,
    });
  }

  const relayBefore = await runNna(['relay', 'status', '--habitat', paths.bodyA]);
  addCheck('relay configured', relayBefore.configured === true, relayBefore.branch);
  addCheck(
    'relay aligned',
    relayBefore.divergent === false && relayBefore.localEventCount === relayBefore.remoteEventCount,
    { localEventCount: relayBefore.localEventCount, remoteEventCount: relayBefore.remoteEventCount },
  );

  const smoke = await runNna([
    'inject',
    `test-env smoke ${Date.now()}`,
    '--source',
    'relay',
    '--wake',
    '--cognition',
    'deterministic',
    '--habitat',
    paths.bodyA,
  ]);
  const relayAfter = await runNna(['relay', 'status', '--habitat', paths.bodyA]);
  addCheck('smoke write', /^[0-9a-f]{64}$/.test(smoke.id) && smoke.wake.events > 0, {
    eventId: smoke.id,
    appendedEvents: smoke.wake.events,
  });
  addCheck(
    'smoke published',
    relayAfter.remoteEventCount > relayBefore.remoteEventCount
      && relayAfter.localEventCount === relayAfter.remoteEventCount
      && relayAfter.divergent === false,
    { before: relayBefore.remoteEventCount, after: relayAfter.remoteEventCount },
  );

  const relayList = await runNna(['relay', 'ls', paths.relay]);
  addCheck(
    'relay ls',
    relayList.branchCount >= 1
      && relayList.summaries.some((entry) => entry.valid === true && entry.agentId === manifest.agentId),
    { branchCount: relayList.branchCount, validBranches: relayList.summaries.filter((entry) => entry.valid).length },
  );

  const metrics = await runNna(['metrics', '--habitat', paths.bodyA]);
  addCheck('metrics', metrics.identityContinuity === true && metrics.eventCount > 0, {
    eventCount: metrics.eventCount,
    driftDistance: metrics.driftDistance,
  });

  const cognition = await runNna(['cognition', '--cognition', 'deterministic']);
  addCheck(
    'cognition interface',
    ['deterministic', 'stochastic', 'model'].every((name) => cognition.adapters.includes(name)),
    { active: cognition.active, modelConfigured: cognition.model.configured },
  );

  const leaks = await findSecretLikeText();
  addCheck('no test key in event data', leaks.length === 0, leaks);

  const relativeRoot = relativeToRepository(paths.root);
  if (relativeRoot.startsWith('..')) {
    warnings.push('NNA_TEST_ROOT is outside the repository; git check-ignore was skipped');
  } else {
    let ignored = false;
    try {
      await runGit(['check-ignore', '-q', relativeRoot || '.']);
      ignored = true;
    } catch {
      ignored = false;
    }
    addCheck('test root ignored', ignored, relativeRoot);
  }

  const ports = {
    habitat: await portFree(habitatPort),
    model: await portFree(modelPort),
  };
  if (!ports.habitat) warnings.push(`habitat port ${habitatPort} is already in use; ignore this if you started env:serve`);
  if (!ports.model) warnings.push(`model port ${modelPort} is already in use; ignore this if you started env:model`);

  const failedChecks = checks.filter((entry) => !entry.passed);
  const valid = failedChecks.length === 0;
  console.log(JSON.stringify({
    valid,
    root: manifest.root,
    agentId: manifest.agentId,
    checkCount: checks.length,
    failedChecks,
    checks,
    ports,
    warnings,
    note: 'env:check advances body-a with one synthetic smoke event; this is expected',
  }, null, 2));
  if (!valid) process.exitCode = 1;
}

async function serveHabitat() {
  await readManifest();
  const free = await portFree(habitatPort);
  if (!free) throw new Error(`habitat port ${habitatPort} is already in use; set NNA_TEST_HABITAT_PORT`);
  const child = spawn(process.execPath, [cli, 'serve', '--habitat', paths.bodyA, '--port', String(habitatPort)], {
    cwd: repositoryRoot,
    env: { ...process.env, NNA_COGNITION: 'deterministic' },
    stdio: 'inherit',
  });
  let stopping = false;
  const forwardSignal = (signal) => {
    if (stopping) return;
    stopping = true;
    child.kill(signal);
  };
  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
}

async function serveModel() {
  await readManifest();
  const free = await portFree(modelPort);
  if (!free) throw new Error(`model port ${modelPort} is already in use; set NNA_TEST_MODEL_PORT`);
  const configuredFakeKey = process.env.NNA_TEST_MODEL_API_KEY?.trim() ?? '';
  const fakeKey = configuredFakeKey || 'test-only-cognition-key';
  const invalid = ['1', 'true', 'yes'].includes(String(process.env.NNA_TEST_MODEL_INVALID ?? '').toLowerCase());
  const requestedImpulse = String(process.env.NNA_TEST_MODEL_IMPULSE ?? 'migrate').trim().toLowerCase();
  const allowedImpulses = new Set(['echo', 'trace', 'migrate', 'sleep']);
  if (!invalid && !allowedImpulses.has(requestedImpulse)) {
    throw new Error(`NNA_TEST_MODEL_IMPULSE must be one of ${[...allowedImpulses].join(', ')}`);
  }
  const content = invalid ? 'delete everything' : requestedImpulse;
  const exportKeyLine = configuredFakeKey
    ? 'export NNA_MODEL_API_KEY="$NNA_TEST_MODEL_API_KEY"'
    : `export NNA_MODEL_API_KEY=${fakeKey}`;

  const server = createHttpServer(async (request, response) => {
    const send = (statusCode, value) => {
      response.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(value));
    };
    try {
      if (request.method !== 'POST') {
        send(405, { error: 'POST is required' });
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 65536) {
          send(413, { error: 'request body too large' });
          return;
        }
        chunks.push(chunk);
      }
      const authorization = request.headers.authorization ?? '';
      if (authorization !== `Bearer ${fakeKey}`) {
        send(401, { error: 'unauthorized' });
        return;
      }
      send(200, { choices: [{ message: { content } }] });
    } catch (error) {
      send(500, { error: error.message });
    }
  });

  server.on('error', (error) => {
    console.error(`nna test-env: fake model organ failed: ${error.message}`);
    process.exit(1);
  });

  server.listen(modelPort, '127.0.0.1', () => {
    console.log(JSON.stringify({
      status: 'fake_model_organ_listening',
      url: `http://127.0.0.1:${modelPort}/v1/chat/completions`,
      mode: invalid ? 'invalid-output' : 'structured-output',
      impulse: invalid ? null : requestedImpulse,
      keyDisclosure: configuredFakeKey
        ? 'using NNA_TEST_MODEL_API_KEY; its value is not printed'
        : 'using a test-only key; never replace it with a real API key',
      fakeApiKey: configuredFakeKey ? null : fakeKey,
      exportCommands: [
        'export NNA_COGNITION=model',
        `export NNA_MODEL_URL=http://127.0.0.1:${modelPort}/v1/chat/completions`,
        exportKeyLine,
        'export NNA_MODEL_NAME=loopback-test-organ',
      ],
      next: (() => {
        const modelHabitat = relativeToRepository(paths.model);
        const wakeCommand = `node bin/nna.mjs wake --habitat ${modelHabitat}`;
        return [
          `node bin/nna.mjs inject "一条待处理天气" --source relay --habitat ${modelHabitat}`,
          wakeCommand,
          `node bin/nna.mjs trace --last 10 --habitat ${modelHabitat} --json`,
        ];
      })(),
      warning: 'This is a loopback test organ. Never configure a real API key here.',
      shellNote: 'If NNA_MODEL_API_KEY is already set, run the exported command to override it with the test-only key.',
    }, null, 2));
  });

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      process.exitCode = 0;
    });
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}

async function reportEnvironment() {
  const manifest = await readManifest();
  const status = await runNna(['status', '--habitat', paths.bodyA]);
  const relay = await runNna(['relay', 'status', '--habitat', paths.bodyA]);
  const cognition = await runNna(['cognition', '--cognition', 'deterministic']);
  console.log(JSON.stringify({
    status: 'test_environment_report',
    manifest,
    bodyA: {
      agentId: status.agentId,
      alive: status.alive,
      credits: status.credits,
      eventCount: status.eventCount,
      digest: status.digest,
      relay,
    },
    cognition: {
      active: cognition.active,
      adapters: cognition.adapters,
      modelConfigured: cognition.model.configured,
    },
    ports: {
      habitat: { requested: habitatPort, available: await portFree(habitatPort) },
      model: { requested: modelPort, available: await portFree(modelPort) },
    },
    commands: {
      check: 'npm run env:check',
      serve: 'npm run env:serve',
      model: 'npm run env:model',
      reset: 'npm run env:reset',
      fullCheck: 'npm run check',
    },
  }, null, 2));
}

async function resetEnvironment(options) {
  if (!options.yes) {
    throw new Error('reset requires --yes; use npm run env:reset');
  }
  await rm(paths.root, { recursive: true, force: true });
  await initEnvironment({ force: true });
}

function printHelp() {
  console.log(`nna test-env — isolated local research test environment

Commands:
  init [--force]   create work/test-env with a bare relay and sample habitats
  check            verify engine, relay, replay, smoke write, secrets and ignore rules
  report           print environment manifest and current body-a summary
  serve            start body-a loopback habitat on 127.0.0.1:8787
  model            start a loopback fake model organ on 127.0.0.1:8788
  reset --yes      delete and recreate work/test-env

Environment:
  NNA_TEST_ROOT             default: work/test-env
  NNA_TEST_HABITAT_PORT     default: 8787
  NNA_TEST_MODEL_PORT       default: 8788
  NNA_TEST_MODEL_IMPULSE    default: migrate
  NNA_TEST_MODEL_INVALID    1/true/yes returns unstructured output
  NNA_TEST_MODEL_API_KEY    optional fake key; value is never printed`);
}

async function main() {
  const [command = 'init', ...rest] = process.argv.slice(2);
  const options = {
    force: rest.includes('--force'),
    yes: rest.includes('--yes'),
  };
  switch (command) {
    case 'init':
      await initEnvironment(options);
      break;
    case 'check':
      await checkEnvironment();
      break;
    case 'serve':
      await serveHabitat();
      break;
    case 'model':
      await serveModel();
      break;
    case 'report':
      await reportEnvironment();
      break;
    case 'reset':
      await resetEnvironment(options);
      break;
    case 'help':
    case '--help':
      printHelp();
      break;
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(`nna test-env: ${error.message}`);
  process.exitCode = 1;
});
