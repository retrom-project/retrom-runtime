# retrom-runtime Agent 实施规范

本仓库维护可被任意 Web 项目引用的浏览器游戏运行时，目前包含 RPG Maker、ONS、KiriKiri 与 Butterscotch，不包含宿主应用的上传、审核、权限、数据库、HTTP 路由或产品验收逻辑。

## 边界

- `src/` 只实现运行时生命周期、adapter、checkpoint codec 与宿主无关的配置校验。
- `assets/` 只保存项目自有 bridge 与小型文本资产；不得保存第三方核心源码、源码补丁或构建产物。
- `runtime-manifest.json` 是支持核心、上游 Release、adapter ABI 与发布资产的唯一机器事实源。
- 本仓库不得编译第三方核心。第三方核心的源码修改、构建脚本、质量门禁和 Release 全部由对应 fork 的
  `retrom/<baseline>` 分支维护；本仓库只聚合固定 fork tag/commit 的 Release 资产并提供统一接口。
- `tests/` 和与源码同目录的 `*.test.ts` 覆盖运行时行为；宿主产品的导入、发布和权限测试留在宿主仓库。
- 不引用任何宿主应用的源码、生成类型、API 路径、数据库模型或本机绝对路径。

## 工作方式

1. 修改行为前先补能在旧行为失败的回归测试。
2. 新增第三方核心时先在独立 fork 完成源码、构建和 Release，再作为未改变既有核心行为的独立
   manifest 项和 adapter 接入；不得在本仓库临时加入源码构建，也不得使用默认 fallback。
3. 保持配置显式、错误码稳定、生命周期可清理；不为推测风险增加复杂框架。
4. 第三方版本必须固定 repository、tag/commit、asset 文件名和 adapter ABI；不得使用 `latest` 或浮动分支。
5. 不提交第三方游戏、RTP、运行时二进制、凭据或本机缓存。

## 核心最低能力准入

- 每个登记在 `runtime-manifest.json` 的核心都必须在 Chrome 中支持标准手柄完成至少方向移动、确认和取消；
  上游 Web 核心缺少某个浏览器手柄边界时，由本仓库 adapter 补齐最小映射并在 `exit()` 时释放全部按键，不能把
  “可用键盘或鼠标操作”当作手柄能力。
- 每个核心都必须提供非空、格式明确且有大小上限的即时存档，并能在新的 runtime 实例中直接恢复到该存档状态；
  恢复后必须仍可继续接受手柄或键盘输入，不能要求用户再从游戏自己的存档菜单手动读档。
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
  宿主产品的真实审核预览、Product Launch、即时存档、不同 Launch 恢复和恢复后输入验证。缺少任一能力的候选
  不得加入 manifest、合并到 `master` 或发布稳定 tag。
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

发布 tag 前还必须运行 `npm run release:build`，确认固定 fork Release 可下载、metadata 匹配且聚合包可由干净目录验证。

## 提交与发布

- 完成一个功能或 bug 修复后单独提交；不要混入无关格式化。
- PR 到 `master` 必须通过 `.github/workflows/quality.yml`；该门禁会聚合并验证固定 fork Release，但不得编译核心。
- `v*` tag 由 `.github/workflows/release.yml` 构建 GitHub Release；tag 不移动、不覆盖。
- 发布产物是兼容边界。破坏公共类型、checkpoint 格式或 adapter ABI 时必须升级相应版本并在 CHANGELOG 说明。
- 已登记 core 的 `gameCompatibilityLine` 不得原地改变；无法继续读取既有游戏输入时建立新 core identity。
  checkpoint 格式变化时更新 `saveAbi`，并只在真实验证后把旧值保留在 `readableSaveAbis`。宿主按当前
  runtime 向前运行，旧存档不兼容时禁用；本仓库不以保留旧 bundle 或 runtime 回滚作为兼容方案。

## 与 Retrom 的本地联调

- 功能分支完成旧行为必红的回归和聚焦门禁后，先保留在分支，不要为了让 Retrom 取得候选 bytes 而提前合并、打 tag 或创建 Release。
- 相邻 Retrom checkout 使用 `RETROM_RUNTIME_DEV_ROOT=/absolute/path/to/this/checkout make dev`。该入口默认只链接本仓库已构建的 `dist`，不会改变 Retrom 的正式 manifest/package lock 或 core bytes；宿主必须以显式 transpile/watch 和独立的被忽略 distDir 编译该链接，不能复用正式包的持久前端 bundle 缓存。普通 adapter 改动只需 `npm run build`，该步骤由 Retrom link target 自动执行。
- 修改第三方核心时，进入对应 fork，按其根 `AGENTS.md` 运行
  `.github/rpg-runtime/build-web.sh <absolute-output-directory>` 与
  `.github/rpg-runtime/verify-release.py`。联调阶段不提前打 tag：在本仓库设置
  `RETROM_RUNTIME_DEV_RELEASE_OVERRIDES='{"onsyuri":"/absolute/output"}'`（EasyRPG、mkxp、KiriKiri 与
  Butterscotch 分别使用 `easyrpg`、`mkxp`、`kirikiri2`、`butterscotch`）运行
  `npm run release:build`；再把同一变量与 `RETROM_RUNTIME_DEV_ROOT`、`RETROM_RUNTIME_DEV_INCLUDE_ASSETS=true`
  一并传给 fresh Retrom dev 实例。该 override 只替换被忽略的本地 stage，不修改正式 manifest、package lock 或 Release identity。
- 必须先用本地 fork 资产完成真实 Retrom 产品链，再在 fork 打不可移动 tag；随后本仓库才把 manifest 固定到该
  fork Release。不得把本地 observed digest、工作树路径或未发布版本写进正式 manifest、证据或文档。
- 必须用本地链接完成受影响 core 的真实 Retrom 导入、审核预览、Product Launch、控制、checkpoint 与不同 Launch 恢复验证。确认通过后才合并 PR，按 package version 创建一个新的不可移动 `v*` tag，并等待 Release workflow 成功。
- Release 完成后，Retrom 先运行 `make retrom-runtime-dev-unlink`，再以独立提交固定新 tag、tag commit、package asset 与 aggregate runtime assets，重新运行正式依赖门禁和同一产品 Case。不得把本地 observed digest、工作树路径或未发布版本写进正式 manifest、证据或文档。

## 上游 fork 维护

- `xxxsen/Player` 的 `master`、`xxxsen/mkxp-z-libretro-emscripten` 的 `main`、
  `xxxsen/OnscripterYuri` 的 `master`、`xxxsen/kirikiroid2-web` 的 `web` 与 `xxxsen/Butterscotch` 的 `main`
  只做上游 fast-forward 镜像，不含 Retrom 修改；当前维护与默认分支分别是
  `retrom/0.8.1.1`、`retrom/f2efc98`、`retrom/0.7.7beta`、
  `retrom/g338d2029f169` 与 `retrom/gae2602f1f83c`。各 fork 根目录
  `AGENTS.md` 和 `retrom-fork.json` 是镜像、维护基线与 Release 资产的
  事实源。
- fork 工作分支只允许 `fix/*`、`feat/*`、`build/*` 与
  `sync/upstream-*`，并从当前 `retrom/<baseline>` 创建、合并后删除；
  不得把补丁并入移动的上游镜像，不得创建 `runtime-clean`、平行版本
  长分支或以 Agent 名命名的分支。
- fork Release 只使用 `rpg-runtime-<upstream-baseline>-rN`；上游没有
  tag 时以 `g<12-hex-commit>` 表示新基线。不得再创建
  `retrom-web-*`、`latest`、`stable` 或其他别名 tag。
- `retrom-runtime` 的 prerelease 可以固定 fork 的 `-rc.N` 候选；稳定
  tag 只能固定已发布的稳定 fork tag。任何 fork tag、tag commit、资产名
  或 adapter ABI 变化都必须作为独立 manifest 变更验证。
- 第三方核心 fork 是唯一源码与构建归属。本仓库不得重新引入 `sourceBuilds`、core build npm script、
  第三方 patch 目录或在 quality/release workflow 中执行核心编译。
