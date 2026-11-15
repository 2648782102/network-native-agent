import { createHash } from 'node:crypto';
import { canonicalJson, createEvent, hashText, verifyEvent } from './crypto.mjs';

export const EMPTY_ROOT = createHash('sha256').update('').digest('hex');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function leafHash(leaf) {
  return sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(String(leaf), 'utf8')]));
}

export function nodeHash(left, right) {
  return sha256(Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from(String(left), 'hex'),
    Buffer.from(String(right), 'hex'),
  ]));
}

function largestPowerOfTwoBelow(value) {
  let result = 1;
  while (result * 2 < value) result *= 2;
  return result;
}

export function merkleRoot(leaves) {
  return subtreeHash(leaves, 0, leaves.length);
}

function subtreeHash(leaves, start, end) {
  const size = end - start;
  if (size === 0) return EMPTY_ROOT;
  if (size === 1) return leafHash(leaves[start]);
  const split = largestPowerOfTwoBelow(size);
  return nodeHash(
    subtreeHash(leaves, start, start + split),
    subtreeHash(leaves, start + split, end),
  );
}

/**
 * Audit path for `index`, ordered from the deepest sibling outward so the last
 * element is the sibling closest to the root.
 */
export function inclusionProof(leaves, index) {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
    throw new Error(`index must be within 0..${leaves.length - 1}`);
  }
  return pathFor(leaves, index, 0, leaves.length);
}

function pathFor(leaves, index, start, end) {
  const size = end - start;
  if (size === 1) return [];
  const split = largestPowerOfTwoBelow(size);
  if (index < split) {
    return [...pathFor(leaves, index, start, start + split), subtreeHash(leaves, start + split, end)];
  }
  return [...pathFor(leaves, index - split, start + split, end), subtreeHash(leaves, start, start + split)];
}

/**
 * Rebuild the root from a leaf and its audit path. Mirrors inclusionProof
 * construction, which makes the pairing easy to test exhaustively.
 */
export function rootFromProof(leaf, index, treeSize, proof) {
  return rebuild(leafHash(leaf), index, treeSize, proof);
}

function rebuild(hash, index, size, proof) {
  if (size === 1) return proof.length === 0 ? hash : null;
  if (proof.length === 0) return null;
  const split = largestPowerOfTwoBelow(size);
  const sibling = proof.at(-1);
  const rest = proof.slice(0, -1);
  if (index < split) {
    const left = rebuild(hash, index, split, rest);
    return left === null ? null : nodeHash(left, sibling);
  }
  const right = rebuild(hash, index - split, size - split, rest);
  return right === null ? null : nodeHash(sibling, right);
}

export function verifyInclusion({ leaf, index, treeSize, proof, root }) {
  if (treeSize < 1 || index < 0 || index >= treeSize) {
    return { valid: false, reason: 'index outside tree' };
  }
  const rebuilt = rootFromProof(leaf, index, treeSize, proof);
  return {
    valid: rebuilt !== null && rebuilt === root,
    rebuilt,
    reason: rebuilt === null ? 'proof shape does not match tree size' : null,
  };
}

/**
 * Prefix consistency by recomputation. A reader that holds the full leaf list
 * can prove the older tree is a literal prefix of the newer one.
 *
 * Cost is O(oldSize) hashing per audit, which is fine for an agent history of
 * 10^4 events and is stated as a limitation rather than hidden. A production
 * log would use RFC 6962 consistency proofs to avoid re-fetching leaves.
 */
export function verifyPrefix({ oldSize, oldRoot, leaves }) {
  if (!Number.isInteger(oldSize) || oldSize < 0) return { valid: false, reason: 'oldSize must be a non-negative integer' };
  if (oldSize > leaves.length) return { valid: false, reason: `oldSize ${oldSize} exceeds ${leaves.length} leaves` };
  const recomputed = subtreeHash(leaves, 0, oldSize);
  return {
    valid: recomputed === oldRoot,
    recomputed,
    reason: recomputed === oldRoot ? null : 'the older root is not a prefix of the newer tree',
  };
}

export function signCheckpoint(logPrivatePem, fields) {
  return createEvent(logPrivatePem, {
    seq: fields.seq,
    parent: fields.parent ?? null,
    type: 'checkpoint',
    bodyId: 'log',
    at: fields.at ?? new Date().toISOString(),
    payload: {
      size: fields.size,
      root: fields.root,
      headId: fields.headId,
      headSeq: fields.headSeq,
    },
  });
}

export function verifyCheckpoint(checkpoint, pinnedLogPublicPem) {
  try {
    verifyEvent(checkpoint, pinnedLogPublicPem);
  } catch (error) {
    return { valid: false, reason: error.message };
  }
  const { size, root, headSeq } = checkpoint.payload ?? {};
  if (!Number.isInteger(size) || size < 1) return { valid: false, reason: 'checkpoint size is invalid' };
  if (typeof root !== 'string' || root.length !== 64) return { valid: false, reason: 'checkpoint root is not a sha256 hex digest' };
  if (!Number.isInteger(headSeq) || headSeq < 1) return { valid: false, reason: 'checkpoint headSeq is invalid' };
  return { valid: true, size, root, headSeq, headId: checkpoint.payload.headId };
}

export function logIdFor(publicPem) {
  return `log_${hashText(publicPem).slice(0, 16)}`;
}

/**
 * A reader's view of what a log has promised. Readers pin the log's public key
 * once, then only accept checkpoints that verify against it and never shrink.
 */
export function auditAgainstCheckpoint({ leaves, checkpoint, pinnedLogPublicPem, knownCheckpoint = null }) {
  const verified = verifyCheckpoint(checkpoint, pinnedLogPublicPem);
  if (!verified.valid) {
    return { valid: false, anchored: false, reason: `checkpoint rejected: ${verified.reason}` };
  }
  if (knownCheckpoint && verified.size < knownCheckpoint.size) {
    return {
      valid: false,
      anchored: false,
      reason: `log size regressed from ${knownCheckpoint.size} to ${verified.size}`,
    };
  }
  if (leaves.length < verified.size) {
    return {
      valid: false,
      anchored: false,
      reason: `relay served ${leaves.length} events but the log anchors ${verified.size}`,
    };
  }
  const root = merkleRoot(leaves.slice(0, verified.size));
  if (root !== verified.root) {
    return {
      valid: false,
      anchored: false,
      root,
      reason: 'relay history does not match the anchored root',
    };
  }
  const head = leaves[verified.size - 1];
  return {
    valid: true,
    anchored: true,
    root,
    size: verified.size,
    headSeq: verified.headSeq,
    headMatches: head === verified.headId,
    unanchoredEvents: leaves.length - verified.size,
    reason: null,
  };
}

export function checkpointSummary(checkpoint) {
  return hashText(canonicalJson({
    size: checkpoint.payload?.size,
    root: checkpoint.payload?.root,
    headSeq: checkpoint.payload?.headSeq,
    headId: checkpoint.payload?.headId,
  }));
}
