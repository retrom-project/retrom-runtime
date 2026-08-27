# retrom-runtime Agent 实施规范

本仓库维护可被任意 Web 项目引用的 RPG Maker 浏览器运行时，不包含宿主应用的上传、审核、权限、数据库、HTTP 路由或产品验收逻辑。

## 边界

- `src/` 只实现运行时生命周期、adapter、checkpoint codec 与宿主无关的配置校验。
- `assets/` 保存项目自有 bridge、补丁说明和小型文本资产；第三方 JS/Wasm 只进入 tag Release，不提交 Git。
- `runtime-manifest.json` 是支持核心、上游 Release、adapter ABI 与发布资产的唯一机器事实源。
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
