# Listener

一个面向合法多音乐源聚合的 Web 音乐播放器。支持并行搜索、音乐地址/ID 识别、收藏、自建歌单、本地音乐、播放队列和按来源授权的歌词与下载能力。

当前版本：`0.3.0`。版本公告见 [CHANGELOG.md](./CHANGELOG.md)。

## 本地运行

需要 Node.js 18 或更高版本。

分别启动聚合服务和前端：

```bash
npm install
npm run dev:server
```

另开一个终端：

```bash
npm run dev
```

构建生产版本：

```bash
npm run build
```

## 接入音乐源

页面只依赖标准化的 `Track` 数据。音乐源运行在 Node.js 服务端：默认通过 `server/providers/apple.mjs` 提供公开歌曲检索和试听，`server/providers/netease.mjs` 作为可选来源；并行聚合、缓存、精确去重和来源超时位于 `server/musicService.mjs`。前端演示回退位于 `src/services/musicProvider.ts`。

地址/ID 解析支持网易、QQ、酷狗、酷我、千千、一听、咪咕、荔枝、蜻蜓、喜马拉雅、5sing 原创/翻唱、全民 K 歌和 Apple Music。解析只识别格式，不代表对应平台已经获得搜索、播放或下载授权；健康接口会返回当前实际连接的来源和能力。

默认通过同源 `/api` 请求服务；开发环境由 Vite 代理到 `http://127.0.0.1:3000`。跨域部署时，复制 `.env.example` 为 `.env.local` 并配置 `VITE_MUSIC_API_BASE`。

接口：

- `GET /api/search?q=关键词` → `{ "tracks": Track[] }`
- `GET /api/health` → `{ "status": "ok", "sources": ["apple"] }`
- `GET /api/resolve?source=apple&id=歌曲ID` → `{ "url": "可播放地址" }`
- `GET /api/identify?input=音乐地址` → `{ "match": { "source": "netease", "id": "歌曲ID", "canonicalUrl": "..." } }`
- `GET /api/track?source=apple&id=歌曲ID` → `{ "track": Track }`
- `GET /api/lyrics?source=来源&id=歌曲ID` → Provider 授权的歌词
- `GET /api/download?source=来源&id=歌曲ID` → Provider 授权的下载描述

接口不可用时会自动回退到演示数据，方便前后端独立开发。

服务端默认限制每个客户端每分钟 60 次请求，搜索结果缓存 30 秒，并对同来源重复记录去重。可用环境变量：`HOST`、`PORT`、`CORS_ORIGIN`、`APPLE_COUNTRY`、`APPLE_SEARCH_URL`、`APPLE_LOOKUP_URL`。

网易云在部分区域会返回加密结果，因此默认关闭。确认部署区域可用后可启用：

```bash
ENABLE_NETEASE=true npm run server
```

可选配置：`NETEASE_SEARCH_URL`、`NETEASE_MEDIA_URL`。

## 播放、歌词与下载规则

- 每首歌通过 `capabilities` 标明试听、完整播放、歌词和下载能力，通过 `quality` 标明已确认的音质等级。
- 只有 Provider 明确实现并声明 `download: true` 时，服务端才返回下载信息；其他来源统一拒绝。
- 不绕过登录、会员、签名、地区限制、加密或 DRM，也不代理用户提交的任意远程地址。
- “导入音乐 / LRC”只处理用户主动选择的浏览器文件；同名音频与 `.lrc` 会自动配对，播放、歌词与下载均在本机会话内完成，刷新后自动清除。

运行测试：

```bash
npm test
```

> 请仅抓取和播放你有权访问的内容，并遵守目标站点的服务条款、robots.txt 与当地法律。
