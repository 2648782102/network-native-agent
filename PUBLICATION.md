# 公开仓库检查清单

这份清单用于把研究原型发布为公开代码仓库。它不改变实验边界，也不把本地培养皿结果解释为公网存活、智能或意识证据。

## 公开什么

- 运行时代码、CLI、测试与演示脚本；
- 研究文档、协议、决策记录与路线图；
- 合成的归档证据：`evidence/formal-experiment/`、`evidence/model-e2e/`、`evidence/model-qualification/`、`evidence/model-stability/`、`evidence/baseline-stability/`、`evidence/annotation/`；
- 小样本复现数据：`examples/sample-run/` 与 `evidence/sample-run/`；
- 证据图表：`evidence/figures/`；
- 脱敏样例：`examples/l4-report.sample.json`、`examples/lifecycle.html`。

## 不公开什么

- `habitat/`、`work/` 与任何本地实验目录；
- `identity.key`、`*.key`、`*.pem`、`.env` 与 `.env.*`；
- 真实模型 API key、GitHub token、SSH 私钥或 relay 凭据；
- 真实个人账号、真实 relay 仓库名与本地绝对路径；
- 未脱敏的第三方数据或真实用户内容。

这些路径已被 `.gitignore` 排除。提交前仍应运行公开审计，不要只依赖忽略规则。

## 提交前验证

```bash
npm run check
npm run audit:public
git status --short
```

`npm run check` 会跑单元测试、demo、L4 样例验证；`npm run audit:public` 会扫描所有 Git 跟踪文件中的账号、真实 relay 名、内部模型别名、本地路径、网关端口与凭据样式。

图表由 `npm run figures` 从归档证据生成，数字不是手工填写。当前实现调用 AntV 图表服务；若不想依赖外部服务，图表 PNG 已归档，读者不需要重新渲染。

归档 PNG 在 Manifest 中带有 `sha256`，并由测试校验。相同证据重新渲染会得到相同字节；数值变化时，哈希也会变化，避免图表与数据悄悄脱节。

`npm run sample:run` 每次都会生成新身份，因此 `agentId`、`digest`、冲动分布和意图匹配率都会变化。稳定的是运行时契约：事件链可重放、冲动属于四选一、事件中不含凭据。不要把某一次样例的百分比当作基准。

提交后，在干净工作树上再运行：

```bash
npm run verify:repository
```

它会克隆仓库、重跑测试、核对归档证据并扫描凭据样式。工作树不干净时脚本会拒绝运行。

## Git 历史

公开前必须确认历史提交信息与历史文件不含内部模型别名、真实 relay 名或个人账号。若历史不干净，不要直接把旧历史推到公共仓库；应基于当前内容建立新的初始提交，并保留旧仓库作为私有备份。

推荐的首次公开流程：

```bash
git checkout --orphan public-release
git add -A
git commit -m "Initial public research release"
```

保留原来的 `main` 分支作为私有备份。是否删除、重命名或强制推送远端分支，应在确认备份后再单独决定。

## GitHub 设置

- 仓库可见性改为 Public 前，先确认默认分支只包含公开内容；
- 启用 Secret Scanning 与 Dependabot alerts；
- 在 About 中填写一句话描述、主页与 topics；
- 确认 Actions 只运行测试与离线 demo，不使用仓库 Secrets 写入第三方系统；
- 不把 relay 事件分支放进代码仓库。

标签、Discussions 与安全开关无法通过 `git push` 同步。标签可用 `NNA_GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=... npm run repo:labels` 一次性创建；没有令牌时请在仓库 Labels 页面手动建 `dependencies`、`npm`、`github-actions`、`evidence`、`protocol`。

## 发布后声明

公开仓库只提供可复现的运行时契约与离线实验。它不代表：

- Agent 已在开放互联网中存活；
- 模型具备智能、意图或意识；
- 项目已获得公网写入授权；
- 任何第三方系统可以被自动访问或修改。

真实开放网络实验仍需单独的边界审查、授权端点、预算与起止时间。
