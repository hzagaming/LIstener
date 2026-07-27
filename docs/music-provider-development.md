# Music Provider 开发指南

## 最小契约

Provider 是独立 ESM 工厂返回的对象，至少包含：

```js
{
  id,
  name,
  enabled,
  experimental,
  official,
  allowedHosts,
  capabilities,
  search(query, limit, signal, page),
  lookup(id, signal),
  lyrics(id, signal),
  resolve(id, signal)
}
```

没有能力的方法应省略，并把对应 capability 设为 `false`。禁止用空对象、伪造 URL 或任意远程地址表示成功。

## Track

Provider 必须返回当前 `src/types/music.ts` 定义的标准 Track。服务边界会校验所有字段、URL、能力和 `track.source === provider.id`。ID 必须转为字符串；时长使用非负秒数；未知音质标记为 `unknown`。

搜索只返回列表所需元数据，不逐条请求歌词、详情或播放地址。分页 offset 为 `(page - 1) * limit`，单次 limit 不超过 50。

## HTTP

真实 Provider 必须使用 `createProviderHttpClient`：

```js
const http = createProviderHttpClient({
  allowedHosts: ['official.example'],
  fetchImpl,
  timeoutMs,
  maxResponseBytes: responseLimitBytes,
  maxRetries,
})
```

- `allowedHosts` 只能包含经审计的固定官方域名。
- Client 只允许无凭据 HTTPS，拒绝 localhost、IP 字面量、非默认端口和非白名单重定向。
- 默认总超时 8 秒、响应 2 MiB、最多 2 次重定向、幂等临时错误最多重试 1 次。
- POST 默认不重试；确需重试时必须证明幂等。
- 不关闭 TLS，不拼接用户提供的完整 URL，不把用户输入放入 Header。
- 错误不能包含 Key、Cookie、Authorization、签名或完整临时 URL。

## 能力与合规

- 官方公开 API：`official: true`。
- 未确认长期稳定性但经过合规评估：`experimental: true` 且默认关闭。
- 需要 Key 的来源只在服务端环境变量存在时注册。
- 播放前重新检查公开权限；付费、关注、NFT、登录或地域门槛返回 `CAPABILITY_UNAVAILABLE`。
- 下载默认关闭。只有内容许可和 Provider API 都明确授权时才能实现。
- 不引入旧私有签名、设备模拟、Cookie、代理池或 DRM 绕过。

## 测试清单

每个 Provider 使用 Mock `fetch` 和脱敏 Fixture，至少覆盖：

1. 搜索、分页、详情和字段标准化。
2. 空响应、字段缺失、非 JSON、429、500 和超时。
3. ID 与返回对象绑定，防止串台。
4. 取消信号、请求速率和响应大小。
5. Host、协议、凭据 URL、重定向和密钥泄漏。
6. 无播放权限时 `playback: none`，不得伪造 URL。

单元测试不得访问真实第三方。人工外部联调应单独执行，不作为 CI 成功条件。
