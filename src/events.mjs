import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, hashText, verifyEvent } from './crypto.mjs';

export const EVENTS_FILE = 'events.ndjson';
export const GENESIS_FILE = 'genesis.json';
export const IDENTITY_FILE = 'identity.key';
export const OUTBOX_DIR = 'outbox';

export function habitatPaths(habitat) {
  const root = path.resolve(habitat);
  return {
    root,
    events: path.join(root, EVENTS_FILE),
    genesis: path.join(root, GENESIS_FILE),
    identity: path.join(root, IDENTITY_FILE),
    outbox: path.join(root, OUTBOX_DIR),
    lock: path.join(root, 'habitat.lock'),
  };
}

export async function ensureHabitatDir(habitat) {
  const paths = habitatPaths(habitat);
  await mkdir(paths.root, { recursive: true });
  await mkdir(paths.outbox, { recursive: true });
  return paths;
}

export async function readPrivatePem(habitat) {
  const paths = habitatPaths(habitat);
  return readFile(paths.identity, 'utf8');
}

export async function writePrivatePem(habitat, privatePem) {
  const paths = await ensureHabitatDir(habitat);
  await writeFile(paths.identity, privatePem, { mode: 0o600 });
}

export function parseEvents(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`events.ndjson line ${index + 1}: invalid JSON`);
      }
    });
}

export async function readRawEvents(habitat) {
  const paths = habitatPaths(habitat);
  try {
    return parseEvents(await readFile(paths.events, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    if (error.message.includes('invalid JSON')) throw error;
    throw error;
  }
}

export async function appendEvent(habitat, event) {
  const paths = await ensureHabitatDir(habitat);
  await writeFile(paths.events, `${JSON.stringify(event)}\n`, { flag: 'a' });
}

export async function writeGenesisSummary(habitat, event) {
  const paths = await ensureHabitatDir(habitat);
  await writeFile(paths.genesis, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
}

/**
 * Verify an event chain.
 *
 * `skipSignatureBefore` lets a caller that already trusts a signed checkpoint
 * skip only the expensive Ed25519 verification for events at or below that
 * sequence number. The cheap checks (id recomputation, seq, parent linkage,
 * event version, agentId derivation) always run for every event, so a tampered
 * prefix is still caught. Skipping signatures is a performance trade-off, not a
 * correctness shortcut.
 */
export function verifyChain(events, options = {}) {
  if (events.length === 0) return [];
  const skipSignatureBefore = Number.isInteger(options.skipSignatureBefore)
    ? options.skipSignatureBefore
    : 0;
  if (skipSignatureBefore < 0) {
    throw new Error('skipSignatureBefore must be a non-negative integer');
  }
  const genesis = events[0];
  if (genesis.type !== 'genesis' || genesis.seq !== 1 || genesis.parent !== null) {
    throw new Error('first event must be genesis with seq 1 and parent null');
  }
  const publicPem = genesis.payload?.publicPem;
  if (!publicPem) {
    throw new Error('genesis event lacks payload.publicPem');
  }
  let parent = null;
  return events.map((event, index) => {
    verifyEvent(event, publicPem, { skipSignature: event.seq <= skipSignatureBefore });
    if (event.seq !== index + 1) {
      throw new Error(`event ${event.seq}: expected seq ${index + 1}`);
    }
    if (event.parent !== parent) {
      throw new Error(`event ${event.seq}: parent does not match previous id`);
    }
    if (event.v !== 1) {
      throw new Error(`event ${event.seq}: unsupported event version ${event.v}`);
    }
    parent = event.id;
    return event;
  });
}

export async function readEvents(habitat) {
  return verifyChain(await readRawEvents(habitat));
}

export function lastEvent(events) {
  return events.at(-1) ?? null;
}

export function eventDigest(event) {
  return hashText(canonicalJson({
    id: event.id,
    seq: event.seq,
    type: event.type,
    bodyId: event.bodyId,
    at: event.at,
    payload: event.payload,
  }));
}
