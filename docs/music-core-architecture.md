# 音乐聚合内核架构

## 原则

- 保持 React 前端和现有 Track 契约稳定。
- Controller 只做 HTTP、参数和响应映射；第三方访问只能发生在 Provider。
- Provider 必须独立启用、声明能力和安全主机，不可用能力明确返回错误。
- 搜索只获取列表元数据；详情、歌词和播放地址按需加载。
- 不代理或长期存储第三方音频，不绕过登录、付费、DRM、地域或版权限制。

## 模块

```text
server/http.mjs                 API Controller 与兼容层
server/musicService.mjs         聚合、Provider Registry、缓存与能力门控
server/providerHttpClient.mjs   HTTPS、Host 白名单、重定向、大小、重试、取消
server/lyrics.mjs               纯文本与 LRC 标准化
server/logger.mjs               JSON 日志与敏感字段脱敏
server/providers/*.mjs          独立 Provider
```

Provider 使用统一的最小契约：

```text
id, name, enabled, experimental, official, allowedHosts, capabilities
search(query, limit, signal, page)
lookup(id, signal)
lyrics(id, signal)
resolve(id, signal)
```

未实现的方法即表示能力不可用，不能用空地址伪装成功。

## API

保留现有 `/api/search`、`/api/track`、`/api/resolve`、`/api/lyrics`、`/api/download` 和 `/api/identify`。

新增版本化语义路由：

- `GET /api/music/providers`
- `GET /api/music/search?q=&provider=all&page=1&page_size=20`
- `GET /api/music/tracks/{provider}/{id}`
- `GET /api/music/tracks/{provider}/{id}/lyrics`
- `POST /api/music/tracks/{provider}/{id}/playback`

新版搜索响应包含查询、来源、分页、结果、请求 ID、耗时、缓存状态和来源错误；旧响应继续只返回 `{ tracks }`。

## 搜索流程

```text
HTTP validation
  → MusicService selects one or enabled providers
  → per-provider timeout/cancellation
  → validate Track and source binding
  → stable round-robin aggregation
  → exact source:id deduplication
  → cache complete result only
  → response adapter
```

任何 Provider 故障都不阻断其他来源，但残缺聚合不写正缓存。页码、来源和 schema 版本进入缓存 Key。

## 安全策略

- Provider 只能访问构造时声明的 HTTPS Host。
- 拒绝凭据 URL、localhost、IP 私网/回环/链路本地和非 HTTP(S) 协议。
- 重定向由 Client 手动处理，每一跳重新校验，限制跳数。
- 限制总超时、响应字节数和最多一次幂等重试。
- 外部 JSON 必须由 Provider 转换并通过服务边界校验。
- 日志递归隐藏 Authorization、Cookie、Token、Secret、签名和临时 URL 查询。
- API 按 IP 限流，查询、页码、页大小和 Provider 均有边界。

## 缓存

搜索缓存按 schema、Provider、标准化查询、页码和页大小隔离。详情和歌词使用独立短 TTL；失败只短期负缓存明确的不可用错误。播放地址不持久化，也不超过上游有效期。

当前缓存为单进程内存实现，适合本项目现阶段。多实例生产部署应替换为共享缓存和网关限流，但无需引入数据库。
