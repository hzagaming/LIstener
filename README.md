# Listener

一个面向多音乐源聚合的 Web 音乐播放器。当前版本包含发现页、聚合搜索、收藏、播放队列与完整播放器交互，并预留了统一的爬虫数据适配层。

当前版本：`0.2.0`。版本公告见 [CHANGELOG.md](./CHANGELOG.md)。

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

页面只依赖标准化的 `Track` 数据。音乐源运行在 Node.js 服务端：默认通过 `server/providers/apple.mjs` 提供公开歌曲检索和试听，`server/providers/netease.mjs` 作为可选来源；聚合、缓存与去重位于 `server/musicService.mjs`。前端演示回退位于 `src/services/musicProvider.ts`。

默认通过同源 `/api` 请求服务；开发环境由 Vite 代理到 `http://127.0.0.1:3000`。跨域部署时，复制 `.env.example` 为 `.env.local` 并配置 `VITE_MUSIC_API_BASE`。

接口：

- `GET /api/search?q=关键词` → `{ "tracks": Track[] }`
- `GET /api/health` → `{ "status": "ok", "sources": ["apple"] }`
- `GET /api/resolve?source=apple&id=歌曲ID` → `{ "url": "可播放地址" }`

接口不可用时会自动回退到演示数据，方便前后端独立开发。

服务端默认限制每个客户端每分钟 60 次请求，搜索结果缓存 30 秒，并合并相同歌曲。可用环境变量：`HOST`、`PORT`、`CORS_ORIGIN`、`APPLE_COUNTRY`、`APPLE_SEARCH_URL`、`APPLE_LOOKUP_URL`。

网易云在部分区域会返回加密结果，因此默认关闭。确认部署区域可用后可启用：

```bash
ENABLE_NETEASE=true npm run server
```

可选配置：`NETEASE_SEARCH_URL`、`NETEASE_MEDIA_URL`。

运行测试：

```bash
npm test
```

> 请仅抓取和播放你有权访问的内容，并遵守目标站点的服务条款、robots.txt 与当地法律。
