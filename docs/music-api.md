# 音乐 API

所有接口返回 JSON。旧 `/api/*` 契约继续供当前前端使用；新版 `/api/music/*` 提供分页、指定来源、请求 ID 和来源错误元数据。

## 新版成功响应

```json
{
  "success": true,
  "data": {},
  "meta": {
    "request_id": "uuid",
    "elapsed_ms": 12
  },
  "error": null
}
```

失败响应使用相同 `request_id`：

```json
{
  "success": false,
  "data": null,
  "meta": { "request_id": "uuid", "elapsed_ms": 3 },
  "error": { "code": "INVALID_QUERY", "message": "..." }
}
```

第三方原始响应和内部异常不会返回客户端。

## Provider 列表

`GET /api/music/providers`

返回 Provider 来源的名称、能力、官方/实验标记和被动状态：`healthy`、`degraded`、`unavailable`、`disabled` 或 `experimental`。一个受控适配器可以发布多个逻辑来源；例如配置 Brave Search Key 后，公开网页目录会分别发布 QQ、酷狗、酷我等来源，但不会把内部适配器 ID 暴露给客户端。

## 搜索

`GET /api/music/search`

| 参数 | 默认值 | 范围 |
|---|---:|---|
| `q` | 必填 | 1–100 字符 |
| `provider` | `all` | `all` 或已启用来源 |
| `page` | `1` | 1–100 |
| `page_size` | `20` | 1–50 |

`data.items` 是现有标准 Track；`meta.cached` 表示是否命中完整结果缓存，`meta.provider_errors` 只包含来源和标准错误码，不包含原始异常。单来源失败不阻断其他来源；残缺结果不写正缓存。

公开网页目录来源只接受 Brave 官方 API 返回、且能通过 `server/platforms.mjs` 官方域名和曲目地址/ID白名单再次验证的页面；这些 Track 的播放、歌词和下载能力均为关闭。

## 详情

`GET /api/music/tracks/{provider}/{trackId}`

返回 `{ "track": Track }`。Provider 和 Track ID 都按路径段解码，Track ID 最大 256 字符，不能作为 URL 或文件路径使用。

## 歌词

`GET /api/music/tracks/{provider}/{trackId}/lyrics`

仅在 Provider 声明歌词能力时可用。响应可包含：

```json
{
  "lyrics": {
    "plain": "纯文本",
    "lrc": "[00:01.20]时间轴",
    "lines": [{ "timeMs": 1200, "text": "时间轴" }],
    "language": null,
    "translated": null
  }
}
```

歌词按普通文本输出，前端不得把内容作为 HTML 执行。

## 播放地址

`POST /api/music/tracks/{provider}/{trackId}/playback`

只有 Provider 明确允许播放时才返回 `{ "playback": { "url": "https://..." } }`。使用 POST 避免临时 URL 被普通搜索缓存。播放链路不代理或持久化音频，也不绕过登录、付费、DRM、地域或访问门槛。

## 授权下载与封面

- `GET /api/download?source={provider}&id={trackId}` 返回 Provider 授权的 `{ "url", "filename" }` 描述；未声明 `download: true` 的来源返回能力错误。
- `GET /api/download/file?source=wikimedia&id={trackId}` 重新校验 Provider 下载能力后，仅从固定 `upload.wikimedia.org` Host 流式传输音频，并返回附件响应头。默认上限 128 MiB、总超时 120 秒，不落盘、不缓存，也不接受任意 URL。
- `GET /api/artwork?source={provider}&id={trackId}` 先由 Provider 查询歌曲，再从该来源固定封面 Host 下载受限图片；支持 Apple、网易、Audius 和 YouTube 官方缩略图，默认上限 8 MiB。

## 账号与用户状态

- `POST /api/auth/register`：`{ "email", "password" }`，密码 12–200 字符。
- `POST /api/auth/login`：建立 HttpOnly 会话 Cookie。
- `GET /api/auth/me`：返回 `{ "user": null }` 或当前用户，未登录也是 200。
- `POST /api/auth/logout`：删除服务端会话并清除 Cookie。
- `GET /api/user/state`：返回 `{ "state", "revision", "updatedAt" }`。
- `PUT /api/user/state`：提交 `{ "state", "revision" }`；修订号落后时返回 409 和 `current`，客户端合并后重试。

账号写接口要求精确匹配配置的 Origin。密码使用 `scrypt` 加盐哈希，数据库仅保存 Session Token 的 SHA-256 哈希。用户状态正文和集合数量均有上限，运行时 SQLite 文件不得提交到仓库。

## 地区推荐

`GET /api/recommendations/region` 只读取 `LISTENER_COUNTRY_HEADER` 指定的可信两位国家代码 Header，返回 `{ "country", "source", "storesRawIp": false }`；不配置时由浏览器语言或用户手动设置回退。

## 旧接口

当前 UI 使用以下兼容接口：`/api/search`、`/api/health`、`/api/resolve`、`/api/identify`、`/api/track`、`/api/lyrics`、`/api/download` 和受限的 `/api/download/file`。它们没有移除计划，修改时必须运行现有 HTTP 与浏览器回归测试。

参考项目的 `input/filter/type/page` POST 表单不是 Listener 的历史产品契约，因此没有引入危险的任意 URL 兼容层。平台 URL 仍只能通过 `/api/identify` 进行本地白名单解析。
