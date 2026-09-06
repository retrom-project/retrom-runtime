# retrom-runtime Agent 实施规范

本仓库维护可被任意 Web 项目引用的浏览器游戏运行时，目前包含 RPG Maker、ONS、KiriKiri、Butterscotch、TyranoScript 与 WASM-4，不包含宿主应用的上传、审核、权限、数据库、HTTP 路由或产品验收逻辑。

## 边界

- `src/` 实现 Provider declaration、Provider Module V1、运行时生命周期、Target 私有实现、checkpoint codec 与宿主无关的 Envelope 校验。
- `assets/` 只保存项目自有 bridge 与小型文本资产；不得保存第三方核心源码、源码补丁或构建产物。
- `src/providers/*/catalog.ts` 生成的 Provider declaration 是 Target、能力、checkpoint contract 与运行文件的唯一机器事实源；`provider-sources.json` 只记录第三方上游/本地构建来源，不能声明 Target 或宿主路由。
- 本仓库不得编译第三方核心。第三方核心的源码修改、构建脚本、质量门禁和 Release 全部由对应 fork 的
  `retrom/<baseline>` 分支维护；本仓库只聚合固定 fork tag/commit 的 Release 资产并提供统一接口。
- `tests/` 和与源码同目录的 `*.test.ts` 覆盖运行时行为；宿主产品的导入、发布和权限测试留在宿主仓库。
- 不引用任何宿主应用的源码、生成类型、API 路径、数据库模型或本机绝对路径。

## 工作方式

1. 修改行为前先补能在旧行为失败的回归测试。
2. 新增第三方核心时先在独立 fork 完成源码、构建和 Release，再更新 `provider-sources.json` 并在 Provider declaration 增加独立 Target；不得在本仓库临时加入源码构建、向 candidate 注入 Target 或使用默认 fallback。
3. 保持配置显式、错误码稳定、生命周期可清理；不为推测风险增加复杂框架。
4. 第三方版本必须固定 repository、tag/commit、asset 文件名和 adapter ABI；不得使用 `latest` 或浮动分支。
5. 不提交第三方游戏、RTP、运行时二进制、凭据或本机缓存。

## 核心最低能力准入

- 每个登记在 Provider declaration 的 Target 都必须在 Chrome 中支持标准手柄完成至少方向移动、确认和取消；
  上游 Web 核心缺少某个浏览器手柄边界时，由本仓库 adapter 补齐最小映射并在 `exit()` 时释放全部按键，不能把
  “可用键盘或鼠标操作”当作手柄能力。
- 每个核心都必须提供非空、格式明确且有大小上限的存档。checkpoint 未声明 `semantics` 时按 `INSTANT` 处理，
  必须在新实例中直接恢复执行状态且继续接受输入。明确声明 `GAME_SAVE` 的 Target 保存游戏原生存档数据，
  可以要求游戏内保存/读档；Host 必须根据该公共声明展示操作提示，并验证原生保存、整包传输、新实例启动前导入、
  原生读档及继续输入。不得把 RMS 或原生存档声明为即时快照，也不得放宽现有即时快照断言。
- 游戏通过自身菜单退出或核心进程自行结束时，adapter 必须一次性上报公共 `EXIT_REQUESTED` 事件，并立即让
  controller 进入退出流程、关闭 checkpoint 能力和释放核心资源；不得把已退出的黑色 canvas 留给宿主，也不得
  允许宿主继续对已结束的核心创建存档。新增核心必须用回归覆盖这一边界，不能要求宿主识别核心专用退出状态。
- 会读取大型游戏文件的核心不得把浏览器 HTTP 缓存当作唯一复用机制：完整物化的不可变文件必须按稳定内容 URL
  写入浏览器持久缓存、命中时复用，并校验索引声明的准确字节数；缓存后端必须覆盖该格式允许的最大单文件，超过
  Cache Storage 已验证单项边界时使用 OPFS 或有界分块，不能把写入失败当成可接受的常态。采用 Range/按需文件
  系统的核心必须保持有界分块，不得退化为启动前整包下载。需要在启动前完整物化项目的核心，首次没有持久缓存时
  必须通过公共 `LOAD_PROGRESS` 事件上报整体已加载/总字节，让宿主展示确定进度；按需 Range 核心不得把尚未请求的
  全游戏字节伪装成启动下载进度。缓存不可用或写入失败只能退回正常网络读取，不能让核心无法启动。新增或修改该
  边界时必须有跨两个
  runtime 实例的网络请求次数回归，以及整包下载/Range 策略的聚焦测试。
- 新核心或改变输入、checkpoint、恢复、核心自身退出行为的版本，必须先在本仓库留下旧行为必红的控制与存档单元回归，再通过
  宿主产品的真实审核预览、Product Launch、所声明语义的存档、不同 Launch 恢复和恢复后输入验证。缺少任一能力的候选
  不得加入 Provider declaration、合并到 `master` 或发布稳定 tag。
- 核心差异只能体现在各自 adapter、checkpoint codec 和显式 ABI 中；不得通过降低上述最低能力、要求宿主写
  核心专用旁路或跳过产品验证来完成接入。

## 必跑门禁

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run package:check
```

发布 tag 前还必须运行 `npm run provider:input:check`、`npm run provider:build`、`npm run provider:check` 与 `npm run release:build`，确认固定 fork Release、Provider Bundle、许可和聚合包可由干净目录确定性验证。

## 提交与发布

- 完成一个功能或 bug 修复后单独提交；不要混入无关格式化。
- PR 到 `master` 必须通过 `.github/workflows/quality.yml`；该门禁会聚合并验证固定 fork Release，但不得编译核心。
- `v*` tag 由 `.github/workflows/release.yml` 构建 GitHub Release；tag 不移动、不覆盖。
- `providerId + targetId` 是长期稳定的 Target 身份。Provider Bundle 是单次部署与 Launch 的不可变产物，不能成为 Game、Review 或 Save 的兼容身份。破坏 Provider Module、Launch Envelope 消费、checkpoint 格式或 Target 行为时必须升级相应版本并在 CHANGELOG 说明。
- checkpoint 格式变化时更新 `writeFormat`，并只在真实验证后把旧值保留在 `readFormats`。宿主只向前激活更高 Provider 版本；旧存档格式不可读时禁用恢复，不保留旧 Bundle 或设计运行时回滚。

## 与 Retrom 的本地联调

- 功能分支完成旧行为必红的回归和聚焦门禁后，先保留在分支，不要为了让 Retrom 取得候选 bytes 而提前合并、打 tag 或创建 Release。
- 使用 Retrom PFB 流程，在同一 `.worktree/<pfb>/project/` 下放置 Retrom、本仓库和涉及的 core worktree；`RUNTIME_ROOT` 与 `CORE_ROOTS` 只能指向该 PFB 树。源码与持久 workspace bind mount 到轻量开发容器，日常不构建 Provider archive 或 core。
- 新 PFB 显式导入已验证的 Provider 基座；运行中的 watcher 原子生成当前 loose module，adapter 修改后确认模块 SHA 改变并轻量 restart。工具链、锁文件或 API 生成输入改变时才 down/build/up；不为源码变更创建 revision 目录、切换数据库或反复 checkout 大仓库。
- 显式 candidate/release 构建仍生成完整 Provider Bundle V1；core candidate 只能覆盖 `provider-sources.json` 已声明的来源，不能新增 Target、改写宿主 binding 或污染 production lock。core 字节变化须按 Retrom 的 `pfb-core-build` 显式构建。
- PFB 必须经真实 Retrom 导入、Review Preview、Product Launch、共享 dispatcher、输入、checkpoint、不同 Launch 恢复和退出清理验证当前开发模块与基座。源码/依赖构建与实时浏览器验收分开执行，避免热更新干扰活动会话；确认通过且取得用户授权后才合并 PR、发布 core tag，再发布本仓库新的不可移动 `v*` tag。
- Release 完成后，Retrom 以独立提交固定正式 Provider descriptor/archive 并重跑同一产品 Case。candidate digest、工作树路径或未发布版本不得写入 production lock 或正式证据。

## 上游 fork 维护

- `retrom-project/Player` 的 `master`、`retrom-project/mkxp-z-libretro-emscripten` 的 `main`、
  `retrom-project/OnscripterYuri` 的 `master`、`retrom-project/kirikiroid2-web` 的 `web`、
  `retrom-project/Butterscotch` 的 `main`、`retrom-project/tyranoscript` 的 `master` 与 `retrom-project/wasm4` 的 `main`
  只做上游 fast-forward 镜像，不含 Retrom 修改；当前维护与默认分支分别是
  `retrom/0.8.1.1`、`retrom/f2efc98`、`retrom/0.7.7beta`、
  `retrom/g338d2029f169`、`retrom/gae2602f1f83c`、`retrom/gc8dbfd492afd` 与
  `retrom/gca2600db8de4`。各 fork 根目录
  `AGENTS.md` 和 `retrom-fork.json` 是镜像、维护基线与 Release 资产的
  事实源。
- fork 工作分支只允许 `fix/*`、`feat/*`、`build/*` 与
  `sync/upstream-*`，并从当前 `retrom/<baseline>` 创建、合并后删除；
  不得把补丁并入移动的上游镜像，不得创建 `runtime-clean`、平行版本
  长分支或以 Agent 名命名的分支。
- fork Release 只使用 `retrom-core-<upstream-baseline>-rN`；上游没有
  tag 时以 `g<12-hex-commit>` 表示新基线。不得再创建
  `rpg-runtime-*`、`retrom-web-*`、`latest`、`stable` 或其他别名 tag；已有旧前缀 tag
  仅作为不可移动的历史记录保留。
- `retrom-runtime` 的 prerelease 可以固定 fork 的 `-rc.N` 候选；稳定
  tag 只能固定已发布的稳定 fork tag。任何 fork tag、tag commit、资产名
  或 adapter ABI 变化都必须作为独立 manifest 变更验证。
- 第三方核心 fork 是唯一源码与构建归属。本仓库不得重新引入 `sourceBuilds`、core build npm script、
  第三方 patch 目录或在 quality/release workflow 中执行核心编译。
