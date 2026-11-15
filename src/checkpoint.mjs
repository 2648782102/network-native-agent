import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, createEvent, hashText, verifyEvent } from './crypto.mjs';
import { habitatPaths } from './events.mjs';

export const CHECKPOINT_FILE = 'checkpoint.json';
export const CHECKPOINT_VERSION = 1;

export function checkpointPath(habitat) {
  const paths = habitatPaths(habitat);
  return path.join(paths.root, CHECKPOINT_FILE);
}

export function checkpointSubject({ size, headId, headSeq, chainDigest }) {
  return hashText(canonicalJson({ version: CHECKPOINT_VERSION, size, headId, headSeq, chainDigest }));
}

/**
 * A checkpoint records "I have verified this prefix". It is signed by the
 * habitat's own identity so that a reader cannot mint one for a chain it never
 * verified, and so a tampered checkpoint fails closed.
 */
export async function writeCheckpoint(habitat, { size, headId, headSeq, chainDigest, privatePem }) {
  const subject = checkpointSubject({ size, headId, headSeq, chainDigest });
  const event = createEvent(privatePem, {
    seq: 1,
    parent: null,
    type: 'checkpoint',
    bodyId: 'local',
    at: new Date().toISOString(),
    payload: { version: CHECKPOINT_VERSION, size, headId, headSeq, chainDigest, subject },
  });
  const target = checkpointPath(habitat);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
  return event;
}

export async function readCheckpoint(habitat) {
  const target = checkpointPath(habitat);
  let text;
  try {
    text = await readFile(target, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { valid: false, reason: 'checkpoint.json is not valid JSON' };
  }
  return parsed;
}

/**
 * Validate a checkpoint against the chain it claims to cover.
 *
 * Returns `usable: false` rather than throwing, so callers can degrade to a
 * full verification instead of refusing to start.
 */
export function validateCheckpoint(checkpoint, events, expectedAgentId) {
  if (!checkpoint) return { usable: false, reason: 'no checkpoint' };
  if (checkpoint.type !== 'checkpoint') return { usable: false, reason: 'not a checkpoint event' };
  if (checkpoint.agentId !== expectedAgentId) {
    return { usable: false, reason: 'checkpoint belongs to a different agent' };
  }
  try {
    verifyEvent(checkpoint, events[0]?.payload?.publicPem ?? null);
  } catch (error) {
    return { usable: false, reason: `checkpoint signature rejected: ${error.message}` };
  }

  const payload = checkpoint.payload ?? {};
  if (payload.version !== CHECKPOINT_VERSION) {
    return { usable: false, reason: `unsupported checkpoint version ${payload.version}` };
  }
  if (!Number.isInteger(payload.size) || payload.size < 1) {
    return { usable: false, reason: 'checkpoint size is invalid' };
  }
  if (payload.size > events.length) {
    return { usable: false, reason: `checkpoint covers ${payload.size} events but chain has ${events.length}` };
  }

  for (let index = 0; index < payload.size; index += 1) {
    if (events[index].id !== undefined && events[index].seq !== index + 1) {
      return { usable: false, reason: `chain is not contiguous at seq ${index + 1}` };
    }
  }
  const head = events[payload.size - 1];
  if (head.id !== payload.headId) {
    return { usable: false, reason: 'checkpoint head does not match the chain' };
  }
  if (head.seq !== payload.headSeq) {
    return { usable: false, reason: 'checkpoint headSeq does not match the chain' };
  }
  const expectedSubject = checkpointSubject({
    size: payload.size,
    headId: payload.headId,
    headSeq: payload.headSeq,
    chainDigest: payload.chainDigest,
  });
  if (payload.subject !== expectedSubject) {
    return { usable: false, reason: 'checkpoint subject does not match its fields' };
  }
  return { usable: true, size: payload.size, headId: payload.headId, headSeq: payload.headSeq };
}
