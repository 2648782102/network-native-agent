import { createHash, timingSafeEqual } from 'node:crypto';

export const DEFAULT_LAN_CIDRS = [
  '192.168.0.0/16',
  '10.0.0.0/8',
  '172.16.0.0/12',
];

function normalizeIp(value) {
  const text = String(value ?? '').trim();
  if (text.startsWith('::ffff:')) return text.slice(7);
  return text;
}

function ipv4ToInt(value) {
  const parts = normalizeIp(value).split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return null;
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function maskForPrefix(prefix) {
  if (prefix === 0) return 0;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

export function parseCidr(value) {
  const [base, prefixText] = String(value ?? '').trim().split('/');
  const baseInt = ipv4ToInt(base);
  const prefix = Number(prefixText);
  if (baseInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = maskForPrefix(prefix);
  return { cidr: String(value).trim(), network: (baseInt & mask) >>> 0, mask };
}

export function parseCidrs(values) {
  const list = Array.isArray(values) ? values : String(values ?? '').split(',');
  const parsed = list
    .map((value) => String(value).trim())
    .filter(Boolean)
    .map(parseCidr)
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_LAN_CIDRS.map(parseCidr);
}

export function isLoopback(value) {
  const ip = normalizeIp(value);
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

export function isIpAllowed(value, cidrs) {
  const ip = normalizeIp(value);
  if (isLoopback(ip)) return true;
  const address = ipv4ToInt(ip);
  if (address === null) return false;
  return parseCidrs(cidrs).some(({ network, mask }) => ((address & mask) >>> 0) === network);
}

export function tokenFromHeaders(headers) {
  const authorization = String(headers?.authorization ?? '');
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  return String(bearer ?? headers?.['x-nna-token'] ?? '').trim();
}

export function tokenMatches(presented, expected) {
  if (!expected) return false;
  const left = Buffer.from(String(presented ?? ''));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function tokenFingerprint(token) {
  return createHash('sha256').update(String(token ?? '')).digest('hex').slice(0, 12);
}

export function redactIp(value) {
  const ip = normalizeIp(value);
  if (!ip.includes('.')) return '<non-ip>';
  const parts = ip.split('.');
  return `${parts[0]}.${parts[1]}.x.x`;
}
