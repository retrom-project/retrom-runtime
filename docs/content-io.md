# Content I/O v1

The Provider owns one Content Session per mounted runtime. Managed adapters register immutable sources and use the shared Reader or materializer; core forks receive opaque file IDs and the versioned bridge. No Host route, user, database or game-import knowledge enters this layer.

The machine contracts are in [`contracts/content-io/v1`](../contracts/content-io/v1/). ABI and contract digest must match before native startup. Worker and synchronous-client modules are self-contained Provider assets covered by the Bundle asset index. A changed native ABI requires a complete verified core candidate and a new Provider base; a loose client overlay alone cannot replace old native assets.

## Sources and reads

A source declares size, URL, purpose, identity and transport policy. Single files use a SHA-256 identity; indexed files use a trusted immutable project digest plus normalized logical path. Storage identity also includes the storage origin. Signed URLs or authorization data are never stored as cache identity. Only authorized origins from the verified bootstrap may be requested.

Registration and stat consume metadata only. Readers offer exact asynchronous reads, an all-or-nothing synchronous hot-cache probe, and bounded streaming. Logical reads are at most 16 MiB; native bridges segment larger requests and preserve offsets above 4 GiB. Internal cache and bridge blocks are 256 KiB; HTTP fetching uses the Session policy below. Range responses must match the requested interval, total size, strong ETag and declared length, with no content encoding. The stream reader confirms EOF before handing bytes from the final network chunk to an asynchronous consumer, even when that chunk spans several cache blocks. Final cache writes cannot defer transport completion, and trailing bytes fail before those blocks are exposed. Identity changes revoke the object; closing a file or Session cancels its requests and prevents late writes.

The Session shares a 16 MiB raw-block LRU budget, 8 MiB temporary-buffer credits (including output credits and a reserved 512 KiB lane for at most two cache-write copies), four physical network slots and a bounded queue. The synchronous bridge uses a single permanent-epoch mailbox and Atomics; it cannot synchronously call HTTP. Native shutdown completes before normal Content Session close. Forced shutdown revokes reads first.

## Session fetch policy

The Session creation options accept a validated, frozen `fetchPolicy`: `smallFileThresholdBytes` defaults to 1 MiB inclusive and `networkWindowBytes` to 512 KiB. Missing fields use the central defaults; unknown fields, unsafe or fractional integers and invalid alignment fail before I/O. The threshold may be zero to disable whole-small-file fetching. Its maximum, and the maximum window, derive from the temporary pool after output reservation, conservatively preserving space for output, a bounded fetch window and pending cache writes (initially 2 MiB). The window must be a positive multiple of the internal block size and no smaller than one block.

Only actual reads trigger fetching. A valid cache hit is returned directly. A miss in a small file plans the whole file; an uncached file can use an explicitly authorized whole GET. Larger files use the aligned window containing the requested offset, clipped at EOF. Existing valid blocks split that plan into contiguous missing ranges; they are never downloaded just to fill a window. Concurrent readers share the same window task with independent cancellation. The last cancellation aborts the fetch. No unopened file is fetched. Real reads may initiate one adjacent speculative window as described below.

Each response retains origin, ETag/If-Match, exact length and applicable full SHA verification. A small-file authorization does not permit a large-file or partial-range 200 response. Fetched bytes split into the existing internal block layout, within the shared network and memory budgets. Fetch configuration never enters source identity or persistent keys; a new Session with different settings reuses old verified blocks. Tests cover non-default thresholds/windows, boundaries, partial cache, concurrency, cancellation and unavailable storage. Product evidence records configuration, requests, bytes and first availability together.

## Sequential prefetch

Prefetch is a fixed internal runtime strategy, not a `ContentFetchPolicyV1` field; it does not change the ABI, messages, contract digest or core range reads. After a successful nonempty demand copy touches a window's final 256 KiB block (including the exact block boundary), the IO Worker Reader may submit the immediately following network window. Successful memory-cache reads also qualify. Empty reads, failed cache probes, materialization and prefetch completion do not trigger speculation. Whole-small-file windows and EOF have no successor. Windows of any validated size use the same alignment and EOF clipping as demand reads.

The Reader's prefetch hook is optional: client-side Readers remain block consumers, and only the IO Worker's BlockPool schedules physical prefetch. Reads fully served from client L1 do not send a new notification or change the bridge contract. A multi-window demand may trigger at each tail it actually consumes; fetching a window alone never starts a chain.

Each Session admits at most one active task whose priority is still `PREFETCH`. Speculation is skipped when physical slots are full, any task is queued, another pure prefetch is running, or temporary credits cannot be reserved immediately while leaving space for a maximum demand window and one output block. It never queues speculative work or reserves a new OUTPUT buffer. Foreground and materialization retain their existing fairness rule; both outrank queued PREFETCH operations. This is bounded use of idle resources, not a guarantee that an already running fetch consumes no bandwidth or storage resources.

Demand and prefetch use exactly the same physical key, including object generation, window and validation policies. Demand joins an existing task before probing persistent storage and promotes it without aborting or restarting its HTTP operation. Promotion frees the speculative concurrency allowance but keeps the physical slot occupied. Every consumer retains independent cancellation; closing the initiating Reader removes only its speculative waiter when another reader still needs the task. The existing physical deadline is not extended by promotion, and aborted work holds credits and its slot until actual cleanup completes.

Prefetch reuses prepare, WindowLoader, missing ranges, normal LRU insertion and persistent saveBlock. Repeated tail reads do not add waiters to an existing task, and fully memory-cached windows are skipped. Ordinary speculative failures do not reject the triggering read; an adopted demand still receives its physical operation's result or failure. Object and Session failures retain the existing revocation/reporting path. Session close cancels all speculation. Consumer hit accounting counts copied bytes only; HTTP telemetry continues to include all actual network bytes, including prefetch.

## Materialization and storage

Eager consumers explicitly select BYTES, BLOB or a streaming sink with an upper bound. Adapters announce the known game and runtime-asset totals before preparation starts and forward the materializer’s verified ready-byte progress; they must not wait until all downloads resolve to report their first progress. Concurrent assets in one phase retain their individual ready counts and sum against the fixed phase total. Completion is emitted only after content validation and backing commit, including memory fallback. Complete files are hashed incrementally. Full-body responses have an idle deadline, not a whole-file five-second deadline. Recovery can reuse verified blocks; only WHOLE_ALLOWED sources may restart as a whole GET. A sink restart aborts the old sink, creates a new sink and resets progress with an incremented attempt.

`retrom-content-io-v1` is a new persistent namespace; old private caches are not treated as verified entries. Backends are OPFS, then Cache Storage blocks, then memory/network. Optional cache failures must not prevent reading. A fresh Session discovers committed alternate generations as read-only sources, including blocks stored after an earlier Session fell back from OPFS to Cache Storage. Reads validate their receipts and content before demand-driven reuse; fallback never changes another Session’s shared current generation. Network and LRU identity retain the Session object generation; an optional physical cache generation change cannot revoke concurrent reads. New physical generations persist an existing ETag pin before accepting blocks. Objects first encountered after fallback still receive an object record so their generations remain discoverable and eligible for ordinary GC. IndexedDB metadata, receipts, per-generation leases and Web Locks protect publication and garbage collection. OPFS-backed Blob/File results hold a separate lease until their explicit release, independent of Reader close.

Workspace consumers require OPFS and publish immutable generations only after validation. With Web Locks, a bounded current-generation pointer is published under a short exclusive lock after all files and the completion receipt commit; downloads hold no publication lock. Reuse acquires the generation use lease before reading its receipt or hashing files. Without Web Locks, each preparation uses a unique generation and neither reads nor writes the shared pointer. Completed generations are retained even if the initiating instance is cancelled immediately after publication. Native writes use a Session overlay. Completed workspace generations are not automatically collected in v1; raw cache blocks and workspace copies can both occupy storage. Ordinary raw-block GC does not remove a leased generation.

## Consumer boundaries

Private Provider policies choose RANGE, EAGER or ON_OPEN independently for each input role. They are not added to the public Host manifest. PSP, Play, NeoCD, ScummVM, KiriKiri and mkxp preserve their native read semantics through thin facades. ONS files materialize when opened; its video URL remains a browser media boundary. Butterscotch prepares a workspace. Small eager adapters preserve their own size and format limits.

Browser-native MV/MZ and TyranoScript, EasyRPG/J2ME loaders, and unmodified EmulatorJS upstream loaders keep explicit external boundaries. Metadata JSON, checkpoint transfer, session save overlays, native media and verified core module execution are separate from managed game downloads. Changes to these boundaries require focused tests rather than silently broadening a download exemption.

## Validation

Run the repository lint, typecheck, unit, build and package gates. `tests/content-io` adds real Worker, OPFS, HTTP, native bridge and two-Session reuse tests. `scripts/content-io/preflight.mjs` freezes a named PFB context; inventory records actual working files, including untracked additions. Candidate preparation checks source identity, ABI, file allowlists and hashes before copying any core inputs. Actual import, review preview, Product Launch, input, checkpoint and restoration belong to the Host acceptance suite. A passing protocol fixture or core build alone is not product acceptance.

Optional cache writes own their credits until the actual backing operation settles, even when the caller times out and degrades the backend. Network windows cannot borrow the cache-write lane, so abandoned I/O remains accounted for without deadlocking active window readers.


### 阶段报告的校验

阶段入口同时核对原始机器报告、子命令记录、输出摘要和当前源码摘要。用例匹配使用完整的
`[caseId] LEVEL/subcase` 标签，不接受子用例名称的前缀匹配；命令失败、超时、报告缺失或汇总断言
与原始报告不一致均拒绝签收。命令超时先终止该命令自己的进程组，再在短宽限期后强制结束，
避免忽略 SIGTERM 的子进程让门禁无限等待。失败报告与旧运行记录保留。

`tests/content-io/stages.json` 保存每个阶段的具体用例与层级。真实 OPFS、Cache Storage、
IndexedDB、Web Locks 与 Worker 崩溃测试归为 BROWSER；来源身份、receipt 校验、不可变完成代
和原生启动前失败策略保留独立 UNIT 检查。真实浏览器结果不能作为 UNIT 或 CORE 报告使用。
对象撤销通过多个管理／消费端口传播时，仍要关闭所有 Reader，但只向 Session 所有者报告一次。

物化回归包括真实浏览器中的首尾块补洞、强 ETag 前缀取消后续传、弱/无 ETag 未完成全文重新获取、
独立 BYTES 输出、最后一块 ACK 前取消，以及 Cache API/IDB 写失败后的有效响应交付。
512 MiB 的 NP2kai/OpenBOR 公共物化上限分别在真实 OPFS 和 Cache API 后端执行全文 SHA 校验及新
Session 的零网络复用；该用例不代表已完整物化 2 GiB 光盘或任意大小的 indexedFile。

同步消费槽以原始错误码永久关闭；对象校验失败不能改写为另一种身份错误。复制前或复制后发布前
发生关闭时，CAS 不得把 CLOSED 改回 OK，新通道使用独立 SAB。Worker 在 READY 前取消时，Session
或 bootstrap 中唯一的资源所有者负责终止 Worker，Blob URL 释放一次。取得 gate/缓冲额度失败也必须
释放已经创建的 deadline 与 abort 监听，不得依赖其稍后自行超时。

阶段 `result.json` 采用严格的 v1 结果结构：`schemaVersion/runId/stageId/status/startedAt/endedAt`、
`inputs`、`commands`、`assertions`、`metricsPath`、`outputs` 和 `blockingReasons`。
`inputs` 包含实际 repository HEAD、源码摘要（`stageInputs` 为阶段声明路径摘要）、环境文件原始字节摘要、
契约摘要，以及适用的 Provider/core 身份引用。身份引用包含 `id/sha256/evidencePath/reportLocation`；
`reportLocation` 是原始证据中实测摘要字段的 JSON pointer。未涉及产物运行的早期阶段保留空身份集合。

每条命令保存 cwd、可执行文件、参数、exitCode、signal、stdoutPath、stderrPath、reportPath 与
reportSha256；原始 command artifact 另外保留开始/结束时间、超时结果与测试环境路径。每条断言记录
caseId、subcase、level、status、expected、observed、reportPath 和原始报告 JSON pointer。
expected/observed 为简短去敏原始值；截图与日志作为 `path/sizeBytes/sha256/kind` 输出引用保存。

执行器只在原始机器报告全部成功、精确必需子用例齐全、命令与固定入口一致、全部输出摘要匹配、
执行前后 HEAD、各仓库工作树及阶段输入一致时写 PASS。工作树证明递归覆盖 gitlink 当前提交与脏文件、未跟踪源文件、符号链接文本和实际执行位；忽略的构建/证据输出不进入源码摘要。验证器从当前文件重新计算，不能用未变化的 HEAD 或旧 preflight 摘要代替。失败、超时、schema 错误、未知字段、摘要篡改、路径越界、
符号链接和错误报告位置均拒绝；重试使用新的 runId。旧版结果不会自动升级或改写成新格式 PASS，
而是保留历史文件并重新运行。`IN_PROGRESS` 仅用于调度状态，不作为可签收的结果状态。

公共 HTTP 传输统计在实际调用 fetch 前记录 Range/whole 请求及其重试，包含同步网络异常和
失败状态码；取消发生在重试等待期间不增加请求。`networkBytes` 在正文读取器取得每个 chunk
时累计，包含之后被长度校验拒绝的字节，不能用成功结果大小代替。未读取的失败响应正文不计入
该字段，服务端已发送字节由独立观察器记录。完整物化、窗口读取和单块路径共用同一个 Session
计数器；缓存重放没有新增请求。当前公共内容传输不发送 HEAD。

异步消费通道只保留仍有效的文件能力。关闭一个文件会撤销该能力；关闭最后一个文件时服务端
关闭通道并释放输出额度，客户端处理 CHANNEL_CLOSED 以释放对应 RPC。共享通道中的其他
文件仍能读取，重复撤销不会重复释放。桥接压力测试使用固定种子的 10,000 次顺序消费与跨缓存
工作集访问，记录每批实际 L1/L2 占用、临时额度和网络量，并在句柄关闭后检查活动资源归零。

资源峰值在 LRU 接受缓冲、缓冲额度授予以及调度器状态变化时记录，关闭或驱逐不清零历史峰值。
周期性快照只描述采样时刻；6 条 Reader 桥的固定 10,000 次读取另外断言真实 L1/L2 各自峰值之和
（总占用峰值的保守上界）、临时/输出额度峰值和物理并发峰值。返回调用者的 BYTES/Blob、原生 HEAP
与这组公共缓存指标分开计量，不能据此推断整个浏览器进程内存。

Store 的 `leases` 统计每一次实际取得且尚未释放的 use lease，包含降级前的旧 backing；只按当前
binding 数量统计会漏掉仍受保护的旧代。释放使用幂等包装，关闭 Session 也清理尚在建立 binding 的
已取得租约。缓存降级次数按实际失败后端累计，损坏块只在确认丢失/长度或本地摘要损坏时累计，
临时 I/O 错误不计为损坏。完整物化按 BYTES/BLOB/SINK 分别累计成功交付字节，整包重启在确认
新 attempt 后计数；未收到重启 ACK 不提前增加次数。

证据汇总的 `--candidate` 检查 S00–S21；`--all` 仍检查 S00–S22，单个阶段可用 `--stage Sxx`。
候选签收和授权后的正式发布复验不混为一个状态；省略选择或同时给出多个选择会失败。
Preflight 可显式记录当前 PFB 内的 `--candidate-root` 和 `--candidate-base-root`，不再依赖默认
输出目录来推测已导入的候选。指定目录的父路径必须已存在，符号链接与跨 PFB 路径均拒绝。

诊断消息只使用固定操作 `CACHE_PROBE/CACHE_READ/CACHE_WRITE/CACHE_GC/CACHE_DEGRADE/READ/MATERIALIZE/CLOSE/ABI`。
`DIAGNOSTIC.codeNumber=0` 表示普通观测；1–17 仍为既定错误码，其余错误消息不能用 0。
统计字段为封闭集合；字节/数量要求非负安全整数，`firstFrameMs/inputReadyMs/exitMs` 接受非负有限小数。
`peak*` 是在资源状态变化处记录的历史峰值，当前值与峰值分开传递；未取得的指标省略，不能伪造为零。
BYTES/BLOB/SINK 成功交付量分别使用 `materializedBytesByBytes/materializedBytesByBlob/materializedBytesBySink`。

逻辑命中字节按已复制给消费者的切片长度计数；异步 `READ_OK.origin` 标记完整块来自
NETWORK/MEMORY/PERSISTENT，公共 Client 按每个实际消费者的切片累加，合并请求的等待者分别计数。
窗口中的每个块保持各自来源；L1 的 `tryReadInto` 只有完整命中后才计数，取消前尚未复制的字节不计。
物化按真正写入结果 sink 的字节计命中，不把后台持久写或预取窗口长度算成消费者命中。

同步 SAB 仍为 64+262144 字节。控制字 8 为返回块来源（0/1/2 对应 NETWORK/MEMORY/PERSISTENT）；
9 为单写者计数序列（更新中奇数，完成后偶数），10/11 与 12/13 分别为 memory/persistent 逻辑命中
的低无符号 32 位和高 21 位；14/15 为当前/峰值 L1 字节。消费者在复制时写入，服务用有界重读
取得一致快照，既不等待核心事件循环，也不在服务线程阻塞。读到未完成的更新时保留之前的观测，
不能拼接两个不同更新的高低字。具体字位与来源枚举由契约 vectors.json 固定并纳入契约摘要。

Client 启动时显式开启诊断；服务每 250ms 提供一次资源所有者的累计统计，并在正常关闭时等待
实际异步任务、临时额度和可选缓存写释放后，先发送最终 CLOSE 统计，再确认 SESSION_CLOSED。
超时如实报告失败与当时未释放数量。同步消费者尚未清理 L1 时保留其共享计数视图，不能直接置零。
use lease 统计还包含 OPFS Blob 交付期间的独立读租约，关闭文件不会提前释放仍被 Blob 使用的租约。

Provider 通过 Host 既有 `reportDiagnostic` 发送 `CONTENT_IO_METRICS`：message 是仅含本次无秘密
sessionId、固定 operation/codeNumber 和允许的数字 counts 的 JSON，不包含资源名称或 URL。
Host 验收优先采集该聚合观测，原始 Worker 事件只用于传输生命周期和没有 Host 观测时的回退；
不得用原始 L2 快照覆盖已经包含 Client L1 的统计。Host 的 `observedMax` 只是采样最大值，
资源峰值必须读取独立的 `peak*` 字段。真实首帧、输入就绪和整体进程内存由产品验收单独观察。

S12–S15 execute each fork's own Node/Python protocol tests as UNIT and validate the current PFB core descriptor, full artifact inventory and compiled Content I/O digest as CONTRACT. Browser tests load the fork's actual bridge source as BROWSER; mkxp additionally compiles and runs its C++ WasmFS pthread fixture as CORE. Neither adapter mocks nor bridge fixtures count as native-game verification. S20 independently requires real Retrom launches, input and checkpoint/restore for PPSSPP, Play!, all three mkxp targets and KiriKiri.

S16 enumerates every eager adapter separately and reruns original adapter suites plus materialization failure, resume, limit and real 512 MiB tests. S17 runs original ONS/Butterscotch/NXEngine suites and browser checks for lazy file sets, independent-session reuse, progress, missing workspace storage, receipt corruption, unfinished generations, concurrent pointer publication, absent Web Locks and save isolation.

S19 invokes the Host protocol/observer/Web suites in its existing PFB toolchain and separately runs Chrome diagnostic retention across iframe removal. S20 invokes the Host's full 21-target product runner; a successful legacy product report alone cannot satisfy its required scenario and performance evidence. S21 revalidates all 21 preceding stage results and every owning case/level/subcase, then runs complete Runtime quality gates and Host backend/integration/Web build gates. It does not authorize release.

Each stage retains its nested Host commands, reports and captures in the run directory. Playwright commands use distinct per-command output directories. These additional artifacts are hashed by streaming, including large binary evidence, and form a closed inventory: changed, missing, unlisted or symbolic-link evidence is rejected. Original machine reports and assertions retain their independent checks; an auxiliary artifact cannot substitute for a runner report.

KiriKiri executes only verified Content I/O assets. JavaScript and Wasm are exposed as session-owned Blob URLs; the Wasm URL uses `application/wasm` and is supplied through `Module.locateFile`. This keeps SDK loaders that omit the optional `wasmBinary` input on the same verified bytes, without a second HTTP download. Exit-trap provenance is bound to that exact Wasm URL, and closing the adapter revokes every asset URL.
