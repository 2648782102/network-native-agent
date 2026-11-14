#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const repositoryUrl = packageJson.repository?.url ?? '';
const owner = /github\.com[/:]([^/]+)\//.exec(repositoryUrl)?.[1] ?? null;
const allowedMetadata = new Set(['package.json']);

const forbidden = [
  ...(owner ? [{ name: 'personal github account outside project metadata', pattern: new RegExp(owner) }] : []),
  { name: 'internal relay repository name', pattern: /nna-relay-[a-z0-9]+(?:-[a-z0-9]+)+/i },
  { name: 'internal vendor namespace', pattern: /(?:^|[^a-z0-9_-])vendor\/[a-z0-9]/i },
  { name: 'local absolute user path', pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { name: 'hardcoded local model endpoint', pattern: /127\.0\.0\.1:\d{2,5}\/v1\// },
  { name: 'github token', pattern: /github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}/ },
  { name: 'openai-like key', pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'private key block', pattern: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/ },
  { name: 'bearer credential', pattern: /Authorization:\s*Bearer\s+(?!PUBLIC_TEST_TOKEN)[A-Za-z0-9._-]{16,}/ },
];

async function main() {
  const { stdout: files } = await execFileAsync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  const scanned = files.trim().split('\n').filter(Boolean).sort();
  const findings = [];
  for (const file of scanned) {
    let text;
    try {
      text = await readFile(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      for (const rule of forbidden) {
        if (rule.pattern.test(line) && !(rule.name.startsWith('personal github account') && allowedMetadata.has(file))) {
          findings.push({ file, line: index + 1, rule: rule.name });
        }
      }
    });
  }
  const result = {
    valid: findings.length === 0,
    scannedFiles: scanned.length,
    findings,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`nna public-audit: ${error.message}`);
  process.exitCode = 1;
});
