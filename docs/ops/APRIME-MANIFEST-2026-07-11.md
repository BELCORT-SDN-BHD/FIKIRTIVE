# A′ 落地舱单 v1

冻结基准: #203 @ `54c1de0b2dab0b1be6398ea1d36e1fb18142f17a` | 策略: 从 main 切旅程 PR 重建落地,合并与部署分离,65 页齐才发版 | 编制日期: 2026-07-11

---

## 1. 总量表

| 桶 | 数量 | 说明 |
|---|---|---|
| allow(机械分桶,默认可搬) | 151 | 全部为 `northstar-immersive` 路由树 + `components/northstar/immersive/*` |
| safe-ui(逐文件评估通过) | 96 | 其中 8 份文档与 main 逐字节相同,无需搬动 → 有效待搬 88 |
| foundation-needed(须单独地基 PR) | 7 | 见第 2 节 |
| exclude(不带入) | 18 | 见第 3 节 |
| unknown(待人工核) | 0 | — |
| **评估总量** | **272** | — |

对账线: **247 可搬(151 allow + 96 safe-ui)= 239 入旅程切片 + 8 份与 main 逐字节相同的文档(无动作)**。

数据覆盖边界(事实说明): 输入一的 151 个 allow 文件按机械分桶默认可搬,**未经逐文件风险评估**;第 6 节的风险筛查仅覆盖输入二的 121 个文件。

---

## 2. foundation-needed 全列表(7 件,必须单独走 reviewed foundation PR,不得夹带进任何 UI 切片)

### 布局 / 门禁
- `apps/web/app/northstar/layout.tsx` — northstar 路由组根 layout,承载生产门禁(NODE_ENV=production 且 NORTHSTAR_PREVIEW!==1 时 404),所有旅程切片的共同承重墙。

### 导航 / 注册表
- `apps/web/app/northstar/page.tsx` — 全城地图总目录页,横切全部 14 区的索引脚手架。
- `apps/web/components/northstar/_registry.ts` — 全城 65 页注册表,驱动左轨导航的单一数据源;未来每个旅程 PR 都要在此加行,须提前定归属与冲突处理。
- `apps/web/components/northstar/_shell.tsx` — 全局外壳(顶栏 + 左轨 + 常驻 Otto dock),功能上等同路由组全局布局。

### 共享组件
- `apps/web/components/northstar/_shared.tsx` — PageHeader / EmptyState / StatCard / MockNote / NsStub / OttoDock / OttoNarrationBar 等全城复用组件库。

### 依赖 / 数据内核
- `apps/web/components/northstar/_mock.ts` — 977 行、跨十余分区的全城共享 mock 数据源,应作为 sandbox 内核一次性落地。

### 其他(中间件 — 全舱单唯一生产回归地雷)
- `apps/web/proxy.ts` — 全站 Better Auth 中间件(matcher 白名单)。**绝不整文件覆盖**:原型 diff 把「新增 northstar 豁免」与「移除 api/media/pub 现有豁免」捆绑,整体合入会静默撤销 Meta 异步媒体回调端点的 HMAC-only 豁免,导致该端点被套登录墙、Meta 服务器请求 404/redirect。只允许把「新增 northstar 前缀」这一行手工叠加到 main 当前版本上。

---

## 3. exclude 全列表(18 件)

### ⚠ 过时治理文件(与「逐旅程从 main 切 PR、绝不整包合并」策略直接冲突,重点标出)
- `docs/northstar/ENDGAME-CITY-ORDER.md` — 「一次过做全部版本」整包施工总令,前提已被重建策略推翻。
- `docs/northstar/WAVE-C-ORDER.md` — Wave C 整批施工单(Foundation→并行→缝合→一次部署),已被替代。
- `docs/northstar/WALK-MANUAL-ENDGAME.md` — 整包走城逐页投票手册,服务于已被取代的治理流程。
- `docs/northstar/IMMERSIVE-COMPOSITION-BLUEPRINT.md` — 一次性建城蓝图,对应代码不入切片,带入即悬空文档。
- `docs/northstar/IMMERSIVE-STORE.md` — 全城单例共享 store 架构蓝图,属共享缝级决定,应在需要时按 foundation 流程重新设计。

### ⚠ 已被 skill 三合一(ac1c929d,founder 亲令)废弃
- `.claude/skills/fleet-orchestration/SKILL.md` — 已并入 fikirtive-orchestration-overlay 并从 main 删除,带入即复活废稿。
- `.claude/skills/model-routing/SKILL.md` — 同上。
- `.claude/skills/two-brain/SKILL.md` — 同上。
- `docs/ops/MODEL-DOSSIER-2026-07.md` — 原型版引用已废弃旧编制,带入会使 main 活文档倒退。

### 会让 main 倒退的旧快照
- `docs/FIKIRTIVE-MASTER-2026-07-10.md` — main 已经 #225/#228 更新,原型版指向已废弃 skill 路径。
- `docs/research/GRILL-VERDICTS-2026-07-03.md` — main 已追加 07-10/07-11 founder 裁决 38 行,旧快照会丢新裁决。
- `docs/strategy/TWO-BRAIN-MEMO-2026-07.md` — main 多 43 行 R5 裁定附录,旧版覆盖即倒退。

### 空 diff / main 已有,无需带入
- `.claude/skills/apple-design/LICENSE` — main 已有一字不差同名文件。
- `.claude/skills/apple-design/SKILL.md` — 同上。
- `docs/ops/SESSION-HANDOFF-2026-07-10.md` — 两点 diff 为 0 行,过程性交班文档。
- `docs/design-system/design-rules.md` — 两分支独立收敛到同一终态,空 diff。
- `docs/northstar/EFFECTIVENESS-LEDGER.md` — 已经 #208 合入 main,空 diff。
- `docs/northstar/GOOSEWORKS-MAP.md` — 已经 #208 合入 main,空 diff。

---

## 4. unknown 列表

**无。** 风险评估对输入二全部 121 个文件均给出明确裁定(safe-ui / foundation-needed / exclude),无待人工核条目。

附注(无需 PR 动作,列此备查): 以下 8 份 safe-ui 文档与 origin/main 逐字节相同,不进任何切片 —— `docs/northstar/QA-REPORT-PREWALK.md`、`docs/northstar/REFERENCE-PROPOSAL-MERDEKA.md`、`docs/northstar/STALL-LEDGER.md`、`docs/strategy/PARTNER-CANDIDATES-MY.md`、`docs/strategy/SOL-R1-2026-07-10.md`、`docs/strategy/SOL-R2-OTTO-2026-07-10.md`、`docs/strategy/SOL-R3-COMPLETENESS-2026-07-10.md`、`docs/strategy/SOL-R4-OPTIMIZE-2026-07-10.md`。

---

## 5. 旅程切片 PR 初步分组建议(239 个可搬文件 → 1 个地基 PR + 8 个旅程切片)

顺序为编译依赖事实,非偏好: **PR-0(地基)→ 切片 1(壳契约)→ 切片 2–8 可并行**。评估 reason 中多处确认 schedule/assets/analytics/create 组件编译依赖 `immersive/_store` 或 `immersive/_context`,二者随切片 1 落地,故壳契约必须先行。每片横跨两棵路由树(`app/northstar/*` 主城 + `app/northstar-immersive/*` 沉浸城)的同一旅程,拆分粒度可再调。

| # | 切片 | 范围 | 约计文件数 |
|---|---|---|---|
| PR-0 | 地基(非旅程切片) | 第 2 节全部 7 件;proxy.ts 只叠加一行 | 7 |
| 1 | 壳契约 + 全局横切(最大一片) | immersive layout/page/tokens.css/otto 页 + `immersive/` 核心(_store/_context/_kit/_selectors/shell/nav/dock/home/otto-assist/otto-fullscreen/deeplink-fallback)+ 双城 global(legal/nav/notifications/otto-chat/otto-dock/search)+ onboarding + cityhall + `global/` 组件 + `scripts/check-northstar-imports.sh`(随首个切片带入,**尚未接 CI,须在此接线**) | ~44 |
| 2 | 创作(create / studio) | 双城 create 各 7 页 + `studio-factory/` 5 件 + `create/` 组件 9 件 + `studio-archetype.test.ts`(**必须与 studio-factory/data.ts 同片,否则编译不过**) | ~29 |
| 3 | 素材(assets) | 双城 assets 各 7 页 + `immersive/assets/` 9 件 + `assets/_data`/`_zone` + `gallery-frame.tsx` | ~26 |
| 4 | Campaign | immersive campaign 7 页 + 组件 8 件;northstar campaign 6 页 + `_bits`/`_data` | ~23 |
| 5 | 排期(schedule) | 双城 schedule 各 5 页 + `immersive/schedule/` 7 件 + `schedule/kit.tsx`(评估已注明:依赖切片 1 的 `_store`) | ~18 |
| 6 | 分析 + 广告(analytics / ads) | immersive ads 4 + analytics 3 页 + `analytics-ads/` 8 件;northstar ads 4 + analytics 2 页 + `ads/` 5 件 + `analytics/` 2 件 | ~28 |
| 7 | CRM + 收件箱(crm / inbox) | immersive crm 4 + inbox 8 页 + `crm-inbox/` 17 件;northstar crm 4 + inbox 5(纯 stub) | ~38 |
| 8 | 账务 / 团队 / 自动化(account-ops) | immersive account 5 + automation 3 + team 3 页 + `account-ops/` 13 件;northstar 对应 9 个 stub 页 | ~33 |

切片 1–8 合计 239 = 247 可搬 − 8 份已在 main 的文档。

---

## 6. 「mock 可能变真调用」风险文件汇总(筛自输入二 reason;输入一的 151 件未逐文件评估,其中同名功能页变真时同样适用)

标 💰 者变真时**必须过 money-safety-review**(花费/计费相邻,评估 reason 原话点名或触及 spendCredits/generate 闸):

| 文件 | 当前 mock 形态 → 变真信号 |
|---|---|
| 💰 `apps/web/app/northstar/account/top-up/page.tsx` | 头注已写明未来接 Stripe MYR LIVE;现为 NsStub 空壳。评估原话:填成真实充值流程那次改动必须过 money-safety-review |
| 💰 `apps/web/app/northstar/campaign/pack-confirm/page.tsx` | 标题含「server 重算」「generate 闸」字样,现为 setTimeout + 内存 store 演示;已核实未触及 genRequest/startGen/fal(假警报),变真即钱路 |
| 💰 `apps/web/app/northstar/create/canvas/page.tsx` + `components/northstar/create/canvas-page.tsx` | startGeneration 为定时器模拟生成引擎,spendCredits 走内存 store;变真即 /api/generate 花费路径 |
| 💰 `apps/web/app/northstar/create/media-editor/page.tsx` + `media-editor-page.tsx` | regenerate/spendCredits/ottoWorking 全走本地 mock store |
| 💰 `apps/web/app/northstar/schedule/composer/page.tsx` | schedulePost/saveDraft 纯内存;X 计费提示(1/4 credits)为静态文案;变真同时涉及发布端点与计费 |
| `apps/web/app/northstar/campaign/calendar/page.tsx` | 文案提及未来 Otto 自动发布(auto-publish),当前无代码路径 |
| `apps/web/app/northstar/campaign/workbench/page.tsx` | 「X pricing」「generated or published」均为静态展示文字 |
| `apps/web/app/northstar/analytics/reports/page.tsx` | 「下载 PDF」为 setTimeout 假进度条 + toast,无真实文件生成 |
| `apps/web/app/northstar/assets/brand-memory/page.tsx` | 产品链接建档 form 现为 preventDefault + 本地状态机;变真即真实抓取端点 |
| `apps/web/app/northstar/assets/cast/page.tsx` | 训练进度 setInterval 模拟;变真即训练/生成调用 |
| `apps/web/app/northstar/assets/brand-kit/page.tsx` | 「Check recent visuals」校验为本地叙述条模拟 |
| `apps/web/app/northstar/assets/my-stuff/page.tsx` | Retry/Upload/Delete 均为前端状态模拟,变真即上传/删除请求 |
| `apps/web/app/northstar/ads/builder/page.tsx` | submitAd() 打本地内存 store,变真即广告提交端点 |
| `apps/web/app/northstar/schedule/share-preview/page.tsx` | 分享 token 写死 + 仅剪贴板;变真涉及短链/权限接口 |
| `apps/web/app/northstar/global/otto-chat/page.tsx` | 流式回复为 setInterval 逐词模拟;变真即打真实 Otto/生成端点 |
| `apps/web/app/northstar/global/notifications/page.tsx` | approveRequest 等审批只操作本地状态;变真即真实审批/计费端点 |
| `apps/web/app/northstar/create/asset-viewer/page.tsx` | 「Regenerate」走本地 mock store |
| `apps/web/components/northstar/schedule/kit.tsx` | Approve 为 setTimeout 模拟延迟后回调本地 store |

结构性护栏(事实): `scripts/check-northstar-imports.sh` 专为拦截上述「mock 误接后端」而生(检测 server actions / @fikirtive/db / @fikirtive/generation / auth 等 import),**当前尚未接入 CI**,评估建议随首个原型页切片带入并接线。