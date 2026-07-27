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

返回已启用 Provider 的名称、能力、官方/实验标记和被动状态：`healthy`、`degraded`、`unavailable`、`disabled` 或 `experimental`。

## 搜索

`GET /api/music/search`

| 参数 | 默认值 | 范围 |
|---|---:|---|
| `q` | 必填 | 1–100 字符 |
| `provider` | `all` | `all` 或已启用来源 |
| `page` | `1` | 1–100 |
| `page_size` | `20` | 1–50 |

`data.items` 是现有标准 Track；`meta.cached` 表示是否命中完整结果缓存，`meta.provider_errors` 只包含来源和标准错误码，不包含原始异常。单来源失败不阻断其他来源；残缺结果不写正缓存。

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

只有 Provider 明确允许播放时才返回 `{ "playback": { "url": "https://..." } }`。使用 POST 避免临时 URL 被普通搜索缓存。服务端不代理、不持久化音频，也不绕过登录、付费、DRM、地域或访问门槛。

## 旧接口

当前 UI 使用以下兼容接口：`/api/search`、`/api/health`、`/api/resolve`、`/api/identify`、`/api/track`、`/api/lyrics` 和 `/api/download`。它们没有移除计划，修改时必须运行现有 HTTP 与浏览器回归测试。

参考项目的 `input/filter/type/page` POST 表单不是 Listener 的历史产品契约，因此没有引入危险的任意 URL 兼容层。平台 URL 仍只能通过 `/api/identify` 进行本地白名单解析。
