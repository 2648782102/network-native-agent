import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  describeCognition,
  makePulsePlan,
  resolveCognitionName,
} from './cognition.mjs';
import {
  createEvent,
  generateIdentity,
  hashText,
  identityFromPrivatePem,
  makeBodyId,
} from './crypto.mjs';
import {
  appendEvent,
  ensureHabitatDir,
  eventDigest,
  lastEvent,
  readEvents,
  readPrivatePem,
  readRawEvents,
  verifyChain,
  writeGenesisSummary,
  writePrivatePem,
} from './events.mjs';
import {
  isExpired,
  reconstruct,
  stateDigest,
} from './state.mjs';
import { readCheckpoint, validateCheckpoint, writeCheckpoint } from './checkpoint.mjs';
import {
  listRelayBranches,
  readRelayConfig,
  readRelayEvents,
  writeRelayConfig,
  writeRelayEvents,
} from './relay.mjs';
import { computeMetrics } from './metrics.mjs';

const DEFAULT_TRAITS = {
  novelty: 0.25,
  persistence: 0.5,
  mobility: 0.2,
  rest: 0.3,
};

async function withHabitatLock(habitat, callback) {
  const paths = await ensureHabitatDir(habitat);
  let handle;
  const started = Date.now();
  while (true) {
    try {
      handle = await open(paths.lock, 'wx');
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - started > 5000) {
        throw new Error('habitat lock timeout');
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  await handle.writeFile(`${process.pid}:${new Date().toISOString()}\n`);
  try {
    return await callback(paths);
  } finally {
    await handle.close();
    await import('node:fs/promises').then(({ unlink }) => unlink(paths.lock).catch(() => {}));
  }
}

async function withEventLock(habitat, callback) {
  return withHabitatLock(habitat, callback);
}

async function appendSigned(habitat, fields) {
  const privatePem = await readPrivatePem(habitat);
  const event = createEvent(privatePem, fields);
  await appendEvent(habitat, event);
  return event;
}

export async function initHabitat(habitat, options = {}) {
  return withHabitatLock(habitat, async () => {
    const existing = await readEvents(habitat);
    if (existing.length > 0 && !options.force) {
      throw new Error('habitat already has a genesis event; use --force to replace it');
    }
    const paths = await ensureHabitatDir(habitat);
    const identity = generateIdentity();
    await writePrivatePem(habitat, identity.privatePem);
    await writeFile(paths.events, '', 'utf8');
    const genesis = createEvent(identity.privatePem, {
      seq: 1,
      parent: null,
      type: 'genesis',
      bodyId: 'environment',
      at: new Date().toISOString(),
      payload: {
        publicPem: identity.publicPem,
        publicKeyFingerprint: identity.publicKeyFingerprint,
        maxCredits: options.credits ?? 12,
        ttlSeconds: options.ttl ?? 3600,
        initialTraits: { ...DEFAULT_TRAITS },
        lineage: null,
        note: options.note ?? 'network-native-agent v0 genesis',
      },
    });
    await appendEvent(habitat, genesis);
    await writeGenesisSummary(habitat, genesis);
    if (options.remoteUrl) {
      await writeRelayConfig(habitat, {
        remoteUrl: options.remoteUrl,
        branch: options.branch,
        agentId: identity.agentId,
      });
      const current = await readEvents(habitat);
      await writeRelayEvents(await readRelayConfig(habitat), current);
    }
    return { habitat: paths.root, genesis, identity: { agentId: identity.agentId, publicKeyFingerprint: identity.publicKeyFingerprint } };
  });
}

export async function attachRelay(habitat, remoteUrl, options = {}) {
  return withEventLock(habitat, async () => {
    const events = await readEvents(habitat);
    if (events.length === 0) throw new Error('habitat has no genesis event; run init first');
    const config = await writeRelayConfig(habitat, {
      remoteUrl,
      branch: options.branch,
      agentId: events[0].agentId,
    });
    const remoteEvents = await readRelayEvents(config);
    if (remoteEvents.length > 0) {
      verifyChain(remoteEvents);
      if (remoteEvents[0].id !== events[0].id) {
        throw new Error('remote relay has a different genesis identity');
      }
    }
    const merged = mergeEventChains(events, remoteEvents, options.strategy ?? 'reject');
    verifyChain(merged);
    const paths = await ensureHabitatDir(habitat);
    await writeFile(paths.events, eventsToText(merged), 'utf8');
    if (options.push !== false) {
      await writeRelayEvents(config, merged);
    }
    return { ...config, remoteUrl: sanitizeConfigRemote(config.remoteUrl), remoteEventCount: remoteEvents.length, localEventCount: events.length, mergedEventCount: merged.length, pushed: options.push !== false };
  });
}

function sanitizeConfigRemote(remoteUrl) {
  if (remoteUrl.startsWith('/') || remoteUrl.startsWith('file://')) return '<local-git-test-remote>';
  return remoteUrl.replace(/\/\/[^@/]+@/, '//<redacted>@');
}

async function syncLocalWithRelay(habitat, options = {}) {
  const config = await readRelayConfig(habitat);
  if (!config) return { enabled: false, events: await readEvents(habitat) };
  const localEvents = await readEvents(habitat);
  const remoteEvents = await readRelayEvents(config);
  if (remoteEvents.length > 0) verifyChain(remoteEvents);
  const merged = mergeEventChains(localEvents, remoteEvents, options.strategy ?? 'reject');
  verifyChain(merged);
  const paths = await ensureHabitatDir(habitat);
  await writeFile(paths.events, eventsToText(merged), 'utf8');
  return { enabled: true, events: merged, config, localEvents, remoteEvents, merged };
}

async function publishEvents(habitat, events, options = {}) {
  const config = await readRelayConfig(habitat);
  if (!config) return { enabled: false };
  if (options.push === false) return { enabled: true, pushed: false };
  await writeRelayEvents(config, events);
  return { enabled: true, pushed: true };
}

export async function relayStatus(habitat) {
  const config = await readRelayConfig(habitat);
  if (!config) return { configured: false };
  const remoteEvents = await readRelayEvents(config);
  if (remoteEvents.length > 0) verifyChain(remoteEvents);
  const localEvents = await readEvents(habitat);
  const localIds = new Set(localEvents.map((event) => event.id));
  const remoteIds = new Set(remoteEvents.map((event) => event.id));
  const commonPrefix = longestCommonPrefix(localEvents, remoteEvents);
  return {
    configured: true,
    branch: config.branch,
    remoteUrl: sanitizeConfigRemote(config.remoteUrl),
    localEventCount: localEvents.length,
    remoteEventCount: remoteEvents.length,
    commonPrefix: commonPrefix.length,
    localOnly: localEvents.length - commonPrefix.length,
    remoteOnly: remoteEvents.length - commonPrefix.length,
    divergent: localEvents.length > commonPrefix.length && remoteEvents.length > commonPrefix.length,
    localHead: lastEvent(localEvents)?.id ?? null,
    remoteHead: lastEvent(remoteEvents)?.id ?? null,
    localOnlyIds: localEvents.slice(commonPrefix.length).filter((event) => !remoteIds.has(event.id)).map((event) => event.id),
    remoteOnlyIds: remoteEvents.slice(commonPrefix.length).filter((event) => !localIds.has(event.id)).map((event) => event.id),
  };
}

export async function syncHabitat(habitat, options = {}) {
  return withEventLock(habitat, async () => {
    const config = await readRelayConfig(habitat);
    if (!config) throw new Error('relay is not configured; run relay attach first');
    const localEvents = await readEvents(habitat);
    const remoteEvents = await readRelayEvents(config);
    if (remoteEvents.length > 0) verifyChain(remoteEvents);
    const merged = mergeEventChains(localEvents, remoteEvents, options.strategy ?? 'reject');
    verifyChain(merged);
    const paths = await ensureHabitatDir(habitat);
    await writeFile(paths.events, eventsToText(merged), 'utf8');
    if (options.push !== false) {
      await writeRelayEvents(config, merged);
    }
    return {
      strategy: options.strategy ?? 'reject',
      localEventCount: localEvents.length,
      remoteEventCount: remoteEvents.length,
      mergedEventCount: merged.length,
      pushed: options.push !== false,
      branch: config.branch,
      agentId: merged[0].agentId,
      digest: reconstruct(merged).digest,
    };
  });
}

export async function restoreHabitat(habitat, targetHabitat, options = {}) {
  const config = await readRelayConfig(habitat);
  if (!config) throw new Error('relay is not configured; run relay attach first');
  const remoteEvents = await readRelayEvents(config);
  if (remoteEvents.length === 0) throw new Error('remote relay has no events');
  const verified = verifyChain(remoteEvents);
  const targetPath = path.resolve(targetHabitat);
  const sourcePath = path.resolve(habitat);
  if (sourcePath === targetPath) throw new Error('restore target must differ from source habitat');
  return withEventLock(targetHabitat, async () => {
    const paths = await ensureHabitatDir(targetHabitat);
    await rm(paths.events, { force: true });
    await writeFile(paths.events, eventsToText(verified), 'utf8');
    await writeGenesisSummary(targetHabitat, verified[0]);
    if (options.identityKey === false) {
      await rm(paths.identity, { force: true });
    } else {
      const privatePem = await readPrivatePem(habitat).catch(() => null);
      if (privatePem) {
        await writePrivatePem(targetHabitat, privatePem);
      }
    }
    if (options.relayConfig !== false) {
      await writeRelayConfig(targetHabitat, {
        remoteUrl: config.remoteUrl,
        branch: config.branch,
        agentId: verified[0].agentId,
      });
    }
    const state = reconstruct(verified);
    await materializeOutbox(targetHabitat, verified);
    return {
      restoredTo: targetPath,
      fromBranch: config.branch,
      eventCount: verified.length,
      agentId: state.agentId,
      digest: state.digest,
      identityKeyCopied: options.identityKey !== false && Boolean(await readPrivatePem(targetHabitat).catch(() => null)),
      relayConfigCopied: options.relayConfig !== false,
      sameBodyAsSource: false,
    };
  });
}

export async function weather(habitat, count = 6, options = {}) {
  const phrases = [
    '一条来自 relay 的噪声',
    '同一条消息再次抵达',
    '一条与先前相反的消息',
    '一个迟到的 feed 片段',
    '重复编号 42',
    '一个无法确定的来源',
  ];
  const sources = ['relay', 'feed', 'webhook', 'issue', 'clock'];
  const appended = [];
  for (let index = 0; index < count; index += 1) {
    const source = sources[index % sources.length];
    const text = phrases[index % phrases.length];
    appended.push(await injectPerception(habitat, text, {
      source,
      metadata: { weather: true, index, batch: options.batch ?? 'default' },
    }));
  }
  return {
    injected: appended.length,
    duplicateRatio: Number((1 / Math.max(1, appended.length)).toFixed(4)),
    sourceCount: new Set(appended.map((event) => event.payload.source)).size,
    firstEventId: appended[0]?.id ?? null,
    lastEventId: lastEvent(appended)?.id ?? null,
  };
}

export async function getMetrics(habitat) {
  const events = await readEvents(habitat);
  const state = reconstruct(events);
  return computeMetrics(path.resolve(habitat), events, state);
}

function eventsToText(events) {
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

function longestCommonPrefix(left, right) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index].id === right[index].id) index += 1;
  return left.slice(0, index);
}

function mergeEventChains(localEvents, remoteEvents, strategy) {
  if (localEvents.length === 0 && remoteEvents.length === 0) return [];
  const genesis = localEvents[0] ?? remoteEvents[0];
  if (remoteEvents.length > 0 && remoteEvents[0].id !== genesis.id) {
    throw new Error('remote relay has a different genesis identity');
  }
  const common = longestCommonPrefix(localEvents, remoteEvents);
  const localOnly = localEvents.slice(common.length);
  const remoteOnly = remoteEvents.slice(common.length);
  if (localOnly.length > 0 && remoteOnly.length > 0) {
    if (strategy === 'reject') {
      throw new Error(`event histories diverged at seq ${common.length + 1}; resolve explicitly`);
    }
    if (strategy !== 'prefer-local' && strategy !== 'prefer-remote' && strategy !== 'replay-local') {
      throw new Error(`unsupported sync strategy: ${strategy}`);
    }
    if (strategy === 'prefer-remote') return remoteEvents;
    return localEvents;
  }
  if (remoteOnly.length > 0) return remoteEvents;
  if (localOnly.length > 0) return localEvents;
  return common;
}

export async function injectPerception(habitat, text, options = {}) {
  return withEventLock(habitat, async () => {
    const sync = await syncLocalWithRelay(habitat, { strategy: options.strategy ?? 'reject' });
    let events = sync.events;
    if (events.length === 0) throw new Error('habitat has no genesis event; run init first');
    const previous = lastEvent(events);
    const event = await appendSigned(habitat, {
      seq: previous.seq + 1,
      parent: previous.id,
      type: 'perception',
      bodyId: 'environment',
      at: new Date().toISOString(),
      payload: {
        source: options.source ?? 'relay',
        text: String(text ?? '').slice(0, 4096),
        metadata: options.metadata ?? {},
      },
    });
    events = [...events, event];
    await publishEvents(habitat, events, options);
    return event;
  });
}

async function planWithCognition(state, events, bodyId, options) {
  return makePulsePlan({
    state,
    events,
    bodyId,
    cognition: options.cognition,
  });
}

export async function describeCognitionAdapter(requested) {
  return describeCognition(requested);
}

export async function listRelays(remoteUrl, options = {}) {
  if (!remoteUrl) throw new Error('relay ls requires <remote-url>');
  const branches = await listRelayBranches(remoteUrl);
  const summaries = await Promise.all(branches.map(async (branch) => {
    const config = { remoteUrl, branch, agentId: null };
    try {
      const events = verifyChain(await readRelayEvents(config));
      const state = reconstruct(events);
      return {
        branch,
        valid: true,
        agentId: state.agentId,
        eventCount: events.length,
        digest: state.digest,
        alive: state.alive,
        deaths: state.deaths,
        resurrections: state.resurrections,
      };
    } catch (error) {
      return { branch, valid: false, error: error.message };
    }
  }));
  return {
    remoteUrl: sanitizeConfigRemote(remoteUrl),
    branchCount: branches.length,
    summaries: options.all === false ? summaries.slice(0, 12) : summaries,
  };
}

export async function wake(habitat, options = {}) {
  return withEventLock(habitat, async () => {
    const sync = await syncLocalWithRelay(habitat, { strategy: options.strategy ?? 'reject' });
    let events = sync.events;
    if (events.length === 0) throw new Error('habitat has no genesis event; run init first');
    let state = reconstruct(events);
    const appended = [];
    const bodyId = makeBodyId();
    const at = () => new Date().toISOString();
    const append = async (type, payload) => {
      const previous = lastEvent(events);
      const event = await appendSigned(habitat, {
        seq: previous.seq + 1,
        parent: previous.id,
        type,
        bodyId,
        at: at(),
        payload,
      });
      events = [...events, event];
      appended.push(event);
      return event;
    };

    if (isExpired(state)) {
      await append('death', { reason: 'lease_expired', bodyId, expiredAt: state.lastActiveAt });
      state = reconstruct(events);
    }

    if (!state.alive && !options.resurrect) {
      await publishEvents(habitat, events, options);
      return { alive: false, bodyId, reason: state.deathReason, appended, state };
    }

    if (options.resurrect && !state.alive) {
      const credits = options.credits ?? state.maxCredits;
      await append('resurrection', {
        reason: 'explicit_resurrection',
        credits,
        previousDeaths: state.deaths,
      });
      state = reconstruct(events);
    } else if (options.resurrect && state.alive && state.credits < state.maxCredits) {
      const credits = options.credits ?? state.maxCredits;
      await append('resurrection', {
        reason: 'metabolic_refill',
        credits,
        previousDeaths: state.deaths,
      });
      state = reconstruct(events);
    }

    const plan = await planWithCognition(state, events, bodyId, options);
    for (const item of plan) {
      state = reconstruct(events);
      if (state.credits <= 0) break;
      await append('pulse', {
        perceptionId: item.pulse.perceptionId,
        impulse: item.pulse.impulse,
        source: item.pulse.source,
        seed: item.pulse.seed,
        cognition: item.pulse.cognition,
        creditsBefore: state.credits,
      });
      await append('action', {
        impulse: item.action.impulse,
        perceptionId: item.action.perceptionId,
        summary: item.action.summary,
        surface: 'outbox',
        cognition: item.action.cognition,
      });
      await append('memory', { summary: item.memory.summary, cognition: item.memory.cognition });
      state = reconstruct(events);
    }

    if (state.alive && state.credits <= 0) {
      await append('death', { reason: 'budget_exhausted', bodyId, pulses: state.pulses });
    } else if (state.alive) {
      await append('heartbeat', {
        credits: state.credits,
        pending: state.pending.length,
        traits: state.traits,
      });
    }
    state = reconstruct(events);
    await materializeOutbox(habitat, events);
    await publishEvents(habitat, events, options);
    return { alive: state.alive, bodyId, reason: state.deathReason, appended, state };
  });
}

export async function getStatus(habitat) {
  const events = await readEvents(habitat);
  if (events.length === 0) throw new Error('habitat has no genesis event; run init first');
  const state = reconstruct(events);
  const genesis = events[0];
  return {
    agentId: state.agentId,
    publicKeyFingerprint: state.publicKeyFingerprint,
    alive: state.alive,
    expired: state.expired,
    createdAt: state.createdAt,
    lastActiveAt: state.lastActiveAt,
    credits: state.credits,
    maxCredits: state.maxCredits,
    ttlSeconds: state.ttlSeconds,
    traits: state.traits,
    pending: state.pending.length,
    bodies: state.bodies,
    bodyCount: state.bodies.length,
    memory: state.memory,
    pulses: state.pulses,
    actions: state.actions,
    deaths: state.deaths,
    resurrections: state.resurrections,
    forks: state.forks,
    deathReason: state.deathReason,
    lineage: state.lineage,
    eventCount: state.eventCount,
    lastEventId: state.lastEventId,
    digest: state.digest,
    genesisId: genesis.id,
  };
}

export async function getTrace(habitat, last = 20) {
  const events = await readEvents(habitat);
  return events.slice(-last).map((event) => ({
    seq: event.seq,
    id: event.id,
    parent: event.parent,
    type: event.type,
    bodyId: event.bodyId,
    at: event.at,
    digest: eventDigest(event),
    payload: event.payload,
  }));
}

export async function replay(habitat, options = {}) {
  const { events, verification } = await readEventsWithCheckpoint(habitat, options);
  const state = reconstruct(events);
  if (options.materialize !== false) {
    await materializeOutbox(habitat, events);
  }
  return {
    valid: true,
    eventCount: events.length,
    agentId: state.agentId,
    digest: state.digest,
    genesisId: events[0].id,
    lastEventId: lastEvent(events).id,
    materializedActions: events.filter((event) => event.type === 'action').length,
    verification,
  };
}

async function readEventsWithCheckpoint(habitat, options = {}) {
  const raw = await readRawEvents(habitat);
  if (raw.length === 0) return { events: [], verification: { mode: 'empty' } };

  // A read-only observer has no identity.key; checkpoints are an optimization,
  // so a habitat without a key simply always verifies in full.
  const identity = options.privatePem ?? await readPrivatePem(habitat).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const mode = options.incremental === false ? 'full' : 'auto';

  if (mode === 'auto') {
    const checkpoint = await readCheckpoint(habitat);
    const verdict = validateCheckpoint(checkpoint, raw, raw[0].agentId);
    if (verdict.usable) {
      const started = Date.now();
      const events = verifyChain(raw, { skipSignatureBefore: verdict.size });
      return {
        events,
        verification: {
          mode: 'incremental',
          checkpointSize: verdict.size,
          recheckedSignatures: events.length - verdict.size,
          skippedSignatures: verdict.size,
          elapsedMs: Date.now() - started,
        },
      };
    }
  }

  const started = Date.now();
  const events = verifyChain(raw);
  let checkpointWritten = false;
  if (identity) {
    const chainDigest = hashText(events.map((event) => event.id).join('\n'));
    await writeCheckpoint(habitat, {
      size: events.length,
      headId: lastEvent(events).id,
      headSeq: lastEvent(events).seq,
      chainDigest,
      privatePem: identity,
    });
    checkpointWritten = true;
  }
  return {
    events,
    verification: {
      mode: 'full',
      recheckedSignatures: events.length,
      skippedSignatures: 0,
      elapsedMs: Date.now() - started,
      checkpointWritten,
      checkpointSkippedReason: checkpointWritten ? null : 'habitat has no identity.key (read-only observer)',
    },
  };
}

export async function materializeOutbox(habitat, events = null) {
  const paths = await ensureHabitatDir(habitat);
  const chain = events ?? await readEvents(habitat);
  const actions = chain.filter((event) => event.type === 'action');
  await mkdir(paths.outbox, { recursive: true });
  await Promise.all(actions.map((event) => writeFile(
    path.join(paths.outbox, `${String(event.seq).padStart(6, '0')}-${event.id.slice(0, 12)}.json`),
    `${JSON.stringify({
      event_id: event.id,
      seq: event.seq,
      at: event.at,
      agent_id: event.agentId,
      body_id: event.bodyId,
      action: event.payload,
    }, null, 2)}\n`,
    'utf8',
  )));
  return actions.length;
}

export async function markDeath(habitat, reason = 'experiment', options = {}) {
  return withEventLock(habitat, async () => {
    const sync = await syncLocalWithRelay(habitat, { strategy: options.strategy ?? 'reject' });
    let events = sync.events;
    let state = reconstruct(events);
    if (!state.alive) return { changed: false, state };
    const bodyId = makeBodyId();
    const previous = lastEvent(events);
    const event = await appendSigned(habitat, {
      seq: previous.seq + 1,
      parent: previous.id,
      type: 'death',
      bodyId,
      at: new Date().toISOString(),
      payload: { reason, bodyId, pulses: state.pulses },
    });
    events = [...events, event];
    state = reconstruct(events);
    await publishEvents(habitat, events, options);
    return { changed: true, event, state };
  });
}

export async function resurrect(habitat, options = {}) {
  return withEventLock(habitat, async () => {
    const sync = await syncLocalWithRelay(habitat, { strategy: options.strategy ?? 'reject' });
    let events = sync.events;
    let state = reconstruct(events);
    const credits = options.credits ?? state.maxCredits;
    const previous = lastEvent(events);
    const event = await appendSigned(habitat, {
      seq: previous.seq + 1,
      parent: previous.id,
      type: 'resurrection',
      bodyId: makeBodyId(),
      at: new Date().toISOString(),
      payload: {
        reason: state.alive ? 'metabolic_refill' : 'explicit_resurrection',
        credits,
        previousDeaths: state.deaths,
      },
    });
    events = [...events, event];
    state = reconstruct(events);
    const appended = [event];
    let bodyId = null;
    if (options.wake) {
      bodyId = makeBodyId();
      const plan = await planWithCognition(state, events, bodyId, options);
      for (const item of plan) {
        state = reconstruct(events);
        if (state.credits <= 0) break;
        for (const [type, payload] of [
          ['pulse', { perceptionId: item.pulse.perceptionId, impulse: item.pulse.impulse, source: item.pulse.source, seed: item.pulse.seed, cognition: item.pulse.cognition, creditsBefore: state.credits }],
          ['action', { impulse: item.action.impulse, perceptionId: item.action.perceptionId, summary: item.action.summary, surface: 'outbox', cognition: item.action.cognition }],
          ['memory', { summary: item.memory.summary, cognition: item.memory.cognition }],
        ]) {
          const child = await appendSigned(habitat, {
            seq: lastEvent(events).seq + 1,
            parent: lastEvent(events).id,
            type,
            bodyId,
            at: new Date().toISOString(),
            payload,
          });
          events = [...events, child];
          appended.push(child);
        }
        state = reconstruct(events);
      }
      if (state.alive && state.credits <= 0) {
        const death = await appendSigned(habitat, {
          seq: lastEvent(events).seq + 1,
          parent: lastEvent(events).id,
          type: 'death',
          bodyId,
          at: new Date().toISOString(),
          payload: { reason: 'budget_exhausted', bodyId, pulses: state.pulses },
        });
        events = [...events, death];
        appended.push(death);
      } else if (state.alive) {
        const heartbeat = await appendSigned(habitat, {
          seq: lastEvent(events).seq + 1,
          parent: lastEvent(events).id,
          type: 'heartbeat',
          bodyId,
          at: new Date().toISOString(),
          payload: { credits: state.credits, pending: state.pending.length, traits: state.traits },
        });
        events = [...events, heartbeat];
        appended.push(heartbeat);
      }
      state = reconstruct(events);
      await materializeOutbox(habitat, events);
    }
    await publishEvents(habitat, events, options);
    return {
      changed: true,
      event,
      state,
      waking: options.wake ? { bodyId, alive: state.alive, reason: state.deathReason, appended, state } : null,
    };
  });
}

export async function forkHabitat(habitat, childHabitat, options = {}) {
  const parentPath = path.resolve(habitat);
  const childPath = path.resolve(childHabitat);
  if (parentPath === childPath) throw new Error('child habitat must differ from parent');
  return withEventLock(habitat, async () => {
    const sync = await syncLocalWithRelay(habitat, { strategy: options.strategy ?? 'reject' });
    let parentEvents = sync.events;
    if (parentEvents.length === 0) throw new Error('habitat has no genesis event; run init first');
    const parentState = reconstruct(parentEvents);
    const parentPrivatePem = await readPrivatePem(habitat);
    const childIdentity = generateIdentity();
    const child = await withHabitatLock(childHabitat, async () => {
      const existing = await readEvents(childHabitat);
      if (existing.length > 0) throw new Error('child habitat already has a genesis event');
      const paths = await ensureHabitatDir(childHabitat);
      await writePrivatePem(childHabitat, childIdentity.privatePem);
      await writeFile(paths.events, '', 'utf8');
      const genesis = createEvent(childIdentity.privatePem, {
        seq: 1,
        parent: null,
        type: 'genesis',
        bodyId: 'environment',
        at: new Date().toISOString(),
        payload: {
          publicPem: childIdentity.publicPem,
          publicKeyFingerprint: childIdentity.publicKeyFingerprint,
          maxCredits: parentState.maxCredits,
          ttlSeconds: parentState.ttlSeconds,
          initialTraits: { ...parentState.traits },
          lineage: {
            parentAgentId: parentState.agentId,
            parentGenesisId: parentEvents[0].id,
            parentLastEventId: parentState.lastEventId,
            parentStateDigest: stateDigest(parentState),
            inheritedMemory: parentState.memory,
          },
          note: 'forked network-native-agent v0 genesis',
        },
      });
      await appendEvent(childHabitat, genesis);
      await writeGenesisSummary(childHabitat, genesis);
      return { habitat: paths.root, genesis, childAgentId: childIdentity.agentId };
    });

    const previous = lastEvent(parentEvents);
    const forkEvent = createEvent(parentPrivatePem, {
      seq: previous.seq + 1,
      parent: previous.id,
      type: 'fork',
      bodyId: 'environment',
      at: new Date().toISOString(),
      payload: {
        childAgentId: child.childAgentId,
        childGenesisId: child.genesis.id,
        parentStateDigest: stateDigest(parentState),
        parentLastEventId: parentState.lastEventId,
      },
    });
    await appendEvent(habitat, forkEvent);
    parentEvents = [...parentEvents, forkEvent];
    await publishEvents(habitat, parentEvents, options);
    return {
      parentAgentId: parentState.agentId,
      childAgentId: child.childAgentId,
      childGenesisId: child.genesis.id,
      parentHabitat: parentPath,
      childHabitat: childPath,
      publishedToRelay: sync.enabled && options.push !== false,
    };
  });
}

export async function forkObserverHabitat(habitat, childHabitat, options = {}) {
  const parentPath = path.resolve(habitat);
  const childPath = path.resolve(childHabitat);
  if (parentPath === childPath) throw new Error('child habitat must differ from parent');
  const parentEvents = await readEvents(habitat);
  if (parentEvents.length === 0) throw new Error('observer habitat has no genesis event');
  const parentState = reconstruct(parentEvents);
  const childIdentity = generateIdentity();
  return withHabitatLock(childHabitat, async () => {
    const existing = await readEvents(childHabitat);
    if (existing.length > 0) throw new Error('child habitat already has a genesis event');
    const paths = await ensureHabitatDir(childHabitat);
    await writePrivatePem(childHabitat, childIdentity.privatePem);
    await writeFile(paths.events, '', 'utf8');
    const genesis = createEvent(childIdentity.privatePem, {
      seq: 1,
      parent: null,
      type: 'genesis',
      bodyId: 'environment',
      at: new Date().toISOString(),
      payload: {
        publicPem: childIdentity.publicPem,
        publicKeyFingerprint: childIdentity.publicKeyFingerprint,
        maxCredits: parentState.maxCredits,
        ttlSeconds: parentState.ttlSeconds,
        initialTraits: { ...parentState.traits },
        lineage: {
          parentAgentId: parentState.agentId,
          parentGenesisId: parentEvents[0].id,
          parentLastEventId: parentState.lastEventId,
          parentStateDigest: stateDigest(parentState),
          inheritedMemory: parentState.memory,
          observerFork: true,
          note: 'new lineage from a read-only observer; parent event chain is unchanged',
        },
        note: 'observer lineage fork network-native-agent v0 genesis',
      },
    });
    await appendEvent(childHabitat, genesis);
    await writeGenesisSummary(childHabitat, genesis);
    return {
      parentAgentId: parentState.agentId,
      childAgentId: childIdentity.agentId,
      childGenesisId: genesis.id,
      parentHabitat: parentPath,
      childHabitat: childPath,
      observerFork: true,
      parentEventChainUnchanged: true,
      publishedToRelay: false,
    };
  });
}

export async function getIdentity(habitat) {
  const events = await readEvents(habitat);
  if (events.length === 0) throw new Error('habitat has no genesis event; run init first');
  const genesis = events[0];
  const privatePem = await readFile((await ensureHabitatDir(habitat)).identity, 'utf8');
  const identity = identityFromPrivatePem(privatePem);
  if (identity.agentId !== genesis.agentId) {
    throw new Error('identity.key does not match genesis public key');
  }
  return {
    agentId: identity.agentId,
    publicKeyFingerprint: identity.publicKeyFingerprint,
    publicPem: identity.publicPem,
    lineage: genesis.payload.lineage,
  };
}

export { resolveCognitionName };
