# 可借鉴的开源器官库

日期：2026-11-11。这里列的是「器官」与思想来源，不是同类产品排行榜，也不代表本项目依赖它们。借鉴前需要重新核对仓库状态、许可证和当前实现。

## 持久执行 / 事件溯源

| 项目 | 借鉴什么 | 不借鉴什么 |
| --- | --- | --- |
| [Erlang/OTP](https://github.com/erlang/otp) | Actor、监督树、进程可以死的运行时文化 | 直接把 BEAM 当作唯一身体 |
| [Microsoft Orleans](https://github.com/dotnet/orleans) | Virtual Actor、激活/失活与逻辑身份 | .NET 生态绑定 |
| [Apache Pekko](https://github.com/apache/pekko) | Actor 模型与持久化事件 | JVM 部署复杂度 |
| [Temporal](https://github.com/temporalio/temporal) | Durable execution、工作流历史可重放 | 把预设工作流当作 Agent 主体 |
| [Restate](https://github.com/restatedev/restate) | 持久调用、恢复与幂等键 | 服务编排中心化 |
| [Wasmtime](https://github.com/bytecodealliance/wasmtime) | 可迁移、可沙箱化的临时身体 | v0 引入 WASM 复杂度 |

## 网络身份 / 消息 / 内容寻址

| 项目 | 借鉴什么 | 不借鉴什么 |
| --- | --- | --- |
| [libp2p specs](https://github.com/libp2p/specs) | 对等身份、传输与协议协商 | 过早做 P2P 网络 |
| [js-libp2p](https://github.com/libp2p/js-libp2p) | Node.js 侧网络传输实现参考 | 直接依赖其全部栈 |
| [Kubo](https://github.com/ipfs/kubo) | 内容寻址、可验证数据块 | 把 IPFS 当作唯一日志 |
| [Nostr NIPs](https://github.com/nostr-protocol/nips) | 签名事件、relay、极简身份 | 公共社交噪声 |
| [Matrix spec](https://github.com/matrix-org/matrix-spec) | 房间事件、联邦消息历史 | 账号与社区运营 |
| [ActivityPub](https://github.com/w3c/activitypub) | 分布式对象与收件箱语义 | 社交产品语义 |
| [Automerge](https://github.com/automerge/automerge) | CRDT、离线合并与状态重建 | 用无冲突合并掩盖死亡/分叉 |
| [Holochain](https://github.com/holochain/holochain) | Agent 中心、来源链与 DHT 思想 | v0 引入完整框架 |
| [GUN](https://github.com/amark/gun) | 去中心化图数据 | 生产级一致性承诺 |

## Agent 行为与评测

| 项目 | 借鉴什么 | 不借鉴什么 |
| --- | --- | --- |
| [AutoGPT](https://github.com/Significant-Gravitas/AutoGPT) | 长期自主任务的历史实验 | 任务循环即主体 |
| [BabyAGI](https://github.com/yoheinakajima/babyagi) | 极简任务驱动循环 | 把 todo list 当记忆本体 |
| [CAMEL](https://github.com/camel-ai/camel) | 多角色交互与涌现研究 | 角色扮演叙事 |
| [AgentVerse](https://github.com/OpenBMB/AgentVerse) | 多 Agent 环境组织 | 群体模拟作为产品 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | 状态图与可检查执行 | 预设图作为运行时本体 |
| [OpenHands](https://github.com/All-Hands-AI/OpenHands) | 代码 Agent 工具面与评测 | 通用开发平台范围 |
| [SWE-agent](https://github.com/SWE-agent/SWE-agent) | Agent-computer interface 与轨迹记录 | 以 SWE-bench 分数为目标 |
| [browser-use](https://github.com/browser-use/browser-use) | 浏览器行动面 | 真实网站自动操作 |
| [WebArena](https://github.com/web-arena-x/webarena) | 可复现网页环境与任务评测 | 把 benchmark 当开放网络 |
| [BrowserGym](https://github.com/ServiceNow/BrowserGym) | 浏览器 Agent 统一环境 | 训练/评测基础设施依赖 |
| [AgentBench](https://github.com/THUDM/AgentBench) | 多环境 Agent 评测思路 | 排行榜导向 |
| [MCP specification](https://github.com/modelcontextprotocol/specification) | 工具适配层协议 | MCP-first 架构 |
| [AntV MCP Server Chart](https://github.com/antvis/mcp-server-chart) | 从归档数据生成可读证据图表 | 不把图表服务当运行时依赖；PNG 已归档 |

## 数字生命 / 人工生命思想

| 来源 | 借鉴什么 | 不借鉴什么 |
| --- | --- | --- |
| [NetLogo](https://github.com/NetLogo/NetLogo) | 环境、主体、涌现与可观测实验 | 把它当运行时实现 |
| Tierra / Avida | 复制、变异、资源竞争、死亡与谱系的思想实验 | 意识或生物学等价主张 |
| Cloudflare Durable Objects（概念） | 逻辑对象跨实例延续 | 闭源平台依赖，非 OSS 器官 |

## 本项目的组合方式

该项目不把这些项目拼成一个大框架，而只抽取三件事：

1. **身份与历史**：签名事件链、内容寻址、重放。
2. **身体与死亡**：Actor / durable execution 中的激活、失活、恢复。
3. **环境与观测**：可复现事件注入、轨迹记录、漂移指标。

刻意不抽的是：固定工作流、通用工具市场、排行榜、公开社交动作和第三方自动写权限。
