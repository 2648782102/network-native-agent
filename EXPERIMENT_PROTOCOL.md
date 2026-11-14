# 正式实验协议：结构化认知器官的运行时不变量

日期：2026-11-14（Asia/Shanghai）

协议版本：`formal-structured-impulse-v2`。v2 的变更：所有纳入样本必须由真实 `nna` CLI 运行时产生 pulse、eventTypes、digest、metrics 与 replay；模型合规调用与运行时重放调用分离；`status=incomplete` 一律排除。模型器官的运行时重放阶段使用本地注入服务器回放已通过合规判定的 impulse，因此它验证“合法模型输出进入运行时后的不变量”，不验证端到端真实模型重试或网络行为。

提示词边界：合规测量使用协议固定的严格 prompt（`promptHash` 写入每条记录）；运行时重放使用 `src/cognition.mjs` 当前生产 prompt。两者不同，因此实验结论只在各自 prompt 条件下成立，不宣称模型对所有提示词配置的普遍能力。

输出预算：准入筛选与正式实验必须使用同一 `max_output_tokens`（当前 256）。预算不同会改变推理模型的 `incomplete` 比例，不能直接比较。

生产路径差异：`src/cognition.mjs` 的生产 prompt 要求“最后一行一个词”，并使用 `max_output_tokens=1024`；协议测量仍要求全文精确一个词、预算 256。端到端实验单独记录在 `MODEL_E2E_REPORT.md`，不与协议合规率混算。

这份协议在执行前固定研究问题、假设、变量、样本、排除准则、统计方法和解释边界。后续实验必须把任何偏离写进报告。

## 1. 研究问题

当一个运行时把外部模型输出约束成四选一结构化冲动时，替换认知器官是否只改变行为轨迹，而不改变签名事件链所承载的身份与生命周期语义？

## 2. 假设

- H1：三种器官在相同创世模板和相同输入下，事件数、事件类型、生命周期计数、replay 有效性保持一致。
- H2：三种器官的冲动分布不同，且状态摘要 digest 与 driftDistance 可以改变。
- H3：模型器官的响应合规率、延迟和失败率可被测量；不完整响应必须计为失败，不能折算为合法冲动。
- H0：器官替换前后没有可观察的轨迹差异，或运行时不变量被破坏。

## 3. 变量

- 自变量：认知器官 `deterministic`、`stochastic`、`model`。
- 因变量：impulse、digest、driftDistance、elapsedMs、replay.valid、failure、secretLeak。
- 控制变量：同一模型、同一 prompt、同一任务集、同一轮数、同一事件格式、同一超时、同一随机种子策略。
- 随机化：每轮任务顺序按预注册 seed 做 Fisher-Yates 洗牌，并写入原始数据。
- 重复：每个器官每个任务至少 10 个独立样本；若模型网关限流，则报告实际完成数和停止原因，不得补造数据。

## 4. 数据与排除准则

- 原始记录写入 NDJSON，每条记录必须包含 trialId、organ、taskId、order、promptHash、rawResponseStatus、promptVersion、responseClass、impulse、modelCallLatencyMs、runtimeElapsedMs、runtimeImpulse、digest、driftDistance、secretLeak。
- v2 的计时字段分为 `modelCallLatencyMs`（真实模型合规调用）与 `runtimeElapsedMs`（真实 CLI 运行时重放）；两者不可混用。`runtimeImpulse` 必须来自真实事件链中的 pulse，且等于纳入记录的 `impulse`。
- 排除准则提前固定：
  - HTTP 非 2xx；
  - 超时；
  - Responses `status=incomplete` 且没有 final text；
  - 输出不是四选一的精确单词；
  - 运行时重放失败（`runtime_failed`）；
  - 仅对模型注入重放：事件链中的 pulse 与合规冲动不一致（`runtime_impulse_mismatch`）；deterministic/stochastic 的运行时 seed 与预计算不同，不以该字段排除；
  - 事件 replay 失败；
  - 事件中出现凭据样式字符串。
- 被排除记录仍保留在原始数据中，标记 `excluded=true` 和 `exclusionReason`。
- 禁止把推理摘要中的候选词当成模型最终输出；只有 final message / output_text 的精确匹配才算合规。

## 5. 统计方法

- 合规率：合规样本 / 有效调用样本，给出 Wilson 95% 置信区间。
- 延迟：`runtimeElapsedMs` 统计成功纳入的运行时重放，报告 n、均值、标准差、中位数、p95；模型合规调用的 `modelCallLatencyMs` 单独保留在原始记录中，不并入运行时延迟。
- 冲动分布：按器官列联表，报告 Cramer's V 作为效应量。
- 生命周期不变量：逐样本检查事件类型集合、事件数、deaths、resurrections、forks、replay.valid。
- 轨迹差异：各器官 digest 唯一数与 driftDistance 均值；不把 digest 差异解释为智能。
- 多重比较：本报告不使用显著性阈值作为“成功”标准，只报告效应量和区间；若未来引入 p 值，需预先登记校正方法。

## 6. 成功标准

- 所有有效样本的 replay.valid 为 true。
- 生命周期计数与事件类型集合在器官间一致。
- secretLeak 数量为 0。
- 模型器官合规率、失败原因和排除记录完整。
- 如果模型器官大量不完整响应，应报告“当前候选模型不适合该结构化契约”，而不是伪造通过结果。

## 7. 复现

- 采集器：`npm run experiment:collect`
- 分析器：`npm run experiment:analyze`
- 协议：本文件
- 输出：`evidence/formal-experiment/raw.ndjson`、`evidence/formal-experiment/analysis.json`、`evidence/formal-experiment/formal-experiment.svg`

## 8. 解释边界

本实验不评测智能、推理能力、意识、意图、人格，也不证明公网存活。它只检验结构化认知器官与事件链运行时之间的工程契约。
