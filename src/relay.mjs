import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { habitatPaths } from './events.mjs';

const execFileAsync = promisify(execFile);

export const EVENT_RELAY_FILE = 'events.ndjson';
export const DEFAULT_RELAY_BRANCH_PREFIX = 'nna-events';

function assertRemoteUrl(remoteUrl) {
  if (typeof remoteUrl !== 'string' || remoteUrl.trim().length === 0) {
    throw new Error('relay remote URL is required');
  }
  const value = remoteUrl.trim();
  const isGitHubRemote = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)/.test(value);
  const isLocalTestRemote = value.startsWith('/') || value.startsWith('file://');
  if (!isGitHubRemote && !isLocalTestRemote) {
    throw new Error('relay remote must be a GitHub HTTPS or SSH URL');
  }
  return value;
}

function branchFor(agentId) {
  const safe = String(agentId).replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${DEFAULT_RELAY_BRANCH_PREFIX}/${safe}`;
}

export function relayConfig(habitat, options = {}) {
  const paths = habitatPaths(habitat);
  const configPath = path.join(paths.root, 'relay.json');
  const merged = {
    version: 1,
    remoteUrl: options.remoteUrl ?? null,
    branch: options.branch ?? null,
    agentId: options.agentId ?? null,
  };
  return { paths, configPath, config: merged };
}

export async function readRelayConfig(habitat) {
  const { configPath } = relayConfig(habitat);
  try {
    return JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`relay.json is invalid: ${error.message}`);
  }
}

export async function writeRelayConfig(habitat, options) {
  const { configPath, paths } = relayConfig(habitat, options);
  await mkdir(paths.root, { recursive: true });
  const config = {
    version: 1,
    remoteUrl: assertRemoteUrl(options.remoteUrl),
    branch: options.branch ?? (options.agentId ? branchFor(options.agentId) : DEFAULT_RELAY_BRANCH_PREFIX),
    agentId: options.agentId ?? null,
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

async function git(args, options = {}) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '/bin/echo',
      GIT_CONFIG_NOSYSTEM: '1',
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

function parseEvents(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function readRelayEvents(config, options = {}) {
  const work = await mkdirTemp();
  try {
    await git(['init', '--quiet'], { cwd: work });
    await git(['remote', 'add', 'origin', assertRemoteUrl(config.remoteUrl)], { cwd: work });
    const ref = `refs/heads/${config.branch}`;
    await git(['fetch', '--quiet', '--depth=1', 'origin', `${ref}:${ref}`], { cwd: work });
    const text = await git(['show', `${ref}:${EVENT_RELAY_FILE}`], { cwd: work });
    return parseEvents(text);
  } catch (error) {
    if (/couldn't find remote ref|not found|does not exist|path .* does not exist|bad revision|unknown revision/i.test(error.message)) {
      return [];
    }
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function listRelayBranches(remoteUrl) {
  const work = await mkdirTemp();
  try {
    await git(['init', '--quiet'], { cwd: work });
    await git(['remote', 'add', 'origin', assertRemoteUrl(remoteUrl)], { cwd: work });
    const stdout = await git(['ls-remote', '--heads', 'origin', `refs/heads/${DEFAULT_RELAY_BRANCH_PREFIX}/*`], { cwd: work });
    return stdout
      .split('\n')
      .map((line) => line.trim().split('\t').at(-1))
      .filter((ref) => ref?.startsWith('refs/heads/'))
      .map((ref) => ref.replace('refs/heads/', ''))
      .sort();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function writeRelayEvents(config, events) {
  const remoteUrl = assertRemoteUrl(config.remoteUrl);
  const branch = config.branch;
  const work = await mkdirTemp();
  try {
    await git(['init', '--quiet'], { cwd: work });
    await git(['remote', 'add', 'origin', remoteUrl], { cwd: work });
    const ref = `refs/heads/${branch}`;
    await git(['fetch', '--quiet', '--depth=1', 'origin', `${ref}:refs/remotes/origin/${branch}`], { cwd: work }).catch(() => {});
    const hasBranch = await git(['rev-parse', '--verify', '--quiet', ref], { cwd: work }).catch(() => '');
    if (hasBranch) {
      await git(['checkout', '--quiet', '-B', branch, ref], { cwd: work });
    } else {
      await git(['checkout', '--quiet', '--orphan', branch], { cwd: work });
      await git(['rm', '--quiet', '-rf', '--cached', '.'], { cwd: work }).catch(() => {});
    }
    await writeFile(path.join(work, EVENT_RELAY_FILE), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
    await writeFile(path.join(work, 'README.md'), `# network-native-agent event relay\n\nBranch: \`${branch}\`\n\nThis branch contains only the signed append-only event log. Do not edit it by hand.\n`, 'utf8');
    await git(['add', EVENT_RELAY_FILE, 'README.md'], { cwd: work });
    const changed = await git(['status', '--porcelain'], { cwd: work });
    if (changed) {
      await git(['-c', 'user.name=network-native-agent', '-c', 'user.email=nna@local.invalid', 'commit', '--quiet', '-m', `nna: ${events.length} signed events`], { cwd: work });
    }
    const remoteHead = await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { cwd: work }).catch(() => '');
    const pushArgs = remoteHead
      ? ['push', '--quiet', `--force-with-lease=${ref}:${remoteHead}`, 'origin', `${branch}:${branch}`]
      : ['push', '--quiet', '--force-with-lease', 'origin', `${branch}:${branch}`];
    await git(pushArgs, { cwd: work });
    return { branch, eventCount: events.length, remoteUrl: sanitizeRemoteUrl(remoteUrl) };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function sanitizeRemoteUrl(remoteUrl) {
  if (remoteUrl.startsWith('/') || remoteUrl.startsWith('file://')) return '<local-git-test-remote>';
  return remoteUrl.replace(/\/\/[^@/]+@/, '//<redacted>@');
}

async function mkdirTemp() {
  return mkdtemp(path.join(os.tmpdir(), 'nna-relay-'));
}

async function mkdtemp(prefix) {
  const { mkdtemp: make } = await import('node:fs/promises');
  return make(prefix);
}
