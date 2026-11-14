# 模型网关接入

模型器官通过一个兼容 OpenAI 风格的 HTTP 网关接入。本项目不绑定任何具体厂商或本地代理；只要网关提供 `/models` 与 `/responses`，就可以被用作可替换认知器官。

## 边界

- 默认不调用模型。
- `NNA_COGNITION=model` 显式启用；模型只返回 `echo` / `trace` / `migrate` / `sleep` 之一。
- API key 只从进程环境变量读取，不进入事件流、报告、outbox 或 Git。
- 网关必须是 HTTPS；本机 loopback HTTP 仅用于测试。
- 模型输出不能直接触发外部写操作。

## 配置

```bash
export NNA_COGNITION=model
export NNA_MODEL_WIRE=responses
export NNA_MODEL_BASE_URL='https://your-model-gateway.example/v1'
export NNA_MODEL_API_KEY='your-test-key'
export NNA_MODEL_NAME='candidate-model-1'
export NNA_MODEL_TIMEOUT_MS='15000'
```

`NNA_MODEL_BASE_URL` 会自动拼接 `/models` 与 `/responses`。如果网关需要额外的非认证请求头，可用 JSON 传入：

```bash
export NNA_MODEL_EXTRA_HEADERS='{"x-gateway-tenant":"research"}'
```

`authorization`、`content-type`、`content-length` 与 `host` 不允许通过额外头覆盖。

## 列出模型

```bash
curl -sS -H "Authorization: Bearer $NNA_MODEL_API_KEY" \
  "$NNA_MODEL_BASE_URL/models"
```

## 最小接入测试

```bash
NNA_MODEL_TIMEOUT_MS=12000 npm run model:gateway -- candidate-model-1
```

该命令会创建临时 habitat、注入一条合成网络天气、调用一次真实模型，并检查：

- pulse 的 `cognition.adapter` 是否为 `model`；
- 输出是否为合法四选一冲动；
- 事件流与报告中是否出现 key、Authorization 或端点片段；
- 是否产生任意外部写操作。

报告默认写入 `work/model-smoke.tmp.json`，可用 `--report <path>` 指定。

## 手动配置

如果使用完整端点而不是 base URL，可以显式设置 `NNA_MODEL_URL`：

```bash
export NNA_COGNITION=model
export NNA_MODEL_WIRE=responses
export NNA_MODEL_URL='https://your-model-gateway.example/v1/responses'
export NNA_MODEL_API_KEY='your-test-key'
export NNA_MODEL_NAME='candidate-model-1'

npm run model:smoke
```

`NNA_MODEL_URL` 优先于 `NNA_MODEL_BASE_URL`，只用于需要自定义路径的网关。

## 与实验脚本的关系

`model:qualify`、`model:e2e`、`model:stability` 与 `experiment:collect` 都读取同一组网关变量。它们不会读取 `.env`，也不会把凭据写入归档证据。完整实验流程见 [EXPERIMENT_PROTOCOL.md](EXPERIMENT_PROTOCOL.md) 与 [TEST_ENVIRONMENT.md](TEST_ENVIRONMENT.md)。

边界不变：模型只是可替换认知器官，不执行外部写操作，不证明智能、意图或意识。
