# Listener

一个面向合法多音乐源聚合的 Web 音乐播放器。支持并行搜索、音乐地址/ID 识别、收藏、自建歌单、相似推荐、本地音乐、播放队列、账号同步、离线应用壳和按来源授权的歌词与下载能力。

当前版本：`0.5.0`。版本公告见 [CHANGELOG.md](./CHANGELOG.md)。

## 本地运行

需要 Node.js 18.17 或更高版本。

默认一条命令同时启动 Node 聚合 API 与 Vite 前端，并接入 Apple、MusicBrainz、Wikimedia Commons，以及实验性的网易云公开元数据搜索：

```bash
npm install
npm run dev
```

只需要静态 Apple 公共搜索、不启动 Node API 时：

```bash
VITE_PUBLIC_APPLE=true npm run dev:client
```

构建生产版本：

```bash
npm run build
```

Node 服务首次启动会自动创建 `data/listener.sqlite`，该目录已忽略，不会把运行时账号或歌单数据提交进仓库。

## GitHub Pages

推送 `main` 后，GitHub Actions 会构建并发布 `dist` 到 `https://hzagaming.github.io/LIstener/`。Pages 无法运行 Node API，因此直接使用无需密钥且支持浏览器跨域请求的 Apple Music 公共检索、地址/ID 解析与试听；公共响应受 2 MB 上限及媒体 Host 白名单约束，瞬时故障会重试一次，CN 无结果会补查 US，网络持续异常才退回演示曲库。静态版本保留本机存储、JSON 迁移、PWA 应用壳和封面导出，但不提供账号云同步或服务端音频下载。

仓库的 **Settings → Pages → Build and deployment → Source** 必须选择 **GitHub Actions**。如果选择从 `main` 分支发布，GitHub 会在 Actions 部署后再次用源码覆盖站点，导致 `/src/main.tsx` 和 `/favicon.svg` 404；部署后的线上冒烟检查会将这种错误配置标记为失败。

## 接入音乐源

页面只依赖标准化的 `Track` 数据。音乐源运行在 Node.js 服务端：默认通过 `server/providers/apple.mjs` 提供公开歌曲检索和授权试听，通过 `server/providers/musicbrainz.mjs` 补充 CC0 录音元数据，通过 `server/providers/wikimedia.mjs` 搜索 Wikimedia Commons 开放音频，并通过 `server/providers/netease.mjs` 补充网易云公开目录元数据和 ID 详情；没有合法播放地址的元数据会保留并明确标记为不可播放。Audius 配置 Key 后可提供创作者公开音频。所有服务端真实 Provider 共用受 Host 白名单、响应大小、重定向、超时、重试和取消约束的 HTTP Client。并行聚合、分页、缓存、精确去重和被动健康状态位于 `server/musicService.mjs`。Pages 专用 Apple 公共适配器位于 `src/services/publicAppleProvider.mjs`，前端演示回退位于 `src/services/musicProvider.ts`。

Node 聚合模式默认使用“完整与元数据”播放范围：隐藏 Apple 试听结果，保留 Wikimedia/Audius 完整音频和网易云/MusicBrainz 目录元数据；可切换为“仅完整可播”或“包含试听”。GitHub Pages 只有浏览器可直连的 Apple 公共接口，因此默认保留试听结果。

打开自建歌单后会根据主要歌手或专辑自动展示最多 8 首真实相似结果；“显示更多/加载更多”和连续播放会继续请求 Provider 分页。推荐不写入本地存储，不使用演示或 Fixture 歌曲，并排除试听；连续队列只自动追加 Provider 明确授权为完整播放的音源，没有合法完整音源时只保留元数据说明或循环已有可播放队列。

地址/ID 解析支持网易、QQ、酷狗、酷我、千千、一听、咪咕、荔枝、蜻蜓、喜马拉雅、5sing 原创/翻唱、全民 K 歌、Apple Music、MusicBrainz、Audius API 和 Wikimedia Commons 文件页地址/ID。解析只识别格式，不代表对应平台已经获得搜索、播放或下载授权；健康接口会返回当前实际连接的来源和能力。

开发模式未配置 `VITE_MUSIC_API_BASE` 时通过 Vite 的同源 `/api` 代理连接本地聚合服务；生产构建未配置时直接使用 Apple 公共搜索，不会探测不存在的 `/api`。跨域部署 Node API 时，将 `VITE_MUSIC_API_BASE` 设置为实际 API Origin。

兼容接口：

- `GET /api/search?q=关键词` → `{ "tracks": Track[] }`
- `GET /api/health` → `{ "status": "ok", "sources": ["apple", "musicbrainz", "wikimedia"], "capabilities": { ... } }`
- `GET /api/resolve?source=apple&id=歌曲ID` → `{ "url": "可播放地址" }`
- `GET /api/identify?input=音乐地址` → `{ "match": { "source": "netease", "id": "歌曲ID", "canonicalUrl": "..." } }`
- `GET /api/track?source=apple&id=歌曲ID` → `{ "track": Track }`
- `GET /api/lyrics?source=来源&id=歌曲ID` → Provider 授权的歌词
- `GET /api/download?source=来源&id=歌曲ID` → Provider 授权的下载描述

当前页面搜索与歌单推荐使用支持指定来源和分页的新版接口；以上兼容契约继续供已有调用方使用：

- `GET /api/music/providers`
- `GET /api/music/search?q=关键词&provider=all&page=1&page_size=20`
- `GET /api/music/tracks/{provider}/{trackId}`
- `GET /api/music/tracks/{provider}/{trackId}/lyrics`
- `POST /api/music/tracks/{provider}/{trackId}/playback`

完整响应格式见 [音乐 API 文档](./docs/music-api.md)。

Node 接口不可用时会先回退到 Apple 公共搜索，公共接口也持续不可用时才使用演示数据；页面会区分公共/演示结果并提供显式重试，不会将故障伪装成零结果。

服务端默认限制每个客户端每分钟 60 次请求，最多同时调用 4 个 Provider，搜索结果缓存 30 秒，并对同来源重复记录去重。`.env.example` 列出了 Provider、缓存、限流、SQLite、会话、地区 Header、封面和音频下载上限配置。服务端变量需由 shell 或部署平台注入，不会由 Node 自动读取 `.env.example`。

没有外部网络时，可显式启用只含原创测试元数据和歌词、且没有播放地址的 Fixture Provider：

```bash
ENABLE_LOCAL_FIXTURE=true npm run server
```

MusicBrainz 要求客户端提供可联系的应用标识，并限制为每秒最多一次请求。默认使用项目仓库地址作为联系标识，也可覆盖为维护邮箱或网站；该来源只提供 CC0 核心录音元数据，不提供音频：

```bash
MUSICBRAINZ_CONTACT=ops@example.com npm run server
```

Wikimedia Commons 来源使用官方 Action API 搜索文件命名空间中的音频，并直接播放 `upload.wikimedia.org` 公开文件；每个文件的作者、许可和署名要求以结果对应的 Commons 来源页为准。下载时 Node 服务只从固定 Wikimedia 媒体 Host 流式转发明确开放的音频并添加附件响应头，不落盘、不缓存，默认上限 128 MiB、总超时 120 秒。

Audius 只开放官方 API 明确标记为可串流且未设置访问门槛的歌曲。API Key 始终保留在服务端，解析接口只向浏览器返回 Audius 生成的公开 HTTPS 流地址；不处理用户登录、签名、付费/关注/NFT 门槛或下载。请先阅读并接受 [Audius API Terms](https://audius.co/legal/api-terms)，再配置开发者 Key：

```bash
AUDIUS_API_KEY=你的开发者Key npm run server
```

网易云公开 Web 端点未提供稳定性承诺，并且在部分区域可能返回加密结果，因此只作为默认启用的实验性元数据源。它支持关键词搜索与数字 ID 详情，但不伪造签名、不解密、不构造播放地址；可显式关闭：

```bash
ENABLE_NETEASE=false npm run server
```

## 播放、歌词与下载规则

- 每首歌通过 `capabilities` 标明试听、完整播放、歌词和下载能力，通过 `quality` 标明已确认的音质等级。
- 只有 Provider 明确实现并声明 `download: true` 时，服务端才返回下载信息；其他来源统一拒绝。
- 不绕过登录、会员、签名、地区限制、加密或 DRM，也不代理用户提交的任意远程地址。
- “导入音乐 / LRC”只处理用户主动选择的浏览器文件；同名音频与 `.lrc` 会自动配对，播放、歌词与下载均在本机会话内完成，刷新后自动清除。

## 账号、设备迁移与离线

- 邮箱密码账号只在 Node 部署中可用；密码使用 `scrypt` 加盐哈希，会话 Cookie 为 HttpOnly、SameSite=Lax，数据库只保存会话 Token 哈希。
- 收藏、歌单、队列、当前歌曲、播放记录、音量、循环与地区偏好使用修订号同步；冲突会合并，首次登录优先恢复云端播放状态和偏好。
- 无账号时仍可导出/导入不含密码、Cookie、本地音频和临时播放地址的 JSON 记录。
- Service Worker 只缓存应用壳与同源构建资源，不缓存 API、第三方音频或私人云端数据。
- 地区推荐只读取显式配置的可信国家代码 Header，不保存原始 IP；用户可手动选择地区或关闭推荐。

运行测试：

```bash
npm test
```

架构、Provider 开发、安全边界、许可证和参考项目审计位于 [`docs/`](./docs/)。

> 请仅抓取和播放你有权访问的内容，并遵守目标站点的服务条款、robots.txt 与当地法律。

## Provider 实现参考

- [Mopidy Backend API](https://docs.mopidy.com/latest/api/backend/)（Apache-2.0）：参考搜索与播放能力分离的 Provider 边界。
- [MusicBrainz Web Service](https://musicbrainz.org/doc/MusicBrainz_API) 与 [数据许可](https://musicbrainz.org/doc/MusicBrainz_License)：遵循 User-Agent、每秒一次请求和核心数据 CC0 规则。
- [MediaWiki Action API](https://www.mediawiki.org/wiki/API:Main_page) 与 [Wikimedia Commons 许可说明](https://commons.wikimedia.org/wiki/Commons:Licensing)：只检索公开音频，具体内容许可与署名要求以文件来源页为准。
- [musicbrainz-api](https://github.com/Borewit/musicbrainz-api)（MIT）：参考应用标识、MBID lookup 与限流思路；本项目未复制其实现或引入该依赖。
- [Audius API / SDK](https://github.com/audiusproject/apps/tree/main/packages/docs/docs/pages/sdk)（Apache-2.0）：参考官方搜索、Track 权限字段、流地址解析与 10 请求/秒限制；软件许可不代表音乐内容可下载或再分发。
