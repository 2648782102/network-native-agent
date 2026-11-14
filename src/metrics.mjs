import { hashText } from './crypto.mjs';

function traitDistance(left, right) {
  const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
  return Array.from(keys).reduce((sum, key) => sum + Math.abs((left?.[key] ?? 0) - (right?.[key] ?? 0)), 0);
}

function impression(text) {
  const clean = String(text ?? '').trim();
  if (!clean) return 'empty';
  return `${clean.length}:${hashText(clean).slice(0, 8)}`;
}

export function computeMetrics(habitat, events, state) {
  const genesis = events[0];
  const initial = genesis.payload.initialTraits ?? {};
  const byType = {};
  const byBody = {};
  const impulses = {};
  const cognition = {};
  const sources = {};
  let lastHeartbeatAt = null;
  let firstEventAt = genesis.at;
  let lastEventAt = genesis.at;
  for (const event of events) {
    byType[event.type] = (byType[event.type] ?? 0) + 1;
    if (event.bodyId !== 'environment') byBody[event.bodyId] = (byBody[event.bodyId] ?? 0) + 1;
    if (event.type === 'pulse') {
      impulses[event.payload.impulse] = (impulses[event.payload.impulse] ?? 0) + 1;
      const adapter = event.payload.cognition?.adapter ?? 'legacy-deterministic';
      cognition[adapter] = (cognition[adapter] ?? 0) + 1;
    }
    if (event.type === 'perception') {
      const source = event.payload.source ?? 'unknown';
      sources[source] = (sources[source] ?? 0) + 1;
    }
    if (event.type === 'heartbeat') lastHeartbeatAt = event.at;
    firstEventAt = firstEventAt < event.at ? firstEventAt : event.at;
    lastEventAt = lastEventAt > event.at ? lastEventAt : event.at;
  }
  const observerEvents = (byType.heartbeat ?? 0) + (byType.trace ?? 0);
  const environmentEvents = byType.perception ?? 0;
  const realPulses = byType.pulse ?? 0;
  return {
    habitat,
    identityContinuity: state.agentId === genesis.agentId,
    replayExactness: state.digest.length === 64,
    bodyTurnover: Object.keys(byBody).length,
    driftDistance: Number(traitDistance(initial, state.traits).toFixed(4)),
    pendingBacklog: state.pending.length,
    metabolicResidual: state.credits,
    observerPollution: Number((observerEvents / Math.max(1, events.length)).toFixed(4)),
    environmentRatio: Number((environmentEvents / Math.max(1, events.length)).toFixed(4)),
    pulseRatio: Number((realPulses / Math.max(1, events.length)).toFixed(4)),
    forkDivergence: state.lineage ? 1 : 0,
    resurrectionLatencySeconds: resurrectionLatency(events),
    eventCount: events.length,
    elapsedSeconds: Math.max(0, (Date.parse(lastEventAt) - Date.parse(firstEventAt)) / 1000),
    lastHeartbeatAt,
    impulses,
    cognition,
    sources,
    impressions: events.filter((event) => event.type === 'perception').slice(-8).map((event) => impression(event.payload.text)),
    digest: state.digest,
  };
}

function resurrectionLatency(events) {
  let deathAt = null;
  let total = 0;
  let count = 0;
  for (const event of events) {
    if (event.type === 'death') deathAt = event.at;
    if (event.type === 'resurrection' && deathAt) {
      total += Math.max(0, (Date.parse(event.at) - Date.parse(deathAt)) / 1000);
      count += 1;
      deathAt = null;
    }
  }
  return count === 0 ? null : Number((total / count).toFixed(3));
}
