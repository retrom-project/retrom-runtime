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

## 上游 fork 维护

- `xxxsen/Player` 只使用 `master`，`xxxsen/mkxp-z-libretro-emscripten`
  只使用 `main`；各自根目录 `AGENTS.md` 和 `retrom-fork.json` 是分支、
  上游基线与 Release 资产的事实源。
- fork 工作分支只允许 `fix/*`、`feat/*`、`build/*` 与
  `sync/upstream-*`，合并后删除；不得创建 `runtime-clean`、平行版本
  长分支或以 Agent 名命名的分支。
- fork Release 只使用 `rpg-runtime-<upstream-baseline>-rN`；上游没有
  tag 时以 `g<12-hex-commit>` 表示新基线。不得再创建
  `retrom-web-*`、`latest`、`stable` 或其他别名 tag。
- `retrom-runtime` 的 prerelease 可以固定 fork 的 `-rc.N` 候选；稳定
  tag 只能固定已发布的稳定 fork tag。任何 fork tag、tag commit、资产名
  或 adapter ABI 变化都必须作为独立 manifest 变更验证。
