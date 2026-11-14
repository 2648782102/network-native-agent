# 真实模型器官接入测试

当前代码已经支持真实模型器官。接入不需要改核心运行时，只需要显式设置环境变量。

## 边界

- 默认不调用模型。
- 只有显式设置 `NNA_COGNITION=model`、模型端点与 `NNA_MODEL_API_KEY` 才会启用。
- URL 必须是 HTTPS，或本机 loopback HTTP 测试端点；不能内嵌凭据。
- API key 只从进程环境变量读取，不进入事件、outbox、Git relay、日志或报告。
- 模型只能返回 `echo` / `trace` / `migrate` / `sleep` 四选一；非结构化输出会在写入 pulse 前失败。
- 这次测试只验证“结构化冲动适配”，不验证模型智能、意识或自主行为。

## 使用专用测试 key

不要使用主力生产 key。建议创建一个便宜、低配额、可随时删除的专用测试 key。

```bash
export NNA_COGNITION=model
export NNA_MODEL_BASE_URL='https://your-model-gateway.example/v1'
export NNA_MODEL_WIRE=responses
export NNA_MODEL_API_KEY='你的专用测试key'
export NNA_MODEL_NAME='你的模型名'
export NNA_MODEL_TIMEOUT_MS='15000'

npm run model:smoke
```

脚本会：

1. 创建临时 habitat；
2. 注入一条合成网络天气；
3. 用真实模型执行一次 `wake`；
4. 检查 pulse 是否带有 `cognition.adapter === 'model'`；
5. 检查事件流中是否出现 key、Authorization、Bearer 或 URL 片段；
6. 打印脱敏报告；
7. 删除临时 habitat。

如果模型返回非四选一，脚本会失败并打印失败原因，但不会把模型原始输出中的敏感内容写进报告。

## 手动命令

```bash
node bin/nna.mjs inject "一条真实模型测试用的网络天气" --source relay --habitat ./habitat
node bin/nna.mjs wake --habitat ./habitat --json
node bin/nna.mjs trace --habitat ./habitat --last 10 --json
```
