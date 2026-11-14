# L4-LAN 受控局域网模式

L4-LAN 是 L4 的第一阶段：Agent HTTP 栖息地仍在本机，但可以被同一局域网内的授权设备访问。它不是公网服务，不是自动发现，不是自我传播。

## 启动

```bash
node bin/nna.mjs serve \
  --habitat ./habitat \
  --port 8787 \
  --lan \
  --token "$NNA_LAN_TOKEN" \
  --cidr 192.168.0.0/16
```

也可以只设置环境变量：

```bash
export NNA_LAN_TOKEN='你的局域网测试token'
node bin/nna.mjs serve --habitat ./habitat --port 8787 --lan
```

不带 `--lan` 时仍然只监听 `127.0.0.1`，行为和之前完全一致。

## 边界

- 只监听用户显式要求的 LAN 模式。
- LAN 模式要求 token；没有 token 会直接拒绝启动。
- 默认 CIDR 白名单：`192.168.0.0/16`、`10.0.0.0/8`、`172.16.0.0/12`；`--cidr` 可覆盖。
- loopback 永远允许。
- `/health` 不要求 token，便于探测存活；其他接口要求 `Authorization: Bearer <token>` 或 `x-nna-token`。
- 根目录只暴露 token 指纹，不暴露 token 本体。
- 请求体上限 64 KiB。
- 不扫描网络、不广播、不自动连接其他设备、不写第三方系统。

## 示例

查看存活：

```bash
curl -s http://192.168.31.120:8787/health
```

带 token 查询状态：

```bash
curl -s -H 'Authorization: Bearer 你的token' \
  http://192.168.31.120:8787/status
```

注入一条网络天气：

```bash
curl -s -X POST \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer 你的token' \
  --data '{"source":"lan","text":"一条来自局域网设备的网络天气"}' \
  http://192.168.31.120:8787/event
```

## 仍需明确的限制

- 这不是多主机 relay；事件链仍写在当前 habitat。
- 这不是公网实验。
- 这不是长期守护进程；需要用你自己的进程管理器或终端保持运行。
- 这不是设备发现协议；地址需要用户手动指定。

完成 LAN 多设备迁移还需要后续实验：专用 relay、两个物理设备、迁移窗口、冲突与审计。

当前已提供单机受控迁移实验：

```bash
npm run lan:migrate
```

它会启动临时 LAN habitat，验证未授权访问被拒绝、授权访问可读取状态、授权设备可注入签名事件、身体死亡后另一身体从 relay 恢复同一身份并产生新血缘，报告写入 `work/lan-migration.json`。面板中的「运行 LAN 迁移」按钮调用同一实验。

注意：这仍是单机上的 LAN 模拟，不证明多物理设备或公网存活。
