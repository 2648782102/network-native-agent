#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const l4Candidates = [path.join(root, 'work', 'l4-simulation.json'), path.join(root, 'examples', 'l4-report.sample.json')];
const lanCandidates = [path.join(root, 'work', 'lan-migration.json')];
const formalCandidates = [path.join(root, 'evidence', 'formal-experiment', 'analysis.json')];
const stabilityCandidates = [path.join(root, 'evidence', 'model-stability', 'report.json')];
const baselineCandidates = [path.join(root, 'evidence', 'baseline-stability', 'report.json')];
const port = Number(process.env.NNA_VIZ_PORT ?? 8789);
const host = process.env.NNA_VIZ_HOST ?? '127.0.0.1';
let running = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function readFirst(candidates) {
  for (const candidate of candidates) {
    try {
      return { report: JSON.parse(await readFile(candidate, 'utf8')), source: path.relative(root, candidate) };
    } catch {
      continue;
    }
  }
  return null;
}

function parseLastJsonObject(text) {
  const chunks = String(text ?? '').trim().split(/\n(?=\{)/).filter((chunk) => chunk.trim().startsWith('{'));
  if (!chunks.length) throw new Error('script produced no JSON report');
  return JSON.parse(chunks.at(-1));
}

async function runScript(script, args) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    cwd: root,
    env: { ...process.env },
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return { report: parseLastJsonObject(stdout), stderr };
}

async function runWithGuard(action) {
  if (running) throw Object.assign(new Error('another run is already in progress'), { statusCode: 409 });
  running = true;
  try {
    return await action();
  } finally {
    running = false;
  }
}

function render(report, source, lan, lanSource, formal, formalSource, stability, stabilitySource, baseline, baselineSource) {
  const formalFacts = formal ? [
    ['正式实验', '已分析'],
    ['原始记录', formal.totalRecords ?? 0],
    ['纳入记录', formal.includedRecords ?? 0],
    ['排除记录', formal.excludedRecords ?? 0],
    ['模型合规率', formal.byOrgan?.model?.complianceRate?.toFixed?.(3) ?? 0],
    ['模型排除', formal.byOrgan?.model?.excluded ?? 0],
    ['Cramer V', formal.cramersV ?? 0],
    ['正式结论', '候选模型未进入默认器官；结构化合规不等于语义正确'],
  ] : [];
  const lanFacts = lan ? [
    ['迁移状态', lan.valid ? 'valid' : 'invalid'],
    ['未授权访问', lan.transport?.unauthenticatedStatus ?? '-'],
    ['授权访问', lan.transport?.authenticatedStatus ?? '-'],
    ['LAN 注入', lan.transport?.injectedStatus ?? '-'],
    ['身份连续', lan.identity?.continuous ? '是' : '否'],
    ['死亡 / 复活', `${lan.lifecycle?.deaths ?? 0} / ${lan.lifecycle?.resurrections ?? 0}`],
  ] : [];
  const baselineFacts = baseline ? baseline.results.map((result) => [result.organ, `${result.summary.intentMatchRate} intent`]) : [];
  const stabilityFacts = stability ? stability.results.map((result) => [
    result.model,
    `${result.summary.valid}/${result.summary.total} · intent ${(result.summary.intentMatchRate * 100).toFixed(1)}%`,
  ]) : [];

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>network-native-agent · 正式实验控制台</title>
  <style>
    :root { color-scheme: dark light; --bg:#0d1117; --panel:#161b22; --fg:#e6edf3; --muted:#9198a1; --line:#30363d; --blue:#58a6ff; --purple:#a371f7; --green:#3fb950; --red:#f85149; }
    @media (prefers-color-scheme: light) { :root { --bg:#fff; --panel:#f6f8fa; --fg:#1f2328; --muted:#59636e; --line:#d1d9e0; --blue:#0969da; --purple:#8250df; --green:#1a7f37; } }
    * { box-sizing:border-box; }
    body { margin:0; padding:36px 20px 64px; background:var(--bg); color:var(--fg); font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif; }
    main { max-width:1060px; margin:auto; }
    h1 { font-size:clamp(28px,5vw,44px); line-height:1.15; margin:0 0 8px; letter-spacing:-.03em; }
    h2 { font-size:20px; margin:36px 0 12px; }
    .lead { color:var(--muted); max-width:800px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
    .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; }
    .card small { color:var(--muted); }
    .value { font:600 22px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; margin-top:6px; }
    .good { color:var(--green); } .bad { color:var(--red); } .purple { color:var(--purple); }
    .controls { display:flex; flex-wrap:wrap; gap:12px; margin:18px 0 8px; }
    .controls button { min-height:38px; padding:8px 14px; color:var(--fg); background:var(--panel); border:1px solid var(--line); border-radius:8px; }
    .controls button.primary { color:var(--primary-foreground,#fff); background:var(--blue); border-color:var(--blue); }
    .controls button:disabled { opacity:.55; }
    .run-status { min-height:24px; margin:8px 0 16px; color:var(--muted); }
    .run-status.error { color:var(--red); }
    pre { white-space:pre-wrap; word-break:break-word; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; color:var(--muted); }
    footer { border-top:1px solid var(--line); margin-top:40px; padding-top:14px; color:var(--muted); }
  </style>
</head>
<body>
  <main>
    <h1>正式实验控制台</h1>
    <p class="lead">只呈现归档证据与受控实验；开发期图表、失效按钮和模型兜底路径已退役。</p>
    <div class="controls">
      <button class="primary" id="formal-chart" type="button">查看正式图表</button>
      <button id="figures" type="button">查看证据图表</button>
      <button id="run-l4" type="button">运行 L4 模拟</button>
      <button id="run-lan" type="button">运行 LAN 迁移</button>
      <button id="refresh" type="button">刷新报告</button>
    </div>
    <div class="run-status" id="run-status" role="status" aria-live="polite">就绪。</div>

    <h2>正式实验 ${formalSource ? `<span class="lead">· ${escapeHtml(formalSource)}</span>` : ''}</h2>
    ${formal ? `
    <section class="grid">
      ${formalFacts.map(([label, value], index) => `<div class="card"><small>${escapeHtml(label)}</small><div class="value ${index % 3 === 0 ? 'good' : index % 3 === 1 ? 'purple' : ''}">${escapeHtml(value)}</div></div>`).join('')}
    </section>
    <p class="lead">协议、原始数据、排除准则和解释边界见 <code>FORMAL_EXPERIMENT_REPORT.md</code>。</p>
    ` : '<p class="lead">尚未找到正式实验分析文件。运行 <code>npm run experiment:analyze</code>。</p>'}

    <h2>模型稳定性 ${stabilitySource ? `<span class="lead">· ${escapeHtml(stabilitySource)}</span>` : ''}</h2>
    ${stability ? `
    <section class="grid">
      ${stabilityFacts.map(([label, value], index) => `<div class="card"><small>${escapeHtml(label)}</small><div class="value ${index % 3 === 0 ? 'good' : 'purple'}">${escapeHtml(value)}</div></div>`).join('')}
    </section>
    <p class="lead">合规率不等于意图匹配率；默认认知器官保持 deterministic。见 <code>MODEL_STABILITY_REPORT.md</code>。</p>
    ` : '<p class="lead">尚未找到模型稳定性报告。</p>'}

    <h2>离线基线 ${baselineSource ? `<span class="lead">· ${escapeHtml(baselineSource)}</span>` : ''}</h2>
    ${baseline ? `<section class="grid">${baselineFacts.map(([label, value]) => `<div class="card"><small>${escapeHtml(label)}</small><div class="value purple">${escapeHtml(value)}</div></div>`).join('')}</section><p class="lead">哈希型适配器意图匹配很低，说明任务标签不能用于模型排序。</p>` : '<p class="lead">尚未找到基线报告。</p>'}

    <h2>LAN 多身体迁移 ${lanSource ? `<span class="lead">· ${escapeHtml(lanSource)}</span>` : ''}</h2>
    ${lan ? `
    <section class="grid">
      ${lanFacts.map(([label, value], index) => `<div class="card"><small>${escapeHtml(label)}</small><div class="value ${index % 3 === 0 ? 'good' : index % 3 === 1 ? 'purple' : ''}">${escapeHtml(value)}</div></div>`).join('')}
    </section>
    ` : '<p class="lead">尚未找到 LAN 迁移报告。</p>'}

    <h2>L4 原始报告 <span class="lead">· ${escapeHtml(source)}</span></h2>
    <pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre>
    <footer>正式实验只测运行时契约，不测智能、意识或意图；公网实验未启用。</footer>
  </main>
  <script>
    const status = document.getElementById('run-status');
    const buttons = Array.from(document.querySelectorAll('.controls button'));
    function setStatus(text, error = false) {
      status.textContent = text;
      status.classList.toggle('error', error);
    }
    async function run(action) {
      buttons.forEach((button) => { button.disabled = true; });
      setStatus('正在运行实验…');
      try {
        const response = await fetch('/run/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) throw new Error(payload.error || response.statusText);
        setStatus(action === 'lan' ? 'LAN 迁移完成。' : 'L4 模拟完成。');
        setTimeout(() => window.location.reload(), 700);
      } catch (error) {
        setStatus('运行失败：' + error.message, true);
        buttons.forEach((button) => { button.disabled = false; });
      }
    }
    document.getElementById('formal-chart').addEventListener('click', () => window.open('/formal-chart.svg', '_blank', 'noopener'));
    document.getElementById('figures').addEventListener('click', () => window.open('/figures/compliance-vs-intent.png', '_blank', 'noopener'));
    document.getElementById('run-l4').addEventListener('click', () => run('l4'));
    document.getElementById('run-lan').addEventListener('click', () => run('lan'));
    document.getElementById('refresh').addEventListener('click', () => window.location.reload());
  </script>
</body>
</html>`;
}

const server = createServer(async (request, response) => {
  try {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true, running }));
      return;
    }
    if (request.url === '/report.json') {
      const l4 = await readFirst(l4Candidates);
      const lan = await readFirst(lanCandidates);
      const formal = await readFirst(formalCandidates);
      const stability = await readFirst(stabilityCandidates);
      const baseline = await readFirst(baselineCandidates);
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        l4: l4?.report ?? null,
        l4Source: l4?.source ?? null,
        lan: lan?.report ?? null,
        lanSource: lan?.source ?? null,
        formal: formal?.report ?? null,
        formalSource: formal?.source ?? null,
        stability: stability?.report ?? null,
        stabilitySource: stability?.source ?? null,
        baseline: baseline?.report ?? null,
        baselineSource: baseline?.source ?? null,
      }, null, 2));
      return;
    }
    if (request.url === '/formal-chart.svg') {
      const svg = await readFile(path.join(root, 'evidence', 'formal-experiment', 'formal-experiment.svg'), 'utf8');
      response.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8' });
      response.end(svg);
      return;
    }
    if (request.url.startsWith('/figures/')) {
      const name = path.basename(decodeURIComponent(request.url.slice('/figures/'.length)));
      const file = path.join(root, 'evidence', 'figures', name);
      const image = await readFile(file);
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(image);
      return;
    }
    if (request.method === 'POST' && request.url === '/run/l4') {
      const result = await runWithGuard(async () => runScript('l4-open-network.mjs', ['simulate', '--report', 'work/l4-simulation.json']));
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: result.report.valid === true, report: result.report, stderr: result.stderr }, null, 2));
      return;
    }
    if (request.method === 'POST' && request.url === '/run/lan') {
      const result = await runWithGuard(async () => runScript('lan-migration.mjs', ['--report', 'work/lan-migration.json']));
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: result.report.valid === true, report: result.report, stderr: result.stderr }, null, 2));
      return;
    }
    const l4 = await readFirst(l4Candidates);
    if (!l4) throw new Error('no L4 report found; run npm run l4:simulate first');
    const lan = await readFirst(lanCandidates);
    const formal = await readFirst(formalCandidates);
    const stability = await readFirst(stabilityCandidates);
    const baseline = await readFirst(baselineCandidates);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(render(l4.report, l4.source, lan?.report ?? null, lan?.source ?? null, formal?.report ?? null, formal?.source ?? null, stability?.report ?? null, stability?.source ?? null, baseline?.report ?? null, baseline?.source ?? null));
  } catch (error) {
    response.writeHead(error.statusCode ?? 500, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: false, error: error.message }, null, 2));
  }
});

server.listen(port, host, () => {
  console.log(`nna viz: http://${host}:${port}`);
});
