import { hashText } from './crypto.mjs';
import { verifyChain } from './events.mjs';

function assertChain(events, label = 'chain') {
  try {
    verifyChain(events);
    return true;
  } catch {
    throw new Error(`${label} is not a valid signed chain`);
  }
}

export function headOf(events) {
  const last = events.at(-1);
  if (!last) throw new Error('chain is empty');
  return { seq: last.seq, id: last.id, at: last.at };
}

export function chainDigest(events) {
  return hashText(events.map((event) => event.id).join('\n'));
}

/**
 * Split one honest history into two branches that share a prefix.
 * Both branches are individually signed and internally consistent, which is
 * exactly what a malicious relay needs for equivocation.
 */
export function splitHistory(events, forkSeq) {
  assertChain(events, 'source history');
  if (forkSeq < 1 || forkSeq >= events.length) {
    throw new Error(`forkSeq must be within 1..${events.length - 1}`);
  }
  return {
    prefix: events.slice(0, forkSeq),
    remaining: events.slice(forkSeq),
  };
}

export function stageEquivocation({ source, forkSeq, viewA, viewB }) {
  assertChain(source, 'source history');
  const { prefix, remaining } = splitHistory(source, forkSeq);
  const merged = {
    a: [...prefix, ...viewA],
    b: [...prefix, ...viewB],
  };
  if (remaining.length === 0) throw new Error('nothing after fork point');
  assertChain(merged.a, 'view A');
  assertChain(merged.b, 'view B');
  return {
    attack: 'equivocation',
    forkSeq,
    views: merged,
    sharedPrefix: prefix.length,
  };
}

export function stageWithholding({ source, withheldFrom }) {
  assertChain(source, 'source history');
  if (withheldFrom <= 1 || withheldFrom > source.length) {
    throw new Error(`withheldFrom must be within 2..${source.length}`);
  }
  return {
    attack: 'withholding',
    views: {
      a: source,
      b: source.slice(0, withheldFrom),
    },
  };
}

export function stageRollback({ source, rollbackTo }) {
  assertChain(source, 'source history');
  if (rollbackTo < 1 || rollbackTo >= source.length) {
    throw new Error(`rollbackTo must be within 1..${source.length - 1}`);
  }
  return {
    attack: 'rollback',
    views: {
      a: source,
      b: source.slice(0, rollbackTo + 1),
    },
  };
}

/**
 * A single reader sees one view and has no reference point.
 * It can prove internal consistency only; it cannot prove freshness or uniqueness.
 */
export function verifySingleView(view) {
  const valid = assertChain(view, 'view');
  return {
    strategy: 'single-view',
    valid,
    head: headOf(view),
    digest: chainDigest(view),
    equivocationDetected: false,
    freshnessKnown: false,
    reason: 'no comparison point: internal consistency does not imply uniqueness or freshness',
  };
}

/**
 * Two readers compare heads. This detects equivocation, but only for the
 * sequences both readers actually observed.
 */
export function verifyCrossCheck(viewA, viewB) {
  assertChain(viewA, 'view A');
  assertChain(viewB, 'view B');
  const headA = headOf(viewA);
  const headB = headOf(viewB);
  const shared = Math.min(viewA.length, viewB.length);
  let divergenceAt = null;
  for (let index = 0; index < shared; index += 1) {
    if (viewA[index].id !== viewB[index].id) {
      divergenceAt = index + 1;
      break;
    }
  }
  if (divergenceAt === null && viewA.length !== viewB.length) {
    divergenceAt = shared + 1;
  }
  return {
    strategy: 'cross-check',
    valid: true,
    headA,
    headB,
    divergenceAt,
    equivocationDetected: divergenceAt !== null,
    freshnessKnown: viewA.length === viewB.length && divergenceAt === null,
    reason: divergenceAt === null
      ? 'both views agree on every shared sequence number'
      : `views diverge at seq ${divergenceAt}`,
  };
}

/**
 * Readers exchange heads every `every` events. This bounds how long a split
 * view can stay hidden, at the cost of extra round trips.
 */
export function verifyHeartbeat({ viewA, viewB, every = 4 }) {
  assertChain(viewA, 'view A');
  assertChain(viewB, 'view B');
  const checkpoints = [];
  for (let seq = every; seq <= Math.min(viewA.length, viewB.length); seq += every) {
    const a = viewA[seq - 1].id;
    const b = viewB[seq - 1].id;
    checkpoints.push({ seq, agree: a === b });
    if (a !== b) {
      return {
        strategy: 'heartbeat',
        every,
        valid: true,
        checkpoints,
        divergenceAt: seq,
        equivocationDetected: true,
        maxEventsHiddenBetweenExchanges: every - 1,
        reason: `heartbeat at seq ${seq} exposed the split; at most ${every - 1} events can hide between exchanges`,
      };
    }
  }
  const lastSeq = Math.min(viewA.length, viewB.length);
  const remainder = lastSeq % every;
  return {
    strategy: 'heartbeat',
    every,
    valid: true,
    checkpoints,
    divergenceAt: viewA.length === viewB.length ? null : lastSeq + 1,
    equivocationDetected: viewA.length !== viewB.length,
    maxEventsHiddenBetweenExchanges: every - 1,
    reason: viewA.length === viewB.length
      ? 'all observed heartbeats agree'
      : `length mismatch after last heartbeat at seq ${lastSeq - remainder}`,
  };
}

export function detectWithholding({ viewA, viewB, expectedSeq = null }) {
  assertChain(viewA, 'view A');
  assertChain(viewB, 'view B');
  const shorter = viewA.length <= viewB.length ? viewA : viewB;
  const longer = viewA.length <= viewB.length ? viewB : viewA;
  const gap = longer.length - shorter.length;
  const detectedByHeartbeat = expectedSeq !== null && shorter.length < expectedSeq;
  return {
    strategy: 'withholding-check',
    valid: true,
    gap,
    detected: gap > 0,
    detectedByHeartbeat,
    reason: gap > 0
      ? `one view is ${gap} event(s) behind`
      : 'views have equal length; withholding not observable from length alone',
  };
}

export function detectRollback({ view, knownHeadSeq }) {
  assertChain(view, 'view');
  const head = headOf(view);
  return {
    strategy: 'rollback-check',
    valid: true,
    head,
    knownHeadSeq,
    detected: head.seq < knownHeadSeq,
    reason: head.seq < knownHeadSeq
      ? `relay head went backwards: ${head.seq} < ${knownHeadSeq}`
      : 'head is at or ahead of the last known sequence',
  };
}
