#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { experimentTasks } from './experiment-tasks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const labels = ['echo', 'trace', 'migrate', 'sleep'];

const rulesets = {
  a: [
    [/\b(echo|repeat|duplicate)\b/, 'echo'],
    [/\b(trace|record|remember|memory)\b/, 'trace'],
    [/\b(migrate|relocate|mobility|unstable)\b/, 'migrate'],
    [/\b(sleep|rest|quiet|calm|inactive)\b/, 'sleep'],
  ],
  b: [
    [/\b(sleep|rest|quiet|calm|inactive|conserve)\b/, 'sleep'],
    [/\b(migrate|relocate|mobility|unstable|closing)\b/, 'migrate'],
    [/\b(echo|repeat|duplicate|same)\b/, 'echo'],
    [/\b(trace|record|remember|memory|ambiguous)\b/, 'trace'],
  ],
};

function labelWith(text, rules, fallback) {
  const normalized = String(text).toLowerCase();
  for (const [pattern, label] of rules) {
    if (pattern.test(normalized)) return label;
  }
  return fallback;
}

async function main() {
  const annotations = [];
  for (const task of experimentTasks) {
    for (const annotator of ['sim-a', 'sim-b']) {
      const fallback = labels[(task.id.length + (annotator === 'sim-b' ? 1 : 0)) % labels.length];
      annotations.push({
        annotator,
        taskId: task.id,
        label: labelWith(task.text, rulesets[annotator === 'sim-a' ? 'a' : 'b'], fallback),
        simulated: true,
      });
    }
  }
  const target = path.resolve(root, 'evidence/annotation/simulated-annotations.json');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(annotations, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, target: path.relative(root, target), annotations: annotations.length, note: 'Simulated labels validate tooling only; they are not human ground truth.' }, null, 2));
}

main().catch((error) => {
  console.error(`nna annotation-simulate: ${error.message}`);
  process.exitCode = 1;
});
