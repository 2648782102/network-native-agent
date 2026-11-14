# 标注协议

日期：2026-11-15（Asia/Shanghai）

## 目的

为 18 个任务建立独立、可审计的意图标签。没有一致性验证的标签不能用于评价模型。

## 标签

只允许：`echo`、`trace`、`migrate`、`sleep`。

## 盲标流程

1. 运行 `node scripts/annotation-tool.mjs sheet evidence/annotation/blind-sheet.json` 生成盲标表；表中不含既有 `intent`。
2. 至少两名标注者独立完成，不得查看旧标签或彼此结果。
3. 标注结果写入 `evidence/annotation/annotations.json`，格式为数组：

```json
[
  { "annotator": "a", "taskId": "calm", "label": "sleep" }
]
```

4. 运行：

```bash
node scripts/annotation-tool.mjs agree evidence/annotation/annotations.json evidence/annotation/agreement.json
```

5. 只有“至少两名标注者一致”的任务才可用于语义指标；其余任务标为 unusable。

## 当前状态

现有 18 个任务标签是单人、未验证的预注册标签。`evidence/annotation/label-risk.json` 显示：

- 4 个任务存在多义线索冲突；
- 5 个任务的标签与文本线索不一致；
- 因此这些标签不能作为模型语义能力的金标准。

在独立标注完成前，`intentMatchRate` 只能作为任务集可分性的诊断值，不能用于模型排名。

工具链自检：`npm run annotation:simulate` 生成两套明确标记为 `simulated: true` 的独立标签，再运行 `agree`，确认 Cohen's kappa、不可用任务列表和报告格式正常。当前自检结果为 kappa 0.4836、18 个任务中 7 个不一致；这些是工具链样例，不是人类金标准。
