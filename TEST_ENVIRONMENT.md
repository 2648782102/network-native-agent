# 测试环境搭建与运行

日期：2026-11-11（Asia/Shanghai）

这份文档回答的是「怎么搭一个能反复做实验、不会污染仓库、又不会越过 [BOUNDARY.md](BOUNDARY.md) 的测试环境」。这里的测试环境不是云主机，也不是公网 relay，而是一套本地可复现的培养皿。

## 0. 先确定分层

不要把代码测试、实验环境和真实网络实验混在一起：

| 层 | 用途 | 位置 | 是否联网 | 是否进 Git |
| --- | --- | --- | --- | --- |
| L0 单元/集成测试 | 每次改代码都跑，验证运行时不变量 | 临时目录、`npm test` | 否 | 否 |
| L1 演示实验 | 验证生命周期、网络恢复、器官交换 | 临时目录、`npm run demo` 等 | 否 | 否 |
| L2 本地测试环境 | 手动作实验：HTTP、bare relay、多个身体、假模型器官 | `work/test-env/` | loopback / 本地文件 | 否 |
| L3 自有私密 GitHub relay | 真网络条件下的跨目录恢复 | 用户自有私有远端 | 是，但受边界审查 | 事件分支只存签名事件 |
| L4-simulation | 开放网络条件的可复现风险模型 | 本地隔离 relay / 临时目录 | 否 | 否 |
| L4-LAN | 受控局域网 HTTP 栖息地 | 本机 habitat + LAN token/CIDR | 局域网授权设备 | 否 |
| L4 真实开放网络 | 真实长期栖息地 | 未启用 | 是 | 需单独批准 |

当前仓库提供 L0、L1、L2、L3、`L4-simulation` 与受控 `L4-LAN`。L3 已在用户自有 Private GitHub relay 上执行；L4 当前模拟延迟、重复、冲突和限流，并可显式开启带 token/CIDR 的局域网 habitat。公网 L4 明确未启用。

多设备测试环境用 `npm run env:network` 生成：它会检测局域网地址，写入 `work/network-test-env/commands.sh`，包含设备 A 启动命令和设备 B 的 health/status/event 命令。公网入口不自动生成；公网边界见 [PUBLIC_TEST.md](PUBLIC_TEST.md)。

## 1. 前置条件

- Node.js `20.11+`；CI 覆盖 20 / 22 / 24。
- `git`，用于本地 bare relay 与事件分支。
- 不需要 `npm install`：项目没有第三方运行时依赖。
- 不需要真实 API key；模型器官可以用本地 loopback 假器官测试。
- 代码仓库可以公开；不要把本地实验目录、identity key、relay 配置或环境变量推到远端。

检查：

```bash
node --version
git --version
git status --short --branch
```

## 2. 一键生成 L2 测试环境

在仓库根目录：

```bash
npm run env:init
npm run env:check
npm run env:report
```

`env:init` 会创建被 `.gitignore` 排除的 `work/test-env/`：

| 路径 | 用途 |
| --- | --- |
| `work/test-env/relay.git` | 本地 bare Git relay |
| `work/test-env/body-a` | 可写主体 A，绑定 relay |
| `work/test-env/body-b` | 从远端事件史恢复的主体 B，继承身份与 relay 配置 |
| `work/test-env/observer` | 只读观察体，无 `identity.key`、无 relay 配置 |
| `work/test-env/small` | 2 credits 的代谢样本，可用于预算耗尽实验 |
| `work/test-env/model` | 保留一条待处理感知，供假模型器官测试 |
| `work/test-env/manifest.json` | 环境元数据 |
| `work/test-env/README.md` | 生成环境的目录说明 |

所有路径都是本地培养皿。`relay.git` 只是文件系统里的 bare Git 仓库，不代表公网存活。

`env:check` 会验证：Node/Git、bare relay、各栖息地重放、身份材料是否符合预期、relay 对齐、一次合成事件能否写入并发布、`relay ls`、metrics、认知接口、事件数据里没有测试 key、实验目录是否被 Git 忽略。

注意：`env:check` 会向 `body-a` 注入并唤醒一条合成 smoke 事件，因此远端事件数会增加。这是预期行为，不是测试污染事故。`npm test`、`npm run demo` 等自动化实验使用独立的临时目录，不会读写 `work/test-env/`。`NNA_TEST_ROOT` 必须指向专用目录；脚本会拒绝仓库根目录或其父目录，防止 `env:reset` 误删仓库。

## 3. L0 / L1：每次改代码都要跑

```bash
npm run check
```

它依次运行：

```text
npm test              12 项自动化检查
npm run demo          生命周期与篡改检测
npm run network-demo  本地 bare relay 的跨身体恢复
npm run cognition-demo 认知器官交换对照
```

这些脚本用 `mkdtemp` 创建独立临时目录并在结束时删除，适合作为提交前门禁。CI 也会在 Node 20 / 22 / 24 上跑 `npm run check`。

## 4. L2：本地 HTTP 栖息地

启动：

```bash
npm run env:serve
```

默认监听 `127.0.0.1:8787`，操作 `body-a`。另开终端：

```bash
curl -s http://127.0.0.1:8787/status | jq
curl -s -X POST http://127.0.0.1:8787/event \
  -H 'content-type: application/json' \
  -d '{"source":"relay","text":"一条来自测试台的网络天气"}' | jq
curl -s 'http://127.0.0.1:8787/trace?last=10' | jq
```

端口冲突时可覆盖：

```bash
NNA_TEST_HABITAT_PORT=8797 npm run env:serve
```

`serve` 只绑定 loopback，不是公开服务。停止用 `Ctrl+C`。

## 5. L2：跨身体恢复与 Relay 实验

查看当前 relay 状态：

```bash
node bin/nna.mjs relay status --habitat work/test-env/body-a --json
node bin/nna.mjs relay ls work/test-env/relay.git --json
```

向 A 写一条事件：

```bash
node bin/nna.mjs inject "迟到的环境消息" --source feed --wake --habitat work/test-env/body-a --json
node bin/nna.mjs sync --habitat work/test-env/body-a --json
```

把 B 对齐远端历史：

```bash
node bin/nna.mjs sync --habitat work/test-env/body-b --json
node bin/nna.mjs status --habitat work/test-env/body-b --json
```

死亡与异地复活：

```bash
node bin/nna.mjs die --reason test-env-body-death --habitat work/test-env/body-a --json
node bin/nna.mjs restore work/test-env/body-b-reborn --habitat work/test-env/body-a --json
node bin/nna.mjs resurrect --wake --credits 6 --habitat work/test-env/body-b-reborn --json
node bin/nna.mjs replay --habitat work/test-env/body-b-reborn --json
```

新目录是新的身体，不是 A 的进程重启。它从签名事件史里恢复 `agentId`，再追加复活和新脉冲。

只读观察体：

```bash
node bin/nna.mjs status --habitat work/test-env/observer --json
node bin/nna.mjs replay --habitat work/test-env/observer --json
```

`observer` 没有 `identity.key`，也没有 relay 配置；尝试向它注入新事件会失败。这种失败是身份边界的一部分。

## 6. L2：假模型器官

模型器官默认关闭。测试时不要接真实模型 key，用仓库自带的 loopback 假器官：

```bash
npm run env:model
```

它会打印一组 `export` 命令。另开终端，复制执行这些命令，然后：

```bash
node bin/nna.mjs inject "一条待处理天气" --source relay --habitat work/test-env/model --json
node bin/nna.mjs wake --habitat work/test-env/model --json
node bin/nna.mjs trace --last 10 --habitat work/test-env/model --json
```

默认假器官返回 `migrate`。可用环境变量改变行为：

| 变量 | 作用 |
| --- | --- |
| `NNA_TEST_MODEL_IMPULSE` | 返回 `echo` / `trace` / `migrate` / `sleep` 之一 |
| `NNA_TEST_MODEL_INVALID=1` | 返回非结构化文本，验证 pulse 写入前被拒绝 |
| `NNA_TEST_MODEL_PORT` | 改假器官端口，默认 `8788` |
| `NNA_TEST_MODEL_API_KEY` | 自定义假 key；值不会被打印 |

示例：

```bash
NNA_TEST_MODEL_IMPULSE=sleep NNA_TEST_MODEL_PORT=8798 npm run env:model
```

再按打印出的命令导出 `NNA_MODEL_URL` 等变量。不要配置真实 API key：这个测试器官只验证结构化冲动、Authorization 传递与 key 不进入事件链，不验证模型智能。

验证非结构化输出：

```bash
NNA_TEST_MODEL_INVALID=1 npm run env:model
```

此时 `wake` 应失败，`status` 里 `pulses=0`、`pending` 仍保留待处理感知；切回正常假器官后，可重新处理同一条感知。

真实模型接入不在此测试台内完成。配置用户自有 HTTPS 模型和专用测试 key 后，可运行 `npm run model:smoke` 做最小结构化冲动测试；细节见 [MODEL_SMOKE.md](MODEL_SMOKE.md)。

## 7. 观测与指标

```bash
node bin/nna.mjs status --habitat work/test-env/body-a --json
node bin/nna.mjs metrics --habitat work/test-env/body-a --json
node bin/nna.mjs trace --last 20 --habitat work/test-env/body-a --json
node bin/nna.mjs replay --habitat work/test-env/body-a --json
```

重点看：

- `agentId` 是否连续；
- `bodyCount` 是否随 `wake` 增长；
- `digest` 是否随事件变化；
- `observerPollution` 是否因 heartbeat/trace 上升；
- `driftDistance` 是否随不同器官变化；
- `relay status` 中 `divergent` 是否保持 `false`。

## 8. 重置与清理

重建整套测试台：

```bash
npm run env:reset
```

只删除：

```bash
rm -rf work/test-env
```

不要提交这些路径：

```text
work/
habitat/
*.key
*.pem
.env
.env.*
```

`.env.example` 是唯一允许提交的示例；运行时不会自动读取 `.env`，环境变量需要在 shell 导出，或由你自己的本地加载器提供。

## 9. 环境变量矩阵

| 变量 | 用于 | 默认 | 说明 |
| --- | --- | --- | --- |
| `NNA_TEST_ROOT` | 测试台脚本 | `work/test-env` | 相对仓库根目录解析 |
| `NNA_TEST_HABITAT_PORT` | `env:serve` | `8787` | loopback HTTP 端口 |
| `NNA_TEST_MODEL_PORT` | `env:model` | `8788` | loopback 假器官端口 |
| `NNA_TEST_MODEL_IMPULSE` | `env:model` | `migrate` | 假器官结构化冲动 |
| `NNA_TEST_MODEL_INVALID` | `env:model` | 空 | `1`/`true`/`yes` 返回非结构化文本 |
| `NNA_TEST_MODEL_API_KEY` | `env:model` | 测试专用 key | 自定义假 key，不打印 |
| `NNA_COGNITION` | 运行时 | `deterministic` | 可设 `stochastic` 或 `model` |
| `NNA_MODEL_BASE_URL` | 模型器官 | 空 | 兼容 `/models` 与 `/responses` 的网关 base URL |
| `NNA_MODEL_URL` | 模型器官 | 空 | HTTPS 或 loopback HTTP |
| `NNA_MODEL_API_KEY` | 模型器官 | 空 | 只从进程环境变量读取 |
| `NNA_MODEL_NAME` | 模型器官 | `default` | 写入事件元数据 |
| `NNA_MODEL_TIMEOUT_MS` | 模型器官 | `15000` | 请求超时 |
| `NNA_MODEL_EXTRA_HEADERS` | 模型器官 | 空 | 可选 JSON 对象，仅允许非认证请求头 |

## 10. L3 真实私有 GitHub relay

L3 的边界、preflight、实验命令、报告字段与清理规则见 [L3_RELAY.md](L3_RELAY.md)。要点：

1. 使用专用 Private 仓库，不用主代码仓库承载事件分支；
2. 本机 `gh` 已认证，先跑 `node scripts/l3-relay.mjs preflight <remote-url>`；
3. 只写 `nna-events/<agentId>` 分支，且分支只含 `events.ndjson` 与 `README.md`；
4. 身体 A 连同 `identity.key` 被销毁后，只读观察体从远端事件史恢复同一身份；
5. 原身份不复活；新 fork 以 lineage 指向原身份，作为后续历史；
6. 报告写入被忽略的 `work/l3-relay-report.json`；
7. 不把 L3 结果宣传成开放互联网存活。

快捷命令：

```bash
npm run l3:preflight -- git@github.com:OWNER/PRIVATE_RELAY.git
npm run l3:experiment -- git@github.com:OWNER/PRIVATE_RELAY.git --yes
```

`preflight` 不写远端；`experiment` 必须带 `--yes`，表示已读报告并授权写事件分支。
