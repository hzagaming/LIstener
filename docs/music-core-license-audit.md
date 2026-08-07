# 音乐内核许可证审计

## 参考项目

- 名称：Music Search / `maicong/music`。
- 来源：<https://github.com/maicong/music>。
- 审计提交：`cc30b8636dc6c4df62bf467b0638363a4217f368`。
- LICENSE：MIT，Copyright (c) 2015 Maicong。
- README 附加限制：声明项目停止维护、代码仅供学习交流且不得用于商业用途。该表述与 MIT 授予的商业使用权存在明显歧义。
- 文件头：入口、核心和前端脚本标注 Maicong 作者及仓库链接。

## 兼容性结论

目标仓库当前没有根 `LICENSE`，无法判断其预期分发许可。由于参考 README 还存在额外非商业限制，本轮不直接复制、翻译或派生参考实现；只记录公开的功能名称、调用链和安全风险，并按当前项目架构 clean-room 重写。

因此：

- 可借鉴：Provider 分离、名称/ID/URL 三类行为、统一歌曲输出的抽象思想。
- 必须重写：HTTP Client、参数校验、Provider、解析器、缓存、限流和 API。
- 禁止引入：旧私有接口、签名算法、代理配置、模板、vendor 和播放地址构造。
- 保留署名：文档中保留项目名称、作者、链接和参考提交；没有复制代码，源码文件不加入参考版权头。
- NOTICE：`THIRD_PARTY_NOTICES.md` 记录参考关系和当前 npm 直接依赖。

## 参考项目依赖

| 依赖 | 版本 | 许可证 | 本轮处理 |
|---|---:|---|---|
| php-curl-class/php-curl-class | 8.1.0 | Unlicense | 不引入；使用 Node 原生 fetch |
| Composer 自身 vendor 文件 | 旧仓库存档 | MIT | 不引入 vendor |

## 当前直接依赖

许可证来自已安装包的 `package.json`：

| 依赖 | 版本 | 许可证 |
|---|---:|---|
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| lucide-react | 0.468.0 | ISC |
| better-sqlite3 | 11.10.0 | MIT |
| vite | 6.4.3 | MIT |
| typescript | 5.7.2 | Apache-2.0 |
| @vitejs/plugin-react | 4.3.4 | MIT |
| @types/react | 18.3.18 | MIT |
| @types/react-dom | 18.3.5 | MIT |

本轮新增 `better-sqlite3` 11.10.0（MIT）用于账号与用户状态持久化；数据库运行时文件不进入发行产物。Wikimedia Commons Provider 只调用官方 API，并仅对结果明确指向的公开媒体提供受限流式下载；每个文件仍受其来源页列出的独立许可和署名要求约束，不授予统一再分发权。Brave Search 集成使用官方远程 API，没有引入其软件代码或新 npm 依赖；索引结果只链接平台公开页面，不取得页面或音乐内容的再分发权。维护者在发布前仍需选择目标项目许可证，并确认演示音频及所有外部服务的内容条款；软件许可证不自动授予音乐内容的再分发权。
