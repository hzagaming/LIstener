# 音乐内核接入审计

## 当前技术栈

- 运行时：Node.js >= 18.17，原生 ESM。
- 前端：React 18、TypeScript 5 严格模式、Vite 6。
- 后端：Node `http`、原生 `fetch` 与 `AbortSignal`，入口为 `server/index.mjs`。
- 测试：Node Test Runner；构建执行 TypeScript 静态检查和 Vite 打包。
- 数据库、队列、Docker、CI：当前均未配置。
- 缓存与限流：进程内搜索缓存、请求合并、API IP 限流及部分 Provider 请求调度。
- 配置：通过 `process.env` 读取，公开变量示例位于 `.env.example`。
- 日志：启动日志使用 `console.log`，尚无统一结构化请求日志。
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
| Audius | conditional | 搜索、公开流 | 仅设置服务端 API Key 时启用，播放前检查公开权限 |
| MusicBrainz | conditional | CC0 录音元数据 | 仅设置联系信息时启用，按官方速率调度 |
| NetEase | experimental | 元数据搜索；播放禁用 | 仅显式开关启用；接口未获官方稳定性确认，不解析播放地址 |
| demo | frontend fallback | 静态演示 | 使用公开演示音频，不属于后端 Provider |

QQ、酷狗等平台目前只做本地地址/ID 识别，没有生产搜索 Provider。这种能力边界必须保留，不能根据参考项目的旧私有接口擅自启用。

## 已有优点

- 单 Provider 超时、聚合降级、稳定交错排序和来源级精确去重。
- 搜索请求合并、短期缓存、缓存容量上限和客户端取消。
- Provider 能力门控；未明确授权时歌词和下载默认关闭。
- Audius Key 不返回前端，并检查返回 URL 是否泄露凭据。
- 前端保留演示回退，第三方故障不会破坏页面基本交互。

## 缺口和本轮范围

1. Provider 尚未共用安全 HTTP Client，响应大小、重定向白名单和有限重试行为不一致。
2. 缺少稳定的后端 LocalFixtureProvider，无法离线验证完整详情和歌词链路。
3. 缺少独立 LRC 解析器及时间轴结构。
4. 搜索 API 缺少指定 Provider、页码、统一新版响应与 Provider 列表接口。
5. 健康状态、结构化日志和敏感信息脱敏尚未统一。
6. 详情和歌词没有独立短期缓存；当前没有负缓存。
7. 架构、Provider 开发、安全策略和许可证文档不完整。

本轮采用增量接入：保留现有 UI、Track 和 `/api/*` 契约，在其上增加安全公共层、新版 `/api/music/*` 路由和测试，不引入数据库或 PHP。
