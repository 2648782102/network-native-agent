#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repositoryRoot, 'bin', 'nna.mjs');
const defaultReportPath = path.join(repositoryRoot, 'work', 'l3-relay-report.json');

const gitEnvironment = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '/bin/echo',
  GIT_CONFIG_NOSYSTEM: '1',
};

const nnaEnvironment = {
  ...gitEnvironment,
  NNA_COGNITION: 'deterministic',
};

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      options._.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    const value = inlineValue ?? (next && !next.startsWith('--') ? (index += 1, next) : true);
    options[key] = value === 'true' ? true : value === 'false' ? false : value;
  }
  return options;
}

function parseGitHubRemote(remoteUrl) {
  const value = String(remoteUrl ?? '').trim();
  let owner = null;
  let repo = null;
  const sshMatch = value.match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?$/);
  const httpsMatch = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    owner = sshMatch[1];
    repo = sshMatch[2];
  } else if (httpsMatch) {
    owner = httpsMatch[1];
    repo = httpsMatch[2];
  } else {
    throw new Error('relay remote must be a GitHub HTTPS or SSH URL');
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('relay remote contains an invalid owner or repository name');
  }
  return { owner, repo, fullName: `${owner}/${repo}` };
}

async function runExecutable(command, args, options = {}) {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: { ...process.env, ...options.env },
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

async function runGit(args, cwd = repositoryRoot) {
  return runExecutable('git', args, { cwd, env: gitEnvironment });
}

async function runGh(args) {
  return runExecutable('gh', args, { env: gitEnvironment });
}

async function runNna(args) {
  const stdout = await runExecutable(process.execPath, [cli, ...args, '--json'], {
    cwd: repositoryRoot,
    env: nnaEnvironment,
  });
  return JSON.parse(stdout);
}

async function ghAvailable() {
  try {
    await runGh(['--version']);
    return true;
  } catch {
    return false;
  }
}

async function assertRemoteIsPrivate(fullName) {
  if (await ghAvailable()) {
    const raw = await runGh(['api', `repos/${fullName}`, '--jq', '{full_name,private,visibility,default_branch,html_url}']);
    const repo = JSON.parse(raw);
    if (repo.full_name !== fullName) {
      throw new Error(`GitHub repository identity mismatch: expected ${fullName}, got ${repo.full_name}`);
    }
    if (repo.private !== true && repo.visibility !== 'private') {
      throw new Error(`refusing L3 experiment: ${fullName} is not private`);
    }
    return { ...repo, verification: 'github-cli' };
  }
  const attestationText = process.env.NNA_L3_REPO_ATTESTATION?.trim();
  if (!attestationText) {
    throw new Error('GitHub CLI gh is unavailable; set NNA_L3_REPO_ATTESTATION to the verified repository JSON from an authenticated GitHub client');
  }
  let attestation;
  try {
    attestation = JSON.parse(attestationText);
  } catch {
    throw new Error('NNA_L3_REPO_ATTESTATION must be valid JSON');
  }
  const attestedName = attestation.full_name ?? attestation.repository_full_name;
  if (attestedName !== fullName) {
    throw new Error(`attestation identity mismatch: expected ${fullName}, got ${attestedName}`);
  }
  if (attestation.private !== true && attestation.visibility !== 'private') {
    throw new Error(`refusing L3 experiment: ${fullName} attestation does not confirm a private repository`);
  }
  return {
    full_name: fullName,
    private: true,
    visibility: 'private',
    default_branch: attestation.default_branch ?? 'main',
    html_url: attestation.html_url ?? `https://github.com/${fullName}`,
    verification: 'external-attestation',
  };
}

async function isEmptyRemote(remoteUrl) {
  const refs = await runGit(['ls-remote', '--heads', remoteUrl]);
  return refs.trim().length === 0;
}

async function assertNoForbiddenRelayPaths(remoteUrl) {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-l3-audit-'));
  try {
    await runGit(['init', '--quiet'], work);
    await runGit(['remote', 'add', 'origin', remoteUrl], work);
    try {
      await runGit(['fetch', '--quiet', '--depth=1', 'origin', 'HEAD'], work);
    } catch (error) {
      if (await isEmptyRemote(remoteUrl)) {
        return { emptyRepository: true, defaultBranchFileCount: 0, forbidden: [] };
      }
      throw error;
    }
    const tree = await runGit(['ls-tree', '-r', '--name-only', 'FETCH_HEAD'], work);
    const files = tree.split('\n').map((line) => line.trim()).filter(Boolean);
    const forbidden = files.filter((name) => /^habitat\//.test(name)
      || /(^|\/)(identity\.key|relay\.json|events\.ndjson|habitat\.lock)$/.test(name)
      || /(^|\/)outbox\//.test(name)
      || /\.env(\.|$)/.test(name)
      || /\.(key|pem)$/.test(name));
    if (forbidden.length > 0) {
      throw new Error(`relay default branch contains forbidden runtime paths: ${forbidden.slice(0, 8).join(', ')}`);
    }
    return { defaultBranchFileCount: files.length, forbidden };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function assertEventBranchOnly(remoteUrl, branches, baselineRefs) {
  const refs = await runGit(['ls-remote', '--heads', remoteUrl]);
  const activeRefs = refs.split('\n').map((line) => line.trim().split(/\s+/).at(-1)).filter(Boolean);
  const expectedRefs = new Set(branches.map((branch) => `refs/heads/${branch}`));
  const newRefs = activeRefs.filter((ref) => !baselineRefs.includes(ref));
  const unexpectedRefs = newRefs.filter((ref) => !expectedRefs.has(ref));
  if (unexpectedRefs.length > 0) {
    throw new Error(`L3 experiment created unexpected remote refs: ${unexpectedRefs.join(', ')}`);
  }
  for (const eventRef of expectedRefs) {
    if (!activeRefs.includes(eventRef)) {
      throw new Error(`expected signed event branch is missing: ${eventRef}`);
    }
  }

  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-l3-branch-audit-'));
  try {
    await runGit(['init', '--quiet'], work);
    await runGit(['remote', 'add', 'origin', remoteUrl], work);
    const firstEventRef = `refs/heads/${branches[0]}`;
    await runGit(['fetch', '--quiet', '--depth=1', 'origin', `${firstEventRef}:${firstEventRef}`], work);
    const tree = await runGit(['ls-tree', '-r', '--name-only', firstEventRef], work);
    const files = tree.split('\n').map((line) => line.trim()).filter(Boolean);
    const unexpectedFiles = files.filter((name) => !['events.ndjson', 'README.md'].includes(name));
    if (unexpectedFiles.length > 0) {
      throw new Error(`signed event branch contains unexpected files: ${unexpectedFiles.slice(0, 8).join(', ')}`);
    }
    const eventsText = await runGit(['show', `${firstEventRef}:events.ndjson`], work);
    const events = eventsText.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
    if (events.length === 0 || events[0].type !== 'genesis') {
      throw new Error('remote event branch does not begin with a genesis event');
    }
    const serialized = JSON.stringify(events);
    if (/test-only-cognition-key|NNA_MODEL_API_KEY|Authorization\s*:|Bearer\s+/i.test(serialized)) {
      throw new Error('remote event branch appears to contain credential-like text');
    }
    return { files, eventCount: events.length, genesisId: events[0].id, expectedRefs: [...expectedRefs] };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function assertHabitatNeverCommitted(remoteUrl, branches) {
  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-l3-history-audit-'));
  try {
    await runGit(['init', '--quiet'], work);
    await runGit(['remote', 'add', 'origin', remoteUrl], work);
    for (const branch of branches) {
      await runGit(['fetch', '--quiet', 'origin', `refs/heads/${branch}:refs/remotes/origin/${branch}`], work);
    }
    const names = await runGit(['log', '--all', '--pretty=format:', '--name-only'], work);
    const files = [...new Set(names.split('\n').map((line) => line.trim()).filter(Boolean))];
    const forbidden = files.filter((name) => !['events.ndjson', 'README.md'].includes(name)
      || /(^|\/)(identity\.key|relay\.json)$/.test(name));
    if (forbidden.length > 0) {
      throw new Error(`event branch history contains unexpected files: ${forbidden.slice(0, 8).join(', ')}`);
    }
    return { committedPaths: files.sort(), forbidden, branches };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function findSecretLikeText(directories) {
  const files = [];
  for (const habitat of directories) {
    for (const name of ['events.ndjson', 'genesis.json', 'relay.json']) {
      files.push(path.join(habitat, name));
    }
    const outbox = path.join(habitat, 'outbox');
    const entries = await readdir(outbox, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) files.push(path.join(outbox, entry.name));
    }
  }
  const pattern = /test-only-cognition-key|NNA_MODEL_API_KEY|Authorization\s*:|Bearer\s+/i;
  const leaks = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (text && pattern.test(text)) leaks.push(path.relative(repositoryRoot, file));
  }
  return leaks;
}

async function preflight(options) {
  const remoteUrl = options.remote ?? options._[0];
  if (!remoteUrl) throw new Error('preflight requires <remote-url> or --remote <remote-url>');
  const parsed = parseGitHubRemote(remoteUrl);
  const repo = await assertRemoteIsPrivate(parsed.fullName);
  const defaults = await assertNoForbiddenRelayPaths(remoteUrl);
  const refs = await runGit(['ls-remote', '--heads', remoteUrl]);
  const baselineRefs = refs.split('\n').map((line) => line.trim().split(/\s+/).at(-1)).filter(Boolean);
  const sshMatches = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)/.test(remoteUrl);
  const report = {
    valid: true,
    phase: 'L3-preflight',
    remoteUrl: sshMatches ? remoteUrl : '<https-redacted>',
    repository: repo,
    defaultBranchAudit: defaults,
    baselineRefs,
    checks: {
      privateRepository: repo.private === true,
      githubRemoteAccepted: true,
      noRuntimePathsOnDefaultBranch: defaults.forbidden.length === 0,
      baselineRefsUseNnaEventsNamespace: baselineRefs.every((ref) => ref.startsWith('refs/heads/nna-events/')),
    },
    gate: 'run experiment only after reading and approving this preflight report',
  };
  report.valid = Object.values(report.checks).every(Boolean);
  await writeReport(options.report ?? defaultReportPath, report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.valid) process.exitCode = 1;
}

async function writeReport(reportPath, report) {
  const target = path.resolve(repositoryRoot, reportPath);
  await import('node:fs/promises').then(({ mkdir }) => mkdir(path.dirname(target), { recursive: true }));
  report.reportPath = path.relative(repositoryRoot, target);
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report.reportPath;
}

export { writeReport as writeReportForTest };

async function experiment(options) {
  const remoteUrl = options.remote ?? options._[0];
  if (!remoteUrl) throw new Error('experiment requires <remote-url> or --remote <remote-url>');
  const parsed = parseGitHubRemote(remoteUrl);
  if (options.yes !== true) {
    throw new Error('L3 experiment writes a signed event branch to GitHub; pass --yes after approving preflight');
  }
  if (!process.env.NNA_L3_PREFLIGHT_APPROVED) {
    throw new Error('L3 experiment requires NNA_L3_PREFLIGHT_APPROVED=1 after reading the preflight report');
  }
  const repo = await assertRemoteIsPrivate(parsed.fullName);
  await assertNoForbiddenRelayPaths(remoteUrl);
  const baselineRefsRaw = await runGit(['ls-remote', '--heads', remoteUrl]);
  const baselineRefs = baselineRefsRaw.split('\n').map((line) => line.trim().split(/\s+/).at(-1)).filter(Boolean);
  const unexpectedBaseline = baselineRefs.filter((ref) => !ref.startsWith('refs/heads/nna-events/'));
  if (unexpectedBaseline.length > 0) {
    throw new Error(`refusing to write because relay has non-nna branch refs: ${unexpectedBaseline.join(', ')}`);
  }

  const work = await mkdtemp(path.join(os.tmpdir(), 'nna-l3-experiment-'));
  const bodyA = path.join(work, 'body-a');
  const recoveryAnchor = path.join(work, 'recovery-anchor');
  const bodyB = path.join(work, 'body-b');
  const forkBody = path.join(work, 'fork-body');
  const startedAt = new Date().toISOString();
  let report = null;
  try {
    const genesis = await runNna(['init', '--habitat', bodyA, '--credits', '10', '--remote-url', remoteUrl]);
    const relay = await runNna(['relay', 'status', '--habitat', bodyA]);
    const initialRelay = await runNna(['relay', 'ls', remoteUrl]);
    await runNna(['weather', '--count', '4', '--batch', 'l3-private-relay', '--habitat', bodyA]);
    await runNna(['wake', '--cognition', 'deterministic', '--habitat', bodyA]);
    await runNna(['sync', '--habitat', bodyA]);
    const beforeDeath = await runNna(['status', '--habitat', bodyA]);

    const death = await runNna(['die', '--reason', 'l3-private-relay-body-death', '--habitat', bodyA]);
    const syncAfterDeath = await runNna(['sync', '--habitat', bodyA]);
    const anchorGenesis = await runNna(['init', '--habitat', recoveryAnchor, '--credits', '10']);
    await runNna(['relay', 'attach', remoteUrl, '--branch', relay.branch, '--push=false', '--habitat', recoveryAnchor])
      .catch((error) => {
        if (!/different genesis/i.test(String(error.stderr ?? error))) throw error;
      });
    await rm(bodyA, { recursive: true, force: true });

    const restored = await runNna(['restore', bodyB, '--no-identity', '--habitat', recoveryAnchor]);
    const restoredStatus = await runNna(['status', '--habitat', bodyB]);
    const observerReplay = await runNna(['replay', '--habitat', bodyB]);
    const observerMetrics = await runNna(['metrics', '--habitat', bodyB]);
    const fork = await runNna(['fork-observer', forkBody, '--habitat', bodyB]);
    const forkStatus = await runNna(['status', '--habitat', forkBody]);
    const forkReplay = await runNna(['replay', '--habitat', forkBody]);
    const finalRelayList = await runNna(['relay', 'ls', remoteUrl]);
    const forkRelayBranch = `nna-events/${fork.childAgentId}`;
    const forkRelayList = await runNna(['relay', 'ls', remoteUrl]);
    const branchAudit = await assertEventBranchOnly(remoteUrl, [relay.branch], baselineRefs);
    const historyAudit = await assertHabitatNeverCommitted(remoteUrl, [relay.branch]);
    const leaks = await findSecretLikeText([bodyB, forkBody, recoveryAnchor]);

    const valid = genesis.agentId === restoredStatus.agentId
      && genesis.agentId === restoredStatus.agentId
      && anchorGenesis.agentId !== genesis.agentId
      && restored.identityKeyCopied === false
      && observerReplay.valid === true
      && observerMetrics.identityContinuity === true
      && fork.childAgentId !== genesis.agentId
      && forkStatus.agentId === fork.childAgentId
      && forkStatus.lineage?.parentAgentId === genesis.agentId
      && forkReplay.valid === true
      && finalRelayList.summaries.some((entry) => entry.branch === relay.branch && entry.valid === true)
      && !finalRelayList.summaries.some((entry) => entry.branch === forkRelayBranch)
      && death.status === 'death'
      && restoredStatus.alive === false
      && observerMetrics.eventCount === branchAudit.eventCount
      && historyAudit.forbidden.length === 0
      && leaks.length === 0
      && branchAudit.files.every((name) => ['events.ndjson', 'README.md'].includes(name));

    report = {
      valid,
      phase: 'L3-experiment',
      startedAt,
      finishedAt: new Date().toISOString(),
      repository: repo,
      remoteUrl: /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)/.test(remoteUrl) ? remoteUrl : '<https-redacted>',
      branch: relay.branch,
      experiment: {
        genesisAgentId: genesis.agentId,
        restoredAgentId: restoredStatus.agentId,
        deathRecorded: death.status,
        deathReason: restoredStatus.deathReason,
        eventsAtSync: syncAfterDeath.mergedEventCount,
        bodyADestroyedWithIdentityKey: true,
        recoveryAnchorAgentId: anchorGenesis.agentId,
        observerRestoredTo: bodyB,
        restoreSource: 'remote signed event branch',
        observerRestoreResult: restored,
        restoredObserverHasIdentityKey: restored.identityKeyCopied,
        observerReplayValid: observerReplay.valid,
        observerIdentityContinuity: observerMetrics.identityContinuity,
        originalBodyCount: beforeDeath.bodyCount,
        originalAgentDiedWithoutResurrection: true,
        lineFork: {
          childAgentId: fork.childAgentId,
          childHabitat: forkBody,
          childStatusAgentId: forkStatus.agentId,
          parentAgentIdInLineage: forkStatus.lineage?.parentAgentId ?? null,
          replayValid: forkReplay.valid,
          remoteBranchExpectedAbsent: forkRelayBranch,
        },
        observerDriftDistance: observerMetrics.driftDistance,
        observerPollution: observerMetrics.observerPollution,
        finalRelayEventCount: branchAudit.eventCount,
      },
      audits: {
        initialRelay,
        finalRelayList,
        forkRelayList,
        branchAudit,
        historyAudit,
        credentialLikeTextInHabitat: leaks,
        baselineRefs,
      },
      boundaries: {
        publicInternet: false,
        thirdPartySystems: false,
        realModelApiKey: false,
        repositoryPrivate: true,
        eventBranchOnly: true,
        defaultBranchUntouched: true,
      },
      conclusion: valid
        ? 'A private GitHub remote carried signed event history across destruction of body A; a read-only observer restored the same identity, and a new lineage fork continued locally. The original identity did not resurrect without its key. This is L3, not open-web life.'
        : 'L3 experiment failed; inspect report and do not claim success.',
    };
    await writeReport(options.report ?? defaultReportPath, report);
    console.log(JSON.stringify(report, null, 2));
    if (!valid) process.exitCode = 1;
  } catch (error) {
    const failure = {
      valid: false,
      phase: 'L3-experiment',
      startedAt,
      failedAt: new Date().toISOString(),
      repository: repo,
      error: error.message,
      remoteUrl: /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)/.test(remoteUrl) ? remoteUrl : '<https-redacted>',
    };
    await writeReport(options.report ?? defaultReportPath, failure).catch(() => null);
    console.log(JSON.stringify(failure, null, 2));
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function printHelp() {
  console.log(`nna L3 relay experiment — private GitHub event relay only

Commands:
  preflight <remote-url> [--report path]
  experiment <remote-url> --yes [--report path]

Preflight checks that gh is authenticated, the repository is Private, the default branch has no runtime secrets,
and records existing nna-events refs. It does not write.

When gh is unavailable, set NNA_L3_REPO_ATTESTATION to verified repository JSON from the connected GitHub API
client. Experiment also requires NNA_L3_PREFLIGHT_APPROVED=1 after the preflight report has been read.

Experiment writes one nna-events/<agentId> branch containing only events.ndjson and README.md, then destroys
body A with its identity key. A new read-only observer restores the same signed history; a new lineage fork
continues locally. It verifies identity continuity, replay, fork lineage, signed history, and secret boundaries.
It does not resurrect the original identity without its key, touch the default branch, use public internet
endpoints, third-party systems, or real model keys.

Example:
  node scripts/l3-relay.mjs preflight git@github.com:OWNER/PRIVATE_RELAY.git
  NNA_L3_PREFLIGHT_APPROVED=1 node scripts/l3-relay.mjs experiment git@github.com:OWNER/PRIVATE_RELAY.git --yes
`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);
  switch (command) {
    case 'preflight':
      await preflight(options);
      break;
    case 'experiment':
      await experiment(options);
      break;
    case 'help':
    case '--help':
    case undefined:
      printHelp();
      break;
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`nna l3-relay: ${error.message}`);
    process.exitCode = 1;
  });
}
