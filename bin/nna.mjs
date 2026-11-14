#!/usr/bin/env node
import process from 'node:process';
import { createServer } from 'node:http';
import {
  DEFAULT_LAN_CIDRS,
  isIpAllowed,
  parseCidrs,
  redactIp,
  tokenFingerprint,
  tokenFromHeaders,
  tokenMatches,
} from '../src/lan.mjs';
import {
  attachRelay,
  describeCognitionAdapter,
  forkHabitat,
  forkObserverHabitat,
  getIdentity,
  getMetrics,
  getStatus,
  getTrace,
  initHabitat,
  injectPerception,
  listRelays,
  markDeath,
  replay,
  relayStatus,
  resurrect,
  restoreHabitat,
  syncHabitat,
  wake,
  weather,
} from '../src/runtime.mjs';

function fail(message) {
  console.error(`nna: ${message}`);
  process.exitCode = 1;
}

function output(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(format(value));
}

function format(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => format(item)).join('\n');
  }
  const lines = [];
  for (const [key, item] of Object.entries(value)) {
    if (item === null || typeof item !== 'object') {
      lines.push(`${key}: ${item}`);
    } else if (Array.isArray(item)) {
      lines.push(`${key}: ${item.length}`);
      for (const entry of item.slice(-5)) lines.push(`  - ${typeof entry === 'string' ? entry : JSON.stringify(entry)}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(item)}`);
    }
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const options = { _: [], json: false, wake: false };
  const numeric = new Set(['credits', 'ttl', 'last', 'port', 'count']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      options._.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    let value = inlineValue;
    if (value === undefined) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        value = true;
      } else {
        value = next;
        index += 1;
      }
    }
    if (value === 'true') value = true;
    if (value === 'false') value = false;
    if (numeric.has(rawKey) && typeof value !== 'boolean') value = Number(value);
    options[key] = value;
  }
  return options;
}

async function main() {
  const argv = process.argv.slice(2);
  const [rawCommand, ...rest] = argv;
  const command = rawCommand === 'relay' ? `relay-${rest.shift() ?? ''}` : rawCommand;
  const options = parseArgs(rest);
  if (!command || command === 'help' || command === '--help') {
    console.log(`nna — network-native-agent v0

Commands:
  init [--habitat dir] [--credits N] [--ttl N] [--force]
  relay attach <remote-url> [--branch name] [--habitat dir]
  relay status [--habitat dir]
  relay ls <remote-url> [--habitat dir]
  sync [--push] [--strategy reject|prefer-local|prefer-remote] [--habitat dir]
  restore <target-dir> [--no-identity] [--habitat dir]
  weather [--count N] [--batch name] [--habitat dir]
  inject <text> [--source name] [--wake] [--cognition name] [--habitat dir]
  wake [--resurrect] [--credits N] [--cognition name] [--habitat dir]
  status [--json] [--habitat dir]
  metrics [--json] [--habitat dir]
  trace [--last N] [--json] [--habitat dir]
  replay [--materialize] [--json] [--habitat dir]
  die [--reason text] [--json] [--habitat dir]
  resurrect [--wake] [--credits N] [--json] [--habitat dir]
  fork <child-dir> [--habitat dir]
  fork-observer <child-dir> [--habitat dir]
  serve [--port N] [--habitat dir] [--lan] [--token text] [--cidr a.b.0.0/16]
  identity [--json] [--habitat dir]
  cognition [--json] [--habitat dir]

Default habitat: ./habitat`);
    return;
  }
  const habitat = options.habitat ?? './habitat';
  switch (command) {
    case 'init': {
      const result = await initHabitat(habitat, {
        credits: options.credits ?? 12,
        ttl: options.ttl ?? 3600,
        force: Boolean(options.force),
        remoteUrl: options.remoteUrl,
        branch: options.branch,
      });
      output({ status: 'genesis', habitat: result.habitat, agentId: result.identity.agentId, genesisId: result.genesis.id, publicKeyFingerprint: result.identity.publicKeyFingerprint }, options.json);
      break;
    }
    case 'relay-attach': {
      const remoteUrl = options._[0];
      if (!remoteUrl) throw new Error('relay attach requires <remote-url>');
      output({ status: 'relay_attached', ...await attachRelay(habitat, remoteUrl, { branch: options.branch, push: options.push !== false }) }, options.json);
      break;
    }
    case 'relay-status': {
      output(await relayStatus(habitat), options.json);
      break;
    }
    case 'relay-ls': {
      const remoteUrl = options._[0];
      if (!remoteUrl) throw new Error('relay ls requires <remote-url>');
      output({ status: 'relay_branches', ...await listRelays(remoteUrl) }, options.json);
      break;
    }
    case 'sync': {
      output({ status: 'synced', ...await syncHabitat(habitat, { push: options.push !== false, strategy: options.strategy ?? 'reject' }) }, options.json);
      break;
    }
    case 'restore': {
      const target = options._[0];
      if (!target) throw new Error('restore requires <target-dir>');
      output({ status: 'restored', ...await restoreHabitat(habitat, target, { identityKey: options.noIdentity !== true }) }, options.json);
      break;
    }
    case 'weather': {
      output({ status: 'weather', ...await weather(habitat, options.count ?? 6, { batch: options.batch ?? 'default' }) }, options.json);
      break;
    }
    case 'inject': {
      const text = options._.join(' ');
      if (!text) throw new Error('inject requires <text>');
      const event = await injectPerception(habitat, text, { source: options.source ?? 'relay' });
      let result = { status: 'perception', id: event.id, seq: event.seq };
      if (options.wake) {
        const waking = await wake(habitat, { credits: options.credits, cognition: options.cognition });
        result = { ...result, wake: { alive: waking.alive, bodyId: waking.bodyId, events: waking.appended.length } };
      }
      output(result, options.json);
      break;
    }
    case 'wake': {
      const result = await wake(habitat, { resurrect: Boolean(options.resurrect), credits: options.credits, cognition: options.cognition });
      output({ status: result.alive ? 'awake' : 'dead', bodyId: result.bodyId, reason: result.reason, events: result.appended.length, agentId: result.state.agentId, credits: result.state.credits, pulses: result.state.pulses }, options.json);
      break;
    }
    case 'status': {
      output(await getStatus(habitat), options.json);
      break;
    }
    case 'metrics': {
      output(await getMetrics(habitat), options.json);
      break;
    }
    case 'trace': {
      const trace = await getTrace(habitat, options.last ?? 20);
      output(trace, options.json);
      break;
    }
    case 'replay': {
      output(await replay(habitat, { materialize: options.materialize !== false }), options.json);
      break;
    }
    case 'die': {
      const result = await markDeath(habitat, options.reason ?? 'experiment');
      output({ status: result.changed ? 'death' : 'already_dead', reason: result.state.deathReason, deaths: result.state.deaths }, options.json);
      break;
    }
    case 'resurrect': {
      const result = await resurrect(habitat, { credits: options.credits, wake: Boolean(options.wake), cognition: options.cognition });
      const finalState = result.waking?.state ?? result.state;
      output({ status: 'resurrection', alive: finalState.alive, credits: finalState.credits, resurrections: finalState.resurrections, wake: result.waking ? { bodyId: result.waking.bodyId, events: result.waking.appended.length } : null }, options.json);
      break;
    }
    case 'fork': {
      const child = options._[0];
      if (!child) throw new Error('fork requires <child-dir>');
      output({ status: 'fork', ...await forkHabitat(habitat, child, { cognition: options.cognition }) }, options.json);
      break;
    }
    case 'fork-observer': {
      const child = options._[0];
      if (!child) throw new Error('fork-observer requires <child-dir>');
      output({ status: 'observer_lineage_fork', ...await forkObserverHabitat(habitat, child) }, options.json);
      break;
    }
    case 'identity': {
      output(await getIdentity(habitat), options.json);
      break;
    }
    case 'cognition': {
      output(await describeCognitionAdapter(options.cognition), options.json);
      break;
    }
    case 'serve': {
      await serve(habitat, options.port ?? 8787, {
        lan: Boolean(options.lan),
        token: typeof options.token === 'string' ? options.token : null,
        cidrs: options.cidr ? String(options.cidr).split(',') : DEFAULT_LAN_CIDRS,
      });
      break;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

async function serve(habitat, port, options = {}) {
  const status = await getStatus(habitat).catch(() => null);
  const lan = Boolean(options.lan);
  const token = options.token ?? process.env.NNA_LAN_TOKEN ?? null;
  const cidrs = parseCidrs(options.cidrs);
  if (lan && !token) {
    throw new Error('--lan requires --token or NNA_LAN_TOKEN');
  }
  const host = lan ? '0.0.0.0' : '127.0.0.1';
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const send = (code, value) => {
      response.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(value, null, 2));
    };
    try {
      const remoteIp = request.socket.remoteAddress ?? '';
      if (!isIpAllowed(remoteIp, cidrs)) {
        send(403, { error: 'network not allowed', source: redactIp(remoteIp) });
        return;
      }
      if (lan && url.pathname !== '/health' && !tokenMatches(tokenFromHeaders(request.headers), token)) {
        send(401, { error: 'token required' });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/') {
        send(200, {
          name: 'network-native-agent habitat',
          version: 0.1,
          mode: lan ? 'lan' : 'loopback',
          agentId: status?.agentId ?? null,
          tokenFingerprint: lan ? tokenFingerprint(token) : null,
          allowedNetworks: lan ? cidrs.map((cidr) => cidr.cidr) : [],
          endpoints: ['/health', '/identity', '/status', '/trace?last=N', 'POST /event', 'POST /wake', 'POST /death', 'POST /resurrect'],
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/health') {
        send(200, await getStatus(habitat));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/identity') {
        send(200, await getIdentity(habitat));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/status') {
        send(200, await getStatus(habitat));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/trace') {
        send(200, await getTrace(habitat, Number(url.searchParams.get('last') ?? 20)));
        return;
      }
      if (request.method === 'POST' && ['/event', '/wake', '/death', '/resurrect'].includes(url.pathname)) {
        const body = await readJsonBody(request);
        if (url.pathname === '/event') {
          const text = typeof body.text === 'string' ? body.text : '';
          if (!text) {
            send(400, { error: 'text is required' });
            return;
          }
          const event = await injectPerception(habitat, text, { source: body.source ?? 'relay', metadata: body.metadata ?? {} });
          const waking = body.wake !== false ? await wake(habitat) : null;
          send(200, { eventId: event.id, seq: event.seq, wake: waking ? { bodyId: waking.bodyId, alive: waking.alive, events: waking.appended.length } : null });
          return;
        }
        if (url.pathname === '/wake') {
          const result = await wake(habitat, { resurrect: Boolean(body.resurrect), credits: body.credits });
          send(200, { bodyId: result.bodyId, alive: result.alive, reason: result.reason, events: result.appended.length });
          return;
        }
        if (url.pathname === '/death') {
          const result = await markDeath(habitat, body.reason ?? 'http');
          send(200, { changed: result.changed, reason: result.state.deathReason, deaths: result.state.deaths });
          return;
        }
        const result = await resurrect(habitat, { credits: body.credits });
        send(200, { changed: result.changed, alive: result.state.alive, credits: result.state.credits });
        return;
      }
      send(404, { error: 'not found' });
    } catch (error) {
      send(500, { error: error.message });
    }
  });
  server.listen(port, host, () => {
    console.log(`nna habitat listening on http://${host}:${port}`);
    if (lan) console.log(`LAN mode · tokenFingerprint=${tokenFingerprint(token)} · cidrs=${cidrs.length}`);
    console.log(`agentId: ${status?.agentId ?? 'run init first'}`);
  });
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new Error('request body too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  return JSON.parse(text);
}

main().catch((error) => fail(error.message));
