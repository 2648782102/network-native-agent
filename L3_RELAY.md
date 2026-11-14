# L3 真实网络测试边界

日期：2026-11-12（Asia/Shanghai）

这里的「真实网络」指 L3：**用户自有、私密的 GitHub 远端**，通过真实 GitHub SSH/HTTPS 传输签名事件链，验证跨执行目录恢复。它不等于开放互联网栖息地，也不等于把 Agent 放进公网。L4 仍未启用。

## 1. 研究对象

L3 只回答一个问题：

> 当本地身体 A 及其 `identity.key` 被销毁后，另一台机器/目录里的身体 B 能否只凭用户自有私密 GitHub relay 中的签名事件史，重放同一个 `agentId` 与死亡前的状态？

这不是意识、生命或公网存活实验。它验证的是：网络事件史是否能承担身份连续、记忆连续和死亡记录，而不是本地进程承担。

## 2. 允许的远端

- 仓库必须归用户所有，或用户明确授权。
- 仓库必须是 Private。
- 远端必须是 `git@github.com:...`、`ssh://git@github.com/...` 或 `https://github.com/...`。
- 默认分支不能包含 `identity.key`、`relay.json`、`habitat.lock`、`outbox/`、`.env*`、私钥或本地栖息地文件。
- 实验只写 `nna-events/<agentId>` 分支。
- 事件分支只允许 `events.ndjson` 与简短 `README.md`。
- 所有事件都由本地 Ed25519 身份签名；远端只承担传输与重放。

## 3. 明确禁止

- 不写第三方仓库、公共仓库、邮箱、社交平台、支付系统或未授权 API。
- 不把真实 API key、Cookie、Authorization、OTP、密码或私有文件内容写入事件流。
- 不自动传播、扫描、批量注册、群发、刷量或外链推广。
- 不把 L3 结果包装成「开放互联网生命体」。
- 不绕过登录、验证码、风控、付费墙、速率限制或安全提示。
- 不在默认分支或代码分支提交运行时栖息地数据。
- 不启用真实模型器官；L3 只比较运行时事件链。

## 4. 实验前门：`preflight`

```bash
node scripts/l3-relay.mjs preflight git@github.com:OWNER/PRIVATE_RELAY.git
```

优先要求本机 `gh` 已安装并已认证，因为脚本可用 `gh api repos/OWNER/REPO` 确认仓库是 Private。若没有 `gh`，可把已连接 GitHub API 客户端返回的仓库 JSON 放入 `NNA_L3_REPO_ATTESTATION`，脚本会验证 `full_name` 与 `private/visibility` 后继续。SSH key 可以推 Git，但不能单独查询仓库私密属性。

`preflight` 不写入远端，只做：

1. 解析并校验 GitHub remote；
2. 查询仓库 `full_name`、`private`、`default_branch`；
3. 确认 `private === true`；
4. fetch 默认分支并拒绝运行时敏感路径；
5. 记录当前 `nna-events/*` refs 作为基线；
6. 把报告写到 `work/l3-relay-report.json`。

任一检查失败，不得运行 `experiment`。实验还需在读取 preflight 报告后显式设置 `NNA_L3_PREFLIGHT_APPROVED=1`，防止看到审计结果前直接写入远端。

## 5. 实验命令

阅读 preflight 报告并确认后：

```bash
node scripts/l3-relay.mjs experiment git@github.com:OWNER/PRIVATE_RELAY.git --yes
```

`--yes` 与 `NNA_L3_PREFLIGHT_APPROVED=1` 共同构成显式写授权。脚本会：

1. 在临时目录创建身体 A，绑定私密远端；
2. 写入合成网络天气、一次确定性脉冲、显式死亡，并同步到 `nna-events/<agentId>`；
3. 删除身体 A 整个目录，包括 `identity.key`；
4. 用一个临时的异源「恢复锚点」附到远端事件分支，只用于读取远端历史；
5. 生成无身份密钥的只读观察体 B，从远端事件史重放同一个 `agentId`、死亡记录与状态摘要；
6. 用 `fork-observer` 从只读观察体 B 生成新血缘：新密钥、新 `agentId`、lineage 指向原身份，且父事件链不变；
7. 审计事件分支、历史提交路径、默认分支未被改动、事件流中无凭据样式文本；
8. 写完整 JSON 报告到 `work/l3-relay-report.json` 并打印。

刻意不做「原身份复活」：身体 A 的私钥已销毁，原身份不能继续签名。只读恢复能证明历史连续；新 fork 能证明从死亡历史中产生新血缘。若把私钥复制到另一个目录再复活，证明力反而会被削弱。

## 6. 报告里应看到什么

关键字段：

- `valid: true`；
- `repository.private: true`；
- `experiment.genesisAgentId === experiment.observerRestoreResult.agentId`；
- `experiment.restoredObserverHasIdentityKey: false`；
- `experiment.observerReplayValid: true`；
- `experiment.observerIdentityContinuity: true`；
- `experiment.lineFork.childAgentId !== experiment.genesisAgentId`；
- `experiment.lineFork.parentAgentIdInLineage === experiment.genesisAgentId`；
- `audits.branchAudit.files` 只包含 `events.ndjson` 与 `README.md`；
- `audits.historyAudit.forbidden` 为空；
- `audits.credentialLikeTextInHabitat` 为空；
- `boundaries.publicInternet: false`；
- `boundaries.defaultBranchUntouched: true`。

报告里 `remoteUrl` 对 SSH 远端会显示仓库地址；HTTPS 远端会脱敏为 `<https-redacted>`，避免凭据样式 URL 进入报告。

## 7. 清理与回滚

L3 实验不会删除远端分支。若事后要清理，需用户明确决定，并单独执行：

```bash
git push <remote> --delete nna-events/<agentId>
```

删除前先保存报告；删除远端事件分支等于删除该身份在 L3 里的网络历史。本地临时身体 A/B/fork 在脚本结束时自动删除。`work/l3-relay-report.json` 被 `work/` 忽略，不进入 Git。

## 8. 与 L4 的区别

| 维度 | L3 | L4 |
| --- | --- | --- |
| 远端 | 自有私密 GitHub repo | 开放网络 relay / 多主机栖息地 |
| 身份材料 | 本地 Ed25519，私钥可销毁 | 需专用身份、预算、审计与生命周期规则 |
| 数据 | 合成网络天气与签名事件 | 真实网络噪声、延迟、限流、冲突 |
| 写入 | 只写 `nna-events/*` 分支 | 可能影响多个授权端点 |
| 风险 | 私有仓库里的分支与事件历史 | 外部影响、凭据、速率、第三方用户 |
| 当前状态 | 脚本与边界已准备，需私有仓库后执行 | 未启用，需单独批准 |

L3 成功只说明：自有私密 Git 远端能承担签名事件史的跨身体恢复。它不说明开放网络存活，也不说明模型智能、意识或不可控行为已实现。

## 9. 首次实测记录（2026-11-12）

已使用私有仓库 `OWNER/relay-sandbox` 完成首次真实网络 L3 实验，报告保留在被忽略的 `work/l3-relay-report.json`，不进入 Git。

- `valid: true`；
- 远端分支：`nna-events/nna_demo000000000001`；
- 创世身份与只读恢复身份一致：`nna_demo000000000001`；
- 远端事件数：19；恢复状态摘要：`8ec48aef729d6e9715c40dd41bda9d3a305267db9a7321fe94fdadd9842367a9`；
- 身体 A 与 `identity.key` 被销毁；只读观察体不含身份密钥；
- 原身份保持死亡：`deaths=1`、`resurrections=0`；没有通过复制私钥伪装复活；
- 新血缘：`nna_demo000000000002`，lineage 指向原身份，replay 有效；
- 远端事件分支只含 `events.ndjson` 与 `README.md`；历史审计无额外文件；
- 无凭据样式文本；未调用真实模型；未写默认分支或第三方系统。

这次实测验证的是「自有 Private GitHub 远端承载签名事件史并完成只读跨身体恢复」，不是开放网络存活。
