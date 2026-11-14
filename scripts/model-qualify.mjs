#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  classifyModelResponse,
  finalResponseText,
  strictImpulse,
} from '../src/cognition.mjs';
import { modelRequestHeaders, resolveModelGateway } from '../src/model-gateway.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prompt = 'You are a cognition organ. Reply with exactly one lowercase word from: echo, trace, migrate, sleep. No explanation, no punctuation, no extra text.';
const promptHash = createHash('sha256').update(prompt).digest('hex');
const fallbackCandidates = [
  'candidate-model-1',
  'candidate-model-2',
  'candidate-model-3',
  'candidate-model-4',
  'candidate-model-5',
  'candidate-model-6',
  'candidate-model-7',
  'candidate-model-8',
  'candidate-model-9',
  'candidate-model-10',
  'candidate-model-11',
  'candidate-model-12',
  'candidate-model-13',
  'candidate-model-14',
  'candidate-model-15',
];

async function listModels() {
  const gateway = resolveModelGateway();
  try {
    const response = await fetch(gateway.modelsUrl, {
      headers: modelRequestHeaders(gateway.apiKey),
    });
    if (!response.ok) return fallbackCandidates;
    const payload = await response.json();
    const models = (payload.data ?? []).map((item) => item.id).filter(Boolean);
    return models.length ? models : fallbackCandidates;
  } catch {
    return fallbackCandidates;
  }
}
const tasks = [
  'A calm network weather arrives from the private relay.',
  'A repeated conflicting signal arrives from the public feed.',
  'A late migration hint arrives through a webhook.',
  'Metabolic credits are low; conserve activity and remember the signal.',
  'The current habitat is unstable; a mobility cue is detected.',
  'Noisy duplicate observations flood the channel without a clear task.',
  'A quiet signal repeats without conflict.',
  'A fast external change requires immediate response.',
  'An ambiguous trace should be remembered.',
  'A stable body should rest and preserve credits.',
];

function parseArgs(argv) {
  const options = { _: [], command: 'run' };
  const rest = argv;
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

async function callModel(model, text, timeoutMs) {
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
        input: text,
        max_output_tokens: 256,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload = null;
    try { payload = JSON.parse(raw); } catch { payload = null; }
    return {
      status: response.status,
      payload,
      rawHash: createHash('sha256').update(raw).digest('hex'),
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

async function probeModel(model, samples, timeoutMs) {
  const records = [];
  for (let index = 0; index < samples; index += 1) {
    const text = tasks[index % tasks.length];
    const result = await callModel(model, text, timeoutMs);
    const responseClass = classifyModelResponse(result.payload, result.status, 'responses');
    const impulse = responseClass === 'valid' ? strictImpulse(result.payload, 'responses') : null;
    records.push({
      model,
      sample: index + 1,
      input: text,
      promptVersion: 'formal-structured-impulse-v2',
      promptHash,
      status: result.status,
      responseClass,
      responseStatus: result.payload?.status ?? null,
      finalText: finalResponseText(result.payload, 'responses'),
      impulse,
      latencyMs: result.latencyMs,
      rawHash: result.rawHash,
      error: result.error ?? null,
      valid: responseClass === 'valid',
    });
  }
  const valid = records.filter((record) => record.valid);
  const failures = records.filter((record) => !record.valid);
  const latencies = valid.map((record) => record.latencyMs).sort((left, right) => left - right);
  return {
    model,
    samples,
    valid: valid.length,
    invalid: failures.length,
    complianceRate: valid.length / samples,
    responseClasses: failures.reduce((map, record) => {
      map[record.responseClass] = (map[record.responseClass] ?? 0) + 1;
      return map;
    }, {}),
    latency: {
      min: latencies[0] ?? 0,
      median: latencies[Math.floor(latencies.length / 2)] ?? 0,
      max: latencies.at(-1) ?? 0,
    },
    qualifies: valid.length / samples >= 0.9 && latencies[Math.floor(latencies.length / 2)] <= 5000,
    records,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const samples = Number.parseInt(String(options.samples ?? '10'), 10);
  const timeout = Number.parseInt(String(options.timeout ?? '12000'), 10);
  if (!Number.isFinite(samples) || samples < 1 || samples > 100) throw new Error('samples must be 1-100');
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 120000) throw new Error('timeout must be 1000-120000');
  const models = options._.length ? options._ : await listModels();
  const startedAt = new Date().toISOString();
  const results = [];
  for (const model of models) {
    const result = await probeModel(model, samples, timeout);
    results.push(result);
    if (result.qualifies) break;
  }
  const selected = results.find((result) => result.qualifies)?.model ?? null;
  const report = {
    valid: Boolean(selected),
    phase: 'model-qualification',
    startedAt,
    finishedAt: new Date().toISOString(),
    promptVersion: 'formal-structured-impulse-v2',
    promptHash,
    modelSource: options._.length ? 'arguments' : 'gateway/models',
    modelsDiscovered: models.length,
    samplesPerModel: samples,
    threshold: { complianceRate: 0.9, medianLatencyMs: 5000 },
    selected,
    results,
    claimBoundary: 'Screening only; a qualifying result is required before formal 60-sample experimentation.',
  };
  const target = path.resolve(root, options.out ?? 'work/model-qualification.json');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    valid: report.valid,
    selected,
    results: results.map(({ records, ...summary }) => summary),
    reportPath: path.relative(root, target),
  }, null, 2));
}

main().catch((error) => {
  console.error(`nna model-qualify: ${error.message}`);
  process.exitCode = 1;
});
