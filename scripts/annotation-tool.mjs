#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { auditLabelRisk, buildAgreementReport, buildBlindSheet } from '../src/annotation.mjs';
import { experimentTasks } from './experiment-tasks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function writeJson(relativePath, value) {
  const target = path.resolve(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path.relative(root, target);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'sheet') {
    const target = await writeJson(args[0] ?? 'work/annotation/blind-sheet.json', buildBlindSheet(experimentTasks));
    console.log(JSON.stringify({ ok: true, command: 'sheet', target, items: experimentTasks.length }, null, 2));
    return;
  }
  if (command === 'audit') {
    const target = await writeJson(args[0] ?? 'work/annotation/label-risk.json', auditLabelRisk(experimentTasks));
    console.log(JSON.stringify({ ok: true, command: 'audit', target }, null, 2));
    return;
  }
  if (command === 'agree') {
    const source = args[0] ?? 'work/annotation/annotations.json';
    const annotations = JSON.parse(await readFile(path.resolve(root, source), 'utf8'));
    const normalized = Array.isArray(annotations) ? annotations : annotations.annotations ?? [];
    const report = buildAgreementReport(normalized, experimentTasks);
    const target = await writeJson(args[1] ?? 'work/annotation/agreement.json', report);
    console.log(JSON.stringify({ ok: true, command: 'agree', target, report }, null, 2));
    return;
  }
  throw new Error('usage: annotation-tool.mjs sheet|audit|agree [args]');
}

main().catch((error) => {
  console.error(`nna annotation: ${error.message}`);
  process.exitCode = 1;
});
