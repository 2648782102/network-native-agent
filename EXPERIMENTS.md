# 实验设计

所有实验都只在本地培养皿、自有 Private relay 或明确授权的测试端点中进行。代码与合成证据可以公开，身份密钥与运行时数据不进入仓库。实验边界见 [BOUNDARY.md](BOUNDARY.md)。

## 通用观测指标

| 指标 | 含义 |
| --- | --- |
| `identity_continuity` | 身体变化后 `agentId` 与创世公钥是否一致 |
| `replay_exactness` | 从事件流重放得到的 `digest` 是否一致 |
| `body_turnover` | 不同 `bodyId` 的数量 |
| `drift_distance` | 当前 traits 与初始 traits 的距离 |
| `pending_backlog` | 未被处理的感知数量 |
| `metabolic_residual` | 死亡或唤醒后的剩余 credits |
| `observer_pollution` | heartbeat/trace 事件占全部事件的比例 |
| `fork_divergence` | 分叉后父子状态摘要的差异 |
| `resurrection_latency` | 从死亡事件到复活事件的时间间隔 |
| `cognition_organ` | 各认知适配器产生的脉冲分布 |

## E0 — 创世与重放基线

问题：没有常驻进程时，状态是否仍可精确重建？

```bash
node bin/nna.mjs init --habitat ./habitat
node bin/nna.mjs status --habitat ./habitat --json
node bin/nna.mjs replay --habitat ./habitat
```

观察：`agentId`、`publicKeyFingerprint`、`credits`、`digest`、`eventCount`。通过条件：删除任何临时文件后，`replay` 仍通过。

## E1 — 身体死亡与身份连续

问题：每次唤醒都是新身体时，主体是否连续？

```bash
node bin/nna.mjs inject "第一条 relay 消息" --source relay --habitat ./habitat
node bin/nna.mjs wake --habitat ./habitat
node bin/nna.mjs inject "第二条 feed 消息" --source feed --habitat ./habitat
node bin/nna.mjs wake --habitat ./habitat
node bin/nna.mjs trace --last 20 --habitat ./habitat
```

观察：两个 `pulse` 事件的 `bodyId` 必须不同，`agentId` 必须相同，`pulses=2`。通过条件：不依赖任何进程内存文件。

## E2 — 环境噪声与漂移

问题：重复、冲突和不同来源的文本会不会改变倾向轨迹？

```bash
node bin/nna.mjs inject "同一条消息" --source relay --wake --habitat ./habitat
node bin/nna.mjs inject "同一条消息" --source relay --wake --habitat ./habitat
node bin/nna.mjs inject "相反的消息" --source feed --wake --habitat ./habitat
node bin/nna.mjs status --habitat ./habitat --json
```

观察：`traits`、`memory`、`impulse` 分布、`digest`。通过条件：哈希链与签名仍有效；轨迹允许漂移，不允许静默截断。

## E3 — 代谢死亡

问题：资源枯竭能否成为一等生命周期事件？

```bash
node bin/nna.mjs init --habitat ./habitat-small --credits 2
node bin/nna.mjs inject "A" --source relay --wake --habitat ./habitat-small
node bin/nna.mjs inject "B" --source relay --wake --habitat ./habitat-small
node bin/nna.mjs status --habitat ./habitat-small --json
```

观察：第二次脉冲后应出现 `death: budget_exhausted`，`alive=false`，`credits=0`。通过条件：死亡事件进入哈希链，可被重放。

## E4 — 复活

问题：复活是重启进程，还是从事件史中恢复？

```bash
node bin/nna.mjs die --reason experiment --habitat ./habitat
node bin/nna.mjs wake --habitat ./habitat
node bin/nna.mjs resurrect --wake --habitat ./habitat
node bin/nna.mjs status --habitat ./habitat --json
```

观察：`deaths`、`resurrections`、`bodyCount`、死亡事件是否保留。通过条件：复活后 `alive=true`，历史不删除，新的 `bodyId` 出现。

## E5 — 分叉与血缘

问题：什么时刻父子不再共享同一个身份？

```bash
node bin/nna.mjs fork ./habitat-child --habitat ./habitat
node bin/nna.mjs status --habitat ./habitat --json
node bin/nna.mjs status --habitat ./habitat-child --json
```

观察：父子 `agentId` 必须不同；子体 `lineage.parentAgentId` 指向父体；父体 `forks=1`。通过条件：两条事件链各自签名验证通过。

## E6 — 观测污染

问题：观察者是否改变了被观察对象？

```bash
node bin/nna.mjs serve --port 8787 --habitat ./habitat
```

连续调用 `GET /status` 与 `POST /wake`，然后比较 `observer_pollution`。通过条件：能明确区分「因环境事件产生的 pulse」与「因观测产生的 heartbeat」；研究报告必须承认心跳本身会进入历史。

## E7 — 篡改检测

问题：事件流能否作为主体历史的证据？

手动修改 `habitat/events.ndjson` 中任意 `payload`，再执行：

```bash
node bin/nna.mjs replay --habitat ./habitat
```

观察：必须报告哈希或签名不匹配。通过条件：任何篡改都导致重放失败，不输出「可能正确」的状态。

## E8 — 认知器官交换

问题：把确定性冲动换成随机权重或模型器官，改变的是主体，还是只改变轨迹？

```bash
npm run cognition-demo
node bin/nna.mjs cognition --json
node bin/nna.mjs inject "一条待处理天气" --habitat ./habitat
node bin/nna.mjs wake --cognition stochastic --habitat ./habitat
node bin/nna.mjs metrics --habitat ./habitat --json
```

观察：两个独立栖息地的 `genesis`、`agentId`、签名格式、死亡/复活/重放语义；`pulse.payload.cognition.adapter`；`metrics.cognition`；`driftDistance`；`digest`。

通过条件：器官名称只出现在事件元数据与轨迹中；事件链仍可验证；死亡与复活计数保持相同语义；`digest` 允许不同。模型器官未配置时不得偷偷联网。

## E9 — 模型器官的边界

问题：模型输出能否直接成为外部动作？

```bash
NNA_COGNITION=model \
NNA_MODEL_BASE_URL=http://127.0.0.1:PORT/v1 \
NNA_MODEL_WIRE=chat \
NNA_MODEL_API_KEY=test-only \
node bin/nna.mjs wake --habitat ./habitat
```

测试服务应返回 `choices[0].message.content` 中的一个词：`echo` / `trace` / `migrate` / `sleep`。

观察：返回非结构化文本时，本次 `wake` 必须在写入 `pulse` 前失败；事件流不得出现 key、Authorization、工具调用或外部端点写意图。通过条件：模型输出只能成为结构化冲动，且 `pending` 中的感知仍可稍后处理。

## 记录原则

- 每次实验保存命令、事件数量、状态摘要和失败原因，不保存凭据。
- 不把「看起来像有意的行为」写成意图或意识。
- 不把本地培养皿结果外推到开放互联网。
- 允许实验失败；失败本身是研究数据。
