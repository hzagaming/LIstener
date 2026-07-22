# Listener

一个面向多音乐源聚合的 Web 音乐播放器。当前版本包含发现页、聚合搜索、收藏、播放队列与完整播放器交互，并预留了统一的爬虫数据适配层。

## 本地运行

```bash
npm install
npm run dev
```

构建生产版本：

```bash
npm run build
```

## 接入音乐源

页面只依赖标准化的 `Track` 数据。真实爬虫应运行在服务端，并实现 `src/types/music.ts` 中的 `MusicProvider` 接口；演示实现位于 `src/services/musicProvider.ts`。

复制 `.env.example` 为 `.env.local` 并配置 `VITE_MUSIC_API_BASE` 后，前端会请求：

- `GET /api/search?q=关键词` → `{ "tracks": Track[] }`
- `GET /api/resolve?source=netease&id=歌曲ID` → `{ "url": "可播放地址" }`

接口不可用时会自动回退到演示数据，方便前后端独立开发。

> 请仅抓取和播放你有权访问的内容，并遵守目标站点的服务条款、robots.txt 与当地法律。
