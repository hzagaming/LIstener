# 参考项目功能映射

参考仓库：`maicong/music`，审计提交 `cc30b8636dc6c4df62bf467b0638363a4217f368`。参考代码只读存放在被 Git 忽略的 `.reference/music-1`。

| 参考功能 | 参考文件/符号 | 当前用途 | 处理方式 | 当前模块 |
|---|---|---|---|---|
| 前端搜索提交 | `static/js/music.js` | 搜索、分页、播放器列表 | 不复制；沿用 React 页面 | `src/App.tsx` |
| 请求入口与参数分流 | `index.php` | API 参数校验和路由 | clean-room 重写 | `server/http.mjs` |
| 按名称搜索 | `mc_get_song_by_name` | 关键词搜索 | 采用 Provider 聚合，不复用旧接口 | `server/musicService.mjs` |
| 按 ID 查询 | `mc_get_song_by_id` | 详情查询 | 按来源路由并校验标准 Track | `server/musicService.mjs` |
| URL 识别 | `mc_get_song_by_url` | 地址/ID 识别 | 只对白名单平台做本地解析 | `server/platforms.mjs` |
| URL 表 | `mc_song_urls` | Provider 请求构造 | 废弃巨大 switch；每来源独立模块 | `server/providers/*` |
| Curl 包装 | `mc_curl` | HTTP 请求 | 不复制；替换为受控公共 Client | `server/providerHttpClient.mjs` |
| 网易参数编码 | `encode_netease_data` | 旧私有接口签名 | 禁止迁移 | 无 |
| QQ 播放地址生成 | `generate_qqmusic_url` | 旧播放地址拼装 | 禁止迁移 | 无 |
| 虾米地址解码 | `decode_xiami_location` | 已下线来源 | 废弃 | 无 |
| 歌词转换 | `generate_kuwo_lrc` 等 | LRC 时间轴 | 按格式行为重新实现 | `server/lyrics.mjs` |
| JSON/JSONP 宽松解析 | `jsonp2json` | 第三方响应解析 | 不接受任意脚本；只解析 JSON | Provider/HTTP Client |
| 统一响应 | `response` | API 输出 | 保留当前 JSON 错误契约并新增 v2 meta | `server/http.mjs` |

## 不迁移的行为

- 非公开、已下线或未经确认的第三方接口。
- 自动跟随任意重定向、HTTP 明文请求、代理池和任意 URL 抓取。
- 搜索后对每条结果继续请求详情和歌词的 N+1 链路。
- 付费地址、旧 vkey、加密签名或地域限制规避逻辑。
- PHP 模板、jQuery 播放器、CSS、图片、vendor 和商业音乐链接。

未有官方文档、合法凭据或当前真实响应佐证的来源只保留本地 ID/URL 识别，不声明 Provider 可用。
