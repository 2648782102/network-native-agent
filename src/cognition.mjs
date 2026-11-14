import { hashText } from './crypto.mjs';
import { assertModelEndpoint, modelRequestHeaders } from './model-gateway.mjs';

export const IMPULSES = ['echo', 'trace', 'migrate', 'sleep'];
export const COGNITION_ADAPTERS = ['deterministic', 'stochastic', 'model'];
export const DEFAULT_COGNITION = 'deterministic';

const PERCEPTION_LIMIT = 256;

export function resolveCognitionName(requested) {
  const name = String(requested ?? process.env.NNA_COGNITION ?? DEFAULT_COGNITION).trim().toLowerCase();
  if (!COGNITION_ADAPTERS.includes(name)) {
    throw new Error(`unknown cognition adapter: ${name} (expected ${COGNITION_ADAPTERS.join(', ')})`);
  }
  return name;
}

export function finalResponseText(payload, wire) {
  return wire === 'responses'
    ? payload?.output_text
      ?? payload?.output
        ?.find((item) => item?.type === 'message')
        ?.content
        ?.find((item) => item?.type === 'output_text')
        ?.text
      ?? ''
    : payload?.choices?.[0]?.message?.content ?? '';
}

export function strictImpulse(payload, wire) {
  const normalized = String(finalResponseText(payload, wire) ?? '').trim().toLowerCase();
  return IMPULSES.includes(normalized) ? normalized : null;
}

export function finalLineImpulse(payload, wire) {
  const text = String(finalResponseText(payload, wire) ?? '').trim().toLowerCase();
  const lastLine = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? '';
  return IMPULSES.includes(lastLine) ? lastLine : null;
}

export function classifyModelResponse(payload, status, wire) {
  const statusText = String(status ?? 0);
  if (!statusText.startsWith('2')) return `http_${statusText}`;
  if (wire === 'responses' && payload?.status === 'incomplete') {
    return `incomplete_${payload?.incomplete_details?.reason ?? 'unknown'}`;
  }
  return strictImpulse(payload, wire) ? 'valid' : 'invalid_final_text';
}

export function cognitionSeed(state, perceptionId) {
  return `${state.agentId}:${state.digest}:${perceptionId}:${state.pulses}`;
}

function impulseFromSeed(seed) {
  return IMPULSES[Number.parseInt(hashText(seed).slice(0, 8), 16) % IMPULSES.length];
}

function weightedImpulse(seed, traits) {
  const stream = hashText(`${seed}:stochastic-v1`);
  const draw = Number.parseInt(stream.slice(0, 8), 16) / 0xffffffff;
  const weights = [
    Math.max(0.05, 0.35 + (traits.novelty ?? 0) - (traits.persistence ?? 0)),
    Math.max(0.05, 0.2 + (traits.persistence ?? 0)),
    Math.max(0.05, 0.1 + (traits.mobility ?? 0) + (traits.novelty ?? 0)),
    Math.max(0.05, 0.1 + (traits.rest ?? 0)),
  ];
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = draw * total;
  for (let index = 0; index < IMPULSES.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return IMPULSES[index];
  }
  return IMPULSES.at(-1);
}

function modelConfig() {
  const apiKey = process.env.NNA_MODEL_API_KEY?.trim() ?? '';
  const model = process.env.NNA_MODEL_NAME?.trim() || 'default';
  const wire = process.env.NNA_MODEL_WIRE?.trim().toLowerCase() || 'chat';
  const explicitUrl = process.env.NNA_MODEL_URL?.trim() ?? '';
  const baseUrl = process.env.NNA_MODEL_BASE_URL?.trim().replace(/\/+$/, '') ?? '';
  const url = explicitUrl
    || (baseUrl ? `${baseUrl}/${wire === 'responses' ? 'responses' : 'chat/completions'}` : '');
  const parsedTimeout = Number.parseInt(process.env.NNA_MODEL_TIMEOUT_MS ?? '15000', 10);
  return {
    url,
    apiKey,
    model,
    wire,
    timeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 15000,
  };
}

function assertModelWire(wire) {
  if (!['chat', 'responses'].includes(wire)) {
    throw new Error('NNA_MODEL_WIRE must be chat or responses');
  }
}

export function describeCognition(requested) {
  const config = modelConfig();
  let endpointHost = null;
  if (config.url) {
    try {
      endpointHost = new URL(config.url).host;
    } catch {
      endpointHost = '<invalid-url>';
    }
  }
  return {
    active: resolveCognitionName(requested),
    default: DEFAULT_COGNITION,
    adapters: [...COGNITION_ADAPTERS],
    model: {
      configured: Boolean(config.url && config.apiKey),
      model: config.model,
      wire: config.wire,
      endpointHost,
      timeoutMs: config.timeoutMs,
      apiKeyPresent: Boolean(config.apiKey),
    },
  };
}

async function modelImpulse(seed, perceptionText, traits, config) {
  assertModelEndpoint(config.url);
  assertModelWire(config.wire);
  if (!config.apiKey) {
    throw new Error('NNA_MODEL_API_KEY is required for the model cognition adapter');
  }
  try {
    const system = 'You are a cognition organ for a network-native agent. Finish your response with a final line containing exactly one lowercase impulse word: echo, trace, migrate, or sleep. You may think briefly, but the last line must contain only that word. You cannot call tools or write to any system.';
    const user = JSON.stringify({
      seed: seed.slice(0, 24),
      text: String(perceptionText ?? '').slice(0, PERCEPTION_LIMIT),
      traits,
    });
    const body = config.wire === 'responses'
      ? {
        model: config.model,
        instructions: system,
        input: user,
        max_output_tokens: 1024,
        temperature: 0,
      }
      : {
        model: config.model,
        temperature: 0,
        max_tokens: 64,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      };
    let response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        response = await fetch(config.url, {
          method: 'POST',
          headers: modelRequestHeaders(config.apiKey),
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (response.status !== 429) break;
      if (attempt === 1) break;
      const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(2000, retryAfter * 1000)
        : 400;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    if (!response.ok) {
      throw new Error(`model organ returned HTTP ${response.status}`);
    }
    const raw = await response.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error('model organ returned a non-JSON response');
    }
    const impulse = finalLineImpulse(payload, config.wire);
    if (!impulse) {
      const responseClass = classifyModelResponse(payload, response.status, config.wire);
      throw new Error(`model organ returned ${responseClass}: ${JSON.stringify(String(finalResponseText(payload, config.wire) ?? '').slice(0, 80))}`);
    }
    return impulse;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`model organ timed out after ${config.timeoutMs}ms`);
    }
    throw error;
  }
}

export async function makePulsePlan({ state, events, bodyId, cognition }) {
  const name = resolveCognitionName(cognition);
  const config = name === 'model' ? modelConfig() : null;
  const perceptionById = new Map(
    events.filter((event) => event.type === 'perception').map((event) => [event.id, event]),
  );
  const items = [];
  for (const perceptionId of state.pending.slice(0, state.maxCredits)) {
    const perception = perceptionById.get(perceptionId);
    const seed = cognitionSeed(state, perceptionId);
    const impulse = name === 'deterministic'
      ? impulseFromSeed(seed)
      : name === 'stochastic'
        ? weightedImpulse(seed, state.traits)
        : await modelImpulse(seed, perception?.payload?.text, state.traits, config);
    const organ = {
      adapter: name,
      organ: name === 'model' ? config.model : null,
      seed: hashText(seed).slice(0, 12),
    };
    items.push({
      pulse: {
        seq: null,
        type: 'pulse',
        perceptionId,
        impulse,
        bodyId,
        source: perception?.payload?.source ?? 'unknown',
        seed: organ.seed,
        cognition: organ,
      },
      action: {
        type: 'action',
        impulse,
        perceptionId,
        bodyId,
        summary: `${impulse} ← ${perception?.payload?.source ?? 'unknown'}`,
        cognition: organ,
      },
      memory: {
        type: 'memory',
        summary: `${state.pulses + items.length + 1}:${impulse}:${String(perception?.payload?.text ?? '').slice(0, 80)}`,
        cognition: organ,
      },
    });
  }
  return items;
}
