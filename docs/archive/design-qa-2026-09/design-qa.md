# 历史设计迭代与验收证据

> **归档说明 — 2026-09-02：** 下方保留多轮历史方向与当时的 fixture 检查；其中包含已被后续 Founder 决定取代的方案，不是当前施工 spec，也不证明 production 已接通。当前 authority 位于 `apps/web/design-system/`；接手先读 [基线交付入口](apps/web/design-system/governance/frontend-baseline-handoff.md)。所附 `artifacts/` 与 `apps/web/artifacts/` 图片只作历史证据。

## Founder Home + Otto 设计验收

Founder implementation acceptance：2026-08-28，Founder 已确认 Founder Home、Otto flow 与 fullscreen 修正版可接受。

Interaction completion addendum：2026-08-28，Founder 发现 business goal、date range 与 comparison 只更新控件文字、没有更新 Home 内容；原视觉方向与 Otto 验收保留，Home filter completeness 重新打开。修正、agent QA 与 Founder 再验收均已完成。

## 验收范围

- 页面：`/product-patterns/founder-home`
- Dashboard 方向：`apps/web/design-system/patterns/founder-home/selected-direction.png`
- Otto flow spec：`apps/web/design-system/patterns/otto-panel/cloudflare-flow-audit.md`
- Cloudflare Mobbin 证据：`apps/web/design-system/patterns/otto-panel/references/cloudflare-ask-ai/`
- 实现状态截图：`apps/web/artifacts/founder-home/otto-cloudflare-flow/`

## 同画布比较

比较图左侧是 Cloudflare Mobbin reference，右侧是 Fikirtive implementation。两侧都等比放入
1280 × 720 的白色画布，不拉伸；Cloudflare source 自带 Mobbin footer，Fikirtive 使用
1280 × 720 desktop viewport。

- Empty conversation：`compare-empty.jpg`
- Structured answer：`compare-answer.jpg`
- Conversation history：`compare-history.jpg`
- Fullscreen thread：`compare-fullscreen.jpg`
- Wide fullscreen correction：`compare-fullscreen-wide-fixed.jpg`（1920 × 1080 implementation）。

## 视觉判断

- 保留 Cloudflare 的主要 rhythm：utility-bar entry、右侧 docked panel、紧凑 header、固定 composer、
  user bubble、无多余 answer card 的结构化正文、inline utilities、history popover 与 fullscreen thread。
- 保留 Fikirtive 差异：Otto 正式橙色 mark、Founder marketing-health starters、预算变更 review gate。
- Dashboard 打开 panel 后真实缩窄，内容仍可操作；fullscreen 时才覆盖 viewport，并将背景 main 设为
  `inert` / `aria-hidden`，避免键盘进入看不见的 Dashboard controls。
- Typography、border、radius、shadow、spacing、brand 与 semantic colors 全部消费正式 token / primitive；
  没有建立 page-specific AI drawer 或第二套 chat component。
- Cloudflare 的 Support entry 未复制，因为 approved spec 明确要求没有真实 destination 时不展示假按钮。

## 交互验收

- Global `Ask Otto`：closed → docked，Dashboard 缩窄。
- Empty：Otto greeting、4 个 contextual starters、固定 composer。
- Dashboard recommendation：只预填建议 prompt；用户自行发送。
- Send：user message → 1.4s visible thinking → structured answer。
- Follow-up：同一 thread 连续追问，composer 始终保留。
- History：search、recent conversations、new conversation、switch 后自动收起；search 再开时重置；
  新 thread 会进入 recent list，可切换回来。
- Fullscreen：同一 active thread、answer、feedback、composer draft 全部保留；退出后回到 docked。
- Copy / feedback：以 `turn.id` 为状态边界；copy 使用画面中该回答的真实文字，成功后该回答原位显示
  `Copied`，feedback 只改变被点击的回答。
- Close / reopen：回到原 Dashboard，再打开恢复 active thread 与未发送 draft。
- Budget action：只进入 `Review budget change` preview，不伪装已经修改 campaign。
- Dashboard desktop-only boundary 保持不变；本轮没有设计 Otto mobile flow。

## 本轮修正记录

1. 将旧静态 suggestion fixture 替换为正式 `otto-panel` composition。
2. 新增同一 thread 的 docked / fullscreen 形态，不删除既有 floating / resize architecture。
3. 将 thinking fixture 从 720ms 调为 1400ms，使 processing 状态清楚可感知。
4. 修复 history 选择后不收起、search query 残留、切换后遗失刚才 thread。
5. 修复多轮回答共享一个 copy / feedback 状态，以及 copy 固定假文字的问题。
6. fullscreen 时将背景 main 设为 inert，消除隐藏 Dashboard 的键盘焦点入口。
7. Founder name 与 dashboard recommended prompt 改由 Founder Home 单一 fixture 提供给 Otto reference。
8. 更新 Otto README 与 shell 形态说明，移除与 Founder approval 冲突的 pending 状态。
9. Founder 宽屏验收发现 fullscreen 把 user bubble 与 assistant answer 一起锁在左侧 `760px`；
   修正为 Cloudflare 的双边阅读关系：user prompt 使用全屏右缘，assistant answer 保持左侧 `760px`
   可读列，composer 继续占满底部，docked panel 不受影响。

## 工程验证

- Targeted ESLint：通过。
- TypeScript：通过。
- Targeted Vitest：30 / 30 通过，包括真实 seed、thinking、answer、copy、per-turn feedback、follow-up、
  fullscreen inert、draft persistence 与 close / reopen 行为。
- Next.js production build：通过；本地临时 auth build values 只用于构建验证，没有写入 repo。
- Fresh browser smoke：无当前 console error / warning；开发中 Fast Refresh 的旧日志不计入最终 fresh run。
- P0 / P1 / P2：0 / 0 / 0。

## Home filter completion 验证

- `Business goal`：Online sales、Leads / bookings、Brand awareness 各自拥有独立推荐组件顺序、指标、洞察、performers、channels 与 Otto recommendation。
- `Date range`：7 / 30 / 90 days 会更新 period、primary value、supporting metrics 与 chart labels / values，不改变 active goal 的自定义布局。
- `Comparison`：previous period / previous year 会更新 comparison label 与 deltas；no comparison 移除 comparison-only deltas。
- `Customize home`：三个 filter 在 unsaved draft 打开时 disabled；每个 goal 独立保存布局，切换再返回不会互相覆盖。
- 单一事实来源：goal templates 在 `model.ts`；fixture composition 在 `fixtures.ts`；页面只消费这两份 authority。
- 组合测试：3 goals × 3 ranges × 3 comparisons 全部生成并检查，共 27 种组合。
- Targeted Vitest：14 / 14 通过；TypeScript、targeted ESLint 与 design-system adoption audit 通过。
- Fresh desktop browser QA：三个 goal、range、comparison、no comparison、per-goal customize save / restore 全部通过；console error / warning 为 0。

final result: passed; Founder re-accepted 2026-08-28

---

# Canvas product pattern 设计验收

QA date：2026-08-29。范围是 fixture-only `/product-patterns/canvas`，不包含 production Canvas、真实
generation、credits、persistence 或业务 mutation。

## Source visual truth 与实现证据

- Stitch Canvas source：`apps/web/design-system/patterns/canvas/references/stitch-canvas-main.jpg`
  （768 × 521 px，source screenshot，density normalization 视为 1×）。
- Stitch Create source：`apps/web/design-system/patterns/canvas/references/stitch-create-home.jpg`
  （768 × 521 px，source screenshot，density normalization 视为 1×）。
- Implementation workspace：`artifacts/canvas-workspace-1440x900-final.png`
  （1440 × 900 px；CSS viewport 1440 × 900；devicePixelRatio 1）。
- Implementation wide workspace：`artifacts/canvas-workspace-1920x1080.png`
  （1920 × 1080 px；CSS viewport 1920 × 1080；devicePixelRatio 1）。
- Implementation Create home：`artifacts/canvas-home-1440x900-final.png`
  （1440 × 900 px；CSS viewport 1440 × 900；devicePixelRatio 1）。
- Implementation mobile share：`artifacts/canvas-share-390x844.png`
  （390 × 844 px；CSS viewport 390 × 844；devicePixelRatio 1）。
- Compare dialog：`artifacts/canvas-compare-1440x900.png`。

Side-by-side normalization：source screenshots 等比放大到 900px 高；implementation 保持 1440 × 900，
没有拉伸或强行对齐不同画面比例。

- Full workspace comparison：`artifacts/canvas-qa-workspace-comparison.png`。
- Full Create-home comparison：`artifacts/canvas-qa-home-comparison-final.png`。
- Focused left-panel comparison：`artifacts/canvas-qa-left-panel-focus.png`。这一 crop 足以检查 conversation、
  Agent log、border、radius、typography、density 与 agent-owned coral；其他重点（top toolbar、node cards、
  omnibox、tool rail）在 1440px 原图已清楚可读，不需要再放大裁切。

## Required fidelity surfaces

- **Fonts / typography：** 使用产品 Geist family 与正式 font tokens；heading、small UI、plan copy 与 status copy
  层级清楚，没有异常 wrap 或截断。Stitch source 的 display weight 更轻；Fikirtive 保留已批准的较强 founder-facing
  heading，分类为 intentional brand difference。
- **Spacing / layout rhythm：** 保留 Stitch 的 full-screen dotted board、left floating conversation、lower-left
  Agent log、bottom composer、center contextual toolbar、right tool rail 与 bottom-right zoom。1440 × 900 和
  1920 × 1080 均无 document overflow，persistent controls 不重叠。
- **Colors / tokens：** neutral surfaces、ink primary 与 semantic states 全部来自 design-system tokens；coral 只用于
  Otto / agent-owned moments。没有新增 page-local color authority。
- **Image quality / asset fidelity：** gift-box image 与 video frame 是为实际 node aspect ratio 生成的 raster assets，
  清晰、crop 正确；Fikirtive/Otto 使用正式 brand components；icons 使用现有 Lucide family。没有 placeholder、emoji、
  CSS illustration、inline SVG 或 fake product asset。
- **Copy / content：** UI 使用 English sentence case；credit approval、dependency、refund、unknown state、Remove 与
  Delete 的区别都明确。Prototype-only feedback 不伪装 production mutation。

## Interaction 与 accessibility evidence

- 自由 prompt → 自动命名 `Merdeka launch` → full-screen Canvas。
- Otto 三种响应：free action、blocking clarification、paid plan。
- item-level `Make`、`Make all · 24 credits`、plan edit/delete、dependency queue、Queued cancel + returned credits。
- asset selection、move、context toolbar、Compare、Approve、Generations index、Share builder、Campaign/Schedule handoff。
- mobile editor guard 与 390 × 844 Approved-only read-only share；share view 没有 Canvas tools 或编辑动作。
- button names、input labels、dialog focus/Escape behavior 与 visible focus 由正式 primitives 提供；fresh-tab console
  error 为 0。

## Comparison history

1. **Pass 1 — blocked by P2：** 1440 × 900 下，长 paid plan 延伸到 Agent log 背后，`Make all` 不在可见/可滚动的
   明确 panel boundary 内。证据：`artifacts/canvas-workspace-1440x900-pass1.png`。
2. **Fix：** conversation 与 Agent log 分别取得 viewport-aware max height 和自己的 overflow region，并缩短 log 的
   visible history，保留完整滚动内容。
3. **Pass 2 — passed：** `artifacts/canvas-workspace-1440x900-final.png` 显示 conversation rect 为 y=72–630，
   Agent log 为 y=640–806，间距 10px；`Make all · 24 credits` 可见。1920 × 1080 同样无 overlap。
4. **P3 polish：** Create home 加回 Stitch source 的低对比 dotted field；正式背景 token 与 content hierarchy 不变。

## Findings

- P0：0。
- P1：0。
- P2：0。
- P3：wide Canvas 的 artifact cluster 仍偏左，这是为了保留 infinite-board 空间，属于预期；production integration
  时再根据真实 node 数量验证 auto-layout density。

## Engineering evidence

- Targeted ESLint：通过（0 error / 0 warning）。
- Targeted Vitest：10 / 10 通过。
- TypeScript：通过。
- Next.js production build：通过；repo 缺少 `BETTER_AUTH_SECRET` 的既有 auth warning 不影响本 fixture route。
- Fresh browser smoke：handoff dialog 可完成，console error 为 0。

final result: superseded by the Stitch conversation-flow correction below

## Stitch conversation-flow correction（2026-08-29）

Founder 在 prototype review 中指出首版把左上 status 与左下 conversation 拆错，要求回到 Stitch 的完整逻辑；
因此上一轮 Canvas pass 重新打开。修正依据是 Mobbin 五条 Stitch flow 的 19 个画面，原图保存在
`apps/web/design-system/patterns/canvas/references/`。

### 修正后的唯一状态链

- bottom omnibox 是唯一输入源；发送后 Agent log 先新增 prompt turn。
- 左上只显示 active turn 的 `Queued → Working → response/approval`，不再另建一个 generic Status panel。
- 左下 Agent log 展开后显示全部 prompt 与状态；选择旧 turn 会把左上恢复到该轮 Otto 回复。
- Canvas selection 直接成为 omnibox context chip；`Ask Otto` 与 `Animate` 都回到同一个 composer。
- queued turn 可取消且不会被延迟 timer 改回 Working；取消后同一 turn 显示 `Cancelled` 与 no-credit 结果。
- paid plan 仍在 active turn 内先报价再批准，这是 Fikirtive 相对 Stitch 唯一的业务差异。

### 验证证据

- 1440 × 900 fresh desktop browser：左上 active turn、左下 Agent log、bottom omnibox、right rail 互不遮挡。
- 浏览器行为：发送后依次观察到 Queued、Working、final response；Agent log 选择旧 turn 可恢复 paid plan；
  queued turn cancel 后 3.4 秒仍保持 Cancelled。
- 最新截图：`artifacts/canvas-stitch-flow-corrected-1440x900.png`。
- Targeted ESLint：通过（0 error / 0 warning）。
- Targeted Vitest：6 / 6 通过。
- TypeScript：通过。
- Next.js production build：通过；repo 未配置 `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` 的既有 build warning
  仍存在，但不影响 fixture-only Canvas route 的编译与页面生成。

final result: implementation passed; pending Founder re-acceptance

---

# Canvas Grok creation-flow correction（2026-08-29）

本轮由已批准并冻结的
`apps/web/design-system/patterns/canvas/grok-image-flow-change-proposal.md` 取代上一版 creation flow：Grok Imagine
负责 prompt、single-action quote、generation、result iteration 与 history 逻辑；Stitch 继续负责 full-screen spatial
workspace；Fikirtive design system、Otto orange 与 credits / Library / handoff truth 保持不变。

## Source visual truth 与实现证据

- Workspace source：`apps/web/design-system/patterns/canvas/references/stitch-canvas-main.jpg`
  （768 × 521 px，source screenshot，1×）。
- Creation logic authority：`apps/web/design-system/patterns/canvas/grok-image-flow-change-proposal.md`，内含 7 条已复核的
  Grok Web Mobbin flows 与 2026-08-29 signed-in Grok Imagine spot-check。
- Create home implementation：`artifacts/design-qa/canvas-grok/create-home-1440x900.png`
  （1440 × 900 px；CSS viewport 1440 × 900；devicePixelRatio 1）。
- Workspace initial quote：`artifacts/design-qa/canvas-grok/workspace-1440x900.png`
  （1440 × 900 px；CSS viewport 1440 × 900；devicePixelRatio 1）。
- Workspace completed turn：`artifacts/design-qa/canvas-grok/workspace-completed-1440x900.png`
  （1440 × 900 px；CSS viewport 1440 × 900；devicePixelRatio 1）。
- Wide workspace：`artifacts/design-qa/canvas-grok/workspace-final-1920x1080.png`
  （1920 × 1080 px；CSS viewport 1920 × 1080；devicePixelRatio 1）。
- Mobile selected-output share：`artifacts/design-qa/canvas-grok/share-selected-390x844.png`
  （390 × 844 px；CSS viewport 390 × 844；devicePixelRatio 1）。

Source 与 implementation 不冒充相同产品内容；比较目标是 Stitch 的 persistent control geometry、spatial hierarchy、
surface density 与 Canvas rhythm。source 等比缩放到 720 × 450 comparison cell，implementation 等比缩放到同一 cell，
均不拉伸：

- Full-view pass 1：`artifacts/design-qa/canvas-grok/comparison-full-pass1.png`。
- Focused left-panel pass 1：`artifacts/design-qa/canvas-grok/comparison-focused-panels-pass1.png`。
- Full-view post-fix：`artifacts/design-qa/canvas-grok/comparison-full-pass2.png`。
- Focused left-panel post-fix：`artifacts/design-qa/canvas-grok/comparison-focused-panels-pass2.png`。

Focused comparison 用于检查 Otto current response 与 History 的 typography、padding、radius、shadow 和折叠关系；top
toolbar、artifact cards、right tool rail、omnibox 与 zoom controls 在 full-view 1440px comparison 中已清楚可读，不需要
第二个 focused crop。

## Required fidelity surfaces

- **Fonts / typography：** 使用产品 Geist 与正式 text tokens；current response、quote、artifact label、History、toolbar
  层级清楚，1440 / 1920 没有异常 wrap、overflow 或截断。Stitch 较轻的灰阶与 Fikirtive 较强的 founder-facing weight
  差异属于已批准的 brand translation。
- **Spacing / layout rhythm：** 保留 Stitch 的 dotted infinite board、左上 current response、左下 History、底部单一
  omnibox、顶部 contextual actions、右侧 tool rail 与右下 zoom。1440 × 900、1920 × 1080 均无 persistent-control
  overlap；completed response 会自然收短，不保留空的 paid-plan region。
- **Colors / tokens：** neutral board、cards、borders、status、focus 与 elevation 全部来自正式 design-system tokens；
  coral 只用于 Otto / agent-owned action。没有复制 Grok black theme 或建立 page-local color source。
- **Image quality / asset fidelity：** gift-box 与 video frame 使用匹配 node ratio 的真实 raster assets，crop、锐度与遮罩
  正确；Fikirtive/Otto 使用正式 brand components，actions 使用 Lucide。没有 emoji、CSS drawing、handmade SVG 或
  placeholder asset。
- **Copy / content：** UI 使用 English sentence case。旧 `Paid plan`、`Make all`、creative `Approved`、`Approved only`
  与 `Agent log` 已从 prototype 移除；`Selected output`、`Ready / Generating`、exact credits 与 Library receipt 语义一致。

## Primary interactions 与 accessibility

- Create home free prompt → 自动命名 `Merdeka launch` → full-screen Canvas。
- Toolbar `Variations` 产生单一 `Generate 4 variations · 8 credits` quote；没有默认 batch plan。
- `Generate` 后目标 artifact 原位显示 `Generating`，完成后变为 `Ready`；Otto 显示 charged receipt 并移除已消费的
  Generate CTA，loading toast 正确 dismiss。
- `Edit` 回到唯一 omnibox；`Animate` 与 `Retry` 先产生各自的 single-action quote；Download / Share / More 保持
  contextual。
- History 只恢复 prompt + result turn，不复制 artifact operational queue；打开时不遮挡 omnibox 或 current response。
- Share dialog 默认 `Selected output`；Campaign / Schedule handoff 传递 selected artifact ID，不需要 creative approval。
- 390 × 844 read-only share 只展示 selected work、Ready state 与 revoke note，没有 editor controls。
- Browser-rendered console error：0。按钮、input、dialog、checkbox、Escape 与 visible focus 使用正式 primitives。

## Comparison history

1. **Pass 1 — blocked by P2：** generation 完成后 current response 仍显示同一 `Generate` quote CTA；loading toast 也在
   completed receipt 后继续旋转。证据：`workspace-1920x1080.png` 与 `comparison-full-pass1.png`。
2. **Fix：** conversation turn 新增明确的 `quoteStatus: pending | completed`；只有 pending quote 显示确认 card；记录
   loading toast id，并在成功 receipt 前 dismiss。
3. **Pass 2 — passed：** `workspace-completed-1440x900.png` 与两张 `pass2` comparison 显示 completed response 收束为
   receipt、没有重复 Generate CTA，也没有 stale loading toast。重新运行 interaction 后 loading toast count 为 0、
   success receipt 为 1。

## Findings

- P0：0。
- P1：0。
- P2：0。
- P3：Next.js dev indicator 会在 local dev 左下角覆盖 History 的一小部分；它不属于产品 DOM，production build 不出现。
- Residual test gap：fixture route 不连接真实 generation、money、persistence、Library mutation 或 navigation；这些仍由
  production integration gate 覆盖，不在本轮验收范围。

## Engineering evidence

- Targeted Vitest：6 / 6 通过。
- TypeScript：通过。
- Targeted ESLint：通过（0 error / 0 warning）。
- Next.js production build：通过；repo 未配置 `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` 的既有 local warning 不影响
  fixture-only route 编译与页面生成。
- Fresh browser checks：Create、History、Variations quote、Generating → Ready、Share、Campaign/Schedule handoff、
  1920 desktop 与 390 mobile share 均通过；console error 为 0。

final result: passed

# Official Avatar Library QA（2026-08-30）

Founder 选择 actor-card visual direction 2。本轮只实现 approved Library / Official avatars surface；avatar identity、
generation engine、persistence 与 Otto IQ backend 不在前端 fixture 范围内。

## Source visual truth 与 implementation evidence

- Selected visual：`apps/web/design-system/patterns/library/official-avatars-selected-direction.png`
  （1536 × 1024 px）。
- Implementation：`apps/web/design-system/patterns/library/official-avatars-implementation.png`
  （1440 × 1024 CSS viewport）。
- Same-input full-view comparison：
  `apps/web/design-system/patterns/library/official-avatars-design-qa-comparison.png`
  （3072 × 1024 px；左 selected visual，右 implementation）。
- State：`Elements → Official avatars → Mei → Character sheet`，Otto panel closed。
- 本轮没有 focused crop：卡片、filters、selected state、detail evidence 与 persistent actions 都在同一 full-view 中清楚可读。

## Required fidelity surfaces

- **Typography：** 继续使用正式 app typography tokens；name、mention、tagline、demographic、badges 与 detail hierarchy
  在 1440px 下没有异常 wrap 或 overflow。
- **Spacing / layout：** 保留 selected visual 的三栏 portrait catalog + persistent right detail rail。detail evidence 自己滚动，
  `Use in Canvas / Favorite` 固定可见，不会因 `In action` 内容变高而掉出 viewport。
- **Colors / tokens：** background、card、border、muted、success、focus、radius、shadow 与 motion 全部消费 Design System owners。
  Selected visual 的 coral selection border 没有照抄：现有 SSOT 规定 coral 只属于 Otto 与 Fikirtive mark，因此实现使用 ink border / ring。
- **Image quality：** 6 位 actor 都使用真实 raster portraits；Mei 另外提供 character sheet 与 2 个 cross-scene samples。
  没有 placeholder、emoji、CSS art、手工 SVG、模型名或 branded wardrobe。
- **Copy：** 常驻 `AI generated` 与 commercial-clearance disclosure；voice 文案保持
  `Voice is set per video, not fixed to the actor.`；UI 没有暗示演员是真人。

## Primary interactions tested

- Search `Mei`：6 → 1。
- Industry `Services`：6 → 5。
- 选择 Rizal：URL 更新为 `avatar=actor-rizal`，可 deep-link。
- `Use in Canvas`：传递 `context=actor-rizal&mention=%40Rizal`，没有复制 avatar identity。
- `Character sheet / In action`：真实切换 evidence；没有 scene fixture 的 actor 显示诚实 empty state。
- `Favorite`：`Favorite → Favorited`，并提供可撤销状态。
- Official avatar Favorite 由 Library surface 持有：切到 Clothes 再返回不会丢失，并会出现在 Library Favorites。
- Browser Back：同步恢复 Library 主 view、Element category、selected avatar 与 detail，不出现 URL / UI drift。
- Canvas handoff：URL 保留 `actor-mei` typed ID；composer 显示 Founder 可读的 `@Mei`。
- 关闭 detail：移除 `avatar` query，同时保留 Official avatars catalog。

## Engineering evidence

- Focused Vitest：3 files，25 / 25 通过。
- Web TypeScript：通过。
- Scoped ESLint：通过（0 error / 0 warning）。
- Next.js production build：通过。Repo 缺少 `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` 的既有 local warning；
  不影响 fixture route 编译与静态页面生成。

## Findings

- P0：0。P1：0。P2：0。
- P3：只有 Mei fixture 提供完整 sheet 与 cross-scene samples；其余 actors 会显示 reference portrait 或 honest empty state。
  这是 fixture asset coverage，不是假功能，也不阻塞 Founder 验收。

final result: passed

---

# Brand / Otto IQ visual direction 1 QA（2026-08-30）

本轮把 Founder 选择的最新 user-friendly Option 1 落成 fixture-only
`/product-patterns/brand?section=brand-voice`。生产 `/brand`、真实 ingestion、persistence、CRM / commerce sync
与 permissions 都没有修改。

Founder refinement：active section 现在拥有页面主标题与说明；`Brand` 只留在 breadcrumb。Ready / Draft /
Processing 使用 canonical Otto vector state 作一个克制的 visual cue，普通 records 与 evidence rows 不重复装饰。

## Source 与 comparison evidence

- Founder-selected source：`apps/web/design-system/patterns/brand/selected-direction.png`（1487 × 1058）。
- Browser implementation：`apps/web/design-system/patterns/brand/implementation.jpg`（1280 × 720）。
- Same-canvas comparison：`apps/web/design-system/patterns/brand/comparison.jpg`。两边都等比放入 1280 × 720
  白色画布，没有拉伸；source 是独立 visual-direction artboard，因此不伪装成相同 browser viewport。

## Visual and component checks

- 保留 Option 1 的主要 hierarchy：单一 Brand surface、五个 route-backed sections、窄 context list、一个 detail
  surface、Evidence 默认展开，Usage / Instructions / Change history 按需展开。
- `Audiences` browser state 已验证：页面 H1 为 `Audiences`，不存在残留的 `Brand` H1；切回 Brand voice 后 H1
  与 URL 都同步。Ready 显示 `otto-success.svg`，Processing 显示 `otto-thinking.svg`，且 preview 保持 disabled。
- 第一轮比对发现 list 缺 section count、detail 多一张解释卡、Evidence rows 太散；三项已修正后重新 capture。
- Fikirtive shell、Geist typography、surface / border / semantic color / radius / shadow 全部消费现有 design-system
  owner；coral 只来自正式 Fikirtive / Otto marks。
- 参考图没有 Campaigns；implementation 保留 formal application-shell 当前已记录的 runtime navigation drift，Brand
  pattern 没有复制或私改一份导航树。
- P0 / P1 / P2：0 / 0 / 0。

## Interaction checks

- 五个 sections 可切换，URL `?section=` 同步，browser back / forward 使用 `popstate` 恢复。
- context list 可选择 Ready / Draft / Processing records；Processing 诚实禁用 preview。
- Preview effect dialog 显示同一 sample 的 `Without context / With context`。
- Add dialog 支持 Text / URL / File；必填后建立 session-only Draft 并自动选中，不声称已经保存。
- Evidence、Usage、Instructions 与 Change history 可独立展开；View all 与 more actions 明确标记 review-fixture boundary。
- Global Ask Otto 继续复用正式 Otto panel，不在 Brand 里造第二个 chat。

## Engineering evidence

- Targeted ESLint：通过（0 error / 0 warning）。
- Targeted Vitest：2 files，14 / 14 通过。
- TypeScript：通过。
- Design-system adoption audit：通过；repo 当前整体迁移率 138 / 256（53.9%），不把本 pattern 合规误报为全 app 已完成。
- Next.js production build：通过；repo 没有配置 `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` 的既有 auth warnings
  仍会在 page-data 阶段输出，但 `/product-patterns/brand` 已成功编译并列入 route manifest。

final result: passed

---

# Stitch-minimal Creation interaction pass（2026-08-30）

Founder 以“ok”批准本轮 mini spec：Create 与 Canvas 继续保留 first-class workspace 架构，交互密度则收敛到
Stitch 的 agentic creation 模型。单一当前任务、必要时才问问题、生成前确认准确 credits、生成进度留在 node、
历史默认退居次要层级。

## Source visual truth

- Local selected references：
  `apps/web/design-system/patterns/canvas/references/stitch-create-home.jpg`
  （768 × 521 px）与
  `apps/web/design-system/patterns/canvas/references/stitch-canvas-main.jpg`
  （768 × 521 px）。
- Mobbin flows：Starting a new chat、Generating a screen、Viewing variations、Editing an element、Adding a screen、
  Uploading an image、Downloading screens；canonical links 记录在
  `apps/web/design-system/patterns/canvas/stitch-image-video-parity-spec.md` §16.2。
- Intended desktop comparison viewports：1440 × 900 与 1920 × 1080。

## Implementation evidence

- Shared composer：`apps/web/design-system/patterns/canvas/CreationComposer.tsx`。
- Create workspace：`apps/web/design-system/patterns/canvas/CreateWorkspaceReference.tsx`。
- Canvas current turn、conversation、node-local progress 与 contextual actions：
  `apps/web/design-system/patterns/canvas/CanvasReference.tsx`。
- Prompt-led image / video inference：`apps/web/design-system/patterns/canvas/model.ts`。

## Required interaction states

- Create idle：一个 composer 与轻量 recent Canvas history。
- Canvas done：当前结果留在 Canvas，Conversation 默认折叠。
- Needs answer：问题与选项出现在同一个 `Otto current turn` 区域，composer 切换为 `Answer Otto`。
- Needs confirmation：同一区域显示 exact credits、Generate 与 Cancel；确认前不收费。
- Generating：进度显示在目标 node，不复制成第二张全局 status card。
- Selected artifact：只显示与当前 node 有关的 Edit、Variations、Animate 与 Download。

## Fidelity status

- Fonts / typography：blocked — 本轮没有取得 implementation screenshot，无法做视觉对照。
- Spacing / layout rhythm：blocked — 本轮没有取得 implementation screenshot，无法做视觉对照。
- Colors / tokens：blocked — 代码继续消费现有 design-system tokens，但没有 rendered comparison，不能写成视觉通过。
- Image / icon fidelity：blocked — source assets 已确认存在，但没有 rendered comparison。
- Copy / content：自动化 source contract 通过；视觉层级仍需 Founder 在实际页面确认。

## Engineering evidence

- Web TypeScript：通过。
- Scoped ESLint：通过。
- Focused Vitest：4 files，32 / 32 通过。
- Production build：通过（使用本地 review-only auth env）。
- `git diff --check`：通过。
- 没有 push、deploy、production generation、money 或 persistence mutation。

## Blocker

- **P2 — rendered comparison unavailable：** Codex in-app Browser 本轮不允许捕捉 localhost route；按照 browser
  policy 没有改用其他浏览器或 raw CDP 绕过。现有预览 tab 可供 Founder 手动 reload 与验收，但在同 viewport、
  同 state 的 source / implementation screenshot 对照完成前，本轮不能声明视觉 QA passed。

final result: blocked

---

# Unified Founder Home + embedded Creation module QA（2026-08-29）

Founder 已明确否决独立 `Creation lab` / 第二个 Home，并在 one-night cooling reminder 后以“确定。”
重新确认方向。当前唯一关系是：`Founder Home（内嵌 creation module）→ full-screen Canvas → Founder Home`。

## Source visual truth 与 implementation evidence

- Founder 提供的 Home source 已规范化保存为
  `apps/web/artifacts/design-qa/unified-home-creation/source-founder-home-1440x933.png`
  （1440 × 933 px；原图 2388 × 1548 px，等比缩放，没有拉伸）。
- 默认收起状态：
  `apps/web/artifacts/design-qa/unified-home-creation/implementation-home-collapsed-clean-final-1440x933.png`
  （1440 × 933 px；CSS viewport 1440 × 933；devicePixelRatio 1）。
- creation 展开状态：
  `apps/web/artifacts/design-qa/unified-home-creation/implementation-home-creation-open-top-final-1440x933.png`
  （1440 × 933 px；CSS viewport 1440 × 933；devicePixelRatio 1）。
- Full same-input comparison：
  `apps/web/artifacts/design-qa/unified-home-creation/comparison-founder-home-collapsed.png`
  （2880 × 933 px；左 source，右 implementation）。
- Focused Home / creation comparison：
  `apps/web/artifacts/design-qa/unified-home-creation/comparison-home-creation-focus.png`
  （2400 × 350 px；左 source main，右 implementation main）。这一 crop 用于检查 Home header、filters、
  creation row、marketing-health heading、spacing、typography 与 divider rhythm；其余 dashboard 内容在 full
  comparison 中清晰可读。

## Required fidelity surfaces

- **Fonts / typography：** 延续现有 Geist / design-system type tokens；Home、filter、creation shortcut、metric 与
  insight hierarchy 与 source 一致，没有异常 wrap、overflow 或 truncation。
- **Spacing / layout rhythm：** 默认状态保留原 Founder Home 的 header → filters → lightweight creation row →
  marketing health 顺序。展开时 composer 在 creation row 内原位展开，不产生第二个页面标题、第二套导航或
  独立 Home shell。
- **Colors / tokens：** neutral surfaces、borders、focus、shadow 与 semantic colors 继续消费正式 tokens；coral 只用于
  Otto / agent-owned elements，没有建立 page-local palette。
- **Image / icon fidelity：** Fikirtive 与 Otto 使用正式 brand components，controls 使用现有 Lucide family；没有
  placeholder、emoji、CSS art、handmade SVG 或新散落资产。
- **Copy / content：** UI 保持 English sentence case。`Creation lab` 已从当前 surface 和 navigation label 移除；
  `Create` 是打开 Home 内嵌模块的 action，`Canvas` 才是项目工作区。

## Comparison history 与 findings

1. **Pass 1 — blocked by P2：** 从已挂载的 Home 点 sidebar `Create` 时，URL 已切换但 React state 没有同步，
   composer 仍保持收起。
2. **Fix：** 以 `initialCreationOpen + context` 作为 `FounderHomeCanvas` 的稳定 key，使 query intent 改变时重新建立
   正确 surface state；同时移除 `#creation` 自动滚动，避免展开后隐藏 Home heading、造成第二个 Home 的错觉。
3. **Pass 2 — passed：** `Home → Create → prompt → Canvas needs-confirmation → Back to Home`、recent canvas、
   global Otto、recommendation context 与 legacy `surface=lab` redirect 全部通过。
4. Full 与 focused comparison 显示 implementation 保留 source 的 Home hierarchy。Source 中黑色 `Creation lab`
   top CTA 被删除是 Founder 明确要求的 intentional difference；正式 sidebar `Create` action 取代它。
5. P0：0。P1：0。P2：0。P3：0。

## Engineering evidence

- Focused web Vitest：4 files，47 / 47 通过。
- Full core Vitest：58 files，1441 / 1441 通过。
- Web 与 core TypeScript：通过。
- Scoped ESLint 与 `git diff --check`：通过。
- Fresh-tab browser：console error 0，warning 0。
- 本轮只更新 review prototype 与共享 navigation contract；没有 push、deploy 或生产 mutation。

final result: passed

---

# Current Home / Creation / Canvas QA authority（2026-08-29）

当前唯一有效的 Home / Creation / Canvas information architecture QA 是上方
`Unified Founder Home + embedded Creation module QA（2026-08-29）`。它取代本文件中所有
`Home → Creation lab → Canvas`、独立 Creation Home、Grok proposal 与历史 Canvas authority 声明。

final result: passed

---

# Home → Creation lab → Canvas information architecture QA（2026-08-29）

本节取代上方所有使用 `Creation Home` 的命名记录。旧字样只是历史证据，不再决定
当前产品信息架构。当前权威是 `apps/web/design-system/patterns/canvas/stitch-image-video-parity-spec.md`
的 §14 addendum：唯一 Home 是 Founder marketing health dashboard，`Creation lab` 是创作入口，
Canvas workspace 是具体项目。

## Source visual truth 与 implementation evidence

- Founder Home：`apps/web/artifacts/design-qa/home-creation-handoff/founder-home-creation-lab-1440x900.jpg`
  （1440 × 900 px）。
- Creation lab：`apps/web/artifacts/design-qa/home-creation-handoff/creation-lab-1440x900.jpg`
  （1440 × 900 px）。
- 导航名称 SSOT：`packages/core/src/navigation.ts` 的 `CREATE_NAV_LABEL`。
- Review 路由 SSOT：`apps/web/design-system/patterns/canvas/review-links.ts` 的
  `creationLabReviewHref`，统一输出 `surface=lab`。

## Browser interaction evidence

- Founder Home 主导航和 page CTA 都显示 `Creation lab`，CTA 进入
  `/product-patterns/canvas?surface=lab`。
- Creation lab 的 navigation、breadcrumb 和 H1 同时显示 `Creation lab`，不存在第二个 Home。
- Creation lab 打开 `Hari Raya gifting` 后进入带 `[aria-label="Canvas board"]` 的 full-screen
  Canvas；`Back to Creation Lab` 返回创作入口。
- Creation lab 主导航的 `Home` 返回 `/product-patterns/founder-home`，页面 title 是
  `Founder Home · Fikirtive`。
- Home 的 `Create this` 保留 contextual handoff：URL 含 `surface=lab&context=...`，而且
  `Review the strongest sales campaign` context 在 Creation lab 可见。

## Engineering evidence

- Focused web Vitest：22 / 22 通过。
- Core navigation Vitest：37 / 37 通过。
- Scoped ESLint：0 error / 0 warning。
- Web 与 core TypeScript：通过。
- Core build：通过，并让运行中的 web review surface 读到新的导航 SSOT。

final result: passed

---

# Canvas interaction refinement QA（2026-08-29）

本节取代上方 `Current Canvas QA authority`，只覆盖本轮 refinement：所有 board content node 共用拖拽、
Stitch-style Conversation，以及 Creation Home 接回 Fikirtive 主壳。

## Source visual truth

- R22 Canvas baseline：`apps/web/design-system/patterns/canvas/references/r22-canvas-completed-1280x720.jpg`
  （1280 × 720 px）。
- Mobbin：[Stitch · Starting a chat](https://mobbin.com/flows/a8f6d3c4-0622-4b62-ac13-e02adaa201b4)、
  [Stitch · Adding a screen](https://mobbin.com/flows/c406e2c4-d94d-4435-aa25-0deb3a210e7a)、
  [Stitch · expanded agent workspace](https://mobbin.com/screens/83b04e08-0003-4d20-b6f4-4e1c0ed60aaf)。
- Mobbin evidence 已在同一次 MCP research 内实际打开检查：左侧 current agent work、左下 Agent log、底部
  composer 与 spatial canvas 同时持续存在；project entry 使用 prompt + recent projects。

## Implementation evidence

- Route：`http://localhost:3008/product-patterns/canvas`。
- Server render：HTTP 200；70,468-byte HTML；确认输出 `data-canvas-node` sticky、reference 与 image nodes，
  Conversation、Otto status、fixed composer 和 fixture-only marker。
- Intended CSS viewport：1440 × 900，device pixel ratio 1。
- Implementation screenshot：未取得。Codex in-app Browser 的 URL policy 拒绝载入该 localhost route；规则明确禁止
  改用另一 browser surface 或 raw automation 绕过，因此没有伪造 screenshot 或另走未经批准的 Playwright。
- Full-view / focused comparison：blocked；缺少本轮 browser-rendered implementation screenshot，不能依代码或 SSR
  HTML 宣称视觉 pass。

## Engineering evidence

- Focused Vitest：11 / 11 通过。
- Full web TypeScript：通过。
- Scoped ESLint：通过（0 error / 0 warning）。
- Next dev route：HTTP 200；只有 repo 既有的 `BETTER_AUTH_URL` local warning。

## Findings

- P0：0（由 tests/typecheck 可证的 structural 层）。
- P1：0（未发现 code-level blocker）。
- P2：视觉与 direct-manipulation browser evidence 尚未取得，因此不能关闭以下验收：1440 × 900 的 overlay
  遮挡、Conversation 展开后的视觉密度、image/sticky/reference 在 100% 与 zoom 后的 pointer drag。

## Required fidelity surfaces

- Fonts / typography：沿用现有 Geist 与 design-system type tokens；视觉未复核。
- Spacing / layout rhythm：实现已改成 Fikirtive main rail + compact content grid；视觉未复核。
- Colors / tokens：新增 UI 只消费 semantic tokens；视觉未复核。
- Image quality / asset fidelity：继续使用已批准 R22 raster assets；未新增 placeholder 或手工 SVG。
- Copy / content：Creation Home、Conversation 与 credits truth 已通过 source/test 检查；视觉 wrapping 未复核。

## Blocker

需要 Founder 在已打开的 localhost preview 中验收，或下一轮 Browser policy 允许本地截图后再跑同 viewport 的
same-input comparison。当前 implementation 可供人工查看，但 Product Design QA 不能诚实标为 passed。

final result: blocked

---

# Founder Home → Creation handoff QA（2026-08-29）

## Source visual truth 与 implementation evidence

- Founder Home source：`apps/web/design-system/patterns/founder-home/selected-direction.png`
  （1487 × 1058 px）。
- Stitch Creation entry source：Mobbin [Starting a chat](https://mobbin.com/flows/a8f6d3c4-0622-4b62-ac13-e02adaa201b4)，
  local evidence `apps/web/artifacts/design-qa/home-creation-handoff/stitch-starting-chat.jpg`（768 × 521 px）。
- Founder Home implementation：`apps/web/artifacts/design-qa/home-creation-handoff/founder-home-1440x900.png`
  （1440 × 900 px；CSS viewport 1440 × 900；devicePixelRatio 1）。
- Creation Home implementation：`apps/web/artifacts/design-qa/home-creation-handoff/creation-home-1440x900.png`
  （1440 × 900 px；CSS viewport 1440 × 900；devicePixelRatio 1）。
- Same-input comparisons：`founder-home-source-vs-implementation.png` 与
  `creation-home-source-vs-implementation.png`（各 2880 × 900 px）。Source 以 center crop normalize 到
  1440 × 900，implementation 保持 1:1 CSS size 后并排比较。
- Focused crop 不需要：本轮改变的是 header CTA、单行 handoff strip 与 Creation entry composition；在 1440px
  full-view 中 copy、control hierarchy 与主要 spacing 已清楚可读。

## Comparison history

1. **Pass 1 — blocked by P1：** 新增的 Link CTAs 使用 `Button asChild`，Base UI 报 4 个 native-button semantic
   errors，dev issues overlay 出现在画面上。视觉可用，但 accessibility semantics 与 console cleanliness 不合格。
2. **Fix：** Navigation CTAs 改为直接使用 Next `Link`，样式只消费共享 `buttonVariants`；保留真实 link role/href，
   不再让 Base UI button wrapper 接管 navigation semantics。
3. **Pass 2 — passed：** 新一轮 Founder Home 与 Creation Home screenshot 无 dev overlay；本轮时间窗内 browser
   console errors 为 0；五个 Creation links 都是无额外 role 的 `<a>`，href 来自 `canvas/review-links.ts`。

## Primary interactions tested

- Home generic `Create` → `/product-patterns/canvas?surface=home`；Creation Home composer 为空、context count 0。
- Home `Continue creating` 两个 recent canvases → full-screen Canvas route。
- Recommended `Create this` → Creation Home with `Review the strongest sales campaign` context。
- Context 清楚可见且 `Remove reference` 可用；移除后 context count 0，Send 仍 disabled，没有 auto-submit。
- Creation Home `Home` → Founder Home reference；Creation Home recent projects → Canvas workspace。
- Browser console：最终复核时间窗 error 0。

## Required fidelity surfaces

- **Fonts / typography：** 继续使用现有 Geist 与 type tokens；新增 microcopy 的 weight、line-height 与 truncation
  在 1440 × 900 清楚，没有新的 wrap 或 overflow。
- **Spacing / layout rhythm：** Home 只增加一条 44px 左右的 handoff strip，没有形成第二套 dashboard；Creation Home
  保留 prompt-first hierarchy，并把 recent work 放在同一 viewport 右栏。
- **Colors / tokens：** 所有 CTA、border、muted surface 与 active nav 来自共享 semantic tokens / `buttonVariants`；
  没有 page-local color。
- **Image quality / assets：** 未新增或替换 media asset；Otto 与 Fikirtive marks 继续来自正式 brand owner。
- **Copy / content：** Home 只说 `Create` / `Continue creating`；完整 Conversation 不出现在 Home。Context 可见、可移除，
  且 exact-credit trust copy 留在 Creation Home。

## Findings

- P0：0。P1：0。P2：0。
- P3：Creation Home 的 starting-point cards 未来可根据真实 merchant data 个性化；当前 fixture copy 足够完成本轮
  information-architecture 验收，不阻塞。

## Engineering evidence

- Focused Vitest：21 / 21 通过。
- Full web TypeScript：通过。
- Scoped ESLint：通过（0 error / 0 warning）。
- Browser route 与两种 handoff state 均通过；console error 0。

final result: passed

---

# Current Home → Creation QA authority（2026-08-29）

当前有效的 handoff QA 是上方 `Founder Home → Creation handoff QA（2026-08-29）`。它补齐了上一轮因 Browser
policy 暂缺的 visual evidence；Canvas R22 本体方向不变。

final result: passed

---

# Canvas R22 convergence QA（2026-08-29）

本节取代上方所有 Canvas QA authority。当前 direction 是 Founder 重新选定的 R22 Canvas；Grok、hybrid 与更早的
Stitch 实现只保留为历史证据，不再决定当前实现。

## Source visual truth 与 rendered implementation

- Source visual：`apps/web/design-system/patterns/canvas/references/r22-canvas-completed-1280x720.jpg`。
- Implementation：`apps/web/artifacts/design-qa/canvas-r22-convergence/implementation-completed-1280x720.jpg`。
- Route：`/product-patterns/canvas`；light theme；completed four-image batch state。
- Source 与 implementation CSS viewport 均为 1280 × 720；browser devicePixelRatio 均为 2；Browser capture
  已归一化为 1280 × 720 px，因此比较中不需要额外缩放或 density correction。
- Full-view same-input comparison：
  `apps/web/artifacts/design-qa/canvas-r22-convergence/full-comparison.png`（2560 × 720 px；左 R22，右 implementation）。
- Focused persistent-surfaces comparison：
  `apps/web/artifacts/design-qa/canvas-r22-convergence/focused-left-comparison.png`（660 × 470 px；左 R22，右 implementation）。
  它将 Otto status 与 Conversation 两个实际 source / implementation crop 组合到同一个输入，足以检查小字、
  padding、status hierarchy、border、radius 与 history density。
- 关键扩展状态：`question-step-1-1280x720.jpg`、`exact-credit-confirmation-1280x720.jpg`、
  `completed-new-generation-1280x720.jpg`，均位于同一 QA artifact folder。

## Required fidelity surfaces

- **Fonts / typography：** 两边使用同一产品 Geist language；project name、Otto title、batch meta、small status、
  artifact label 与 omnibox hierarchy 对齐，没有异常 wrap 或截断。Implementation 保留 Fikirtive 的语义状态 copy。
- **Spacing / layout rhythm：** R22 的 full-screen dotted board、左上 Otto status、左下 Conversation、中央四张
  compact artifacts、底部 640px omnibox、右侧 tool rail 与右下 zoom 全部恢复；persistent controls 无 overlap。
- **Colors / tokens：** background、card、border、shadow、status 与 focus 全部消费正式 design-system tokens；橙色
  只属于 Otto / agent action，没有新增 page-local palette。
- **Image quality / assets：** source 的抽象 screen images 被产品域内真实 gift-box raster assets 替换，比例、crop、
  sharpness 与四方向 density 正确；icons 继续使用项目 icon library，没有 emoji、CSS drawing、inline SVG 或 placeholder。
- **Copy / content：** UI 使用 English sentence case；等待、确认、失败、取消与 unknown-state 的 credits truth 明确。
  `Review fixture only` 在 top bar 集中表达，不再与 composer 重叠。

## Primary interaction evidence

- Ambiguous prompt → 两步 blocking question → decisions 写入 Conversation → `Generate · 2 credits` → Done；
  confirmation 提交后立即消失，未出现第二次付款按钮。
- 选中 artifact → `Edit with Otto`：同一 artifact 进入 composer context，textarea 获得 focus。
- Variations：2 个 image versions 显示 exact 4-credit confirmation；Cancel 后显示 `0 credits charged`。
- Animate：selected image → exact 20-credit confirmation → 6-second video artifact；原 image 保留。
- Conversation：恢复 failed turn 后，顶部 status 同步为 Failed，并显示 `Credits returned`。
- Canvas mechanics：Zoom `100% → 90%`；第一个 artifact 从 `(450,130)` 拖到 `(527.778,174.444)`，证明 pointer
  capture 与 scaled-position calculation 生效。
- Selected-output Share：More → Share selected output → `/product-patterns/canvas?share=selected`；read-only
  view 显示 `View only`。
- Fresh browser tab：0 error、0 warning。

## Comparison history 与 findings

1. **Pass 1 — P2：** Implementation 只有两张 oversized artifact，和 R22 的 compact four-result batch density 不同；
   Otto status 缺少真实 progress steps；底部 fixture label 与 composer 争抢空间；supporting notes 落在 persistent
   Conversation / composer 背后。
2. **Fix：** 恢复 `fixtures.ts` 已定义的 four-output / 8-credit truth；四张 compact artifacts、batch boundary 与
   R22 placement 成为同一初始 state；Otto status 加回 progress steps 和单次 charge truth；fixture truth 移入 top bar；
   sticky / extracted note 回到 R22 空间；omnibox 宽度恢复为 640px。
3. **Pass 2 — passed：** Full-view 与 focused comparison 显示 major-region proportions、persistent control geometry、
   artifact density 与 status hierarchy 已对齐。P0 / P1 / P2：0 / 0 / 0。
4. **P3 / intentional differences：** Gift-box imagery、Fikirtive status copy、exact-credit trust row 与三条 seeded
   Conversation history 是产品翻译，不是 R22 brand / content 的逐像素复制；保留到 Founder 视觉验收。

## Engineering evidence

- Targeted Vitest：10 / 10 通过。
- Scoped ESLint：通过（0 error / 0 warning）。
- Full web TypeScript：通过。
- Production generation、money、persistence、Campaign / Schedule handoff 仍未接入；这是已冻结的 fixture checkpoint
  boundary，不伪装完成。

final result: passed

# Canvas Stitch image/video parity QA（2026-08-29）

本节取代本文件所有旧 Canvas / Grok 结论。当前唯一产品与交互 authority 是已批准冻结的
`apps/web/design-system/patterns/canvas/stitch-image-video-parity-spec.md`：Stitch 负责 agentic
creation 与 spatial Canvas 逻辑；Fikirtive 只翻译为 image/video，并保留 Otto、exact credits 与正式 design system。

## Source visual truth 与 implementation evidence

- Workspace source：`apps/web/design-system/patterns/canvas/references/stitch-canvas-main.jpg`
  （768 × 521 px；Mobbin source screenshot；1×）。
- Create-home source：`apps/web/design-system/patterns/canvas/references/stitch-create-home.jpg`
  （768 × 521 px；Mobbin source screenshot；1×）。
- Workspace implementation：`artifacts/design-qa/canvas-stitch-image-video/workspace-1440x900.png`
  （1440 × 900 px；CSS viewport 1440 × 900；devicePixelRatio 1）。
- Compact desktop post-fix：`artifacts/design-qa/canvas-stitch-image-video/workspace-1280x720-post-fix.png`
  （1280 × 720 px；CSS viewport 1280 × 720；devicePixelRatio 1）。
- Create-home implementation：`artifacts/design-qa/canvas-stitch-image-video/home-1440x900-final.png`
  （1440 × 900 px；CSS viewport 1440 × 900；devicePixelRatio 1）。
- Same-input workspace comparison：`artifacts/design-qa/canvas-stitch-image-video/workspace-comparison.png`
  （1440 × 450 px；source 与 implementation 分别等比放入 720 × 450 cell，不拉伸）。
- Same-input Create-home comparison：`artifacts/design-qa/canvas-stitch-image-video/home-comparison-final.png`
  （1440 × 450 px；同一 normalization）。

Focused crop 未另外创建：左上 current turn、左下 Agent log、bottom omnibox、artifact actions 与 toolbar 在
1440 × 450 comparison 中仍可辨认；交互细节另由 1440 × 900 implementation 原图与 fresh browser DOM 验证。

## Required fidelity surfaces

- **Fonts / typography：** 全部使用产品正式 font 与 text tokens；current turn、Agent log、artifact label、
  omnibox、toolbar 的 weight 与 line-height 清楚，没有异常 wrap 或 truncation。Fikirtive 的 founder-facing
  weight 比 Stitch 稍强，是 brand translation，不是局部 type override。
- **Spacing / layout rhythm：** 保留 Stitch 的 full-screen dotted board、left-top current turn、left-bottom
  Agent log、bottom-center omnibox、object actions、right rail 与 bottom-right zoom。1280 × 720、1440 × 900、
  1920 × 1080 都没有 document overflow；persistent controls 可见且可操作。
- **Colors / tokens：** neutral Canvas、surface、border、shadow、semantic status 与 selection 全部消费正式 tokens；
  coral 只出现在 Otto / agent-owned moment。没有新的 page-local color authority。
- **Image quality / asset fidelity：** gift-box 与 video frame 使用已有真实 raster assets，aspect、crop 与清晰度正确；
  Fikirtive/Otto 使用正式 brand components，icons 使用 Lucide family。没有 emoji、CSS illustration、handmade SVG
  或 placeholder product image。
- **Copy / content：** UI 使用 English sentence case；blocking question、exact credits、cancel/no-charge、refund、
  unknown status、selection context 与 fixture-only boundary 都明确。没有 Grok feed、Discover 或 post-generation
  mandatory Approved gate。

## Primary interactions tested

- `Video prompt → Needs answer → Use latest image → Generate · 20 credits → Working → Done`，Canvas artifact
  数量由 2 增至 3。
- 自由回答仍从唯一 omnibox 进入同一个 turn；paid confirmation 用 turn id 防止 double-submit。
- generation Working 期间的新 prompt 进入 `Queued`；上一轮完成后才恢复为 confirmation。
- Agent log 可展开、折叠并恢复历史 `Done / Failed / Confirming status` turn 到左上 current-turn surface。
- artifact selection、Shift multi-select、pointer-capture drag、Hand pan、zoom、Escape、Delete 与 context chip 可操作。
- `Edit with Otto`、`Create variations`、`Animate`、`Download`、Export、Share 与 remove-from-canvas 均有真实 fixture feedback。
- Project home、recent project、prompt-first start 与 auto-name flow 可达。
- 1440 × 900 和 1920 × 1080 的 scroll size 等于 viewport；fresh-tab console error / warning 为 0。

## Comparison history 与 findings

1. **Pass 1 — P2：** 1280 × 720 的早期实现把初始 artifact cluster 放得过低，artifact footer 会进入 bottom omnibox
   的视觉占用带，降低拖动与选择清晰度。
2. **Fix：** 初始 cluster 从 y=190 调整至 y=130，并将 x positions 收拢到 450 / 730；生成结果继续依照 source
   artifact 向右非破坏式展开。
3. **Post-fix evidence：** `workspace-1280x720-post-fix.png` 与 `workspace-1440x900.png` 显示 artifact footer、
   object toolbar、current turn、Agent log 和 omnibox 均有独立可点击空间。
4. **P3 fix：** Create home 补回 Stitch source 的低对比 dotted field；post-fix 证据为
   `home-comparison-final.png`。
5. P0：0。P1：0。P2：0。Remaining P3：0。

## Engineering evidence

- Canvas + design-system source-of-truth Vitest：15 / 15 通过。
- Full web TypeScript：通过。
- Scoped ESLint：通过（0 error / 0 warning）。
- Next.js production build：通过；repo 未配置 `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` 的既有 local warning
  不影响 fixture-only `/product-patterns/canvas` 编译和页面生成。
- Fresh-tab browser smoke：console error / warning 为 0。

final result: passed

---

# Creation Grok Imagine full-parity QA（2026-08-29）

本轮 authority 是 `apps/web/design-system/patterns/canvas/grok-imagine-full-parity-proposal.md`。Founder 明确确认
“从0开始借鉴”后，旧 Stitch spatial Canvas、draggable nodes、pan/zoom、selection toolbar 与 Agent log 全部退役；
本节取代上方所有 Stitch × Grok hybrid QA 结论成为当前 Creation 验收依据。

## Mobbin source 与同画面 comparison

- Grok Imagine home source：`apps/web/design-system/patterns/canvas/references/grok-imagine/imagine-home.jpg`。
- Grok video progress source：`apps/web/design-system/patterns/canvas/references/grok-imagine/video-generating.jpg`。
- Grok video result source：`apps/web/design-system/patterns/canvas/references/grok-imagine/video-result.jpg`。
- Home prototype：`apps/web/artifacts/design-qa/canvas-grok-full/home-1440.png` 与 `home-1920.png`。
- Image results：`apps/web/artifacts/design-qa/canvas-grok-full/image-results-1440.png`。
- Video progress / result：`apps/web/artifacts/design-qa/canvas-grok-full/video-generating-1440.png` 与
  `video-result-1440.png`。
- Same-image comparison：`apps/web/artifacts/design-qa/canvas-grok-full/home-comparison.png` 与
  `video-comparison.png`；每张上方是 Mobbin source，下方是 Fikirtive prototype。

## Required fidelity surfaces

- **Information architecture：** 左侧 primary navigation、Featured templates、Discover masonry、bottom composer、
  creation conversation、single-result view 与 lightweight History 对应 Grok Imagine 层级。
- **Composer：** 全程只有一个；Image / Video、reference、ratio / duration 与 send 都属于同一 control。
- **Results：** multi-image results 属于 conversation；video 使用独立 single-media view、source thumbnails、media
  progress overlay 与右侧 result actions。
- **Fikirtive ownership：** Brand、Otto、tokens 与 exact-credit confirmation 保留；没有复制 Grok logo、dark theme
  或 subscription UI。
- **Retirement check：** implementation source 不包含 Canvas node、pointer capture、drag/pan/zoom 或 Agent log。

## Browser interaction evidence

- Direct image：prompt → `Generate · 8 credits` → Generating → 4 ready image results。
- Blocking question：Video prompt 无 reference → `Which image should I animate?` → Upload → 20-credit confirmation。
- Cancel：confirmation → Cancel → `Generation cancelled. No credits were used.`，不建立 result。
- Follow-up：已有 result 后 image generation quote 为 4 credits，并建立新 version。
- Image-to-video：image result → `Make video` → `Generate · 20 credits` → dedicated progress view → ready video。
- Result actions：like、retry、download、share、more / Library 均有 prototype feedback；retry 回到下一次 exact
  confirmation。
- History：History → `Hari Raya gifting` → 恢复旧 prompt / result → 同一 composer 可继续。
- Desktop layout：1440 × 900 与 1920 × 1080；1920 下 `scrollWidth === innerWidth`，无水平 overflow。
- Fresh browser log：0 error，0 warning。

## Comparison findings

1. **Pass 1 — P1 direction mismatch：** 初版逻辑已是 Grok，但首页仍有自创 large hero，Featured templates 是
   4 个 landscape cards；single result 没有 Grok 的 source-thumbnail rail，composer 过高。
2. **Fix：** 直接以 Mobbin source 重排为 6 个 portrait templates + Discover，收紧 floating composer；single video
   result 增加 source thumbnails、中央 media、progress overlay 与 vertical actions。
3. **Pass 2 — P2：** blocking question 内重复显示 Otto avatar；New generation 没有完整清空旧 reference；Retry
   只有 toast，没有回到付费确认。
4. **Fix：** question 只保留 conversation-level Otto；New generation 重置 project / turns / results / reference；Retry
   建立新的 exact quote。
5. **Pass 3 — passed：** source-vs-prototype comparison 与全流程 walkthrough 后，P0/P1/P2 为 0。

## Engineering evidence

- Focused Vitest：10 / 10 通过。
- Full web TypeScript：通过。
- Scoped ESLint：通过（0 error / 0 warning）。
- Next.js production build：通过；repo 缺少 `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` 的既有 local warning 不影响
  fixture-only Creation route 编译与页面生成。

final result: passed

---

# Canvas Grok Imagine interaction parity QA（2026-08-29）

本轮 authority 是
`apps/web/design-system/patterns/canvas/grok-imagine-interaction-parity-proposal.md`：Grok Imagine 拥有完整
creation interaction，Google Stitch 只拥有 spatial Canvas shell，Fikirtive 只增加 blocking question 与
exact-credit confirmation。

## Visual evidence

- Stitch spatial source：`apps/web/design-system/patterns/canvas/references/stitch-canvas-main.jpg`。
- Implementation 1440 × 900：`artifacts/design-qa/canvas-grok-parity/workspace-1440x900.jpg`。
- Implementation 1920 × 1080：`artifacts/design-qa/canvas-grok-parity/workspace-1920x1080.jpg`。
- Same-input comparison：`artifacts/design-qa/canvas-grok-parity/source-vs-prototype.jpg`。Source 与 implementation
  各自等比置入 960 × 540 cell 后并排检查。

## Interaction evidence

- Direct generation：`Generate · 8 credits` 只能提交一次；确认后建立新的 `Generating` artifact，1.6 秒后同一
  artifact 进入 `Ready`，conversation receipt 显示 `8 credits charged`。
- Blocking question：`One thing before I create this` → `Bold & celebratory` → 同一 turn 的 compact confirmation；
  自由输入回答也复用同一条 conversation。
- Cancel：confirmation 变成 `Generation cancelled`，明确 `no credits were used`，不建立 artifact。
- Result iteration：selected result 的 `Variations` 建立下一次 exact quote，不覆盖 source。
- Image-to-video：`Make video` 建立 `16:9 · 6 seconds · Selected image attached` 的 20-credit confirmation。
- History/reopen：header 的 lightweight History menu 可定位旧 conversation；有 resultId 的 turn 同时恢复 Canvas selection。
- Free action：`Rename this to Merdeka premium hero` 真实更新 node label、selection context 与 Undo history，不收 credits。
- Canvas mechanics：selected node 从 `(639,153)` 拖到 `(714,208)`；drag、pan、zoom、add、duplicate、remove、
  undo/redo 继续工作。

## Comparison history and findings

1. **Pass 1 — blocked by P1：** Base UI `DropdownMenuLabel` 未放在 `DropdownMenuGroup` 内，打开 History 会进入
   route error boundary。
2. **Fix：** History、context 与 aspect-ratio menu 全部使用同一个正式 Base UI group structure；重新走查三个
   menu 后 fresh browser error log 为 0。
3. **Pass 1 — P2：** 368px conversation card 内的 credits、secondary actions 与 Generate CTA 同行，CTA 在
   1440px capture 中被截断。
4. **Fix：** credits 与 secondary actions 保持一行，exact-credit Generate CTA 改为下方 full-width primary action。
5. **Pass 2 — passed：** 1440 × 900 与 1920 × 1080 下，single conversation、artifact cluster、omnibox、top
   toolbar、right rail 与 zoom controls 不互相遮挡；P0/P1/P2 为 0。

## Engineering evidence

- Canvas interaction parity + design-system SSOT/checklist tests：21 / 21 通过。
- Full web TypeScript：通过。
- Scoped ESLint：通过（0 error / 0 warning）。
- Next.js production build：通过；repo 缺少 `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` 的既有 local warning
  不影响 fixture-only Canvas route 编译与页面生成。
- Fresh browser console errors：0。

final result: passed

---

# Otto conversation branch walkthrough（2026-08-29）

## Scope 与 evidence

本轮在 1440 × 900、devicePixelRatio 1 的 browser-rendered Canvas 中，从 prompt 实际走完 free
action、unsupported guidance、blocking clarification、clarification answer、paid quote、Working、Ready receipt 与
History restore。对应 source of truth 是
`apps/web/design-system/patterns/canvas/README.md` 的 Otto conversation walkthrough addendum。

- Free rename + History：`artifacts/design-qa/canvas-conversation-walkthrough/free-rename-history-1440x900.jpg`。
- Clarifying question + History：`artifacts/design-qa/canvas-conversation-walkthrough/clarifying-question-history-1440x900.jpg`。
- Completed receipt + History：`artifacts/design-qa/canvas-conversation-walkthrough/completed-receipt-history-1440x900.jpg`。
- 三张 implementation capture 均为 1440 × 900 px，CSS viewport 1440 × 900，density 1，同一 light theme、
  同一 fixture project。本轮是 interaction-state comparison，未更改 Stitch/Fikirtive visual target；因此使用同一
  implementation frame 比较三种 Otto states，不重复生成 source-vs-shell montage。

## Comparison history

1. **Pass 1 — blocked by P1：** Otto 回复 `Done — I renamed the selected result`，但 Canvas label 仍是
   `Warm gift-box hero`。这是虚假成功反馈，会直接破坏 Founder 对 agent 的信任。
2. **Pass 1 — blocked by P2：** Otto 提问后，Founder 回答 `Calm and premium`，下一个 quote 没有明确
   承接该答案，看起来像两个无关 turn。
3. **Fix：** free rename 现在真实更新 selected artifact、Canvas label 与 composer context，并进入同一
   Undo history；free move / arrange 也只在实际改变 Canvas 后回复完成。Clarification answer 会以
   `Got it — <answer>` 承接，再展示下一个 exact quote。未实作的 Group 返回 honest guidance，
   不改 Canvas、不收 credits。
4. **Pass 2 — passed：** 下方全部 browser interaction 通过；没有剩余 P0/P1/P2。

## Browser interaction evidence

- Initial quote：`Ready to generate 4 directions`，Generate CTA 可见。
- Rename：`Warm gift-box hero → Merdeka hero`；Canvas label 与 composer context 同步；Undo 恢复原名。
- Move：selected node 从 `(639,153)` 到 `(693,189)`；Undo 恢复 `(639,153)`。
- Arrange：手动拖到 `(759,233)` 后，Otto 恢复到 `(639,153)`。
- Unsupported Group：明确回复 `Grouping is not available yet`，并提供 Arrange / Move 替代方案。
- Clarification：`One thing before I create this` → Founder `Calm and premium` →
  `Got it — Calm and premium` + compact quote。
- Paid lifecycle：`Ready quote → Generating 4 product-photo directions → Your result is ready`；完成后
  Generate CTA 消失，receipt 显示 `8 credits charged`。
- History：7 个 turns；可分别恢复 rename result、clarifying question 与 completed receipt。
- Browser console errors：0。

## Required fidelity surfaces

- **Typography / copy：** question、guidance、quote 与 receipt 的 hierarchy 清楚；English sentence case 一致。
- **Spacing / layout：** History 7 turns 使用原有 scroll region，不遮挡 omnibox 或 current response。
- **Colors / tokens：** 未新增 page-local color；Working、Ready、guidance 继续使用正式 semantic tokens。
- **Images / assets：** 会话修正不改变 asset source、crop 或 quality。
- **Interaction honesty：** 所有 `Done` 都对应可见 Canvas mutation；不支持的动作不伪装成成功。

## Engineering evidence

- Canvas focused tests：9 / 9 通过。
- Canvas + design-system SSOT tests：14 / 14 通过。
- Full web TypeScript：通过。
- Scoped ESLint：通过（0 error / 0 warning）。
- Next.js production build：通过；repo 缺少 `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` 的既有 local
  warning 不影响 fixture-only Canvas route。

final result: passed

---

# Canvas functional mechanics QA（2026-08-29）

本轮不改 creation-flow authority：Grok Image 继续负责 creation logic，Stitch 继续负责 full-screen
spatial workspace，Fikirtive design system 与 Otto orange 不变。本轮只验证 Founder 要求的 Canvas
direct-manipulation mechanics。

## Source visual truth 与 implementation evidence

- Source：`apps/web/design-system/patterns/canvas/references/stitch-canvas-main.jpg`
  （768 × 521 px；source screenshot）1。
- Initial implementation：`artifacts/design-qa/canvas-functional/canvas-functional-1440x900.png`
  （1440 × 900 px；CSS viewport 1440 × 900；devicePixelRatio 1）。
- Direct-manipulation state：`artifacts/design-qa/canvas-functional/canvas-functional-drag-pan-1440x900.png`
  （1440 × 900 px；CSS viewport 1440 × 900；devicePixelRatio 1）。
- Same-input full-view comparison：`artifacts/design-qa/canvas-functional/source-vs-functional-1440x900.png`
  （2880 × 900 px）。Source 等比 cover 到 1440 × 900 cell，implementation 保持 1:1 CSS size；两者
  并排后在同一 visual input 内检查。
- 本轮未做 focused crop：变更只影响 board/node transform 与 tool states，相关 controls 在 1440px full-view 中
  清晰可读；未修改 typography、asset crop 或 dense panel details。

## Required fidelity surfaces

- **Fonts / typography：** 没有新增字体或 page-local type rule；toolbar、asset label、History 与 composer 继续使用
  正式 Geist/text tokens，没有新的 wrap、overflow 或 truncation。
- **Spacing / layout rhythm：** 节点位置改为 `translate3d`，board 使用 camera translate + scale；persistent
  top bar、Otto response、History、omnibox、tool rail 与 zoom controls 在拖动前后都不互相遮挡。
- **Colors / tokens：** selection ring、drag shadow、tool pressed state、disabled state 继续来自正式
  border/shadow/button tokens；没有新增散落颜色。
- **Image quality / asset fidelity：** node 拖动、复制和新增保持原有真实 raster asset、crop 和 aspect ratio；
  没有 placeholder、emoji、CSS drawing 或手工 SVG。
- **Copy / content：** 工具栏只保留已实作的 `Select`、`Pan`、`Add image`、`Add video`、
  `Generations` 与 `Use selected output`；未实作的 Marquee / Group 已移除，没有假 affordance。

## Primary interactions tested

- Select mode：第一个 node 从 `(396, 153)` 拖到 `(516, 233)`；放开后显示 `Saving…`。
- Node drag Undo / Redo：Undo 恢复 `(396, 153)`，Redo 恢复 `(516, 233)`。
- Pan mode：从 artifact 上开始拖动，3 个 nodes 都精确平移 `(+100, +60)`，相对位置不变。
- Add image：`3 → 4`；Undo：`4 → 3`；Redo：`3 → 4`；Add video：`4 → 5`。
- Duplicate：`5 → 6`；Remove from canvas：`6 → 5`。
- 空白处点击后 selected nodes `1 → 0`，contextual toolbar 正常消失。
- Zoom：`100% → 90% → 100%`；min/max 和 reset disabled state 正确。
- Browser error log：0。

## Comparison history 与 findings

1. **Pass 1 — passed：** 并排 comparison 中，Stitch 的 infinite-board geometry、persistent top/bottom controls、
   right rail 与 spatial artifact cluster 都仍在 Fikirtive implementation 中成立。
2. 本轮没有因比较发现 P0/P1/P2，因此没有视觉返工 iteration。
3. P0：0。P1：0。P2：0。
4. P3 / residual gap：本 route 是 fixture-only，Undo history 与 viewport 不跨 reload 持久化；这是已登记的
   production-integration non-goal，不是本轮 prototype 阻塞。

## Engineering evidence

- Focused Vitest：8 / 8 通过。
- Full web TypeScript：通过。
- Scoped ESLint：通过（0 error / 0 warning）。
- Next.js production build：通过。Repo 缺少 `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` 的既有 local warning
  不影响 fixture-only Canvas route 编译与页面生成。

final result: passed

---

# Current Canvas QA authority（2026-08-29）

当前唯一有效的 Canvas QA 是本文件中的 `Canvas R22 convergence QA（2026-08-29）`，对应已批准冻结并带 R22
amendment 的 `apps/web/design-system/patterns/canvas/stitch-image-video-parity-spec.md`。本文件其余 Grok、hybrid、
旧 Stitch 与 functional-mechanics Canvas sections 都是历史证据，不再决定当前产品方向。

final result: passed

---

# Current Canvas QA authority · refinement update（2026-08-29）

当前唯一有效的 Canvas QA 是上方 `Canvas interaction refinement QA（2026-08-29）`。实现与工程检查已完成，
但因本轮 localhost Browser screenshot 被 URL policy 拒绝，尚缺 visual/direct-manipulation evidence；旧的 passed
sections 只证明对应历史版本，不覆盖本轮 UI。

final result: blocked

---

# Current Home / Creation lab / Canvas QA authority · final update（2026-08-29）

当前有效证据是本文件中的 `Home → Creation lab → Canvas information architecture QA
（2026-08-29）`。它取代所有把创作入口称为 `Creation Home` 的历史记录，并与已批准
spec 的 §14 addendum 对齐。当前关系只有 `Home → Creation lab → Canvas workspace`。

final result: passed

---

# Current Home / Creation / Canvas QA authority · Unified Home final（2026-08-29）

上面的 `Home → Creation lab → Canvas` authority 已被 Founder 随后的明确方向反转与“确定。”批准取代。
当前唯一有效的 information architecture 与 QA 是本文件中的
`Unified Founder Home + embedded Creation module QA（2026-08-29）`：
`Founder Home（内嵌 creation module）→ full-screen Canvas → Founder Home`。

final result: passed

---

# First-class Create workspace correction QA（2026-08-29）

Founder 澄清：`Create` 不是 Home 的展开状态，而是像 Schedule 一样与 Home 同级的专用 product area。
本轮在 standing direction-change reminder 后获 Founder “是的。”批准；当前关系是
`Home → Create workspace → full-screen Canvas → Create workspace`。

## Source visual truth 与 implementation evidence

- Selected Create source：
  `apps/web/artifacts/design-qa/home-creation-handoff/creation-home-1440x900.png`
  （1440 × 900 px；此前已看过的 Create 方向；density 1×）。
- Implementation：
  `apps/web/artifacts/design-qa/first-class-create/create-workspace-1440x900-final.png`
  （1440 × 900 px；CSS viewport 1440 × 900；devicePixelRatio 1）。
- Full same-state comparison：
  `apps/web/artifacts/design-qa/first-class-create/comparison-create-workspace-full.png`
  （2880 × 900 px；左 source，右 implementation；两侧 1:1，不拉伸）。
- Focused content comparison：
  `apps/web/artifacts/design-qa/first-class-create/comparison-create-workspace-focus.png`
  （2260 × 650 px；左右都从 x=235、y=45 裁出 1130 × 650 的 Create 主内容）。这一 crop 用于检查
  H1、composer、recent canvases、starting points、typography、padding、radius 与 shadow；sidebar / topbar 在 full
  comparison 中清晰可读。

## Required fidelity surfaces

- **Fonts / typography：** 延续 Geist 与正式 text tokens；Create heading、helper copy、composer、recent row 与
  starting-point hierarchy 对齐 source，没有异常 wrap、overflow 或 truncation。
- **Spacing / layout rhythm：** 同一个 application shell 内，Create 拥有独立 H1、两栏 main card 与三张 starting-point
  cards；不显示 Home marketing chart。1440 × 900 下 persistent sidebar、topbar、Otto launcher 与 content 无 overlap。
- **Colors / tokens：** background、card、border、muted、focus、shadow 与 Otto coral 全部消费现有 design-system
  owners；没有 page-local palette。
- **Image / icon fidelity：** Otto 使用正式 `OttoAvatar`，Fikirtive 使用正式 shell brand，actions 使用既有 Lucide
  family；没有 placeholder、emoji、CSS art、handmade SVG 或新增 raster 需求。
- **Copy / content：** breadcrumb、H1 与 active nav 统一是 `Create`。页面没有 `Home` heading、marketing-health
  content 或 `Creation lab` 名字；charge copy 明确付费确认发生在 Canvas。

## Comparison history 与 findings

1. **Earlier direction — blocked by P1：** `/founder-home?intent=create` 只在 Home 内展开 composer，点击主导航
   `Create` 后仍看到 Home heading、marketing chart 与 Home active state；这违反 first-class destination 心智模型。
2. **Fix：** 新建 canonical `/product-patterns/create` review route 与 `CreateWorkspaceReference`；Home 只保留轻量
   handoff，旧 Home intent 和 `surface=lab` 都 redirect 到 Create，Canvas Back 改为 `Back to Create`。
3. **Post-fix pass — passed：** full 与 focused comparison 保留已选 Create composition；implementation 只做现有
   design-system fidelity 更新，没有改变 source 的信息层级。
4. P0：0。P1：0。P2：0。P3：0。

## Primary interactions tested

- Sidebar `Home → Create`：route、breadcrumb、H1 与内容面全部改变；Home dashboard 不出现在 Create。
- Starting prompt chips：会更新 prompt 与 Image / Video mode；Send 进入 Canvas question/confirmation。
- Recent Canvas：打开 full-screen Canvas，并保留 Conversation。
- Canvas `Back to Create`：返回 canonical Create workspace。
- Home `Create this`：把 recommendation context 带入 Create，context 可见且可移除，不自动提交。
- Legacy `/founder-home?intent=create` 与 `/canvas?surface=lab`：redirect 到 canonical Create，并保留 context。
- Fresh-tab browser：console error 0，warning 0。

## Engineering evidence

- Focused web Vitest：4 files，48 / 48 通过。
- Full core Vitest：58 files，1441 / 1441 通过。
- Web TypeScript、core build、scoped ESLint 与 `git diff --check`：通过。
- Prototype 保持 fixture-only；没有 push、deploy、production generation、money 或 persistence mutation。

final result: passed

---

# Current Home / Create / Canvas QA authority · first-class Create final（2026-08-29）

上面的 `Unified Founder Home` authority 已被 Founder 随后的明确澄清与“是的。”批准取代。当前唯一有效的
information architecture 与 QA 是本文件中的 `First-class Create workspace correction QA（2026-08-29）`：
`Home → first-class Create workspace → full-screen Canvas → Create workspace`。

final result: passed

---

# Current Creation QA authority · Stitch-minimal pass（2026-08-30）

当前有效的 information architecture 仍是
`Home → first-class Create workspace → full-screen Canvas → Create workspace`；交互层则由本文件中的
`Stitch-minimal Creation interaction pass（2026-08-30）` 取代旧的 Create / Canvas density。
自动化工程检查已通过，但本轮缺少同 viewport、同 state 的 rendered comparison，所以视觉 QA 保持 blocked，
等待 Founder 在实际页面验收或浏览器权限恢复后补齐证据。

final result: blocked

---

# Canvas design-system compliance audit（2026-08-30）

Founder 批准在 1440 × 900 走一次完整 QA，并把问题聚焦为：Canvas 的 components 是否全部消费 Fikirtive
design system。当前 run 已捕捉并检查 Create idle、needs answer、credits confirmation、generating、completed、
Conversation、Variations popover 与 actions menu；浏览器 console error / warning 为 0。

完整 evidence、8 张截图与 Before / After remediation 表：
`apps/web/artifacts/design-qa/canvas-ds-audit-2026-08-30/audit.md`。

结论：颜色、状态色、阴影、品牌资产与多数 Base UI actions 已合规；但 28px `rounded-xl` 绕过 12px
`--radius-card`、7 个 raw buttons、1 个 raw textarea、typography / motion literals 与 Otto filled-button 3.50:1
small-text contrast 仍未收口。现有 tests 通过，但 source-of-truth guard 尚未覆盖这些 drift。

final result: blocked

---

# Current Canvas QA authority · design-system convergence passed（2026-08-30）

上面的 blocked audit 已由 Founder 批准的 convergence pass 修复。当前有效证据是
`apps/web/artifacts/design-qa/canvas-ds-audit-2026-08-30/audit.md` 的 `Post-fix verification`：
Create 与 Canvas 的 8 个主要状态已在 1440 × 900 重跑；Canvas pattern 不再含 raw visible controls、legacy
surface radius、arbitrary type / tracking 或 local motion literals。Otto coral button 使用 brand ink，实测 4.997:1；
Canvas drag、Conversation、popover、menu、fixed-panel geometry 与 browser logs 全部通过。

这项 QA 只证明当前 Create / Canvas pattern 已消费正式 design system；不把整个 app 的迁移率误报为 100%。

final result: passed

---

# Home analysis detail · visual direction 3（2026-08-31）

Founder 已批准并冻结 `apps/web/design-system/patterns/founder-home/home-analysis-spec.md`，并选择视觉方向 3。
本轮只实现 `home.analysis` detail 与 Home entry / return state；没有重做已验收的 Home overview，也没有恢复
Campaigns、Schedule 或独立 Analytics product area。

## 同 viewport 比较

- Founder-selected target：`apps/web/design-system/patterns/founder-home/home-analysis-selected-direction.png`
  （1487 × 1058）。
- Browser implementation：`apps/web/design-system/patterns/founder-home/home-analysis-implementation.png`
  （1487 × 1058；CSS viewport 1487 × 1058）。
- Full side-by-side：`apps/web/design-system/patterns/founder-home/home-analysis-comparison.png`。
- Focused main-content side-by-side：`apps/web/design-system/patterns/founder-home/home-analysis-comparison-focus.png`。

目标与实现保持相同的信息顺序：Back / subject → inherited filters / freshness → plain-language conclusion →
headline metric → one explanatory chart → What this means / three evidence items → Next step / Create / Ask Otto /
progressive breakdown。实现保留正式 240px application shell 和 canonical black primary action；视觉稿中较窄的
概念侧栏与蓝色 mock primary 没有覆盖已批准的 application-shell / design-token authority。

## Fidelity 与 accessibility

- Typography、spacing、divider、surface、icon、status 与 focus 全部消费现有 Fikirtive tokens / primitives；没有
  page-local button、card、chart、drawer 或色值 authority。
- 结论与主指标在第一视区；chart 只保留 Day / Week、tooltip 与三个 evidence markers，没有 KPI wall 或 arbitrary
  report builder。
- 三条 evidence 在同一行稳定排布；source label 比 visual mock 重复三次 `Strong evidence` 更可验证；整体 evidence
  strength 仍在 section header 清楚显示。
- Desktop-only boundary 由 Home 与 analysis 共用一个 component；keyboard names、combobox labels、expanded state、
  focus ring 与 semantic headings 均可读。
- 1487 × 1058 无 clip、overlap、broken wrap 或 persistent-control collision；mobile layout 是 frozen spec 的 non-goal，
  小视窗显示 deliberate desktop-required state。

## Primary interactions 与 required states

- Home `What changed` 三个 driver、marketing-health heading、Top performer rows、channel rows 与 Source completeness
  全部进入同一个 analysis template，并保留 subject / metric / source / filter context。
- Detail date range 从 30 days 改为 7 days 后 URL 与 chart 更新；Back 仍恢复 Home 原本的 Last 30 days、comparison、
  customized layout 与 `#what-changed` focus。
- Day / Week、chart tooltip、View breakdown open / close、breakdown dimension 均可操作。
- `Ask Otto` 打开正式 panel，并预填 subject、period、conclusion、evidence strength 与 snapshot time。
- `Create a variation` 进入 canonical Create，显示可移除 analysis snapshot；没有自动 submit 或 charge。
- Top performer 显示具体 subject、source、metric 与唯一 Create action；Data health 显示唯一 Manage connections action。
- Ready、partial、insufficient、error、loading 五种状态全部 browser-rendered；insufficient / error 有真实 recovery actions。
- Browser console error / warning：0。

## Engineering evidence

- Scoped ESLint：0 error / 0 warning。
- TypeScript：通过；开发 cache 曾产生一次被截断的 `.next/dev/types/validator.ts`，重新生成 route types 后 clean pass。
- Targeted Vitest：3 files，19 / 19 通过。
- Design-system adoption audit：执行通过；全 app 当前为 138 / 258 product files（53.5%），本项 analysis surface
  全部使用 canonical primitives，不把全 app 迁移率误报为完成。
- Next.js production build：exit 0；repo 未配置 `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` 的既有 auth warnings 仍出现，
  但 product-pattern route 编译、type collection 与 page generation 完成。

P0：0。P1：0。P2：0。P3：0。

final result: passed
