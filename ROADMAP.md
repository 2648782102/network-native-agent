# 路线与最终目标

状态：研究原型，`v0 / Phase 2` 培养皿已落地。日期是记录点，不是承诺。

## 最终目标

形成一套可复现、可证伪的 **Network-native Agent Runtime** 规格与原型，使一个 Agent 至少满足：

1. 身份、记忆与生命周期不依附任何单一进程或主机；
2. 至少两个独立执行身体能在不同时间从同一事件史中醒来；
3. 事件传输可由本地介质替换为自有网络 relay / 私有 Git 远端，而运行时语义不变；
4. 死亡、复活、分叉、漂移、观测污染都有可测量指标；
5. 能用同一事件格式替换确定性冲动与模型认知；
6. 所有实验都留在 [BOUNDARY.md](BOUNDARY.md) 定义的培养皿内；
7. 产出一份诚实的研究札记，明确区分已证明、未证明和仍属隐喻的部分。

成功不是「Agent 做完了多少任务」，而是「主体连续性是否真的由网络事件史承担」。

## Phase 0 — 研究宪章与本地培养皿

完成：

- 独立仓库；
- 研究命题、定义、边界、实验、参考项目与决策记录；
- 签名 append-only 事件流；
- Ed25519 创世身份；
- 临时身体、代谢、死亡、复活、分叉、重放；
- 本地 HTTP 栖息地接口；
- 自动化测试与生命周期 demo；
- CI 覆盖 Node.js 20 / 22 / 24。

退出条件：`npm run check` 通过，且 `replay` 能检测事件篡改。

## Phase 1 — 多身体与网络天气（已落地）

完成：

- `relay attach` / `relay status` / `sync` / `restore` / `weather` / `metrics` 命令；
- 私有 Git 事件分支作为可替换的网络事件介质；
- 签名事件链跨目录恢复、异源创世检测、事件历史分叉检测；
- `network-demo` 演示一个身体死亡后，另一个独立目录从远端事件史恢复并复活；
- 观测指标覆盖身体更替、倾向漂移、观测污染与复活延迟。

退出条件已满足：两个独立目录、不同时间从同一远端事件史重放，得到相同身份与状态摘要；复活后继续产生新 `bodyId`。

## Phase 2 — 认知适配器（已落地）

目标：证明模型只是器官，不是主体。

完成：

- `src/cognition.mjs` 定义器官接口与 `makePulsePlan`；
- 确定性器官仍是默认基线；
- 随机权重器官提供无外部依赖的交换对照；
- 可选模型器官只通过环境变量读取凭据，端点只允许 HTTPS 或本机 loopback HTTP；
- 模型输出必须被约束成一个结构化冲动，非结构化输出在写入 pulse 前失败；
- `cognition` / `metrics` / `npm run cognition-demo` 对比器官分布、漂移与生命周期；
- [FINDINGS.md](FINDINGS.md) 区分已证明、未证明和隐喻边界。

退出条件已满足：替换认知器官后，身份、事件格式、死亡/复活、重放与 relay 语义不变；只有脉冲分布与状态摘要改变。

## Phase 3 — 网络传输与身体迁徙（L3 已完成）

目标：把本地 bare Git 测试 relay 换成用户自有的私密 GitHub 远端，并在真实网络条件下复现 Phase 1 实验。

完成：

- [L3_RELAY.md](L3_RELAY.md) 定义真实私有 GitHub relay 的边界、审计、报告与清理；
- `scripts/l3-relay.mjs` 提供 `preflight` 与 `experiment --yes` 两道门；
- preflight 验证 Private 仓库、默认分支无运行时密钥、现有 `nna-events/*` refs；
- experiment 设计为销毁身体 A 与私钥后，从远端事件史生成只读观察体，再产生新血缘分叉；
- 报告字段明确区分「历史恢复」与「原身份复活」，不把私钥复制包装成网络生命。

已执行：

- 用户创建并指定专用 Private GitHub relay `OWNER/relay-sandbox`；
- 在无本机 `gh` 的条件下，用已连接 GitHub API 客户端提供的仓库 JSON 完成 attestation；
- 运行 preflight，审阅私密性、默认分支与现有 refs；
- 显式运行 `experiment --yes`，报告写入被忽略的 `work/l3-relay-report.json`；
- 首次实测结果见 [L3_RELAY.md](L3_RELAY.md) 第 9 节。

退出条件已满足：销毁执行目录中的全部临时文件与私钥后，只读观察体从远端事件史恢复同一 `agentId` 与死亡前状态摘要；报告通过所有边界审计。没有复制私钥，没有宣称原身份复活。

## Phase 4 — 开放网络条件基座（L4-simulation 已完成）

目标：在不接入公网的前提下，把开放网络中的延迟、重复、冲突、限流、只读镜像污染纳入可复现实验，并验证身份来源仍只来自私有签名事件链。

完成：

- [L4_DESIGN.md](L4_DESIGN.md) 定义 L4 边界、允许/禁止事项、报告验收字段与真实开放 relay 门槛；
- `scripts/l4-open-network.mjs` 提供 `simulate` 与 `verify`；
- 本地模拟私有 relay 与公开只读镜像，记录延迟、重复、冲突、限流和有序私有历史；
- 身体 A 死亡后，只读观察体恢复同一 `agentId`，不复制私钥、不复活原身份；
- `fork-observer` 产生新血缘，父链不变；
- 脱敏样例报告 `examples/l4-report.sample.json` 可离线验证；
- `npm run check` 纳入 `l4:verify-sample`。

退出条件已满足：开放网络式噪声可被观测且报告可离线验证；公开镜像不成为身份权威；签名历史、私钥边界和血缘规则不变。

## Phase 5 — 研究札记与公开决策（札记已落地）

目标：把结果写成可评审的材料，而不是宣传文案。

完成：

- [FINDINGS.md](FINDINGS.md) 汇总当前实验结论、失败案例与边界审查；
- 明确「身份 / 记忆 / 身体 / 死亡 / 复活 / 活着 / 不可控」只是运行时术语；
- 记录 Phase 3 真实私有 GitHub relay 的边界、失败风险与实测结果；Phase 4 的 L4-simulation 记录开放网络条件基座。

已完成：

- 公开前整理：README、LICENSE（MIT）、SECURITY、CONTRIBUTING 与 PUBLICATION 清单；
- 内部模型别名与厂商专属接入已中性化，改为通用模型网关；
- 证据、报告与图表完成脱敏与一致性审计；
- `scripts/public-audit.mjs` 与 CI 中的 `audit:public` 阻止内部标识回归。

退出条件已满足：公开范围与脱敏标准写入 [PUBLICATION.md](PUBLICATION.md)。真实开放网络实验仍需单独决定。

## 明确不做

- 不为 star 数做增长动作；
- 不把开放网络实验提前到边界审查之前；
- 不引入团队、计费、云同步、仪表盘或插件市场；
- 不把「可控网关」变成项目主轴；
- 不把模型幻觉、意识或人格主张当作实验结果。

## 决策门

每个阶段结束时只回答两个问题：

1. 主体连续性是否比以前更少依赖某台机器？
2. 新增能力是否仍在培养皿边界内？

两个答案都为「是」才进入下一阶段。
