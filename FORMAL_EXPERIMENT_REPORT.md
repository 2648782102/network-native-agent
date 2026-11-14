# 正式实验报告：结构化认知器官契约

日期：2026-11-14（Asia/Shanghai）

## 结论

`candidate-model-1` 通过 Responses 兼容网关通过了严格结构化冲动契约的自检与 10 样本准入，并在正式 60 次实验中达到 60/60 合规。`candidate-model-2` 则仍不适合该契约。

核心结果（protocolVersion `formal-structured-impulse-v2`；模型合规调用来自真实 Responses 兼容网关；运行时字段来自真实 `nna` CLI 事件链、status、metrics、replay。模型器官的运行时重放使用本地注入服务器回放已判定合法的 impulse，因此不是端到端真实模型写入测试）：

- 180 条原始记录，10 轮，3 种器官，6 个任务。
- deterministic：60/60 合规，Wilson 95% CI `[0.9398, 1]`。
- stochastic：60/60 合规，Wilson 95% CI `[0.9398, 1]`。
- model（`candidate-model-1`）：60/60 合规，合规率 `1.000`，Wilson 95% CI `[0.9398, 1]`。
- 180 条原始记录全部纳入；180/180 都具备真实运行时字段、真实 pulse 事件与 replay，生命周期计数一致，`secretLeak=0`。
- 模型合规调用延迟 `modelCallLatencyMs` 与真实 CLI 运行时重放延迟 `runtimeElapsedMs` 已分离记录；统计表只汇总运行时重放延迟。
- raw 数据经凭据样式扫描无命中。
- `test/model-incomplete.test.mjs` 固定了关键回归：Responses `status=incomplete` 且无 final text 时，运行时不写 pulse、感知保持 pending。
- 冲动分布列联表 Cramer's V：`0.2433`。

## 解释

这说明两件事：

1. 运行时边界在真实 CLI 试验中有效：纳入样本的事件链全部可重放，生命周期不变量保持不变。
2. `candidate-model-1` 可以作为严格四选一器官；`candidate-model-2` 不行，差别来自模型行为而非运行时。

这不是模型能力评测，也不证明模型智能、意识、意图或公网存活。

提示词与预算限制：合规测量使用协议固定的严格 prompt，准入与正式实验统一使用 `max_output_tokens=256`；运行时重放使用当前生产 cognition prompt。结论只在这些条件下成立，不外推到所有模型或所有提示词配置。

## 复现

```bash
npm run experiment:collect
npm run experiment:analyze
```

协议、统计方法和排除准则见 [EXPERIMENT_PROTOCOL.md](EXPERIMENT_PROTOCOL.md)。

原始数据：

- `evidence/formal-experiment/raw.ndjson`
- `evidence/formal-experiment/analysis.json`

图表：

- `evidence/formal-experiment/formal-experiment.svg`
- `evidence/formal-experiment/formal-experiment.png`

## 与旧基准的关系

旧的 `model:benchmark` 把 `incomplete` 响应兜底为 `migrate`，因此不具备正式实验效力；该脚本、图表和命令已删除。现在 `src/cognition.mjs` 的严格规则把 `status=incomplete` 一律视为失败。
