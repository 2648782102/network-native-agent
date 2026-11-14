# v0 / Phase 2 验收记录

日期：2026-11-11（Asia/Shanghai）

## 范围

验收对象是本地培养皿、Git relay 模拟的网络事件介质与可替换认知器官，不是开放互联网 Agent，也不是模型能力评测。

## 检查项

- [x] 独立 GitHub 仓库；公开代码与运行时数据分离。
- [x] 研究宪章、运行时规格、实验、边界、路线、参考项目与决策记录。
- [x] 无需第三方依赖，Node.js 20.11+ 可运行。
- [x] Ed25519 创世身份与签名事件链。
- [x] 临时身体、感知、脉冲、行动、记忆、心跳。
- [x] 代谢预算、死亡、复活、分叉。
- [x] `status` / `trace` / `replay` 从事件流重建状态。
- [x] 本地 loopback HTTP 栖息地接口。
- [x] 自动化测试与生命周期 demo。
- [x] CI 覆盖 Node.js 20 / 22 / 24。
- [x] `.gitignore` 排除运行时数据、密钥与本地环境变量。
- [x] `relay attach` / `relay status` / `sync` / `restore` / `weather` / `metrics`。
- [x] Git 事件分支承载签名事件链，异源创世被明确拒绝。
- [x] 独立目录可从远端事件史恢复同一 `agentId` 与状态摘要。
- [x] 身体死亡后，恢复体可以复活并继续向远端事件分支追加历史。
- [x] `network-demo` 输出身份连续、身体更替、漂移、观测污染与最终远端事件数。
- [x] `CognitionAdapter` 接口与 `deterministic` / `stochastic` / `model` 三种器官。
- [x] 模型器官默认关闭，凭据只从环境变量读取，端点限制为 HTTPS 或 loopback HTTP。
- [x] 模型输出被约束为结构化冲动；非结构化输出不会写入 pulse，key 不进入事件链。
- [x] `cognition` 命令与 `metrics.cognition` 能观测器官配置与脉冲分布。
- [x] `cognition-demo` 对比不同器官的漂移轨迹，且身份、事件格式、死亡/复活、重放语义不变。
- [x] `relay ls` 可枚举并验证远端事件分支。
- [x] `fork` 在绑定 relay 时也会把血缘事件发布到网络历史。
- [x] [FINDINGS.md](FINDINGS.md) 明确区分已证明、未证明与隐喻边界。
- [x] `npm run env:init` / `env:check` / `env:report` / `env:serve` / `env:model` / `env:reset` 本地测试环境脚本。
- [x] [TEST_ENVIRONMENT.md](TEST_ENVIRONMENT.md) 定义 L0–L4 测试分层、变量矩阵与 L3 证据门槛。
- [x] 测试环境目录默认位于 `work/test-env/`，被 `.gitignore` 排除；自定义根目录不得为仓库根目录或父目录。
- [x] [L4_DESIGN.md](L4_DESIGN.md) 定义 L4-simulation、开放网络风险字段、报告验收字段与真实开放 relay 门槛。
- [x] `scripts/l4-open-network.mjs` 可模拟延迟、重复、冲突和限流，离线 verify 样例报告。

## 本地验证命令

```bash
npm test
npm run demo
npm run network-demo
npm run cognition-demo
npm run check
npm run env:init
npm run env:check
npm run l4:verify-sample
```

具体结果在 CI 与本地输出中记录。L3 真实 GitHub relay 结果见 [L3_RELAY.md](L3_RELAY.md) 第 9 节；本验收仍不声称开放互联网 / L4 实验已完成。

## 明确限制

- 未连接真实公共互联网；`network-demo` 使用本地 bare Git relay，已完成的是自有 GitHub relay 的 L3 与本地 `L4-simulation`。
- 默认未调用模型；模型器官只在显式配置后调用用户提供的端点，自动化测试使用 loopback 假器官。
- 未实现分布式共识、跨主机执行槽或真实开放网络 relay；L3 的 GitHub relay 与 L4 的本地镜像只是签名事件传输/观察介质。
- 未证明意识、生命、意图或语义正确性。
- 除用户明确授权的 Private GitHub relay 事件分支外，未进行传播、推广或第三方数据收集；未写默认分支或第三方系统。
- L4 只做本地受控模拟；公开只读镜像不是身份权威，真实开放网络运行仍需单独决定。
