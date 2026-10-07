# retrom-runtime Agent 实施规范

本仓库维护可被任意 Web 项目引用的浏览器游戏运行时，目前声明 110 个 Target，覆盖 EmulatorJS 与独立原生 Web/Wasm 核心，不包含宿主应用的上传、审核、权限、数据库、HTTP 路由或产品验收逻辑。

## 边界

- `src/` 实现 Provider declaration、Provider Module V1、运行时生命周期、Target 私有实现、checkpoint codec 与宿主无关的 Envelope 校验。
- `assets/` 保存项目自有 bridge、文本资产与 `assets/facts/` 下经过来源摘要校验的声明事实；不得保存第三方核心源码、源码补丁、二进制构建产物或游戏。`src/runtime/` 是配置构造、实际实现选择、BIOS/Parent 要求和内容身份的宿主无关事实源。
- `src/providers/*/catalog.ts` 生成的 Provider declaration 是 Target、能力、checkpoint contract 与运行文件的唯一机器事实源；`provider-sources.json`（retrom-runtime）和 `src/providers/emulatorjs/source-catalog.ts`（EmulatorJS）只记录第三方上游/本地构建来源，不能声明 Target 或宿主路由。
- 本仓库不得编译第三方核心。第三方核心的源码修改、构建脚本、质量门禁和 Release 全部由对应 fork 的
  `retrom/<baseline>` 分支维护（J2ME 原创集成层使用 `main`）；本仓库只聚合固定 fork tag/commit 的 Release 资产并提供统一接口。
- `tests/` 和与源码同目录的 `*.test.ts` 覆盖运行时行为；宿主产品的导入、发布和权限测试留在宿主仓库。
- 不引用任何宿主应用的源码、生成类型、API 路径、数据库模型或本机绝对路径。

## 工作方式

1. 修改行为前先补能在旧行为失败的回归测试。
2. 新增第三方核心时先在独立 fork 完成源码、构建和 Release，再更新所属 Provider 的来源清单并在 Provider declaration 增加独立 Target；不得在本仓库临时加入源码构建、向 candidate 注入 Target 或使用默认 fallback。
3. 保持配置显式、错误码稳定、生命周期可清理；不为推测风险增加复杂框架。
4. 第三方版本必须固定 repository、tag/commit、asset 文件名和 adapter ABI；不得使用 `latest` 或浮动分支。
5. 不提交第三方游戏、RTP、运行时二进制、凭据或本机缓存。

## 核心最低能力准入

- 每个登记在 Provider declaration 的 Target 都必须在 Chrome 中支持标准手柄完成至少方向移动和确认；
  手柄取消是可选能力，不得因缺少取消拒绝核心接入；已有明确且正常工作的取消能力继续保留和验证。
  上游 Web 核心缺少某个浏览器手柄边界时，由本仓库 adapter 补齐最小映射并在 `exit()` 时释放全部按键，不能把
  “可用键盘或鼠标操作”当作手柄能力。
- 同一映射配置中，一个手柄按钮只能对应一个具体目标输入，不能同时映射多个键或跨输入类型重复发送。
  例如原生 A/B 与键盘 Enter/Escape 不能叠加；不得用重复映射补足确认或可选的取消。真实键盘输入保持独立。
  同一目标的按下/释放事件是一个映射的生命周期，不是多个映射；宿主菜单中的 B 返回不等同于游戏内取消。
- 每个核心默认都必须提供非空、格式明确且有大小上限的存档。仅当用户明确允许某个平台不支持存档时，
  对应 adapter 才可声明 `saveSemantics: "NO_SAVE"`，并同时设置 `checkpoint: null`、`capabilities.checkpoint: false`；
  不得把缺少序列化接口或实现困难视为许可，也不得生成占位存档。该例外只适用于获准平台，必须在 Host 明确提示无法创建或恢复存档。
  非空 checkpoint 必须明确声明 `semantics: "INSTANT"` 或 `"GAME_SAVE"`，不能省略或依赖默认值。
  `INSTANT` 必须在新实例中直接恢复执行状态且继续接受输入。`GAME_SAVE` 的 Target 保存游戏原生存档数据，
  可以要求游戏内保存/读档；Host 必须根据该公共声明展示操作提示，并验证原生保存、整包传输、新实例启动前导入、
  原生读档及继续输入。不得把 RMS 或原生存档声明为即时快照，也不得放宽现有即时快照断言。
- 会读取大型游戏文件的核心不得把浏览器 HTTP 缓存当作唯一复用机制：完整物化的不可变文件必须按稳定内容 URL
  写入浏览器持久缓存、命中时复用，并校验索引声明的准确字节数；缓存后端必须覆盖该格式允许的最大单文件，超过
  Cache Storage 已验证单项边界时使用 OPFS 或有界分块，不能把写入失败当成可接受的常态。采用 Range/按需文件
  系统的核心默认必须保持有界按需分块。仅当 Host 显式选择 `contentLoading: "PRELOAD"` 时，Provider
  可在核心启动前以有界分块完整填充持久缓存；不得将整包保存在 JS 内存。该模式必须确认完整缓存并保持租约至退出，
  缓存不可用时明确失败，由用户重试或切回按需模式。需要在启动前完整物化项目的核心，首次没有持久缓存时
  必须通过公共 `LOAD_PROGRESS` 事件上报整体已加载/总字节，让宿主展示确定进度；按需 Range 核心不得把尚未请求的
  全游戏字节伪装成启动下载进度。默认按需模式的缓存不可用或写入失败只能退回正常网络读取，不能让核心无法启动。新增或修改该
  边界时必须有跨两个
  runtime 实例的网络请求次数回归，以及整包下载/Range 策略的聚焦测试。
- 新核心或改变输入、checkpoint、恢复行为的版本，必须先在本仓库留下旧行为必红的控制与存档单元回归，再通过
  宿主产品的真实审核预览、Product Launch、所声明语义的存档、不同 Launch 恢复和恢复后输入验证。缺少任一必需
  或已声明能力的候选不得加入 Provider declaration、合并到 `master` 或发布稳定 tag。
- 核心差异只能体现在各自 adapter、checkpoint codec 和显式 ABI 中；不得通过降低上述最低能力、要求宿主写
  核心专用旁路或跳过产品验证来完成接入。

## 公共存档压缩

- 所有新存档不设大小阈值，必须在 Provider 公共存档边界统一执行一次 gzip 压缩；恢复时由同一公共层有界解压后再交给核心。覆盖即时快照、原生存档导出、退出最终快照和成功持久化后的确认。
- 核心 adapter 只输出、接收自身未压缩的状态或语义封包；移除 adapter 内已有的传输压缩写入，不得叠加核心 gzip 与公共 gzip。PX68K 等多文件语义容器保留 ZIP，但新写入使用 STORE（level 0），由公共 gzip 压缩。核心原生状态序列化中的字段编码（例如 WebMSX 的数组编码）、游戏固有存档编码和游戏资源解包不属于整包传输压缩；不得破坏核心原生读取契约。
- 公共存储格式通过各 Target 的 `writeFormat`/`readFormats` 显式声明。每个 Target 只读写当前公共单层 gzip 格式；不保留历史编码或按魔数猜测格式。存档恢复同时要求冻结的 core/provider/target、实际实现指纹与完整 active 游戏文件内容 hash 一致。
- 压缩和解压都须校验非空与 Target 大小上限；解压流逐块限制实际输出量，不能只信任 gzip 尾部的长度。损坏、截断、解压超限或取消必须失败，不得回退为新游戏或把压缩字节传入核心。
- 回归必须覆盖小存档、完整字节往返、当前格式读取、单层压缩、损坏/超限、取消，以及原生存档确认和退出最终快照。宿主保存、哈希和传输压缩后的字节，不复制核心专用编解码。

## 可选退出通知

`EXIT_REQUESTED` 是可选的公共生命周期事件，不是核心准入条件。能够可靠观察游戏菜单退出或核心进程结束的 adapter
可以用它通知 Host；一旦上报就必须只上报一次，并立即进入退出流程、关闭 checkpoint 能力和释放核心资源。无法观察
该边界的核心仍可由 Host 调用 `exit()` 结束会话，不需要核心专用旁路。新增或修改该事件的上报时必须用回归覆盖退出
清理。

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
- 发布版本只来自 GitHub 的不可移动 `vX.Y.Z`（或 RC）tag；两个 Provider 的 manifest、客户端导出和归档名统一使用去掉 `v` 的版本。不得在 package.json、provider-sources.json 或 catalog 中维护独立发布版本；未打 tag 的构建使用 `0.0.0-dev`，PFB 客户端沿用已校验基座版本。
- `v*` tag 由 `.github/workflows/release.yml` 构建 GitHub Release；tag 不移动、不覆盖。`vX.Y.Z-rc.N` 可从功能分支发布 GitHub prerelease，稳定 tag 必须已进入 `master`；两者都执行相同代码和聚合门禁。
- `providerId + targetId` 是长期稳定的 Target 身份。Provider Bundle 是单次部署与 Launch 的不可变产物，不能成为 Game、Review 或 Save 的兼容身份。Provider Module、Launch Envelope 与 checkpoint 行为直接修改现有契约，不因不兼容而升级协议代际，也不保留兼容读取、旧调用识别或旧数据迁移。提交前必须运行协议代际门禁。
- checkpoint 格式由当前实现声明，`readFormats` 仅包含当前 `writeFormat`。宿主只向前激活更高 Provider 版本；旧存档格式不可读时禁用恢复，不保留旧 Bundle 或设计运行时回滚。

## 与 Retrom 的本地联调

- 功能分支完成旧行为必红的回归和聚焦门禁后，先保留在分支，不要为了让 Retrom 取得候选 bytes 而提前合并、打 tag 或创建 Release。
- 使用 Retrom PFB 流程，在同一 `.worktree/<pfb>/project/` 下放置 Retrom、本仓库和涉及的 core worktree；`RUNTIME_ROOT` 与 `CORE_ROOTS` 只能指向该 PFB 树。源码与持久 workspace bind mount 到轻量开发容器，日常不构建 Provider archive 或 core。
- 新 PFB 显式导入已验证的 Provider 基座；运行中的 watcher 原子生成当前 loose module，adapter 修改后确认模块 SHA 改变并轻量 restart。工具链、锁文件或 API 生成输入改变时才 down/build/up；不为源码变更创建 revision 目录、切换数据库或反复 checkout 大仓库。
- 显式 candidate/release 构建仍生成完整 Provider Bundle V1；core candidate 只能覆盖所属 Provider 来源清单已声明的来源（`provider-sources.json` 或 EmulatorJS `source-catalog.ts`），不能新增 Target、改写宿主 binding 或污染 production lock。core 字节变化须按 Retrom 的 `pfb-core-build` 显式构建。
- PFB 必须经真实 Retrom 导入、Review Preview、Product Launch、共享 dispatcher、输入、checkpoint、不同 Launch 恢复，
  并在 Target 实现 `EXIT_REQUESTED` 时验证退出清理。源码/依赖构建与实时浏览器验收分开执行，避免热更新干扰活动
  会话；确认通过且取得用户授权后才合并 PR、发布 core tag，再发布本仓库新的不可移动 `v*` tag。
- Release 完成后，Retrom 以独立提交固定正式 Provider descriptor/archive 并重跑同一产品 Case。candidate digest、工作树路径或未发布版本不得写入 production lock 或正式证据。

## 上游 fork 维护

- 各 fork 根目录的 `AGENTS.md` 和 `retrom-fork.json` 是镜像、维护基线与 Release 资产的事实源。具体的 fork 仓库、上游镜像分支与当前维护分支信息参见各 fork 仓库自身的文档。
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

## 运行配置与宿主工具

- Game 的 JSON 只保存游戏特定 content 规则、各核心 options 与 Parent logical path；不保存 BIOS 安装 ID、来源批次、凭据、Provider 部署 URL 或 Bundle 摘要。
- ROM hash 是整份 Game active 游戏文件集合的唯一内容身份。单个非项目 ROM 使用原始 SHA；项目（即使只有一个文件）及多文件集合使用排序后的 logical path/size/SHA 树 hash。媒体文件不属于此集合。
- `scripts/runtime-cli.mjs` 随 npm package 布局离线交付；宿主启动读取 catalog，运行准备调用 prepare，保存列表使用 batch-identity/batch-restorable，不逐条启动 Node，不为列表装配 BIOS 或 Parent。宿主可用 `--serve` 复用有界串行 JSONL 子进程；不新增网络运行服务、持久队列或授权状态。
- PFB 的 host 工具必须完整生成后原子发布不可变快照；不能把活跃宿主指向会被 clean 删除的 dist。Provider watcher 使用当前源码声明及实际 Target 执行闭包计算指纹；无关 adapter 修改不得改变其他 Target 指纹。
- 运行资源只由宿主现有登录态授权。运行 ID 与 RPC nonce 是资源标识/消息关联值，不是授权凭据。隔离页面通过受限内容桥获取原始文件，不签发 ticket/token/capability 或额外 cookie。
- 全部 110 个 Provider Target 保留；既有宿主产品绑定为 109 个，EmulatorJS PPSSPP 没有原产品入口。运行组件测试与真实产品验收必须分别记录，不能用声明数量或空白画面代替产品证据。
