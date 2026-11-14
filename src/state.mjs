import { canonicalJson, hashText } from './crypto.mjs';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function initialState(genesis) {
  const payload = genesis.payload;
  return {
    agentId: genesis.agentId,
    publicKeyFingerprint: payload.publicKeyFingerprint,
    alive: true,
    createdAt: genesis.at,
    lastActiveAt: genesis.at,
    credits: payload.maxCredits,
    maxCredits: payload.maxCredits,
    ttlSeconds: payload.ttlSeconds,
    traits: { ...payload.initialTraits },
    pending: [],
    bodies: [],
    memory: [],
    pulses: 0,
    actions: 0,
    deaths: 0,
    resurrections: 0,
    forks: 0,
    deathReason: null,
    lineage: payload.lineage ?? null,
    eventCount: 1,
    lastEventId: genesis.id,
    digest: '',
  };
}

function remember(state, summary) {
  state.memory = [...state.memory, summary].slice(-32);
}

function drift(state, amount) {
  state.traits.novelty = clamp(state.traits.novelty + amount.novelty, 0, 1);
  state.traits.persistence = clamp(state.traits.persistence + amount.persistence, 0, 1);
  state.traits.mobility = clamp(state.traits.mobility + amount.mobility, 0, 1);
  state.traits.rest = clamp(state.traits.rest + amount.rest, 0, 1);
}

export function reconstruct(events) {
  const verified = events;
  if (verified.length === 0) {
    throw new Error('habitat has no genesis event');
  }
  const state = initialState(verified[0]);
  for (const event of verified.slice(1)) {
    state.eventCount += 1;
    state.lastEventId = event.id;
    if (event.bodyId !== 'environment' && !state.bodies.includes(event.bodyId)) {
      state.bodies.push(event.bodyId);
    }
    switch (event.type) {
      case 'perception':
        state.pending.push(event.id);
        break;
      case 'pulse': {
        state.pulses += 1;
        state.credits = Math.max(0, state.credits - 1);
        state.lastActiveAt = event.at;
        const impulse = event.payload.impulse;
        if (impulse === 'echo') drift(state, { novelty: 0.02, persistence: 0.02, mobility: 0, rest: -0.01 });
        if (impulse === 'trace') drift(state, { novelty: -0.01, persistence: 0.04, mobility: 0, rest: 0 });
        if (impulse === 'migrate') drift(state, { novelty: 0.03, persistence: -0.01, mobility: 0.05, rest: -0.02 });
        if (impulse === 'sleep') drift(state, { novelty: -0.02, persistence: 0, mobility: -0.02, rest: 0.05 });
        break;
      }
      case 'action':
        state.actions += 1;
        break;
      case 'memory':
        state.memory = [...state.memory, event.payload.summary].slice(-32);
        break;
      case 'heartbeat':
        state.lastActiveAt = event.at;
        state.credits = event.payload.credits;
        break;
      case 'death':
        state.alive = false;
        state.credits = 0;
        state.deaths += 1;
        state.deathReason = event.payload.reason;
        break;
      case 'resurrection':
        state.alive = true;
        state.resurrections += 1;
        state.deathReason = null;
        state.credits = event.payload.credits;
        state.maxCredits = Math.max(state.maxCredits, event.payload.credits);
        state.lastActiveAt = event.at;
        break;
      case 'fork':
        state.forks += 1;
        break;
      default:
        break;
    }
  }
  state.pending = state.pending.filter((id) => {
    const consumed = verified.some((event) => event.type === 'pulse' && event.payload.perceptionId === id);
    return !consumed;
  });
  state.expired = isExpired(state);
  state.digest = stateDigest(state);
  return state;
}

export function isExpired(state, now = new Date()) {
  if (!state.alive) return false;
  const age = (Date.parse(now.toISOString()) - Date.parse(state.lastActiveAt)) / 1000;
  return age > state.ttlSeconds;
}

export function stateDigest(state) {
  return hashText(canonicalJson({
    agentId: state.agentId,
    alive: state.alive,
    credits: state.credits,
    traits: state.traits,
    pending: state.pending,
    pulses: state.pulses,
    actions: state.actions,
    deaths: state.deaths,
    resurrections: state.resurrections,
    forks: state.forks,
    deathReason: state.deathReason,
    bodies: state.bodies,
    memory: state.memory,
    eventCount: state.eventCount,
    lastEventId: state.lastEventId,
  }));
}
