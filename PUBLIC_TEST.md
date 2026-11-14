# 公网测试边界

当前仓库**不提供公网自动暴露命令**。公网实验必须人工搭建网关、限定时间、限定 token，并留下可审计记录。

## 允许形状

- 用户明确授权的一次公网 URL。
- 反向代理或隧道前面转发到本机 `127.0.0.1:PORT`。
- Bearer token 必须开启，且不同于本地开发 token。
- 只开放只读端点，或明确允许 `/event` 短时间写入合成事件。
- 实验结束后立即关闭公网入口。
- 记录 URL 的 SHA-256、起止时间、请求摘要；不记录完整公网 URL 和 token。

## 禁止

- `nna serve --lan --cidr 0.0.0.0/0`。
- 无 token 暴露。
- 长期公网服务。
- 自动传播、自动注册、扫描、群发或第三方写入。
- 真实私人数据、Cookie、Authorization、OTP、API key 进入事件。
- 把公网可达性包装成“公网生命体已实现”。

## 推荐流程

1. 在本机启动 loopback habitat：

```bash
node bin/nna.mjs serve --habitat ./habitat --port 8787
```

2. 用用户自有反代或隧道把 HTTPS 域名转发到 `127.0.0.1:8787`，在网关层强制 token。

3. 只测试：

```bash
curl -s https://PUBLIC_HOST/health
curl -s -H 'Authorization: Bearer PUBLIC_TEST_TOKEN' https://PUBLIC_HOST/status
```

4. 若允许写入，只发送合成事件：

```bash
curl -s -X POST \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer PUBLIC_TEST_TOKEN' \
  --data '{"source":"public-test","text":"synthetic public test event"}' \
  https://PUBLIC_HOST/event
```

5. 记录 URL 哈希：

```bash
printf '%s' 'https://PUBLIC_HOST' | shasum -a 256
```

6. 结束后关闭网关，并从事件流审计是否存在凭据样式文本。

## 当前结论

公网测试不是当前自动测试环境的一部分。应先完成两设备 LAN 实测，再决定是否进行短时公网测试。
