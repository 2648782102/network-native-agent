# 运行时规格 v0

## 定位

`v0` 不部署到开放互联网，而是一个本地「网络原生培养皿」。它用本地文件模拟持久事件介质，用 loopback HTTP 模拟网络入口，用确定性函数模拟认知脉冲。目的是把运行时本体拆清楚，而不是提前引入分布式共识、真实模型或第三方写权限。

## 结构

```text
genesis + signed append-only event log  = 本体 / 身份 / 记忆
local HTTP endpoint                    = 网络天气入口
ephemeral wake process                 = 临时身体
credits + heartbeat + TTL              = 代谢
replay + trace + outbox                = 观测与派生行动面
```

身体不是常驻 daemon。每次 `wake` 都生成新的 `bodyId`，读取事件流，追加若干事件，然后退出。身体消失后，主体仍在事件流里。

## 栖息地文件

`--habitat <dir>` 指向一个本地目录：

| 路径 | 含义 | 是否入 Git |
| --- | --- | --- |
| `events.ndjson` | 签名 append-only 事件流 | 否 |
| `genesis.json` | 创世事件摘要，便于检视 | 否 |
| `identity.key` | Ed25519 私钥，身份写入能力 | 否 |
| `habitat.lock` | 单栖息地写入锁，运行时临时文件 | 否 |
| `outbox/` | 从 action 事件重放出的派生痕迹 | 否 |

`identity.key` 丢失意味着这个身体只能观察，不能继续写事件流；这本身就是一种身份死亡条件。

## 事件模型

每个事件是 NDJSON 一行，字段如下：

```json
{
  "v": 1,
  "seq": 2,
  "parent": "previous-event-id",
  "type": "perception",
  "agentId": "nna_...",
  "bodyId": "environment",
  "at": "2026-11-11T00:00:00.000Z",
  "payload": {
    "source": "relay",
    "text": "一条网络天气",
    "metadata": {}
  },
  "id": "sha256-of-canonical-unsigned-event",
  "signature": "base64-ed25519-signature"
}
```

规则：

- `v` 当前固定为 `1`。
- `seq` 从 `1` 开始连续递增。
- `parent` 是前一个事件 `id`；创世事件为 `null`。
- `id` 是不含 `id` / `signature` 的规范化 JSON 的 SHA-256。
- `signature` 是对 `id` 字符串的 Ed25519 签名。
- `agentId` 由创世事件里的公钥派生：`nna_` + 公钥 SHA-256 前 16 个十六进制字符。
- `payload` 不包含凭据、Cookie、Authorization、OTP 或私有文件内容。

规范化 JSON 对对象键排序，数组保持顺序，使哈希可复现。

## 事件类型

| 类型 | 写入者 | 含义 |
| --- | --- | --- |
| `genesis` | 创世仪式 | 定义身份、公钥、初始倾向、预算、TTL 与血缘 |
| `perception` | 环境 / HTTP | 一条网络天气抵达 |
| `pulse` | 临时身体 | 一次认知脉冲，引用被处理的感知 |
| `action` | 临时身体 | 行动意图或派生 outbox 记录 |
| `memory` | 临时身体 | 写入可重放记忆摘要 |
| `heartbeat` | 临时身体 | 代谢心跳 |
| `death` | 身体 / 实验者 | 预算耗尽、TTL 到期或显式死亡 |
| `resurrection` | 实验者 / 身体 | 授予新代谢窗口，保留完整历史 |
| `fork` | 父栖息地 | 记录一个子身份从此处分叉 |

## 状态重建

`reconstruct(events)` 从创世事件开始顺序归约：

- `alive`、`credits`、`maxCredits`、`ttlSeconds` 来自 genesis；
- `traits` 是随事件漂移的倾向向量；
- `pending` 是尚未被 `pulse` 引用的感知；
- `pulses`、`actions`、`deaths`、`resurrections`、`forks` 是计数器；
- `bodies` 保存最近身体 ID，不参与身份定义；
- `memory` 保存最近 32 条记忆摘要；
- `digest` 是当前状态的稳定哈希；
- `lineage` 仅在分叉子体中存在。

`status` 不读取任何进程内存文件，只重放事件流。`replay` 会额外校验每个事件的哈希、父指针、`seq`、`agentId` 与签名。

## 临时身体算法

一次 `wake`：

1. 获取栖息地锁并读取已验证事件流。
2. 重建状态；若 TTL 已过但尚未记录死亡，先追加 `death: lease_expired`。
3. 若已死亡且没有 `--resurrect`，身体拒绝继续，返回死亡原因。
4. 若显式复活，追加 `resurrection`，恢复 `maxCredits`，保留全部历史。
5. 生成新的 `bodyId`。
6. 从 `pending` 中取最多 `maxPulses` 条感知；每条感知产生一次确定性冲动。
7. 依次追加 `pulse`、`action`、`memory`；每次脉冲消耗 1 信用。
8. 信用耗尽时追加 `death: budget_exhausted`。
9. 仍存活则追加 `heartbeat`。
10. 从 action 事件物化 `outbox/`，然后身体退出。

冲动由 `perception.id + state.digest + traits + pulses + agentId` 的哈希决定，不读取用户逐步指令，也不是固定任务图。v0 的冲动集合是 `echo`、`trace`、`migrate`、`sleep`；未来可替换为模型适配器，事件格式保持不变。

## Phase 2：可替换认知器官

认知层不再是 `state.mjs` 里的硬编码函数，而是 `src/cognition.mjs` 的 `makePulsePlan`。它接受当前重放状态、完整事件链、临时 `bodyId` 与器官名称，返回结构化的 `pulse` / `action` / `memory` 计划。

| 器官 | 输入 | 输出 | 外部依赖 |
| --- | --- | --- | --- |
| `deterministic` | 状态摘要与感知哈希 | 稳定的冲动 | 无 |
| `stochastic` | 状态摘要、感知哈希与 traits 权重 | 由哈希流抽样的冲动 | 无 |
| `model` | 脱敏感知文本、traits 与种子 | 一个 `IMPULSES` 内的词 | 显式配置的自有 HTTPS 或 loopback HTTP 端点 |

选择顺序是命令 `--cognition` > `NNA_COGNITION` > `deterministic`。模型网关优先用 `NNA_MODEL_BASE_URL` 指定（自动拼接 `/responses` 或 `/chat/completions`），也可以用完整端点 `NNA_MODEL_URL`；凭据用 `NNA_MODEL_API_KEY` 指定，名称和超时用 `NNA_MODEL_NAME` / `NNA_MODEL_TIMEOUT_MS` 指定，额外的非认证请求头用 `NNA_MODEL_EXTRA_HEADERS` 传入 JSON。为了允许本机假器官，`http://127.0.0.1`、`http://localhost` 和 `http://[::1]` 例外可用；其他端点必须是 HTTPS。URL 不允许内嵌用户名或密码。运行时不自动读取 `.env` 文件；`.env.example` 只是 shell 环境变量模板。

模型输出必须能解析为 `choices[0].message.content`，且第一个词必须是 `echo` / `trace` / `migrate` / `sleep` 之一。否则本次 `wake` 在写入 pulse 前失败，环境感知仍留在 `pending` 中。模型不接收私钥、relay 配置、outbox 或任何工具调用能力。它的回答只成为事件 payload 里的 `impulse` 与 `cognition` 元数据。

`cognition` 元数据记录适配器名、模型名和事件种子，使 `metrics` 能统计各器官的脉冲分布。API key 不进入规范事件、签名、摘要、trace、outbox 或 relay 分支。`cognition` 命令只显示是否配置了 key、端点 host 与超时，不显示 key 本身。

交换实验的退出条件：替换器官后，`genesis`、签名哈希链、`agentId`、死亡/复活事件、重放与 `restore` 语义不变；只有脉冲分布、traits 漂移和 `digest` 可以改变。`npm run cognition-demo` 输出该对照实验的机器可读结果。

## 代谢、死亡与复活

- `credits` 是脉冲预算，不是货币。
- 每次 `pulse` 消耗 1 信用；归零时记录死亡。
- `ttlSeconds` 从最近一次 heartbeat / pulse / resurrection 起算；过期在下次 `wake` 或 `status` 中可见。
- `death` 是一等事件，不是异常；死亡后事件流继续保留。
- `resurrection` 授予新的 `maxCredits` 窗口，不删除死亡记录。
- 复活后的 `bodyId` 必然不同于上一个身体，但 `agentId` 不变。

## 分叉

`fork <child-dir>`：

1. 读取父状态摘要与最后一个事件 ID。
2. 为子体生成新的 Ed25519 密钥与 `agentId`。
3. 子体创世事件写入 `lineage`：父 `agentId`、父事件 ID、父状态摘要、继承的 traits 与 memory。
4. 父事件流追加 `fork`，记录子 `agentId` 与子 genesis ID。
5. 父子从此写各自的事件链。

分叉不是复制进程，而是产生一条新的身份历史。

`fork-observer <child-dir>` 用于只读观察体：父体没有 `identity.key` 或不能代表原身份继续签名时，仍可从父状态摘要产生一个新密钥、新 `agentId` 与新创世事件。`lineage.observerFork=true` 标记这是从观察体产生的后续血缘；父事件链不会被追加 `fork` 事件，也不会被改写。它不是原身份复活，而是新身份从旧历史中分叉。

## 本地 HTTP 接口

`serve` 只监听 `127.0.0.1`：

| 方法与路径 | 作用 |
| --- | --- |
| `GET /` | 接口说明 |
| `GET /health` | 存活与摘要 |
| `GET /identity` | 身份、公钥指纹、血缘 |
| `GET /status` | 重放后的状态 |
| `GET /trace?last=N` | 最近 N 个事件 |
| `POST /event` | 注入感知；默认触发一次 `wake` |
| `POST /wake` | 手动唤醒身体 |
| `POST /death` | 记录死亡 |
| `POST /resurrect` | 记录复活 |

请求体限制为 64 KB，不接受凭据，不转发到外部网络。

## 不变量

- 没有 `events.ndjson` 就没有 Agent。
- 没有私钥就不能追加身份事件。
- 事件哈希链断裂或签名失效时，任何重放都必须失败。
- `outbox/` 是派生数据；删除后可从 action 事件重建。
- `bodyId` 不参与身份定义；`agentId` 才参与。
- v0 不写第三方系统，不读取真实用户配置，不依赖 Git 仓库。

## v0 的替代关系

| 真正网络原生运行时 | v0 培养皿替代物 |
| --- | --- |
| 开放网络 relay / pub-sub | loopback HTTP + 感知事件 |
| 内容寻址或分布式日志 | 本地 NDJSON 哈希链 |
| 多主机执行槽 | 不同 `bodyId` 的短命进程 |
| 模型认知 | 确定性冲动适配器 |
| 外部写操作 | 本地 `outbox/` 派生痕迹 |
| 网络身份 | Ed25519 公私钥与创世事件 |

这些替代关系必须被显式记录，避免把培养皿误称为开放互联网生命体。

## Phase 1 扩展：Git relay 事件介质

`relay attach <remote-url>` 把一个栖息地绑定到自有 Git 远端的 `nna-events/<agentId>` 分支。该分支只保存 `events.ndjson` 和一条说明，不保存密钥、outbox 或本地锁。`relay ls <remote-url>` 可枚举 `nna-events/*` 分支，并对每条远端事件链做签名验证后列出身份、事件数、状态摘要与生命周期计数。

写入流程：

1. `fetch` 远端事件分支，读取并验证签名哈希链；
2. 比较本地事件链与远端事件链的最长公共前缀；
3. 只有一端有新事件时，采用较长链；两端都分叉时，`reject` 为默认策略；
4. 用 `--force-with-lease=<remote-head>` 推送新的事件分支 commit；
5. `inject` / `wake` / `die` / `resurrect` / `fork` 都先同步再追加，避免旧身体覆盖网络历史，也避免分叉血缘只留在本地。

`restore <target-dir>` 从远端分支重建一份独立栖息地，可复制身份密钥使其具备继续写历史的能力，也可用 `--no-identity` 生成只读观察体。恢复体不是原进程重启：它有新的本地目录、新的临时文件，后续 `wake` 会产生新的 `bodyId`，但 `agentId`、事件链和状态摘要连续。

`metrics` 返回 Phase 1 指标：身份连续、身体更替、倾向漂移、待办积压、代谢余量、观测污染、环境事件比例、脉冲比例、复活延迟、事件数与耗时。

当前 relay 支持 GitHub HTTPS/SSH 远端和本地 bare Git 测试远端。生产环境只应使用用户自有、私密的 GitHub 远端；本地路径仅供测试。
