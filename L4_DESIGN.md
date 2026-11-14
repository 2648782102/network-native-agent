# L4 开放网络研究边界与设计

日期：2026-11-14（Asia/Shanghai）

L4 研究的是：当事件传输暴露在更不可信、更不可预测的网络条件中时，Agent 运行时是否仍能把身份、死亡、恢复和血缘建立在签名事件史上，而不是建立在某个可达端点上。

L4 不宣称开放互联网生命体，不接真实模型 key，不写第三方系统，不自我传播，不绕过速率限制，不把运行时隐喻写成意识主张。

## 1. L3 到 L4 的变化

| 维度 | L3 | L4 |
| --- | --- | --- |
| 传输介质 | 用户自有 Private GitHub relay | 多个授权 relay / 可观察的开放网络条件 |
| 主要风险 | 私钥泄露、误写默认分支 | 延迟、重复、冲突、限流、镜像污染、错误端点 |
| 身份来源 | 私有签名事件链 | 仍然是私有签名事件链；公开镜像只能观察，不能授权 |
| 恢复语义 | 只读恢复同一身份，不复制私钥 | 相同；开放端点不能替代私钥或签名历史 |
| 结论边界 | 私有 GitHub 能承载跨身体恢复 | 开放网络条件可被观察与审计，但不产生公网生命体证据 |

## 2. 当前实现范围：`L4-simulation`

当前落地的是受控 L4 研究基座，不是公网运行：

- 两个本地隔离 Git relay，分别模拟私有事件源和公开只读镜像；
- 模拟正向延迟、重复读取、冲突快照、限流重试与有序私有历史；
- 私有 relay 继续承载签名事件链；
- 公开镜像只承载只读快照，冲突会被记录，不会覆盖私有历史；
- 身体 A 死亡并销毁私钥后，身体 B 从私有历史只读恢复；
- 观察体通过 `fork-observer` 产生新血缘，父链不变；
- 报告写入被 Git 忽略的 `work/l4-simulation.json`，并可通过 `verify` 离线审计。

这个阶段证明的是：**开放网络式的噪声、冲突和限流可以被纳入可复现实验，同时不把身份来源交给不可信端点。** 它不证明公网环境、长期存活、分布式共识或模型智能。

## 3. 允许与禁止

允许：

- loopback、临时目录、本地 bare Git relay；
- 用户明确授权的多个 relay；
- 合成文本、延迟、重复、乱序、冲突与限流模型；
- 只读公开镜像与可验证报告。

禁止：

- 写第三方仓库、社交平台、邮箱、支付系统、公共 API；
- 扫描、注册、群发、传播、刷量、自动推广；
- 真实 API key、Cookie、Authorization、OTP 或私人文件进入事件；
- 绕过登录、验证码、风控、速率限制或安全提示；
- 把公开镜像当成身份权威；
- 把 `L4-simulation` 写成公网生命体实验。

## 4. 命令

```bash
node scripts/l4-open-network.mjs simulate --report work/l4-simulation.json
node scripts/l4-open-network.mjs verify work/l4-simulation.json
```

`simulate` 只创建临时目录里的本地 relay，不联网。`verify` 读取已有报告并离线校验关键字段。

## 5. 报告验收字段

- `phase === 'L4-simulation'`
- `valid === true`
- `networkConditions.conflictDetected === true`
- `identity.genesisAgentId === identity.restoredAgentId`
- `identity.originResurrected === false`
- `identity.privateKeyCopied === false`
- `lifecycle.observerReplayValid === true`
- `lifecycle.lineageParentAgentId === identity.genesisAgentId`
- `boundaries.publicInternet / thirdPartySystems / realModelApiKey / defaultBranchTouched / selfPropagation / credentialsInEvents` 全为 `false`

## 6. 真实开放 relay 的额外门槛

未来若要把 L4 从模拟升级到真实开放网络端点，必须另行满足：

1. 专用身份、专用预算、专用域名 / repo / relay；
2. 所有可写端点归用户所有或已获明确授权；
3. 明确实验起止时间、资源上限、数据留存与清理规则；
4. 不写默认分支、不收集第三方数据、不携带凭据；
5. 记录真实延迟、重复、冲突、限流与恢复数据；
6. 事后审计；代码可公开，但运行时数据、身份密钥与 relay 凭据不得进入仓库。

在这些条件成立前，本仓库只运行 `L4-simulation`。
