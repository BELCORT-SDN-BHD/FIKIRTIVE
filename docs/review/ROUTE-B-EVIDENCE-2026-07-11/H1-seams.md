# H1 · 架构缝对照(章程 H 车道 repo 侧)

> 基线核对:`git rev-parse --short=8 HEAD` = `b5a48d0f`(与工单一致,继续)。
> 范围:九条扩建缝定义位置/范本实现/2026-07-02 之后新合进 main 的功能是否走缝/CI 机器围栏状态;
> 随工具数增长的接口清单;第十缝(本地化包)落地痕迹。只读取证,不判分不排序。

## 列定义(同 matrix-schema)
`id | zone | capability | promise_source | stage_main | gate | evidence | provenance | gaps`
本分片聚焦"缝"本身而非单个用户能力,故用简化行:`缝# | 缝名 | 定义位置 | 范本实现 | 新功能是否走缝(证据) | CI围栏 | provenance`。

## 九条缝逐条

| 缝# | 缝名 | 定义位置(main@b5a48d0f) | 范本实现 | 07-02 后新合功能是否走缝 | CI 围栏 |
|---|---|---|---|---|---|
| 1 | defineOttoSkill | `packages/otto/src/skill.ts`(factory,DEFINITION-time 抛错保证);`packages/otto/src/registry.ts`(`allSkills` 数组,一行一 skill) | `packages/otto/src/skills/generate.ts` 等 16 个原始 skill(2026-07-02 地图记录) | **走缝**。registry.ts 现有 **25** 个 skill(比 07-02 地图记录的 16 多 9 个:saveProduct/saveCustomerSegment/saveOffer/lookupProducts/ingestProduct/metaAdPerformance/metaExpert/proposeResearch/schedulePosts)。每个都经 `defineOttoSkill` 工厂 + registry 一行注册,未见绕过证据(evidence: `packages/otto/src/registry.ts:1-56`)。schedulePosts 尤其是 L1/排期链走此缝的证据:`packages/otto/src/skills/schedule-posts.ts:1-70` 注释明示"single write authority (#123): each post goes through the injected `ctx.schedule.draft` port — the SAME server function...this skill no longer touches Prisma"。 | `scripts/check-skill-imports.sh`(CI hard fail,`.github/workflows/ci.yml:42`)拦 skills 目录内直连 `@fikirtive/generation`/`reserveCredits`/`meta-graph`/`metaGraphPost`;`catalog:check`(`ci.yml:46`,hard fail — 与 2026-07-02 地图记载的"不 CI 拦"**已变化**,见下方断层观察)。 |
| 2 | GenerationProvider | `packages/generation/src/index.ts:createGenerationProvider()`(mock/fal/byteplus 三选一,fail-safe 默认 mock) | `apps/worker/src/generation.ts:5`(worker 单例) | **未见新供应商接入**;L1 发布链/排期区/L0 量测层均不碰生成模型,本缝在此窗口无新增触点(evidence: `git log --oneline --since=2026-07-02 -- packages/generation` 无改动条目)。 | 无专属 CI 围栏,靠 `check-skill-imports.sh` 侧面拦 skills 目录直连 `@fikirtive/generation`。 |
| 3 | Credit ledger | `packages/db/src/credits.ts`(reserve/settle/refund,SOLE writer) | `apps/web/lib/gen-actions.ts:134`(startGen) | **L1/排期/L0 三个新链均刻意不碰此缝** —— L1 commit 原文反复声明"Not a spend path (organic is free)"(evidence: commit `f336d50e`, `09cd9060` 提交信息);`schedulePosts` skill 注释"Spends NO money, creates NO GenJob"(`packages/otto/src/skills/schedule-posts.ts:4`)。L0 量测原语(TrackedLink 等)同样 $0(见下)。 | partial-unique 索引(`CreditLedger_finalizer_once` 等)未新增/未改动,迁移目录里无新钱路迁移落在这窗口。 |
| 4 | Channel foundation | `apps/web/lib/channels/{types.ts,registry.ts}`(`Channel` 接口 + `channelRegistry`,自注册模式) | `apps/web/lib/channels/{instagram.ts,facebook.ts}`(该缝在 07-02 地图**未收录**,经 `git log --follow` 查得源头是 PR #74`feat: channel-provider foundation + config-driven Account/Settings page`,早于本窗口) | **走缝**。L1 发布链新增 `apps/web/lib/channels/meta-publish-adapter.ts`(123 行),接的是既有 `Channel.publish()` 接口位;`meta-publish-adapter.ts:1-15` 注释明示"the actual Graph choreography is the ONE shared implementation in @fikirtive/core/server ... which the publish worker also drives — so human path and worker path never diverge"(单一动作层,未绕缝私拉)。`MetaConnection` 模型登记在 `TENANT_GUARD_EXEMPT`("channel layer (seam 4)",`packages/db/src/tenant-guard.ts:32`)。 | 无专属 CI 机器围栏(纯接口约定,靠 review)。 |
| 5 | Tenant model | `packages/db/src/tenant-guard.ts:TENANT_MODELS`(集合)+ `requireOwner()`(`apps/web/lib/auth-guard.ts`) | 全部业务表 | **走缝**。L0 量测原语六表(`TrackedLink,QrAsset,QrPlacement,VoucherToken,SourceTag,AttributionEvent`)与排期 `ScheduledPost` 均登记进 `TENANT_MODELS`(非 EXEMPT),各自带注释注明"出生即登记"(evidence: `packages/db/src/tenant-guard.ts:9-22`)。`ScheduledPostMedia`/`PublishAttempt` **未在 TENANT_MODELS 也未在 EXEMPT**——核实原因:两表本身不带 `ownerId` 列(靠 `scheduledPostId` FK 传递到 `ScheduledPost`),故落在"覆盖契约"("每个带 ownerId 的表必须二选一")定义域之外,非漏项(evidence: `packages/db/prisma/schema.prisma:1159-1195` 两表均无 `ownerId` 字段)。 | `tenant-guard-coverage.test.ts`(测试,未逐行读,按 07-02 地图记载存在);runtime 层 `withTenantGuard` prod=WARN、test=THROW(non-hard-CI-fail in prod by design)。 |
| 6 | Queue/worker | `packages/core/src/{gen.ts,refgen.ts,timeline.ts}` 定义策略常量;web `apps/web/lib/queue.ts` + worker `apps/worker/src/index.ts` 各自 `createQueue` | gen/refgen/render/caption 四队列(07-02 地图) | **走缝**。L1 新增 `PUBLISH_QUEUE`/`PUBLISH_DLQ`/`PUBLISH_QUEUE_POLICY`(`packages/core/src/index.ts` re-export,commit `09cd9060` 描述"ONE policy object, created identically by web...and worker")。`apps/worker/src/jobs/publish.ts`(583 行)+ `apps/worker/src/publish-env-check.ts` 落地一个新 handler,遵循既有"回收器时间链"约定(commit 描述 H7:`PUBLISH_EXECUTION_DEADLINE_MS(240s) < 队列 expire(300s) < reaper 阈值(600s)`三级排序)。 | 无独立 CI 机器围栏(靠 review + 单测,`apps/worker/src/jobs/publish.test.ts` 305 行)。 |
| 7 | .gb + shadcn | 单一设计系统约定(`docs/design-system`,`docs/design/handoff/design-system-readme.md`);`otto/page.tsx:skin="gb"` 硬编码(07-02 地图) | OttoApp/OttoView 全树 | **走缝,无 coral 越界证据**。排期区 UI 唯一新文件 `apps/web/components/otto/OttoSchedule.tsx`,`grep -rl coral` 该目录 **零命中**(evidence: 命令 `grep -rln coral apps/web/components/schedule` 返回空;实际组件在 `components/otto/` 下,同样零命中)。`OttoView.tsx:16,201-202` 确认 `view==="schedule"` 现在 dispatch 到真实 `<OttoSchedule/>`(07-02 地图记载彼时仍是 `ComingSoon` 占位——**本窗口内由占位转真实**,见下方断层观察)。L0 量测层(TrackedLink 等)**未见任何专属 UI 组件**(`find apps/web/components -iname "*tracked-link*" -o -iname "*qr*"` 零命中)——原语已建但界面未接。 | 无机器围栏(纯约定 + design review)。 |
| 8 | ChatMessage 卡片五道缝 | ①`apps/web/lib/types.ts:69` kind 联合 ②`otto-ui-messages.ts:threadToUiMessages` 占位 ③`OttoChatStream.tsx`/`OttoConversation.tsx` 双渲染器 ④`otto-inject-helpers.ts:injectCardMessage`/`appendDurableResults` 注入过滤 ⑤`otto-stream-bridge.ts` `bridgeEvent`/`TOOL_STEP_LABELS` 流桥名单 | STORYBOARD_CARD(#99,07-02 地图详载全五处联动) | **部分走缝,排期链刻意不进卡系统**。kind 联合从 07-02 的 9 个长到当前 **12 个**(新增 `RESEARCH_CARD/RESEARCH_REPORT/PERFORMANCE_CARD`,evidence: `apps/web/lib/types.ts:69`);这三个走了五道缝。`schedulePostsSkill` **不产生新 kind**——其 `executeSchedulePosts` 直接返回 JSON(`{ok,draftedIds,failures}`),走的是 agent 普通 tool-output 而非卡片(evidence: `packages/otto/src/skills/schedule-posts.ts:42-70`),故未触碰 kind 联合/占位/渲染器/注入过滤四处;但**第⑤处(流桥 TOOL_STEP_LABELS)未登记**——见下方"N 处"表格,是遗漏还是有意未列不可判定(Unknown)。 | 无机器围栏(07-02 地图记载:F23 卡片错配靠人工发现,无 CI 检测卡片五处联动一致性)。 |
| 9 | Parity Manifest | `packages/otto/src/parity-manifest.ts:PARITY_MANIFEST`(单一字面量对象:`skill`/`exempt`/`todoSkill` 三选一) | Schedule/P1-01/P-block 等首批注册(文件头注释自述) | **走缝**。当前 `PARITY_MANIFEST` 180 个 key,84 个 `todoSkill:true`(去掉 line 22 的类型声明本身含"todoSkill: true"字面量,做过手工核对避免 grep 误计——见下方断层观察方法论)。L1 新增 `api:media/pub/[token].GET` 登记为 `exempt:"ADMIN"`(commit `09cd9060` diff 精确定位:`packages/otto/src/parity-manifest.ts` 该 PR 仅 +1 行,且是 exempt 非 todoSkill,ratchet 未被推高)。排期新增的 `schedule-actions.{approveScheduledPost,cancelScheduledPost,updateScheduledPost,listScheduledPosts,listOwnerTargets}` 全部登记为 `todoSkill:true`(evidence: `packages/otto/src/parity-manifest.ts:232-236`),即"发布/管理排期"目前只有 draft 一条路径有对应 skill(`schedulePosts`),approve/cancel/edit/list 均是已知欠账,非隐瞒。 | `scripts/check-parity.mjs`(经 `check-parity.sh` 调,`ci.yml:49 pnpm lint:parity`)**hard fail**:①字段合法性检查 process.exit(1) ②debt ratchet `todoCount > maxTodoSkill` 则 fail。`scripts/parity-debt-baseline.json` 现值 `{maxTodoSkill:84}`,与当前 84 精确吻合(**未超标**,核实见下)。 |

## 随工具数增长的接口("加一个能力要动 N 处")

| 接口 | 位置 | 每加一个能力要动几处(N) | 当前规模 | 证据 |
|---|---|---|---|---|
| Skill 注册表 | `packages/otto/src/registry.ts` | 至少 2 处(import 一行 + `allSkills` 数组一行),官方 5 步配方还含:③ `context.ts` 声明端口+`buildOttoContext` 注入 ④ `catalog.ts` 重新生成 ⑤ `migration.test.ts` 门测试(`skills/AGENTS.md` 5 步,07-02 地图 §274 记载,本次未见改动) | 25 个 skill(07-02 时 16 个,+9) | `packages/otto/src/registry.ts:1-56` |
| ChatMessage kind 联合 | `apps/web/lib/types.ts:69` | 五道缝全套(kind 声明 + 占位 + 双渲染器 + 注入过滤 + 流桥名单),07-02 地图记载 STORYBOARD_CARD 落地时确实五处联动 | 12 个 kind(07-02 时 9 个,+3:RESEARCH_CARD/RESEARCH_REPORT/PERFORMANCE_CARD) | `apps/web/lib/types.ts:69` |
| TOOL_STEP_LABELS | `apps/web/lib/otto-stream-bridge.ts:170-190` | 1 处(纯 map,未登记 = 静默不显示步骤,非 fail) | 18 个 label,对应 25 个 skill 中的 18 个;**6 个新 skill 未登记且无"故意静默"注释**(saveProduct/saveCustomerSegment/saveOffer/lookupProducts/ingestProduct/schedulePosts —— 对照 `setTitle` 有明确注释"stays silent (internal housekeeping)",这 6 个没有对应注释,是否有意不可判定) | `apps/web/lib/otto-stream-bridge.ts:170-190` vs `packages/otto/src/registry.ts:29-53` |
| Parity manifest 债务清单 | `packages/otto/src/parity-manifest.ts:PARITY_MANIFEST` | 1 处(新 action/route 出生即需一行 `skill`/`exempt`/`todoSkill`),但 ratchet 只允许 todoSkill 总数不增(`scripts/parity-debt-baseline.json`) | 180 个 key(skill 66 / exempt ~29 / todoSkill 84,数字见上表方法论说明) | `packages/otto/src/parity-manifest.ts` |
| Channel registry | `apps/web/lib/channels/registry.ts` | 2 处(新建 adapter 文件实现 `Channel` 接口 + `registerChannel()` 一行) | 2 个 channel(instagram/facebook),`ChannelId` 类型本身声明"OPEN, never a closed enum"(`types.ts:3`),故设计上是 O(1) 增量,非 N² | `apps/web/lib/channels/registry.ts:1-12` |

**观察**:skill 注册表与 TOOL_STEP_LABELS 之间没有机器强制的一致性检查——一个新 skill 可以合入 CI 全绿而不触碰步骤名单(fail-open,静默无提示,不是 fail-closed)。Parity manifest 是唯一带 ratchet 硬闸的清单;kind 联合/五道缝无机器闸,靠人工(07-02 地图记载的 F23 就是这类人工才发现的错配案例)。

## 第十缝「本地化包缝」—— 落地痕迹核查

- **判决层**:`docs/ops/SESSION-HANDOFF-2026-07-10.md:9` 与 `docs/FIKIRTIVE-MASTER-2026-07-10.md:17-18,101` 记载 2026-07-10 拟议"第十缝(本地化包)":全球为底、本地(渠道/合规/语言/币种/节庆/基准数据)为可插拔皮层,状态标"📋修宪"(拟议中,非已定稿)。
- **宪法层**:`docs/BLUEPRINT.md` 第四章(线 124-138)当前仍写"九条扩建缝",修订表(线 200-224)最新一行是 `v2.11`(2026-07-10,「待 founder 终审」),**未见任何提及"第十缝"或"本地化"的修订行**——即第十缝尚未完成宪法第七章的正式修订流程(不是「已定稿」,只是判决簿里提了一嘴)。
- **代码层**:`find . -iname "*locale*"` 全仓零命中(排除 node_modules/.git);无 `packages/locale`、`packages/i18n`、无本地化包相关目录/文件。
- **结论(事实,非判断)**:第十缝目前 100% 停留在文档判决层,宪法未修订,代码零痕迹。

## 断层观察(原始观察,不排序不评分)

1. `catalog:check` 在 2026-07-02 地图中记载为"CI 未拦"(只跑 check-skill-imports.sh),但当前 `.github/workflows/ci.yml:46` 已把它加入 CI 且为 hard fail——地图与当前 main 有出入,提醒后续判定不要直接复用 07-02 地图对"哪些是 warn"的结论,需逐条重查(本分片已对本文列出的脚本逐一重查)。
2. Parity ratchet 计数有一个容易踩的陷阱:`packages/otto/src/parity-manifest.ts:22` 类型声明本身含字面量 `{ todoSkill: true; reason: string }`,对源文件做 `grep -c "todoSkill: true"` 会比脚本实际统计的 `todoCount` 多算 1(85 vs 84)——本次核对已用 `git diff` 精确定位 PR #227 对该文件的唯一改动(+1 行 exempt,非 todoSkill)排除了假警报;但这说明这个字面量对象的"读代码估算真实计数"本身有陷阱,值得在总审查时留意,别被 grep 误导出"parity 债务超标"的假结论。
3. Schedule 区(`view==="schedule"`)在 07-02 地图里被记载为 `ComingSoon` 占位(DORMANT),当前已由 PR #123（`5723ed23`）+ 后续修复接上真实 `<OttoSchedule/>` 组件——这是一个"UI shell → integrated"的阶梯跃迁窗口,发生在本次地图基线之后,H1 分片只确认"走了正确的缝"这一事实,阶段判定(stage_main)留给整合矩阵的分片做。
4. L1 发布链(#219+#227)三处明文自证"Not a spend path / Zero production behavior change"——即 `canPublish` 在 prod 恒为 false(等 Meta App Review 通过),这是**代码里刻意做的 kill-switch**,不是"没做完"的假象;`MEDIA_PROXY_SECRET` 未设时 `/api/media/pub/[token]` 恒 404(commit 原文自述),这两点使得 L1 目前对 production 用户是彻底不可达(fail-closed by construction),但对 main 代码本身"走缝"这件事是完整的。
5. `ScheduledPostMedia`/`PublishAttempt` 两张新表没有 `ownerId` 列,靠父表 `ScheduledPost.ownerId` 传递隔离——这类"子表无独立 ownerId、靠 FK 传递"的模式此前在 `ShotEntityRef`(07-02 地图)也出现过,是既有惯例的延续,不是本窗口新发明的例外。
6. 6 个新 skill(saveProduct/saveCustomerSegment/saveOffer/lookupProducts/ingestProduct/schedulePosts)在 `TOOL_STEP_LABELS` 里没有条目、也没有像 `setTitle` 那样的"故意静默"注释——流式 UI 上这些工具被调用时用户看不到任何步骤提示,是遗漏还是设计选择,本分片判不了(标 Unknown)。

## Unknowns

- `TOOL_STEP_LABELS` 6 处缺失究竟是遗漏还是有意静默——需要问设计方或翻 PR 描述确认(本分片时间预算内未追溯每个新 skill 对应 PR 的 commit message)。
- `tenant-guard-coverage.test.ts` 的具体断言内容未逐行读(只读了 07-02 地图对它的转述),`ScheduledPostMedia`/`PublishAttempt` 不需要进 TENANT_MODELS 这一结论基于 schema 字段核查,未跑测试验证覆盖契约测试是否真的豁免了这两张无 ownerId 的表(禁止跑测试,故留 Unknown)。
- `docs/design/2026-07-03-harmony-02-parity-manifest.md` 里提到"CI 拦截为 warn→hard 两阶段,在建"——当前 `lint:parity` 已是 hard fail,但两阶段切换的具体切换 PR/日期未查(不影响本次结论,仅留痕)。
- Channel foundation(缝 4)在 2026-07-02 地图完全未收录(该地图六个 mapper 未覆盖 `apps/web/lib/channels/`),本次靠 `git log --follow` 补溯到 PR #74,但该缝的完整历史规格(是否有独立 spec 文档、TikTok/Lazada/Shopee 的 adapter 骨架是否已存在)未查——仅确认 instagram/facebook 两个 adapter 存在。
- L0 量测层(TrackedLink 等)除 schema + TENANT_MODELS 登记外,是否已有 server action / route 落地(redirect 端点、二维码生成端点)未逐一核查——只读到了 tenant-guard.ts 的注释("重定向/扫码端点是公共匿名的"),未定位具体 route 文件核实其是否已合并。

## Dropped(预算内放弃项)

- 未逐条核对九缝之外、07-02 地图已详载的"Admin/Auth""Storage/DB"两大节在本窗口(07-02 之后)是否有新变更走缝——时间预算优先给了 H1 任务点名的 L1 发布链/排期/L0 量测三个新链路。
- CI 机器围栏表未覆盖 `.github/workflows/ci.yml` 里可能存在的其他 job(如是否有单独的 lint/format job)——只核对了任务点名相关的 fence 脚本(check-skill-imports/check-no-raw-prisma/check-parity/check-blueprint-integrity/check-destructive-migrations/catalog:check)。
- L0 量测层(第 5 个新链路点名对象)只核查了 tenant-guard 登记与 schema 存在性,未深入其 server actions/routes 的走缝细节(时间预算耗尽前的取舍,已在 observations/unknowns 标注)。
