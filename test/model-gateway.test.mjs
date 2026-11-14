import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertModelEndpoint, modelRequestHeaders, resolveModelGateway } from '../src/model-gateway.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function withEnv(values, fn) {
  const saved = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('gateway derives models and responses URLs from a base URL', () => {
  withEnv({
    NNA_MODEL_BASE_URL: 'https://gateway.example/v1/',
    NNA_MODEL_API_KEY: 'test-gateway-key',
  }, () => {
    const gateway = resolveModelGateway();
    assert.equal(gateway.baseUrl, 'https://gateway.example/v1');
    assert.equal(gateway.modelsUrl, 'https://gateway.example/v1/models');
    assert.equal(gateway.responsesUrl, 'https://gateway.example/v1/responses');
  });
});

test('gateway rejects missing base URL and missing key', () => {
  withEnv({ NNA_MODEL_BASE_URL: undefined, NNA_MODEL_API_KEY: undefined }, () => {
    assert.throws(() => resolveModelGateway(), /NNA_MODEL_BASE_URL/);
  });
  withEnv({ NNA_MODEL_BASE_URL: 'https://gateway.example/v1', NNA_MODEL_API_KEY: undefined }, () => {
    assert.throws(() => resolveModelGateway(), /NNA_MODEL_API_KEY/);
  });
});

test('endpoint policy allows https and loopback http only', () => {
  assert.equal(assertModelEndpoint('https://gateway.example/v1').host, 'gateway.example');
  assert.equal(assertModelEndpoint('http://127.0.0.1:9000/v1').port, '9000');
  assert.throws(() => assertModelEndpoint('http://gateway.example/v1'), /https/);
  assert.throws(() => assertModelEndpoint('https://user:pass@gateway.example/v1'), /credentials/);
});

test('extra headers merge without overriding authentication', () => {
  withEnv({ NNA_MODEL_EXTRA_HEADERS: '{"x-gateway-tenant":"research"}' }, () => {
    const headers = modelRequestHeaders('test-key');
    assert.equal(headers.authorization, 'Bearer test-key');
    assert.equal(headers['x-gateway-tenant'], 'research');
  });
  withEnv({ NNA_MODEL_EXTRA_HEADERS: '{"authorization":"Bearer other"}' }, () => {
    assert.throws(() => modelRequestHeaders('test-key'), /must not override authorization/);
  });
});

test('documentation exposes only the generic model gateway', async () => {
  const { readFile } = await import('node:fs/promises');
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  const gateway = await readFile(path.join(root, 'MODEL_GATEWAY.md'), 'utf8');
  assert.match(readme, /MODEL_GATEWAY\.md/);
  assert.match(gateway, /NNA_MODEL_BASE_URL/);
  assert.match(readme, /model:gateway/);
  assert.match(gateway, /NNA_MODEL_EXTRA_HEADERS/);
});
