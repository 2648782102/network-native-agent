const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function assertModelEndpoint(url) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ''));
  } catch {
    throw new Error('model endpoint must be a valid URL');
  }
  const loopback = LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) {
    throw new Error('model endpoint must use https, or http on loopback for local test organs');
  }
  if (parsed.username || parsed.password) {
    throw new Error('model endpoint must not embed credentials');
  }
  return parsed;
}

function extraHeaders() {
  const raw = process.env.NNA_MODEL_EXTRA_HEADERS?.trim();
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('NNA_MODEL_EXTRA_HEADERS must be a JSON object');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('NNA_MODEL_EXTRA_HEADERS must be a JSON object');
  }
  const headers = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`NNA_MODEL_EXTRA_HEADERS value for ${key} must be a string`);
    }
    const normalized = key.toLowerCase();
    if (['authorization', 'content-type', 'content-length', 'host'].includes(normalized)) {
      throw new Error(`NNA_MODEL_EXTRA_HEADERS must not override ${normalized}`);
    }
    headers[normalized] = value;
  }
  return headers;
}

export function modelRequestHeaders(apiKey) {
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return { ...headers, ...extraHeaders() };
}

export function resolveModelGateway({ requireKey = true } = {}) {
  const baseUrl = process.env.NNA_MODEL_BASE_URL?.trim() ?? '';
  const apiKey = process.env.NNA_MODEL_API_KEY?.trim() ?? '';
  if (!baseUrl) {
    throw new Error('NNA_MODEL_BASE_URL is required, for example https://gateway.example/v1');
  }
  if (requireKey && !apiKey) {
    throw new Error('NNA_MODEL_API_KEY is required for the model gateway');
  }
  assertModelEndpoint(baseUrl);
  const normalized = baseUrl.replace(/\/+$/, '');
  return {
    baseUrl: normalized,
    responsesUrl: `${normalized}/responses`,
    modelsUrl: `${normalized}/models`,
    apiKey,
  };
}
