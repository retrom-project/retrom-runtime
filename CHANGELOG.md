# Changelog


## 0.45.0

- Prefetch the adjacent network window when demand reads reach the current window's final internal block, using existing memory and persistent caches without changing core reads or the Content I/O contract.
- Deduplicate demand and prefetch in either arrival order, promote adopted work to foreground without restarting HTTP, and limit speculative work to spare scheduling and buffer capacity.
- Cover multi-window reads, cancellation, deadlines, failures, persistent reuse, and resource cleanup with unit and browser regressions.

## 0.44.0

- TIC-80／FAKE-08 在准备开始前报告游戏与运行资产总量，随后按已校验并提交的字节推进加载进度。

- Content workspaces now allow OPFS delivery without Web Locks using independent generations; locked reuse publishes only complete generations and retains published files after cancellation. Completed workspace generations are not automatically collected.
- Content I/O Session 支持冻结的小文件整取阈值与独立网络窗口；默认 1 MiB / 512 KiB，内部缓存块保持 256 KiB。
- 修复缓存降级与本地读取身份错误时的跨 reader 撤销，并记录缓存后端诊断。

- Provider 私有的 Content I/O v1 统一游戏字节读取、完整物化、可配置 Range 窗口与 256 KiB 缓存块、持久缓存和取消。Provider Module V1、Launch Envelope V1、Target 身份和 checkpoint 格式保持原契约。
- NeoCD、ScummVM、独立 PPSSPP、Play!、mkxp 和 KiriKiri 使用公共 Reader；原有完整下载入口仍按原来的加载时机物化。EasyRPG、J2ME、隔离网页和 ONS 浏览器视频保留既有上游/浏览器加载边界。
- Provider 新增 `assets/content-io/worker.mjs`；同步 Worker 目标额外声明 `sync-client.mjs`。二者均由同一构建器生成并逐字节校验。旧基座不能承载新资产或新核心 ABI，PFB 需显式安装完整候选基座。
- PPSSPP、Play!、KiriKiri 和 mkxp 使用对应新 ABI 的固定核心 Release；未发布来源仍只能用于显式候选构建，不能作为正式 Release 输入。
- 持久缓存使用新的 `retrom-content-io-v1` namespace，不读取或删除旧核心缓存。升级后的首次读取可能重新下载；可选缓存失败依次降级，不改变文件格式上限。
- 自有项目 JSON 索引读取增加确定性元数据预算：`max(16 MiB, 65536 + maximumProjectFiles * (18 * maximumPathCodeUnits + 8192))`，其中文件数与路径长度取原索引校验上限。预算限制 JSON 表示大小，不缩小游戏文件上限。
- Butterscotch 使用不可变工作代和逐文件摘要校验，存档按会话隔离。工作副本与公共原始缓存可能同时占用磁盘；本版不自动回收已完成的工作代，未提交代在失败时清理。公共原始缓存的 GC 不会清除存档。

发布与验收范围：完整 21 Target 故障／性能矩阵未签收；已执行的产品证据保留各自候选版本，不声明全量覆盖。发布状态以不可变 tag 及其 Release 资产为准。
