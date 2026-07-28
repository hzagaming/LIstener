# Listener

一个面向合法多音乐源聚合的 Web 音乐播放器。支持并行搜索、音乐地址/ID 识别、收藏、自建歌单、本地音乐、播放队列和按来源授权的歌词与下载能力。

当前版本：`0.4.8`。版本公告见 [CHANGELOG.md](./CHANGELOG.md)。

## 本地运行

需要 Node.js 18.17 或更高版本。

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

## GitHub Pages

推送 `main` 后，GitHub Actions 会构建并发布 `dist` 到 `https://hzagaming.github.io/LIstener/`。Pages 版本使用静态演示数据，不请求无法在 GitHub Pages 运行的 Node API；本地开发和其他后端部署不受影响。

仓库的 **Settings → Pages → Build and deployment → Source** 必须选择 **GitHub Actions**。如果选择从 `main` 分支发布，GitHub 会在 Actions 部署后再次用源码覆盖站点，导致 `/src/main.tsx` 和 `/favicon.svg` 404；部署后的线上冒烟检查会将这种错误配置标记为失败。

## 接入音乐源

页面只依赖标准化的 `Track` 数据。音乐源运行在 Node.js 服务端：默认通过 `server/providers/apple.mjs` 提供公开歌曲检索和可用试听；没有试听的合法元数据仍会保留并标记为不可播放。MusicBrainz 可提供开放录音元数据，Audius 可提供创作者公开音频，网易云仅作为区域相关的实验元数据来源。所有真实 Provider 共用受 Host 白名单、响应大小、重定向、超时、重试和取消约束的 HTTP Client。并行聚合、分页、缓存、精确去重和被动健康状态位于 `server/musicService.mjs`。前端演示回退位于 `src/services/musicProvider.ts`。

地址/ID 解析支持网易、QQ、酷狗、酷我、千千、一听、咪咕、荔枝、蜻蜓、喜马拉雅、5sing 原创/翻唱、全民 K 歌、Apple Music、MusicBrainz 和 Audius API 地址/ID。解析只识别格式，不代表对应平台已经获得搜索、播放或下载授权；健康接口会返回当前实际连接的来源和能力。

默认通过同源 `/api` 请求服务；开发环境由 Vite 代理到 `http://127.0.0.1:3000`。跨域部署时，复制 `.env.example` 为 `.env.local` 并配置 `VITE_MUSIC_API_BASE`。

接口：

- `GET /api/search?q=关键词` → `{ "tracks": Track[] }`
- `GET /api/health` → `{ "status": "ok", "sources": ["apple"], "capabilities": { "apple": { "search": true, "playback": true, "lyrics": false, "download": false } } }`
- `GET /api/resolve?source=apple&id=歌曲ID` → `{ "url": "可播放地址" }`
- `GET /api/identify?input=音乐地址` → `{ "match": { "source": "netease", "id": "歌曲ID", "canonicalUrl": "..." } }`
- `GET /api/track?source=apple&id=歌曲ID` → `{ "track": Track }`
- `GET /api/lyrics?source=来源&id=歌曲ID` → Provider 授权的歌词
- `GET /api/download?source=来源&id=歌曲ID` → Provider 授权的下载描述

新版接口在保持以上契约的同时支持指定来源和分页：

- `GET /api/music/providers`
- `GET /api/music/search?q=关键词&provider=all&page=1&page_size=20`
- `GET /api/music/tracks/{provider}/{trackId}`
- `GET /api/music/tracks/{provider}/{trackId}/lyrics`
- `POST /api/music/tracks/{provider}/{trackId}/playback`

完整响应格式见 [音乐 API 文档](./docs/music-api.md)。

接口不可用时会自动回退到演示数据并明确显示服务异常，方便前后端独立开发且不会将故障伪装成零结果。

服务端默认限制每个客户端每分钟 60 次请求，最多同时调用 3 个 Provider，搜索结果缓存 30 秒，并对同来源重复记录去重。`.env.example` 列出了 Provider 白名单、Fixture/网易开关、超时、响应上限、一次重试、并发数、缓存 TTL 和 API 限流配置。服务端变量需由 shell 或部署平台注入，不会由 Node 自动读取 `.env.example`。

没有外部网络时，可显式启用只含原创测试元数据和歌词、且没有播放地址的 Fixture Provider：

```bash
ENABLE_LOCAL_FIXTURE=true npm run server
```

MusicBrainz 要求客户端提供可联系的应用标识，并限制为每秒最多一次请求。设置邮箱或网站地址后启用；该来源只提供 CC0 核心录音元数据，不提供音频：

```bash
MUSICBRAINZ_CONTACT=ops@example.com npm run server
```

Audius 只开放官方 API 明确标记为可串流且未设置访问门槛的歌曲。API Key 始终保留在服务端，解析接口只向浏览器返回 Audius 生成的公开 HTTPS 流地址；不处理用户登录、签名、付费/关注/NFT 门槛或下载。请先阅读并接受 [Audius API Terms](https://audius.co/legal/api-terms)，再配置开发者 Key：

```bash
AUDIUS_API_KEY=你的开发者Key npm run server
```

网易云搜索接口未获官方稳定性确认，并且在部分区域会返回加密结果，因此默认关闭。即使显式启用也只提供实验性元数据搜索，不解析或构造播放地址：

```bash
ENABLE_NETEASE=true npm run server
```

## 播放、歌词与下载规则

- 每首歌通过 `capabilities` 标明试听、完整播放、歌词和下载能力，通过 `quality` 标明已确认的音质等级。
- 只有 Provider 明确实现并声明 `download: true` 时，服务端才返回下载信息；其他来源统一拒绝。
- 不绕过登录、会员、签名、地区限制、加密或 DRM，也不代理用户提交的任意远程地址。
- “导入音乐 / LRC”只处理用户主动选择的浏览器文件；同名音频与 `.lrc` 会自动配对，播放、歌词与下载均在本机会话内完成，刷新后自动清除。

运行测试：

```bash
npm test
```

架构、Provider 开发、安全边界、许可证和参考项目审计位于 [`docs/`](./docs/)。

> 请仅抓取和播放你有权访问的内容，并遵守目标站点的服务条款、robots.txt 与当地法律。

## Provider 实现参考

- [Mopidy Backend API](https://docs.mopidy.com/latest/api/backend/)（Apache-2.0）：参考搜索与播放能力分离的 Provider 边界。
- [MusicBrainz Web Service](https://musicbrainz.org/doc/MusicBrainz_API) 与 [数据许可](https://musicbrainz.org/doc/MusicBrainz_License)：遵循 User-Agent、每秒一次请求和核心数据 CC0 规则。
- [musicbrainz-api](https://github.com/Borewit/musicbrainz-api)（MIT）：参考应用标识、MBID lookup 与限流思路；本项目未复制其实现或引入该依赖。
- [Audius API / SDK](https://github.com/audiusproject/apps/tree/main/packages/docs/docs/pages/sdk)（Apache-2.0）：参考官方搜索、Track 权限字段、流地址解析与 10 请求/秒限制；软件许可不代表音乐内容可下载或再分发。
