# 音乐内核接入审计

## 当前技术栈

- 运行时：Node.js >= 18.17，原生 ESM。
- 前端：React 18、TypeScript 5 严格模式、Vite 6。
- 后端：Node `http`、原生 `fetch` 与 `AbortSignal`，入口为 `server/index.mjs`。
- 测试：Node Test Runner；构建执行 TypeScript 静态检查和 Vite 打包。
- 数据库：本地 SQLite 账号、会话和用户状态；运行时文件位于忽略目录，不进入发布物。
- 队列与共享缓存：当前未配置；生产 API 提供非 root Docker 镜像、持久化 SQLite Volume、容器健康检查及全来源部署验收，CI 使用 GitHub Actions 构建和发布 Pages。
- 缓存与限流：进程内搜索缓存、请求合并、API IP 限流及部分 Provider 请求调度。
- 配置：通过 `process.env` 读取，公开变量示例位于 `.env.example`。
- 日志：`server/logger.mjs` 输出带请求 ID、状态和耗时的结构化 JSON，并递归脱敏凭据与签名查询参数。
- 许可证：仓库当前没有根 `LICENSE`，引入或再分发代码前必须由维护者确定项目许可证。

## 现有调用链

`src/App.tsx` → `src/services/musicProvider.ts` → `/api/*` → `server/http.mjs` → `server/musicService.mjs` → 独立 Provider → 第三方公开端点。

后端已按 Provider 分文件，Controller 不直接访问第三方。现有 Track 契约位于 `src/types/music.ts`，服务端使用相同字段进行运行时校验：`id`、标题、歌手、专辑、秒级时长、来源、媒体地址、封面、来源页、音质和能力标记。

## 路由和错误

- `GET /api/health`：来源和能力。
- `GET /api/search`：聚合搜索，参数为 `q`、`limit`。
- `GET /api/resolve`、`/api/track`、`/api/lyrics`、`/api/download`：按 `source`、`id` 获取能力。
- `GET /api/identify`：只解析预定义平台 URL/ID，不发起网络请求。
- 错误格式为 `{ "error": { "code": string, "message": string } }`。

## Provider 状态

| Provider | 默认状态 | 能力 | 合规依据 |
|---|---|---|---|
| Apple | enabled | 公开搜索、元数据、官方试听 | Apple iTunes Search/Lookup 公开端点 |
| Audius | enabled | 搜索、公开流；静态版授权下载 | 公开只读 API 无需 Key，播放和下载前分别检查公开权限 |
| MusicBrainz | enabled | CC0 录音元数据 | 默认使用项目地址标识客户端，按官方速率调度；部署者可覆盖联系信息 |
| NetEase | experimental | 元数据搜索；播放禁用 | 仅显式开关启用；接口未获官方稳定性确认，不解析播放地址 |
| Wikimedia | enabled | 开放音频搜索、播放、授权下载 | 官方 Action API 与固定媒体 Host；许可以来源页为准 |
| YouTube Music | conditional | 官方搜索与元数据；播放/歌词/下载禁用 | 仅设置服务端 API Key 时启用；固定一页以限制配额，不抽取媒体 |
| Public Web Catalog | conditional | QQ、酷狗、酷我等 12 个来源的公开页面元数据搜索 | 仅设置 Brave Search 服务端 Key 时启用；固定官方搜索 Host，结果必须通过平台地址/ID白名单 |
| demo | frontend fallback | 静态演示 | 使用公开演示音频，不属于后端 Provider |

QQ、酷狗等平台没有接入逆向私有 API；未配置 Brave Search Key 时只做本地地址/ID识别，配置后仅搜索公开索引页面，播放、歌词和下载仍保持禁用。

## 已有优点

- 单 Provider 超时、聚合降级、稳定交错排序和来源级精确去重。
- 搜索请求合并、短期缓存、缓存容量上限和客户端取消。
- Provider 能力门控；未明确授权时歌词和下载默认关闭。
- Audius Key 为可选服务端配置且不返回前端，并检查返回 URL 是否泄露凭据。
- 前端保留演示回退，第三方故障不会破坏页面基本交互。

## 已落实模块与剩余边界

1. 后端 Provider 共用 `server/providerHttpClient.mjs`，统一执行 HTTPS Host 白名单、逐跳重定向校验、流式响应上限、超时、取消和一次有限退避重试。
2. `LocalFixtureProvider`、LRC 时间轴解析、指定 Provider/分页搜索、Provider 列表和版本化响应均已实现，并由离线集成测试覆盖。
3. 搜索、详情和歌词使用有界进程内缓存；完整故障使用短期负缓存，播放临时地址不持久化。
4. Provider 健康状态、来源级错误、API 限流、结构化请求日志和敏感信息脱敏已统一。
5. 本地开发由 `server/dev.mjs` 同时启动 API 与 Vite；Pages 和无 Node API 的生产构建使用 Apple、Audius、MusicBrainz、Wikimedia Commons 与 Internet Archive 公共聚合。公共适配器限制 Host、响应大小、超时和 MusicBrainz 每秒一次请求，来源故障相互隔离。
6. 当前使用单机 SQLite，仍无共享缓存和分布式限流；多实例生产环境需要外部基础设施。QQ、酷狗等没有已确认官方目录 API 的来源通过受控网页索引补充名称搜索，但不宣称可播放。
7. 仓库仍缺少根 `LICENSE`；发布者必须先确定项目许可证。参考项目只做 clean-room 架构研究，没有复制其代码。

实现保持现有 UI、Track 和 `/api/*` 契约，并增量提供安全公共层与 `/api/music/*` 版本化路由，不引入 PHP 或不必要的运行时依赖。
