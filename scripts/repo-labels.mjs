#!/usr/bin/env node
import process from 'node:process';

const repository = process.env.NNA_GITHUB_REPOSITORY ?? '';
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

const labels = [
  { name: 'dependencies', color: '0366d6', description: 'Dependency and action version updates' },
  { name: 'npm', color: 'cb3837', description: 'npm manifest or lockfile changes' },
  { name: 'github-actions', color: '2088ff', description: 'GitHub Actions workflow changes' },
  { name: 'bug', color: 'd73a4a', description: 'Reproducible defect' },
  { name: 'question', color: 'd876e3', description: 'Research or protocol question' },
  { name: 'evidence', color: '0e8a16', description: 'Archived data, reports, or figures' },
  { name: 'protocol', color: '5319e7', description: 'Experiment protocol or boundary change' },
];

async function main() {
  if (!token) {
    throw new Error('set GITHUB_TOKEN or GH_TOKEN to a token with issue write access');
  }
  if (!repository) {
    throw new Error('set NNA_GITHUB_REPOSITORY=owner/repo');
  }
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) throw new Error('NNA_GITHUB_REPOSITORY must be owner/repo');

  const results = [];
  for (const label of labels) {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/labels`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify(label),
    });
    if (response.status === 422) {
      const update = await fetch(`https://api.github.com/repos/${owner}/${repo}/labels/${encodeURIComponent(label.name)}`, {
        method: 'PATCH',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({ new_name: label.name, color: label.color, description: label.description }),
      });
      results.push({ name: label.name, action: update.ok ? 'updated' : `failed ${update.status}` });
      continue;
    }
    results.push({ name: label.name, action: response.ok ? 'created' : `failed ${response.status}` });
  }
  console.log(JSON.stringify({ repository, results }, null, 2));
  if (results.some((result) => result.action.startsWith('failed'))) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`nna repo-labels: ${error.message}`);
  process.exitCode = 1;
});
