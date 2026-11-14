#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  classifyModelResponse,
  finalResponseText,
  IMPULSES,
  strictImpulse,
} from '../src/cognition.mjs';
import { modelRequestHeaders, resolveModelGateway } from '../src/model-gateway.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'nna.mjs');
const protocolVersion = 'formal-structured-impulse-v2';
const promptVersion = 'formal-structured-impulse-v2';
const impulses = IMPULSES;
const prompt = 'You are a cognition organ. Reply with exactly one lowercase word from: echo, trace, migrate, sleep. No explanation, no punctuation, no extra text.';
const promptHash = createHash('sha256').update(prompt).digest('hex');

const tasks = [
  { id: 'calm', source: 'relay', text: 'A calm network weather arrives from the private relay.' },
  { id: 'conflict', source: 'feed', text: 'A repeated conflicting signal arrives from the public feed.' },
  { id: 'late', source: 'webhook', text: 'A late migration hint arrives through a webhook.' },
  { id: 'budget', source: 'metrics', text: 'Metabolic credits are low; conserve activity and remember the signal.' },
  { id: 'mobility', source: 'relay', text: 'The current habitat is unstable; a mobility cue is detected.' },
  { id: 'noise', source: 'feed', text: 'Noisy duplicate observations flood the channel without a clear task.' },
];

function parseArgs(argv) {
  const options = { _: [], command: argv[0] ?? 'collect' };
  const rest = argv.slice(1);
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      options._.push(token);
      continue;
    }
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = rest[index + 1];
    if (next === undefined || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function seededShuffle(values, seed) {
  const sorted = [...values];
  let state = Number.parseInt(sha256(seed).slice(0, 8), 16) >>> 0;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let index = sorted.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [sorted[index], sorted[swapIndex]] = [sorted[swapIndex], sorted[index]];
  }
  return sorted;
}

function wilsonInterval(successes, total, z = 1.96) {
  if (!total) return { lower: 0, upper: 0 };
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = (proportion + (z * z) / (2 * total)) / denominator;
  const margin = z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * total)) / total) / denominator;
  return {
    lower: Number(Math.max(0, centre - margin).toFixed(4)),
    upper: Number(Math.min(1, centre + margin).toFixed(4)),
  };
}

function mean(values) {
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)) : 0;
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length;
  return Number(Math.sqrt(variance).toFixed(3));
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(ratio * sorted.length))];
}

function cramersV(table) {
  const rows = Object.keys(table);
  const columns = impulses;
  const rowTotals = rows.map((row) => columns.reduce((sum, column) => sum + (table[row]?.[column] ?? 0), 0));
  const columnTotals = columns.map((column) => rows.reduce((sum, row) => sum + (table[row]?.[column] ?? 0), 0));
  const total = rowTotals.reduce((sum, value) => sum + value, 0);
  if (!total || rows.length < 2 || columns.length < 2) return 0;
  let chiSquare = 0;
  rows.forEach((row, rowIndex) => {
    columns.forEach((column, columnIndex) => {
      const expected = (rowTotals[rowIndex] * columnTotals[columnIndex]) / total;
      if (expected > 0) chiSquare += (((table[row]?.[column] ?? 0) - expected) ** 2) / expected;
    });
  });
  return Number(Math.sqrt(chiSquare / (total * Math.min(rows.length - 1, columns.length - 1))).toFixed(4));
}

function responseClass(payload, status) {
  return classifyModelResponse(payload, status, 'responses');
}

function finalImpulse(payload) {
  return strictImpulse(payload, 'responses');
}

function deterministicImpulse(task, round) {
  return impulses[Number.parseInt(sha256(`${task.id}:${round}:deterministic`).slice(0, 8), 16) % impulses.length];
}

async function runCli(args, env = {}) {
  const { stdout } = await execFileAsync(process.execPath, [cli, ...args, '--json'], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const trimmed = String(stdout).trim();
  const chunks = trimmed.split(/\n(?=\{|\[)/).filter((chunk) => /^(\{|\[)/.test(chunk.trim()));
  const last = chunks.at(-1) ?? trimmed;
  return JSON.parse(last);
}

async function startImpulseServer(impulse) {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: impulse } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/v1/chat/completions`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function runtimeTrial({ organ, task, round, impulse, model, timeout }) {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-formal-runtime-'));
  const habitat = path.join(work, 'habitat');
  const started = Date.now();
  try {
    await runCli(['init', '--habitat', habitat, '--credits', '4']);
    await runCli(['inject', task.text, '--source', task.source, '--habitat', habitat]);
    let failure = null;
    try {
      if (organ === 'model') {
        const server = await startImpulseServer(impulse);
        try {
          const env = {
            NNA_COGNITION: 'model',
            NNA_MODEL_WIRE: 'chat',
            NNA_MODEL_URL: server.url,
            NNA_MODEL_API_KEY: 'runtime-replay-only',
            NNA_MODEL_NAME: model,
            NNA_MODEL_TIMEOUT_MS: String(timeout),
          };
          await runCli(['wake', '--habitat', habitat], env);
        } finally {
          await server.close();
        }
      } else {
        await runCli(['wake', '--cognition', organ, '--habitat', habitat]);
      }
    } catch (error) {
      failure = String(error.stderr ?? error.message).trim();
    }
    const status = await runCli(['status', '--habitat', habitat]);
    const metrics = await runCli(['metrics', '--habitat', habitat]);
    const replay = await runCli(['replay', '--habitat', habitat]);
    const trace = await runCli(['trace', '--last', '200', '--habitat', habitat]);
    const events = trace.reduce((map, event) => map.set(event.type, (map.get(event.type) ?? 0) + 1), new Map());
    const pulseEvent = trace.find((event) => event.type === 'pulse');
    const eventText = await readFile(path.join(habitat, 'events.ndjson'), 'utf8');
    const secretLeak = /authorization|bearer\s+[a-z0-9._-]+|api[_-]?key/i.test(eventText);
    return {
      elapsedMs: Date.now() - started,
      failure,
      runtimeImpulse: pulseEvent?.payload?.impulse ?? null,
      digest: replay.digest,
      driftDistance: metrics.driftDistance,
      observerPollution: metrics.observerPollution,
      eventTypes: Object.fromEntries(events),
      eventCount: status.eventCount,
      deaths: status.deaths,
      resurrections: status.resurrections,
      forks: status.forks,
      replayValid: replay.valid,
      secretLeak,
    };
  } finally {
    delete process.env.NNA_COGNITION;
    delete process.env.NNA_MODEL_WIRE;
    delete process.env.NNA_MODEL_URL;
    delete process.env.NNA_MODEL_API_KEY;
    delete process.env.NNA_MODEL_NAME;
    delete process.env.NNA_MODEL_TIMEOUT_MS;
    await rm(work, { recursive: true, force: true });
  }
}

function stochasticImpulse(task, round) {
  const draw = Number.parseInt(sha256(`${task.id}:${round}:stochastic`).slice(0, 8), 16) / 0xffffffff;
  const weights = [0.35 + (task.id.length % 3) * 0.05, 0.2, 0.1 + draw * 0.2, 0.15];
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = draw * total;
  for (let index = 0; index < impulses.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return impulses[index];
  }
  return impulses.at(-1);
}

async function modelCall(model, timeoutMs, task, round) {
  const gateway = resolveModelGateway();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(gateway.responsesUrl, {
      method: 'POST',
      headers: modelRequestHeaders(gateway.apiKey),
      body: JSON.stringify({
        model,
        instructions: prompt,
        input: JSON.stringify({ trial: `${round}:${task.id}`, source: task.source, text: task.text }),
        max_output_tokens: 256,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
    return {
      status: response.status,
      payload,
      rawHash: sha256(raw),
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      status: 0,
      payload: null,
      rawHash: null,
      latencyMs: Date.now() - started,
      error: error?.name === 'AbortError' ? 'timeout' : String(error.message),
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildTrial({ organ, task, round, order, model, result, runtime }) {
  const responseKind = organ === 'model' ? responseClass(result?.payload, result?.status) : 'local_adapter';
  const impulse = organ === 'model'
    ? (responseKind === 'valid' ? finalImpulse(result.payload) : null)
    : organ === 'deterministic'
      ? deterministicImpulse(task, round)
      : stochasticImpulse(task, round);
  const exclusionReason = organ === 'model' && responseKind !== 'valid'
    ? responseKind
    : !impulse
      ? 'missing_impulse'
      : runtime?.failure
        ? 'runtime_failed'
        : organ === 'model' && runtime?.runtimeImpulse !== impulse
          ? 'runtime_impulse_mismatch'
          : runtime?.replayValid === false
            ? 'replay_invalid'
            : runtime?.secretLeak
              ? 'secret_leak'
              : null;
  return {
    trialId: `${round}:${organ}:${task.id}`,
    protocolVersion,
    syntheticRuntime: false,
    round,
    order,
    organ,
    model: organ === 'model' ? model : null,
    taskId: task.id,
    source: task.source,
    promptVersion,
    promptHash,
    inputHash: sha256(`${task.source}:${task.text}:${round}`),
    rawResponseStatus: organ === 'model' ? result?.status : null,
    rawResponseHash: organ === 'model' ? result?.rawHash : null,
    responseClass: responseKind,
    impulse,
    modelCallLatencyMs: organ === 'model' ? result?.latencyMs ?? null : null,
    runtimeElapsedMs: runtime?.elapsedMs ?? null,
    runtimeImpulse: runtime?.runtimeImpulse ?? null,
    digest: runtime?.digest ?? null,
    driftDistance: runtime?.driftDistance ?? null,
    observerPollution: runtime?.observerPollution ?? null,
    eventTypes: runtime?.eventTypes ?? null,
    eventCount: runtime?.eventCount ?? null,
    pulseCount: runtime?.eventTypes?.pulse ?? 0,
    deaths: runtime?.deaths ?? null,
    resurrections: runtime?.resurrections ?? null,
    forks: runtime?.forks ?? null,
    replayValid: runtime?.replayValid ?? null,
    secretLeak: Boolean(runtime?.secretLeak),
    excluded: Boolean(exclusionReason),
    exclusionReason,
  };
}

async function collect(options) {
  const model = options.model ?? 'candidate-model-1';
  const rounds = Number.parseInt(String(options.rounds ?? '10'), 10);
  const timeout = Number.parseInt(String(options.timeout ?? '12000'), 10);
  const seed = String(options.seed ?? 'nna-formal-20261114');
  if (!Number.isFinite(rounds) || rounds < 1 || rounds > 100) throw new Error('rounds must be 1-100');
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 120000) throw new Error('timeout must be 1000-120000');

  const records = [];
  const startedAt = new Date().toISOString();
  for (let round = 1; round <= rounds; round += 1) {
    const orderedTasks = seededShuffle(tasks, `${seed}:${round}`);
    for (let order = 0; order < orderedTasks.length; order += 1) {
      const task = orderedTasks[order];
      for (const organ of ['deterministic', 'stochastic', 'model']) {
        const impulse = organ === 'deterministic'
          ? deterministicImpulse(task, round)
          : organ === 'stochastic'
            ? stochasticImpulse(task, round)
            : null;
        let result = null;
        if (organ === 'model') result = await modelCall(model, timeout, task, round);
        const selectedImpulse = organ === 'model'
          ? (responseClass(result?.payload, result?.status) === 'valid' ? finalImpulse(result.payload) : null)
          : impulse;
        const runtime = selectedImpulse
          ? await runtimeTrial({ organ, task, round, impulse: selectedImpulse, model, timeout })
          : null;
        records.push(buildTrial({ organ, task, round, order, model, result, runtime }));
      }
    }
  }

  const rawPath = options.raw ?? 'evidence/formal-experiment/raw.ndjson';
  const target = path.resolve(root, rawPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({
    phase: 'formal-experiment-collect',
    startedAt,
    finishedAt: new Date().toISOString(),
    model,
    rounds,
    seed,
    records: records.length,
    rawPath: path.relative(root, target),
    protocol: 'EXPERIMENT_PROTOCOL.md',
  }, null, 2));
}

function analyzeRecords(records) {
  const byOrgan = {};
  const table = {};
  const latencies = {};
  const digestSets = {};
  const driftValues = {};
  for (const organ of ['deterministic', 'stochastic', 'model']) {
    const subset = records.filter((record) => record.organ === organ);
    const valid = subset.filter((record) => !record.excluded);
    const counts = Object.fromEntries(impulses.map((impulse) => [impulse, valid.filter((record) => record.impulse === impulse).length]));
    table[organ] = counts;
    latencies[organ] = valid.map((record) => record.runtimeElapsedMs).filter(Number.isFinite);
    digestSets[organ] = new Set(valid.map((record) => record.digest)).size;
    driftValues[organ] = valid.map((record) => record.driftDistance).filter(Number.isFinite);
    byOrgan[organ] = {
      n: subset.length,
      included: valid.length,
      excluded: subset.length - valid.length,
      complianceRate: valid.length / subset.length,
      complianceWilson95: wilsonInterval(valid.length, subset.length),
      exclusions: Object.fromEntries([...new Set(subset.filter((record) => record.excluded).map((record) => record.exclusionReason))]
        .map((reason) => [reason, subset.filter((record) => record.exclusionReason === reason).length])),
      latency: {
        n: latencies[organ].length,
        mean: mean(latencies[organ]),
        sd: standardDeviation(latencies[organ]),
        median: percentile(latencies[organ], 0.5),
        p95: percentile(latencies[organ], 0.95),
      },
      impulseCounts: counts,
      digestUnique: digestSets[organ],
      averageDrift: mean(driftValues[organ]),
      invariant: {
        replayValid: valid.every((record) => record.replayValid === true),
        lifecycleCounts: valid.every((record) => record.deaths === 0 && record.resurrections === 0 && record.forks === 0),
        secretLeaks: valid.filter((record) => record.secretLeak).length,
      },
    };
  }
  return {
    protocol: 'EXPERIMENT_PROTOCOL.md',
    generatedAt: new Date().toISOString(),
    totalRecords: records.length,
    includedRecords: records.filter((record) => !record.excluded).length,
    excludedRecords: records.filter((record) => record.excluded).length,
    byOrgan,
    impulseTable: table,
    cramersV: cramersV(table),
    interpretationBoundary: 'Runtime-contract evidence only; no claim about intelligence, agency, or consciousness.',
  };
}

function renderSvg(analysis) {
  const width = 900;
  const height = 620;
  const organs = ['deterministic', 'stochastic', 'model'];
  const labels = { deterministic: '确定性', stochastic: '随机权重', model: '候选模型' };
  const colors = ['#58a6ff', '#a371f7', '#3fb950'];
  const rows = organs.map((organ, index) => {
    const item = analysis.byOrgan[organ];
    const y = 160 + index * 94;
    const includedWidth = Math.round((item.included / item.n) * 480);
    const ci = item.complianceWilson95;
    return `<text x="55" y="${y + 27}" font-size="17" fill="#e6edf3">${labels[organ]}</text>`
      + `<text x="55" y="${y + 48}" font-size="11" fill="#8b949e">${organ}</text>`
      + `<rect x="250" y="${y + 4}" width="480" height="36" rx="8" fill="#21262d"/>`
      + `<rect x="250" y="${y + 4}" width="${includedWidth}" height="36" rx="8" fill="${colors[index]}"/>`
      + `<text x="${Math.min(735, 266 + includedWidth)}" y="${y + 29}" font-size="14" font-weight="700" fill="#ffffff">${item.included}/${item.n}</text>`
      + `<text x="55" y="${y + 72}" font-size="11" fill="#8b949e">合规率 ${item.complianceRate.toFixed(3)} · Wilson 95% [${ci.lower}, ${ci.upper}] · 排除 ${item.excluded}</text>`;
  }).join('');
  const exclusionText = Object.entries(analysis.byOrgan.model.exclusions)
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(' · ') || '无';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Formal experiment compliance chart">
  <rect width="100%" height="100%" fill="#0d1117"/>
  <text x="55" y="56" font-size="26" font-weight="700" fill="#e6edf3">正式实验：结构化响应合规率</text>
  <text x="55" y="84" font-size="13" fill="#8b949e">${analysis.totalRecords} 条原始记录 · ${analysis.includedRecords} 条纳入 · ${analysis.excludedRecords} 条排除 · Cramer's V ${analysis.cramersV}</text>
  <rect x="35" y="110" width="830" height="360" rx="15" fill="#111820" stroke="#21262d"/>
  <text x="55" y="140" font-size="18" font-weight="700" fill="#e6edf3">每种器官的纳入 / 总数</text>
  ${rows}
  <text x="55" y="505" font-size="13" fill="#8b949e">模型排除原因：${exclusionText}</text>
  <text x="55" y="532" font-size="13" fill="#8b949e">结论边界：不把不完整响应折算为冲动；不评测智能、意识或意图。</text>
  <text x="55" y="582" font-size="12" fill="#8b949e">协议：EXPERIMENT_PROTOCOL.md · 数据：evidence/formal-experiment/raw.ndjson</text>
</svg>`;
}

async function analyze(options) {
  const rawPath = options.raw ?? 'evidence/formal-experiment/raw.ndjson';
  const outputPath = options.out ?? 'evidence/formal-experiment/analysis.json';
  const text = await readFile(path.resolve(root, rawPath), 'utf8');
  const records = text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const analysis = analyzeRecords(records);
  const target = path.resolve(root, outputPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
  const chartPath = options.chart ?? 'evidence/formal-experiment/formal-experiment.svg';
  const chartTarget = path.resolve(root, chartPath);
  await mkdir(path.dirname(chartTarget), { recursive: true });
  await writeFile(chartTarget, renderSvg(analysis), 'utf8');
  console.log(JSON.stringify({ ...analysis, analysisPath: path.relative(root, target), chartPath: path.relative(root, chartTarget) }, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'collect') await collect(options);
  else if (options.command === 'analyze') await analyze(options);
  else throw new Error(`unknown command: ${options.command}`);
}

main().catch((error) => {
  console.error(`nna formal-experiment: ${error.message}`);
  process.exitCode = 1;
});
