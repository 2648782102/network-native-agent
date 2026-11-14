#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const endpoint = process.env.NNA_CHART_ENDPOINT ?? 'https://antv-studio.alipay.com/api/gpt-vis';
const outputDir = path.resolve(root, process.env.NNA_FIGURE_DIR ?? 'evidence/figures');

const palette = ['#2563eb', '#f97316', '#0d9488', '#7c3aed'];

async function readJson(relative) {
  return JSON.parse(await readFile(path.join(root, relative), 'utf8'));
}

async function render(spec, name) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...spec, source: 'network-native-agent' }),
  });
  if (!response.ok) throw new Error(`chart render failed: HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.success) throw new Error(`chart render failed: ${payload.errorMessage}`);
  const image = await fetch(payload.resultObj);
  if (!image.ok) throw new Error(`chart download failed: HTTP ${image.status}`);
  const buffer = Buffer.from(await image.arrayBuffer());
  const target = path.join(outputDir, `${name}.png`);
  await writeFile(target, buffer);
  return {
    name,
    file: path.relative(root, target),
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    source: payload.resultObj,
  };
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const stability = await readJson('evidence/model-stability/report.json');
  const baseline = await readJson('evidence/baseline-stability/report.json');
  const formal = await readJson('evidence/formal-experiment/analysis.json');
  const qualification = await readJson('evidence/model-qualification/live-list-quick.json');
  const annotation = await readJson('evidence/annotation/simulated-agreement.json');
  const e2e = await readJson('evidence/model-e2e/report.json');

  const specs = [];

  specs.push({
    name: 'compliance-vs-intent',
    spec: {
      type: 'column',
      data: [
        ...stability.results.map((result) => ({
          category: result.model,
          value: Number(result.summary.complianceRate.toFixed(4)),
          group: '结构化合规率',
        })),
        ...stability.results.map((result) => ({
          category: result.model,
          value: Number(result.summary.intentMatchRate.toFixed(4)),
          group: '意图匹配率',
        })),
      ],
      group: true,
      stack: false,
      theme: 'academy',
      style: { palette },
      width: 1200,
      height: 720,
      title: '合规不等于语义正确：结构化合规率与意图匹配率',
      axisXTitle: '模型',
      axisYTitle: '比率',
    },
  });

  specs.push({
    name: 'impulse-distribution',
    spec: {
      type: 'column',
      data: ['deterministic', 'stochastic', 'model'].flatMap((organ) =>
        Object.entries(formal.byOrgan[organ].impulseCounts).map(([impulse, count]) => ({
          category: impulse,
          value: count,
          group: organ,
        }))),
      group: true,
      stack: false,
      theme: 'academy',
      style: { palette },
      width: 1200,
      height: 720,
      title: '同一批任务下三种认知器官的冲动分布（n=60）',
      axisXTitle: '结构化冲动',
      axisYTitle: '次数',
    },
  });

  specs.push({
    name: 'qualification-outcome',
    spec: {
      type: 'column',
      data: qualification.results.map((result) => ({
        category: result.model.replace('candidate-model-', 'c'),
        value: Number((result.valid / result.samples).toFixed(4)),
      })),
      theme: 'academy',
      style: { palette },
      width: 1280,
      height: 760,
      title: '模型准入快速探测：每个候选 3 个样本的合规率',
      axisXTitle: '候选模型（cN = candidate-model-N）',
      axisYTitle: '合规率',
    },
  });

  specs.push({
    name: 'annotation-agreement',
    spec: {
      type: 'column',
      data: [
        { category: '一致', value: annotation.annotatedTasks - annotation.unusableTasks.length },
        { category: '不一致', value: annotation.unusableTasks.length },
      ],
      group: false,
      theme: 'academy',
      style: { palette: ['#0d9488', '#dc2626'] },
      width: 900,
      height: 640,
      title: `模拟双标一致性：18 个任务中 ${annotation.unusableTasks.length} 个不一致（κ=${annotation.pairwise[0].kappa}）`,
      axisXTitle: '标注结果',
      axisYTitle: '任务数',
    },
  });

  specs.push({
    name: 'latency-comparison',
    spec: {
      type: 'column',
      data: [
        ...baseline.results.map((result) => ({
          category: result.organ,
          value: result.summary.latencyMedian,
          group: '中位延迟',
        })),
        ...stability.results.map((result) => ({
          category: result.model,
          value: result.summary.latency.median,
          group: '中位延迟',
        })),
      ],
      group: false,
      theme: 'academy',
      style: { palette: ['#1d4ed8'] },
      width: 1200,
      height: 720,
      title: '认知器官端到端中位延迟（毫秒）',
      axisXTitle: '器官 / 模型',
      axisYTitle: '毫秒',
    },
  });

  specs.push({
    name: 'e2e-impulses',
    spec: {
      type: 'pie',
      data: Object.entries(e2e.summary.impulseCounts).map(([impulse, count]) => ({
        category: impulse,
        value: count,
      })),
      theme: 'academy',
      style: { palette },
      width: 900,
      height: 760,
      title: `端到端模型实验冲动分布（n=${e2e.summary.total}，合规率 ${e2e.summary.complianceRate.toFixed(3)}）`,
    },
  });

  const results = [];
  for (const { name, spec } of specs) {
    results.push(await render(spec, name));
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    endpoint,
    figures: results,
    note: 'Generated from archived evidence; numeric values come from evidence/*.json, not hand-entered.',
  };
  await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(`nna render-figures: ${error.message}`);
  process.exitCode = 1;
});
