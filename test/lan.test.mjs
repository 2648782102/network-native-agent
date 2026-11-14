import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isIpAllowed,
  isLoopback,
  parseCidr,
  tokenMatches,
} from '../src/lan.mjs';

test('LAN CIDR allowlist accepts private networks and rejects public addresses', () => {
  const cidrs = ['192.168.31.0/24', '10.0.0.0/8'];
  assert.equal(isIpAllowed('127.0.0.1', cidrs), true);
  assert.equal(isIpAllowed('192.168.31.42', cidrs), true);
  assert.equal(isIpAllowed('10.2.3.4', cidrs), true);
  assert.equal(isIpAllowed('8.8.8.8', cidrs), false);
});

test('loopback detection handles mapped IPv4', () => {
  assert.equal(isLoopback('::ffff:127.0.0.1'), true);
  assert.equal(isLoopback('192.168.1.2'), false);
});

test('parseCidr rejects invalid values', () => {
  assert.ok(parseCidr('192.168.1.0/24'));
  assert.equal(parseCidr('not-an-ip/24'), null);
  assert.equal(parseCidr('192.168.1.0/33'), null);
});

test('token comparison is exact', () => {
  assert.equal(tokenMatches('abc123', 'abc123'), true);
  assert.equal(tokenMatches('abc123', 'abc12'), false);
  assert.equal(tokenMatches('', 'abc123'), false);
});
