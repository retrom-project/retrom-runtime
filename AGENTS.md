# retrom-runtime Agent 实施规范

本仓库维护可被任意 Web 项目引用的浏览器游戏运行时，目前包含 RPG Maker 与 ONS，不包含宿主应用的上传、审核、权限、数据库、HTTP 路由或产品验收逻辑。

## 边界

- `src/` 只实现运行时生命周期、adapter、checkpoint codec 与宿主无关的配置校验。
- `assets/` 保存项目自有 bridge、补丁说明和小型文本资产；第三方 JS/Wasm 只进入 tag Release，不提交 Git。
- `runtime-manifest.json` 是支持核心、上游 Release、adapter ABI 与发布资产的唯一机器事实源。
- 需要小型宿主接口补丁的上游核心可由 tag Release 工作流按固定 repository、tag、commit 构建；不把宿主产品逻辑写入补丁。
- `tests/` 和与源码同目录的 `*.test.ts` 覆盖运行时行为；宿主产品的导入、发布和权限测试留在宿主仓库。
- 不引用任何宿主应用的源码、生成类型、API 路径、数据库模型或本机绝对路径。

## 工作方式

1. 修改行为前先补能在旧行为失败的回归测试。
2. 新增核心先作为未改变既有核心行为的独立 manifest 项和 adapter；不得用默认 fallback。
3. 保持配置显式、错误码稳定、生命周期可清理；不为推测风险增加复杂框架。
4. 第三方版本必须固定 repository、tag/commit、asset 文件名和 adapter ABI；不得使用 `latest` 或浮动分支。
5. 不提交第三方游戏、RTP、运行时二进制、凭据或本机缓存。

## 必跑门禁

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run package:check
```

发布 tag 前还必须运行 `npm run release:build`，确认生成的包和 core asset bundle metadata 可由干净目录验证。

## 提交与发布

- 完成一个功能或 bug 修复后单独提交；不要混入无关格式化。
- PR 到 `master` 必须通过 `.github/workflows/quality.yml`。
- `v*` tag 由 `.github/workflows/release.yml` 构建 GitHub Release；tag 不移动、不覆盖。
- 发布产物是兼容边界。破坏公共类型、checkpoint 格式或 adapter ABI 时必须升级相应版本并在 CHANGELOG 说明。
- 已登记 core 的 `gameCompatibilityLine` 不得原地改变；无法继续读取既有游戏输入时建立新 core identity。
  checkpoint 格式变化时更新 `saveAbi`，并只在真实验证后把旧值保留在 `readableSaveAbis`。宿主按当前
  runtime 向前运行，旧存档不兼容时禁用；本仓库不以保留旧 bundle 或 runtime 回滚作为兼容方案。

## 与 Retrom 的本地联调

- 功能分支完成旧行为必红的回归和聚焦门禁后，先保留在分支，不要为了让 Retrom 取得候选 bytes 而提前合并、打 tag 或创建 Release。
- 相邻 Retrom checkout 使用 `RETROM_RUNTIME_DEV_ROOT=/absolute/path/to/this/checkout make dev`。该入口默认只链接本仓库已构建的 `dist`，不会改变 Retrom 的正式 manifest/package lock 或 core bytes；宿主必须以显式 transpile/watch 和独立的被忽略 distDir 编译该链接，不能复用正式包的持久前端 bundle 缓存。普通 adapter 改动只需 `npm run build`，该步骤由 Retrom link target 自动执行；修改 ONS core 或 host patch 时才先显式运行 `npm run core:ons:build`，并在可删除的 fresh Retrom dev DB 上额外设置 `RETROM_RUNTIME_DEV_INCLUDE_ASSETS=true`。不得在已有 artifact 引用的数据库中用本地 bytes 冒充同一正式 Release identity。
- 必须用本地链接完成受影响 core 的真实 Retrom 导入、审核预览、Product Launch、控制、checkpoint 与不同 Launch 恢复验证。确认通过后才合并 PR，按 package version 创建一个新的不可移动 `v*` tag，并等待 Release workflow 成功。
- Release 完成后，Retrom 先运行 `make retrom-runtime-dev-unlink`，再以独立提交固定新 tag、tag commit、package asset 与 aggregate runtime assets，重新运行正式依赖门禁和同一产品 Case。不得把本地 observed digest、工作树路径或未发布版本写进正式 manifest、证据或文档。

## 上游 fork 维护

- `xxxsen/Player` 的 `master` 与 `xxxsen/mkxp-z-libretro-emscripten` 的
  `main` 只做上游 fast-forward 镜像，不含 Retrom 修改；当前维护与默认
  分支分别是 `retrom/0.8.1.1` 和 `retrom/f2efc98`。各 fork 根目录
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
