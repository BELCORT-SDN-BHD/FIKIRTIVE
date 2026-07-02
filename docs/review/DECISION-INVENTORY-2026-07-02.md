> **性质**:给 agent 的深度参考(总蓝图 `docs/BLUEPRINT.md` 的原料层)。大变更后由总审查员更新或重生成 —— 这一层**允许**演进。

# FIKIRTIVE 产品决策总清单(总蓝图原料)— 完整 harvest

**来源**:`docs/superpowers/specs/` 全部 53 个文件 + `docs/superpowers/plans/` 全部 64 个文件 + `docs/ux-audit-2026-06-26-otto.md` + `docs/audit-2026-07-02-full.md`(头部)。基线 worktree ≈ origin/main `019b552`(#106)。
**状态词汇**:SHIPPED(已上线)/ DORMANT(已合并、待某事激活)/ IN-FLIGHT(进行中)/ PLANNED(已定案未建)/ PARKED(暂停待恢复)/ DEFERRED(明确"以后")/ EXPLICITLY-REJECTED(明确"不要")/ SUPERSEDED(被后续方向取代)/ RETIRED(已退役删除)。

---

## 0. 北极星与总原则(锁定的产品方向)

| 决策 | 内容 | 状态 | 记录文件 |
|---|---|---|---|
| **Otto = 超级员工 (super-employee)** | "Otto is your (this brand's) super-employee… You just talk to Otto. That is the product." Otto = "the Claude Code of marketing"。五要素:技能注册表 / 记忆(store-infinite recall-finite)/ 异步工厂 / 人工闸(花钱+不可逆才问)/ 分阶段隔离 | 锁定(concept locked, 三方独立 review 验证 2026-06-24) | `specs/2026-06-24-fikirtive-product-concept.md` |
| **一个 app、没有两扇门 (no two doors)** | "Supersedes the earlier 'two doors (/simple + /pro)' framing. **There are no two doors.**" Pro/agency 是后加的层,不是并行路由树 | 锁定 | 同上 |
| **Otto Operating Contract(五条铁律)** | ① 透明计费、只用 credits(never dollars)② approve before spend ③ status-grounded honesty(失败自动退款、retry 不双扣)④ suggestion-button 引导 ⑤ One Otto everywhere(新能力=新 skill) | 锁定 | `specs/2026-06-26-otto-ideal-experience-design.md` |
| **创始人三优先级** | 顺序:**安全 > 效率 > 非常容易管理(founder-manageability, file-system style)** — G7 起所有设计的尺子 | 锁定 | `specs/2026-06-28-g7-otto-ad-write-v1-design.md` §2 |
| **钱路神圣不可动** | money-in = `grantCredits` only;spend path(reserve/settle/genRequest gate/startGen/idempotency/provider call)任何改动必过 money-safety-review;"ask before spending real money — the ask IS the cap" | 锁定、贯穿全部 plans 的 Global Constraints | 几乎每个 plan 头部;`specs/2026-06-28-SESSION-HANDOFF.md` §7 |
| **Canvas 成为家 (canvas-as-home)** | WHAT-pass #45:"canvas becomes the home (one door)",现有工具逐步折进去 | SHIPPED(G1, PR #48/#60 栈) | `specs/2026-06-27-otto-feature-decisions.md`、`specs/2026-06-27-g1-canvas-spine-design.md` |
| **保留 `@openai/agents` runtime,不换 HERMES** | "Keep the existing runtime; do NOT swap to HERMES… borrow its ideas only" | 锁定 | `specs/2026-06-24-fikirtive-product-concept.md` §3.1 |
| **语言约定** | skill 文档/spec 用华语方便创始人复审;生成 prompt 一律英文(模型英文调优);UI 文案 sentence case、no em-dashes;卡片 chrome 英文 | 锁定 | `specs/2026-07-01-otto-creation-experience-design.md`、`plans/2026-07-02-otto-storyboard-f2-render.md` |
| **设计系统 = Grok-bright(.gb + shadcn)** | 近白 #FCFCFC、ink #0A0A0A、**coral #EC5828 = OTTO/agent 专用**、语义色只表状态、Geist 字体;"design is LOCKED — conversion, not redesign" | SHIPPED(#69–#80,main `313eb27` 单一 .gb 系统) | `specs/2026-06-30-full-shadcn-migration-strategy.md`、`specs/2026-06-29-UI-REWORK-ENGINEER-HANDOFF.md` |

---

## 1. 创始人逐项决策记录(2026-06-27 feature-decisions — 45 项 WHAT + 42 项 HOW + 分组顺序)

文件:`docs/superpowers/specs/2026-06-27-otto-feature-decisions.md`(唯一的逐项"要/不要/以后"档案)

### 1a. WHAT pass(45 项,图例:要=include · 不要=skip · 以后=later · 已有=exists)

- **A 组(agent & canvas)**:1 Agent mode=已有 · 2 无限画布=要 · 3 canvas 图像生成=要 · 4 图→视频 animate=要 · 5 文字/设计节点=要 · 6 一项目多 agent 并行=要 · 7 结构化 intake/brand brief=要 · 8 快速填 brief 模板=要 · 9 可见 agent 状态=要 · 10 starter prompt chips=要 · 11 项目自动创建+项目级会话=要 · 12 参考一致性(同模特/脸)=要(via @reference)
- **B 组(web research)**:13 UGC 多级流水线=要 · 14 web research/品牌 grounding=要
- **C 组(单资产编辑器)**:15 detail/edit 页=要 · 16 crop=要 · 17 aspect-ratio 预设=要 · 18 regenerate=要 · 19 animate(detail 页)=要 · 20 video extend(+6s/+10s)=要 · 21 make video=要 · 22 upscale=要 · 23 视频音频=要 · 24 编辑 composer 带 @reference=要 · 25 variant stack=要 · 26 favorite+反馈=要 · 27 删除=要 · 28 分享/copy link=要
- **D 组(browse/library)**:29 模板库+模板 modal=要 · 30 带提问步骤的模板=要 · 31 history/library 页=要 · 32 discover feed=要
- **E 组(其他 Grok 模块)**:**33 Build(终端 coding agent)=不要** · **34 独立通用 Chat=不要**(agent+project 管理会话)· **35 Spicy/18+ NSFW=不要** · 36 一键发布=要(要按钮/位置,平台灵活——Meta/IG,不必 X)· 37 Settings=要(自己设计,不抄 Grok)· 38 Tasks/定时自动化=要 · 39 订阅/计费/用量门=要(钱路 sacrosanct:in=grantCredits,Stripe=Phase 4)
- **F 组(四大 vector)**:40 广告 connector=要,**多平台:Meta+TikTok+Lazada+Shopee、本地化(SEA/马来西亚)** · 41 广告数据分析=要(多平台)· 42 Brand Brain=要加强 · 43 auto-video(agent 批量出 campaign 视频)=要
- **G 组(横切)**:44 模型选择=起步固定 1 图+1 视频、无用户选择器,架构留 1–2 个后加位 · 45 canvas 成为家
- **⚠️ 创始人注(item 39)**:HOW pass 前"re-audit the entire current codebase"(已执行,= 同文件的 current-state map)

### 1b. HOW pass(42 项:复用 11 / 优化 12 / 重建 19)

- **复用(11)**:3,4,9,11,18,19,21,23,25,27,39(钱路"production-grade, audited — do NOT touch")
- **优化(12)**:1 agent core,7 intake,8 brief 模板,10 chips,12 @reference 一致性,15 detail 页,17 aspect,24 composer,28 share,31 library,44 模型选择(env 化+spend-time 校验),45 canvas-as-home
- **重建(19)**:2 canvas 引擎(React Flow),5 文字节点,6 多 agent,13 UGC 流水线,14 web research,16 crop,20 extend,22 upscale,26 favorite,29/30 模板,32 discover,36 发布按钮,37 settings,38 定时任务,40 广告 connectors(逐平台独立 PR+重安全测试、排最后),41 广告分析,42 Brand Brain v2,43 批量 auto-video

### 1c. 分组顺序(创始人拍板)

**G1 canvas spine → G2 单资产编辑器 → G3 更聪明的 agent(research/intake/@reference/Brand Brain v2)→ G4 campaign 自动化(UGC/批量视频/多 agent)→ G5 library/模板/settings/tasks → G6 connectors/发布/分析(最后,风险)**。约束:G1 必须最先(spine),G6 必须最后(钱/平台风险);#39 钱路全程不动。

---

## 2. Otto agent 核心(brain、skill 框架、聪明化)

| # | 功能(中/英) | 一句话 | 状态 | 文件 · 关键决策 |
|---|---|---|---|---|
| 2.1 | **Agents SDK 迁移** / Otto → OpenAI Agents SDK | 手搓 planner 换成 `@openai/agents` 多步 agent;`packages/otto`;RunState 存自家 Postgres;Otto-LLM 花费用 reserve→settle 计入 credits;`generate` 是唯一花钱 tool(needsApproval);cowork→otto 改名(幂等键前缀迁移=钱路变更、单独 gated diff);出图后 worker 自动回灌 verdict turn | SHIPPED | `specs/2026-06-22-otto-agent-sdk-migration-design.md`(拒绝 Vercel EVE:lock-in/beta/Node24);`plans/2026-06-22-otto-agents-sdk-migration.md`。三处钱机器改动:(A) 变额结算 (B) 幂等索引谓词迁移 (C) 所有付费 LLM 入口计费 |
| 2.2 | **Otto Skill Framework** / `defineOttoSkill()` | 3 字段声明 `cost/effect/reach` → 机械推导 `needsApproval = spend ∥ (write∧external)`;缺字段=最危险值(fail-closed);spend 必带 idempotencyKey;参数禁身份键;CI fence 禁 skills import fal/reserveCredits;registry 自动接线 + CATALOG.md | SHIPPED(PR #28 merged 2026-06-26;registry 现 15 skills) | `specs/2026-06-26-otto-skill-framework-design.md`;`plans/2026-06-26-otto-skill-framework.md`。触发条件=产品概念文件的"skill #6 前建 scaffold" |
| 2.3 | **创作体验总设计** / 意图→分镜→执行(A–G blocks) | 目标流程:①刨根问底(硬门)→②出分镜($0)→③闸① 首帧图(便宜、单独审批)→④闸② make all 视频(贵、总审批)→交付 N 个独立成片(拼接以后再说)。"Otto 聪明=流程一半 + prompt 质量一半" | 主设计文件;各 block 状态见下 | `specs/2026-07-01-otto-creation-experience-design.md`。**2026-07-02 复审砍掉:B(clarify 卡片=UI 糖 YAGNI)、C(recallBrandFact=brandContext 已每轮注入)**;proposePack 补 goal 门 |
| 2.4 | **Block 1:requires 资讯门** / 刨根问底硬门 | `defineOttoSkill` 加 `requires: {field, question}[]`;缺资讯 → 跳过 execute 返回 `needMoreInfo` 让 Otto 纯文字追问;用户可显式豁免("不需要"/"没有");propose/proposePack 要求 `goal` | SHIPPED(PR #83;proposePack 门随 #91 补) | `plans/2026-07-01-otto-requires-info-gate.md` |
| 2.5 | **Block D/E:prompt 精通** / `seedreamPrompt` + `seedancePrompt` | 两个 $0 确定性装配 skill,结构化意图→契合模型偏好的英文 prompt。创始人决策:①输出英文 ②无面向用户 requires(用户不懂摄影,Otto+skill 负责手艺)③视频默认 clean-footage 负向(图不加)④reference=措辞+身份锁定不搬像素 ⑤主动确定性装配、每模型一个 skill ⑥这两个 skill 成为 seedream/seedance **唯一 prompt 权威**(方案 B+ 已落地:`prompt-skills.ts` 单一来源,有专属 skill 的 family 跳过旧 directive) | SHIPPED(PR #91;decision-6 = PR #98) | `specs/2026-07-01-otto-prompt-mastery-seedream-seedance-design.md`;`plans/2026-07-01-otto-prompt-mastery-skills.md` |
| 2.6 | **Block F:分镜卡** / `STORYBOARD_CARD` + `proposeStoryboard` + 逐帧编辑 + 闸① | 有序分镜卡(每镜头 shotId+首帧 prompt+视频 prompt);创始人拍板:①一整块做 ②**v1 不做连贯**(镜头独立、首帧可并行)③新建卡不塞 proposePack ④闸① 复用 `generate`(**Fable 终审:每镜头铸子 GEN_CARD、fresh `cowork:<childCardId>` key;禁止复合 key;重出=再铸一张**)⑤v1 全套编辑(改字清图/增删/重排) | IN-FLIGHT:F1 后端 $0 SHIPPED(PR #99);F2 渲染、F3 编辑=plans 已写(2026-07-02);F4 闸① 首帧图(花钱)待建 | `specs/2026-07-02-otto-storyboard-card-design.md`;`plans/2026-07-02-otto-storyboard-f{1,2,3}-*.md` |
| 2.7 | **Block G:两道闸执行** / 闸② make all 视频 + 连贯模式 | 不连贯=并行一次做完;连贯=顺序链式(末帧→下首帧)逐镜头确认;循环调现有 `generate`,钱路零改;碰钱走 money-review | PLANNED(F 之后) | `specs/2026-07-01-otto-creation-experience-design.md` §4.2 |
| 2.8 | **流式聊天** / Otto chat "feels like Claude" | 即时回显+token 流+live 状态线+inline tool-part 卡片;Vercel AI SDK + Route Handler;founder-first flag(临时脚手架,验证后删);生成仍走 worker 异步 | SHIPPED(#84 把 gate 全量放开给所有用户) | `specs/2026-06-25-otto-chat-streaming-design.md`、`-research.md`;`plans/2026-06-25-otto-chat-streaming.md` |
| 2.9 | **生成信任修复** / Otto Generation Trust | 卡片状态由真实 GenJob 终态推导(working/done/failed);失败卡="没做成、没扣你钱、retry 不会双扣";纯 client state,不动 worker/退款 | SHIPPED(audit roadmap 一部分) | `plans/2026-06-26-otto-generation-trust.md` |
| 2.10 | **参考图 vision + i2v 解耦** / reference attachment | 创始人 3 拍板:①方案 A(Otto 看懂图 + 拖图不再强制变视频)②不分步、尽快全量(接受风险)③视频当参考先不做(等产品信号)。上线双门:money-safety-review + 真机 happy path | SHIPPED(PR #84 `87519aa`) | `specs/2026-07-01-otto-reference-vision-design.md`;`plans/2026-07-01-otto-reference-vision.md` |
| 2.11 | **视频抽帧参考** / video-frame-as-reference (抽帧) | 上传按钮收视频→浏览器内选帧面板(滑块、默认 10% 位置、1600px 上限、JPEG 0.92)→帧走现有图片参考路径;零后端/零钱路 | SHIPPED(随 PR #84) | `specs/2026-07-01-otto-video-frame-reference-design.md`;`plans/2026-07-01-otto-video-frame-reference.md` |
| 2.12 | **整段参考视频** / whole-clip reference video (v1) | 选帧面板加"Use whole video"→新字段 `referenceVideoGenerationId`(与图片参考平行、互斥)→Seedance 2.0 `reference_video`。创始人 3 拍板:①通用不预设用法 ②**真人脸认证流程直接 SKIP**(被拒→fail-closed 退款+友好报错)③输入片长 2–10s 上限护 margin。收费不变(720p=7cr);上线双门:money-review + 付费实测(花钱前先问) | IN-FLIGHT(approved-for-planning,plan 已写 2026-07-02) | `specs/2026-07-02-otto-reference-video-design.md`;`plans/2026-07-02-otto-reference-video.md` |
| 2.13 | **多参考图条件化** / multi-reference conditioning (Seedream) | `byteplus.ts` 只发第 1 张→改发整个数组(verify-first 已证 Ark `image` 收数组;10+1≤15 恒安全);只改图片路;创始人选"code now, verify at dev-flip"(不先花钱 probe) | IN-FLIGHT(verified → implementing;task_dc06ac5a) | `specs/2026-07-02-multi-reference-conditioning-design.md` |
| 2.14 | **Brand Brain / 品牌记忆** | 概念文件定义 memory=store-infinite recall-finite、用户可看可改;v1 诚实版=可编辑 brand-notes+页面;`researchBrand`(URL 自动抓)= SSRF 信任边界,**cut from first ship**(后以 G3b BrandKit/BrandRule+`getBrandContextText`+`researchBrandFromUrl` 落地,34-PR 批次 #35/#45 修 SSRF) | SHIPPED(G3b 于 #47 整合批;brandContext 每轮注入) | `specs/2026-06-24-fikirtive-product-concept.md` §3.2;`specs/2026-06-27-otto-feature-decisions.md` #42;34-PR ship plan |
| 2.15 | **Web research skill** / `researchWeb` | WHAT #14 要、重建;g6b spec 把它当既有 external-read skill 模式引用 | SHIPPED(skill 存在;联网搜索 API key 缺=下一优先级之一,creation spec §0 顺序 2) | `specs/2026-07-01-otto-creation-experience-design.md` §0;`specs/2026-06-28-g6b-meta-insights-design.md` |
| 2.16 | **多 convo 并行画布** / G4c multi-convo canvas | "多 agent"落地=一项目多条并行 Otto 会话共享画布;**单 Otto 引擎、能力靠 skill、无 personas**(创始人原话"就一个 agent 就好,然后通过 skill 去 harness");用户手动开 convo(auto-spawn orchestrator 以后);UX=侧栏多 tab;节点 threadId 染色+过滤 | SHIPPED(G4c) | `specs/2026-06-27-g4c-multi-convo-canvas-design.md` |
| 2.17 | **UGC 流水线 / 批量 auto-video / 结构化 intake 表单** | WHAT #13/#43/#7 均"要"(重建/优化),归 G4/G3 | PLANNED(未建;storyboard F/G 是其前奏) | `specs/2026-06-27-otto-feature-decisions.md` |

---

## 3. Canvas 工作台

| # | 功能 | 一句话 | 状态 | 文件 |
|---|---|---|---|---|
| 3.1 | **G1 canvas spine** / 无限画布成为家 | React Flow;image/video/text 节点;CanvasNode 表;canvas/chat 双入口都走既有 spend gate;模型固定 seedream + env `OTTO_DEFAULT_VIDEO_MODEL` | SHIPPED(#48/#60 栈) | `specs/2026-06-27-g1-canvas-spine-design.md`(取代早稿 `2026-06-27-otto-agent-canvas-workspace-design.md`);`plans/2026-06-27-g1-canvas-spine.md` |
| 3.2 | **G2a detail panel** / 单资产详情面板 | 节点打开 DetailPanel:regenerate/animate/download/copy/delete/favorite(`Generation.favorite` 新列) | SHIPPED(#49) | `specs/2026-06-27-g2a-detail-panel-design.md` |
| 3.3 | **G2b editor tools** | variant 切换、aspect picker、edit @composer、crop(react-easy-crop、$0 派生资产) | SHIPPED(栈内) | `specs/2026-06-27-g2b-editor-tools-design.md` |
| 3.4 | **G2c extend + upscale** | video extend(20)+upscale(22)——净新 fal 模型+定价、money-adjacent、独立 PR | PLANNED(拆出后未建) | `specs/2026-06-27-g2a-detail-panel-design.md`(拆分记录) |
| 3.5 | **Canvas 视频流 4 项增强**(Grok 对齐) | 创始人:all four approved, phased, keep it simple。P1a motion presets(Gentle/Dynamic/Custom)+P1b hover 显按钮=SHIPPED(#85);P2 图 4 变体 2×2 grid+成本确认=SHIPPED(#88);P3 t2v fallback(无源图生成)=SHIPPED(#89) | SHIPPED | `specs/2026-07-01-canvas-video-flow-design.md` |
| 3.6 | **节点建卡重试** | canvas-node create retry,付费 job 不再被孤儿化(P2) | SHIPPED(#90) | (git log;audit F 族) |
| 3.7 | **确认删除 / make-video 确认、composer 快捷键** | #82 confirm-delete/make-video;#81 composer keys | SHIPPED | (git log) |

---

## 4. Library / Templates / Discover(G5)

| # | 功能 | 一句话 | 状态 | 文件 · 决策 |
|---|---|---|---|---|
| 4.1 | **G5a Library** | 可搜索分页的"我做过的一切"(含上传/crop);创始人:content=everything、project-scoped 即全库、Full/Compact 双视图;kind 筛选=follow-up 砍掉 | SHIPPED | `specs/2026-06-27-g5a-history-library-design.md` |
| 4.2 | **G5b Templates** | 4 个内置 i2i 模板(创始人挑):Remove background · Remove object · Product in scene · **Festival makeover(Raya/CNY/Deepavali)**;静态代码目录(拒绝 DB/admin authored、拒绝 ComfyUI TemplateBundle);Generate 点击=审批(显示 1 credit) | SHIPPED | `specs/2026-06-27-g5b-templates-design.md` |
| 4.3 | **G5c Discover = Inspiration Gallery** | Grok Discover 重释义(单租户隔离禁 community feed):BELCORT 静态灵感目录(~9 条),Use in Otto 预填 composer / Copy prompt;v1 纯文字卡无图 | SHIPPED | `specs/2026-06-28-g5c-discover-inspiration-design.md` |
| 4.4 | **G5 settings + tasks** | WHAT #37(自己设计的 settings)→ 已由 Account/Settings 页落地(§7);#38 定时任务 → Schedule 模块(§5.6)+ ideal-experience Phase 4 autonomy | settings=SHIPPED;tasks=PLANNED | 见 §5.6/§7.4 |

---

## 5. 渠道 / Meta / 发布 / 分析(G6/G7 + channels)

| # | 功能 | 一句话 | 状态 | 文件 · 决策 |
|---|---|---|---|---|
| 5.1 | **G6a Connect Meta(读)** | 多租户只读 OAuth connector(创始人:"每个 user 都能连自己的";read-only first `ads_read`);AES-256-GCM token 加密、HMAC state、token 永不到 client;断开=硬删 | SHIPPED(#61,prod 实测 4 个 ad account) | `specs/2026-06-28-g6a-meta-connect-design.md` |
| 5.2 | **G6b Meta insights(读)** | `metaInsights` skill(free/read/external)+ Connections 页 30d 摘要 | SHIPPED(#62;创始人:"你先冲,我这里自己来") | `specs/2026-06-28-g6b-meta-insights-design.md` |
| 5.3 | **G7 v1 Otto 管理现有广告(写)** | pause/resume/budget±/reschedule;**4 档自主模式(LOCKED):① Ask(默认最严)② Draft ③ Auto(省钱动作自动、花钱永远问)④ Autopilot(硬上限)**,v1 只 ①+③;SoD 三道墙(Otto 无写工具/CI fence/服务器重查真相);批准绑定+过期+单次消费;exactly-once processing(MetaActionExecution);MAYBE-APPLIED→对账→问人(永不自动重试/回滚);全局急停 kill-switch;policy=手写可读表文件(Cedar 推迟);花的是用户自己的 Meta 广告费(非 credits) | SHIPPED→**DORMANT**(#64 `f141037`;待 reconnect 授 `ads_management` + App Review) | `specs/2026-06-28-g7-otto-ad-write-v1-design.md`;research `specs/2026-06-28-g7-agent-authz-research.md`(12 条 3-0 验证发现;2 条 refuted:Cedar 42-60× 快、FIFO exactly-once) |
| 5.4 | **G7 v2 Otto 建广告(策划官)** | 从目标出发读 Brand Brain+素材+insights→有理有据投放计划(BUILD card)→**全部建成 PAUSED 草稿=$0**;启动=un-pause=v1 花钱门;v2 模式 ①+②;单 adset 单 ad 起步(A/B 多 adset deferred);不在 build 内生成新素材 | SHIPPED→**DORMANT**(#65 `5ad6214`;待 reconnect 授 pages_show_list) | `specs/2026-06-29-g7-v2-otto-build-ads-design.md` |
| 5.5 | **Channel provider foundation** / 渠道抽象层 | 创始人:"也要有一个选项可以给我们换平台(之后会有更多的平台,所以基础先建好)";`Channel` 接口+registry;IG/FB 是前两个 adapter;加平台=丢 adapter+注册,Schedule/Analytics/Connections 零改写 | SHIPPED(#74 `a5fff93`,连同 Account 页) | `specs/2026-06-30-channels-foundation-design.md`;`plans/2026-06-30-channels-foundation-and-account.md` |
| 5.6 | **Schedule** / Buffer 式排程(OTTO 驱动) | IG+FB;IG 无原生排程→自建定时 scheduler;25 帖/24h 限速;**auto-publish 需 Meta App Review(`instagram_content_publish`+`pages_manage_posts`,创始人并行提交)**;`ScheduledPost` 状态机 DRAFT→SCHEDULED(须 approvedAt)→PUBLISHING→PUBLISHED/NEEDS_ATTENTION;三视图(OTTO plan 默认/Calendar 月周日/Queue);OTTO `schedulePosts` skill 只建 DRAFT;**公开发布永远要 owner 明确批准**;媒体复用已付费 generations(零 fal 花费);Phase A feed image+carousel,B=Reels/Stories+best-time,C=analytics 回灌 | PLANNED(spec 完;建设排在 Analytics 后;App Review 未交) | `specs/2026-06-30-schedule-design.md` |
| 5.7 | **Analytics(全量)** | 创始人:"还要能看过往的数据都,过往的 post 那些。全部"——KPI 卡+全历史图表+每条 organic post 表现+OTTO insight;organic 需 `instagram_manage_insights` 等新权限(与 Schedule 一起送审);Phase A=广告侧先上、organic 显示 pending 状态 | PARKED→下一个建(plan 有 **STALE STYLING 警告:须重定向到 .gb+shadcn/recharts 再建**);founder 定序"严格全部迁完 shadcn 再 Analytics"(迁移已完) | `specs/2026-06-30-analytics-design.md`;`plans/2026-06-30-analytics.md` |
| 5.8 | **发布按钮(WHAT #36)/ TikTok/Lazada/Shopee connectors(WHAT #40)** | 要;平台灵活;逐平台独立 PR+重安全测试、排最后 | PLANNED(Meta 之外未动) | `specs/2026-06-27-otto-feature-decisions.md` |
| 5.9 | **Meta App 实务** | 活 App `999242359480685`(Marketing API);死 App `1359820566248770` 弃;prod 激活 3 个创始人步骤(存 redirect URI/批 Railway deploy/App Review+商业验证);**prod TOKEN_ENCRYPTION_KEY 永不轮换** | 进行中(创始人侧) | `specs/2026-06-28-SESSION-HANDOFF.md` §2–3 |

---

## 6. 钱 / credits / 变现

| # | 决策 | 内容 | 状态 | 文件 |
|---|---|---|---|---|
| 6.1 | **Org-as-tenant + credits ledger 基础** | 创始人北极星:"把基础直接做好,当成完整的 SaaS database 来设计,未来就不用多做一次工作。" 锁定表(§1 决策表):org-as-tenant;founder org id 字面 `"founder"`(零迁移零 R2 re-key,CI guard);保留 `ownerId` 列名;双角色轴(User.role 平台 staff ≠ Membership.role 每 org);reserve→settle→refund 两 delta 账本;**deterministic pricedCreditCost ⇒ RESERVE==SETTLE 恒等**;任何终态失败全额退款(founder 吸收 fal 成本);credits 即花费上限(关 M1) | SHIPPED(P0–P3 全部,multi-tenant flip 已上线) | `specs/2026-06-19-closed-beta-saas-foundation-design.md`;`plans/2026-06-19-closed-beta-p{0,1,2,3}-*.md` |
| 6.2 | **计费单位** | 内部 1 credit=$0.01;**显示 1 credit=$0.10**(`INTERNAL_PER_DISPLAY=10`);后(2026-06-26 operating contract)升级为 **credits 是唯一单位、never dollars**——取代早期"$-equivalent always visible"的决策(两者都有档,后者晚、生效) | 锁定 | `specs/2026-06-19-…-saas-foundation` §5.6 vs `specs/2026-06-26-otto-ideal-experience-design.md` 契约 #1 |
| 6.3 | **免费额度** | beta 1,000 credits/org → **2026-06-29 砍到 100**(≈4–5 条完整 campaign,BytePlus 成本下 1000 太慷慨) | SHIPPED(#66) | `specs/2026-06-29-monetization-credit-packs-byteplus-design.md` |
| 6.4 | **Stripe 充值(Phase 3a)** | 一次性 credit packs;packs 定义在 Stripe(`metadata.credits`)不写码;webhook 签名验证→幂等 `grantCredits`(`stripe:<eventId>`);**订阅/退款/持久 Customer/@better-auth-stripe = Phase 3b deferred** | SHIPPED(#22 合入 → LIVE) | `specs/2026-06-26-stripe-credit-topup-design.md`;`plans/2026-06-26-stripe-credit-topup-phase3a.md` |
| 6.5 | **MYR 定价 + pack 表** | 1cr≈RM0.50;**Starter RM25/50cr · Standard RM100/220cr(+10%) · Pro RM250/600cr(+20%)**;每 pack 全生成组合皆盈利(最差 1.56×);Otto 聊天按真实 token ×**1.5 margin**(便宜=差异化);一个 credit 池(Otto+生成共用);Otto 订阅层=deferred 未来 margin 档 | SHIPPED LIVE(#66,live Stripe;⚠️ live priceIds 只在 Stripe 后台) | `specs/2026-06-29-monetization-credit-packs-byteplus-design.md` |
| 6.6 | **BytePlus 迁移(Phase 2)** | fal→官方 ModelArk:图 **Seedream 5.0**(sync)、视频 **Seedance 2.0 fast**(async submit→poll,poll 藏 provider 内);用户选 **720p(默认)/1080p**;**每次扣费(创始人确认):图 1cr · 720p 7cr · 1080p 16cr**(flat per-resolution、盖 t2v 最差、i2v 主路径 ≈1.9×);主视频路径=i2v(先首帧再动);env 切换、fal 留 fallback | SHIPPED(#67,prod provider=byteplus) | `specs/2026-06-29-phase2-byteplus-migration-design.md` |
| 6.7 | **花钱三大周边** | Otto-LLM per-turn 预算 reserve→settle(`withLlmBudget`,maxTurns 上限);`spentUsd`=record-only 真实成本(margin 分析);impersonation 期间 8 个 spend 入口 early-return 封锁 | SHIPPED | `specs/2026-06-22-…-sdk-migration` §6;`plans/2026-06-17-opt6-p3a-spend-observability.md`;`plans/2026-06-26-operator-console-…-phase2.md` |
| 6.8 | **beta 期 planner $0 规则** | `COWORK_PROVIDER` 必须 $0(mock/self-hosted)否则 LLM 花费绕过 credits 上限——Phase 0 断言;后被 2.1 的全入口计费取代(R1 退役) | SUPERSEDED(由全入口计费替代) | `specs/2026-06-19-…-saas-foundation` §5.7 |

---

## 7. 租户 / 认证 / 运营台(admin)

| # | 功能 | 一句话 | 状态 | 文件 · 决策 |
|---|---|---|---|---|
| 7.1 | **OPT-6 运营 dashboard(P1a/P2/P3a/P1b)** | in-handler auth 全覆盖;RuntimeConfig(免部署改配置);ModelRegistryOverlay **TRUE-disable 在全部 5 个花钱 chokepoint**(DB 只能收窄typed menu、永不能加模型/提上限);$0 确定性 composer 只在 spend 侧跑一次;spentUsd 账本;5 角色 operator-RBAC(super-admin/ops/finance/moderator/viewer;section→role 矩阵;self-escalation 禁);4 个用户决策:TRUE-disable、operator-RBAC team-only、Moderator=review/audit-only、phase 顺序 foundation→money-obs→model/knowledge→RBAC;admin 子域名"explicitly NOT planned"(user 2026-06-17) | SHIPPED(P1a/P2/P3a/P1b;P3b system-health、P4 moderation、P5 PLUS = deferred) | `specs/2026-06-17-opt6-admin-dashboard-design.md`;`plans/2026-06-17-opt6-p{1a,1b,2,3a}-*.md` |
| 7.2 | **多租户 admin console(tenants)** | 完整运营台(创始人选"完整运营台"):商户列表/详情、跨租户 credit grant(**super-admin only**,锁定)、suspend/resume+立即断 session、DB 邀请表 AllowedEmail(env∪DB、founder env 永远优先=anti-lockout)、suspend 不被登录 bootstrap 复活(关键修) | SHIPPED(P1/P2/P3) | `specs/2026-06-21-multitenant-admin-console-design.md`;`plans/2026-06-21-multitenant-admin-p{1,2,3}-*.md` |
| 7.3 | **Better Auth 迁移** | NextAuth(patch-only)→Better Auth;先建 dormant 基础(email+password/Google/magic-link,身份桥=email join,`ba_*` 表),后单独 cutover;闭 beta allowlist 保留为外墙;锁死 lockout 预防条件(克隆库演练+真登录+一次真生成) | SHIPPED(cutover live,PR #8;NextAuth 已删 PR #10) | `specs/2026-06-25-betterauth-foundation-design.md`;`plans/2026-06-25-betterauth-foundation.md` |
| 7.4 | **Operator console on BA admin plugin** | 两个锁定决策:①角色 source of truth=`User.role`(BA 只是镜像)②ban 模型=`Membership.status` 权威+BA `banned` 全局踢;Phase 1=装 plugin+修 cutover 弄坏的 force-logout;Phase 2=impersonation(founder-only、audited、**spend-blocked**、可见 banner、30min) | SHIPPED(P1 #12、P2 #14) | `specs/2026-06-26-operator-console-better-auth-admin-design.md`;两个 phase plans |
| 7.5 | **Account/Settings 页** | config-driven section registry(加设置=加一条注册项,"file-system"原则);7 sections(Profile/Billing/Connections/OTTO behavior/Notifications/Schedule defaults/Danger);spend cap=display+软信号 only(不改账本);OwnerSettings JSON 存储 | SHIPPED(#74) | `specs/2026-06-30-account-settings-design.md`;`specs/2026-06-30-remaining-pages-overview.md` |

---

## 8. UI / 设计系统

| # | 功能 | 一句话 | 状态 | 文件 · 决策 |
|---|---|---|---|---|
| 8.1 | **UI 全面重做(Grok-bright)** | 整 app 重皮到 Grok-bright;strangler 一次一面;**钱路 display-only**;创始人逐屏批 hi-fi;**founder 看不到 inline widget → 一律 PNG 到 ~/Desktop**;design source of truth=claude.ai/design 项目 `0abf8563`;Geist(不是 Figtree,旧记录作废) | SHIPPED(P0–P5 经 shadcn 栈) | `specs/2026-06-29-UI-REWORK-ENGINEER-HANDOFF.md`;`plans/2026-06-29-fikirtive-ui-rework-roadmap.md` |
| 8.2 | **shadcn 全量迁移(S0–S4)** | 创始人:"迁完全部全部的组件去 shadcn… 严格全部迁完再 Analytics";杀双 UI 系统;S4 teardown 删 `components/fk`、`otto-theme.css`、`?skin=fk`、**`components/studio`+`app/studio`(退役创作台)**;ReactFlow 保留只重皮;coral=OTTO only 全 app | SHIPPED(#76 S0/S1a;#80 squash=S1–S4 全量,main `313eb27`) | `specs/2026-06-30-full-shadcn-migration-strategy.md`;`plans/2026-06-30-shadcn-S{0,1a}-*.md` |
| 8.3 | **Typography 对齐 + OTTO mascot** | Analytics 屏=排版/字距金标准;mascot 机器人→coral 云 | SHIPPED(#86/#87);仍开:33 条跳过项+My Stuff/Brand-memory 重建+回写设计系统 | (memory/git log;基线=design 项目 ui_kits) |
| 8.4 | **早期 /otto 光主题前端** | Claude Design 交接稿落地 `/otto`(.fk 主题、ad-pack batch、Workshop stub);锁定:build batch 让 chooser 真实;`/otto` 新路由、`/studio` 留手动房 | SHIPPED→大半 SUPERSEDED(.fk 已在 S4 删除;/studio 已退役) | `plans/2026-06-25-fikirtive-otto-frontend.md`;`plans/2026-06-24-fikirtive-v1-backend.md` |
| 8.5 | **Otto-Operator IA(D1–D14 锁定决策)** | D1 Otto=operator+front door;D2 goal tiles→scoped chat→ad-pack chooser;D3 ~6 个硬编码 goal tiles;D4 Co-pilot 逐步批准(Auto-pilot 砍出 Phase 1);D5 终点=下载/copy-to-post;D6 结构隐藏(Home/My Stuff/Workshop/Account);D7 confidence 只 editorial 永不假数字;D8 GenerationBatch 表;D9 新设计系统(Vapor 退役);D10 desktop-first;D11 路由 /home(后实际=/otto canvas);D12 My Stuff=一面两段;D13 Workshop=?surface 切换;D14 cast 浏览/编辑分离 | 大部分 SHIPPED(以 canvas-as-home 形态演化;Workshop 概念被 canvas 吸收) | `specs/2026-06-24-fikirtive-otto-operator-home-design.md` |

---

## 9. STUDIO 时代(pre-Otto-pivot;多数已退役或被吸收)

| # | 功能 | 一句话 | 状态 | 文件 |
|---|---|---|---|---|
| 9.1 | **Cowork skill 总体规划(moat 三层)** | 参考层+ModelDirective 知识库(DB+admin、创始人的明确选择"knowledge lives in the DB with an in-app admin panel, editable live, no redeploy")+skills 面;Phase 0A/0B/1/2 建成(transport 拆分、ModelDirective+admin、model-aware Enhance、Guardian+Coach);Codex R1–R12 修订全收 | Phase 0–2 SHIPPED(遗留);**Phase 3(shotDoctor/recipeMemory)、Phase 4(fillStoryboard)从未建**——被 Otto storyboard F/G 取代 | `specs/2026-06-13-cowork-skill-masterplan.md`;`plans/2026-06-14-cowork-phase-{0a,0b,1,2}-*.md` |
| 9.2 | **SP1 cowork agent loop** | 会话 agent+人工闸 Generate card;锁定:lip-sync 排 SP4、canvas 排 SP3、agent-suggests/user-overrides、Always-Ask only;`suggestModel` 确定性路由 | SHIPPED→SUPERSEDED(coworkTurn 已死,被 Agents SDK Otto 取代) | `specs/2026-06-15-cowork-agent-loop-design.md`;`plans/2026-06-15-cowork-sp1-plan{1,2}-*.md` |
| 9.3 | **SP2 sessions** | 会话列表(new/switch/rename/soft-delete;无 search/pin,user-decided) | SHIPPED(演化为 Otto threads/ConvoTabs) | `plans/2026-06-16-cowork-sp2-sessions.md` |
| 9.4 | **SP3 canvas / SP4 lip-sync / SP5 upscale+autonomous** | SP roadmap 后段 | SP3→G1 实现;**SP4 lip-sync/talking-character 从未回访=PLANNED-dormant**;SP5 credits 已建、autonomous→ideal-experience Phase 4 | `specs/2026-06-15-cowork-agent-loop-design.md` §SP |
| 9.5 | **Context layer + 多模态 transport** | ProjectBrief/描述复用/provider 可配置(mock|fal|modal|claude);Claude first→Modal 自托管 later | SHIPPED(遗留;vision 收集逻辑在 #84 被复活入 Otto) | `plans/2026-06-16-cowork-context-transport.md` |
| 9.6 | **Reference base + variants(@mira:red-dress)** | 每实体一张锁定 base+命名 variants(i2i from base)+@mention variant 选择(Phase A/B/C);partial-unique handle;fail-closed variant 0-ref 拒付 | SHIPPED(A+B+C) | `specs/2026-06-15-reference-base-variants-design.md`;三个 phase plans |
| 9.7 | **OPT-4 视频编辑器(EP1–EP4)** | LTX-style:真转场(xfade)/split·ripple·snapping·undo/whisper.cpp 字幕+文字叠加/Sound tab+ducking+FCP7 XML 导出+近似预览;全 $0 ffmpeg;锁死:不自建实时预览引擎(Remotion 买、触发条件才买)、单视觉轨、LTX-light 天花板 | SHIPPED(当时)→**编辑器 surface 随 studio 退役处理**(S3/S4 计划删 studio+Editor 遗留对);能力(worker ffmpeg render/caption)仍在 | `specs/2026-06-18-opt4-video-editor-design.md`;`plans/2026-06-18-opt4-ep{1,2,3,4}-*.md` |
| 9.8 | **拖放(编辑器+Storyboard)** | HTML5 DnD,自定义 MIME;明确不做 pixel→time 定位(Shotstack 无公开映射) | SHIPPED(studio 时代)→随 studio 退役 | `specs/2026-06-13-editor-storyboard-drag-drop-design.md`;plan 同名 |
| 9.9 | **ChingXuan wedge(v0 商户)** | 一个 beta 商户与 Otto 对话出成片+记录发布结果;multi-ref video=组合图→animate(provider-blocked 原生多参考);Simple Mode 必须 cheap 模型 | plan 存在;被 FIKIRTIVE 一 app pivot 吸收(性能回路→Analytics/Schedule 承接) | `plans/2026-06-22-chingxuan-wedge.md` |
| 9.10 | **34-PR 集成批(#11–#46)** | 一条 integration 分支收 33 个 PR;**#22 vs #25 竞争 Stripe:ship #22、采 #25 的 `stripe:${session.id}` 幂等键、#25 排除**(漏 proxy 排除、webhook 会 302);must-fix 表(#30 costCredits 转发、#45 SSRF DNS-rebinding、#24 reaper 25min…) | SHIPPED(#47 `fba7882`) | `specs/2026-06-27-otto-34pr-integration-ship-plan.md` |
| 9.11 | **Ultra-review fixes(栈 #48–#59)** | 10+2 项修复;创始人:"一个 cleanup PR 全修";**video model 暂定 Veo 3.1 Lite**(kling 缺 aspect/audio;后被 BytePlus seedance-2-fast 取代);DNS IP-pinning=deferred follow-up | SHIPPED | `specs/2026-06-28-review-fixes-design.md`;`plans/2026-06-28-review-fixes.md` |

---

## 10. 明确"不要"(EXPLICITLY-REJECTED)

| 项 | 出处 |
|---|---|
| **#33 Build(Grok 终端 coding agent)**——"wrong product. Skip." | feature-decisions;agent-canvas-workspace 附录 B |
| **#34 独立通用 Chat**(agent+project 管会话) | feature-decisions |
| **#35 Spicy/18+ NSFW**——"off-brand. Skip." | feature-decisions;agent-canvas-workspace 附录 B |
| **两扇门(/simple+/pro 双 app)** | product-concept(supersedes) |
| **HERMES runtime 替换** | product-concept §3.1 |
| **Vercel EVE / 迁 Vercel** | agent-sdk-migration §2 |
| **假 performance 分数**(confidence 只 editorial) | operator-home "Do NOT copy";D7 |
| **enterprise governance/roles 照抄、用户侧模型选择器** | operator-home "Do NOT copy";WHAT #44 |
| **Grok 式跨用户 Discover feed / community / publish 系统**(破坏租户隔离) | g5c spec §1 |
| **personas/多角色 agent** | g4c(创始人原话"就一个 agent 就好") |
| **clarify 卡片(B)、recallBrandFact(C)**——2026-07-02 复审砍除(YAGNI/冗余) | creation-experience §9 |
| **Seedance 真人脸认证流程**——"直接 SKIP,不考虑"(拒了走退款+报错) | reference-video spec |
| **批量花钱单 skill / 复合幂等 key(`cowork:${cardId}:${shotIndex}`)**——明确禁止 | creation-experience §4.2;storyboard-card §7 |
| **Clerk Orgs / managed-auth 现在就上**(WorkOS AuthKit=deferred bolt-on,只在企业要 SAML/SCIM 时) | closed-beta-saas §1/§6.4 |
| **admin 独立子域名/服务**——"explicitly NOT planned (overkill)" | opt6 §8 |
| **假折扣/best-value 话术、top-up 绑反馈**——"top-up never gated on feedback" | closed-beta-saas §1/§5.6 |
| **自建实时预览引擎**——"war-story graveyard";Remotion 买不建 | opt4 §0.4 |
| **摄像机实拍素材导入** | opt4 §5 |
| **prompt 超长静默截断**(reject-only fail-closed) | storyboard-card §7 |

---

## 11. 明确"以后 / deferred"(未建、已记档)

- **G2c video extend + upscale**(WHAT #20/#22;money-adjacent 独立 PR)— `g2a spec`
- **多 adset/A·B campaign(G7 v3)、mode ④ Autopilot 硬上限、per-account autonomy、Cedar 策略引擎、`pg-transactional-outbox` 全套** — `g7 v1/v2 specs`
- **Meta 公开 App Review**(ads_management/pages/publish/organic-insights 一起送审)— G7/Schedule/Analytics 激活的公共门
- **TikTok/Lazada/Shopee connectors、多平台发布**(WHAT #40 多平台承诺)
- **Schedule Phase B/C**(Reels/Stories、best-time AI、bulk、analytics 回灌)
- **Analytics Phase B**(organic per-post 全历史;权限批了自动点亮)
- **Otto 订阅层**(未来 margin 档;现在一个 credit 池)+ Stripe Phase 3b(订阅/退款/Customer)
- **连贯模式(末帧→首帧链式)**(storyboard v1 明确不做;随 G)
- **成片拼接(concat N 段成一条)**——"以后再说"(creation-experience §1)
- **多参考视频(≤3 段)、reference_image 1–9 张进视频、参考音频**——reference-video v1 只 1 段
- **i2i pixel 条件化(image kind 的参考图直接喂生成器)**——#84 只做 vision 层;follow-up 自带 money-review
- **@mention 实体 base 图喂 Otto vision**(需 entity→asset 解析)
- **video keyframe 视觉管线 v2**(Otto 真"看"视频)
- **SP4 lip-sync / talking-character**(从未回访)
- **auto-spawn orchestrator(lead Otto 派活)、chat-as-canvas-node** — g4c
- **DNS rebinding IP-pinning 完整修**(undici dispatcher)— review-fixes deferred
- **Postgres RLS、org-switcher、团队多席位邀请、`ownerId`→`organizationId` 改名** — closed-beta §9
- **OPT-6 P3b(system/queue health)、P4(content moderation + 真 fal 安全参数闸)、P5(marketing/support/invite-codes/export)**
- **user-authored/DB 模板、模板 select 型问题、Discover 配图** — g5b/g5c
- **cowork masterplan Phase 3/4(shotDoctor、recipeMemory、fillStoryboard)**——被 Otto 方向取代但从未正式关闭
- **ideal-experience Phase 4 autonomy**(cron 计划任务+主动通知+预算护栏;开放题:通知渠道/预算模型/主动性强度)
- **audit 未决 G3–G5**:stuck-job refund/reaper(部分由 2026-07-02 audit F02/F03 修复接手)、真自助充值已解、purge 污染实体
- **首帧图便宜预览档**(Seedream 有无低清档待确认)— creation-experience §7

---

## 12. 两份审计(gap 档案)

### 12a. Otto UX/feature 审计 2026-06-26(`docs/ux-audit-2026-06-26-otto.md`)
- **方法**:创始人 7m51s 录屏 + 8-agent 代码审计;65 raw → **41 个问题**;严重度以商户视角。
- **核心破诺一句话**:"Otto plans and makes it — you approve before anything costs money" 在每一子句上都为假(聊天先扣钱、$0.04 报价实扣 $0.10(2.5×)、视频请求按便宜图报价、余额不对账、$0.61 花掉零产出还说 "Not stuck at all")。
- **P0 头 10 条**(节选):P0-1 聊天未批先花钱;P0-2 报价≠实扣;P0-3 两步计划无聚合价;P0-4 "可 undo"为假;P0-5 "结果回来才扣"为假;P0-6 卡片乐观死端+回退成付款按钮;P0-7 Otto 盲说 job 状态;P0-8 四个钱数字永不对账;P0-9 /otto 是孤岛、默认还落 /studio;P0-10 无自助充值、$0 时砖机。
- **8-PR roadmap**;PR1(诚实钱文案+credits)已 ship(#11);**决策已定:G1 ✅ 会话保持收费(文案改诚实)、G2 ✅ credits everywhere**;G3(stuck-job refund/reaper)、G4(真自助充值→已由 Stripe 解)、G5(清 prod 垃圾实体)当时未决。
- **横切警示**:录屏全程在 founder-only streaming 路径;商户走的 OttoConversation 更差——修复须双面验证(后 #84 统一到 streaming 全量)。

### 12b. 全库审计 2026-07-02(`docs/audit-2026-07-02-full.md`)
- **基线** main `e61722f`(#93);ultracode 多智能体、两轮独立对抗验证交叉比对。
- **结论**:**P0=0**(无活体静默丢钱/双扣/越权/泄漏)· P1=10 · P2=22 · P3=8 · 4 条否证(F22 F31 F33 F44)。44 条编号 F01–F44。
- **触钱立案(须 money-safety-review+逐条批准)**:F02 F03 F04 F05 F06 F07 F08 F09 F27 F39 F40。
- **贯穿主题**:①无 reaper 的预扣泄漏家族(RefGenJob F02、Otto-LLM 预扣 F03)②stale-generationId 家族(DetailPanel F08/F09)③客户端静默吞错(F19/F20/F21)④client 读 server env(F18)⑤BytePlus 收尾未完(F05/F06/F39 成本仍记 fal 价/F40 水印)⑥**无 CI**(F36,P1 流程风险:push=auto-deploy 无人闸)。
- **分歧裁定**:F12(ad-build 越权)run1 CONFIRMED vs run2 REFUTED——裁定当前不可达(Next action-id 盐化、无 client import),按 P3 加固"顺手修"(去顶层 "use server")。
- **处置状态**:先修后建+spend-path 隔离逐条批准(wf_52d821f3);F23/F37/F41 已在 #106 关闭;partA runbook = `docs/runbook-2026-07-02-partA-fixes.md`。

---

## 13. 状态速查(截至 2026-07-02, main ≈ #106)

- **LIVE on prod**:多租户+credits+Better Auth+运营台;canvas home 全套(G1/G2a/G2b/G4c/G5a/b/c + 视频流 #85/#88/#89 + #90);Meta 读连接器+insights;变现(MYR packs live Stripe、100 免费、Otto 1.5×);BytePlus 生成(Seedream 5.0 / Seedance 2.0 fast、720p/1080p、1/7/16cr);Grok-bright 单系统;streaming 聊天全量+参考图 vision+抽帧;requires 门(#83)+prompt 精通(#91/#98);storyboard F1(#99)。
- **DORMANT 等激活**:G7 v1 管广告(#64,等 ads_management reconnect+App Review);G7 v2 建广告(#65,等 pages_show_list);Stripe 之外的 Meta 公开使用(商业验证+Dev→Live)。
- **IN-FLIGHT**:storyboard F2/F3(plans 已写)→F4 闸①;整段参考视频(spec+plan 齐);多参考图条件化(implementing);2026-07-02 审计修复批(先修后建)。
- **NEXT(已定序)**:Analytics(全量,基于 .gb+shadcn 重定向后建)→ Schedule(Buffer 式,App Review 并行)→ G(闸② make all)。
- **创始人侧未清**:首次真金 prod 生成 E2E;Meta 激活三步;live priceIds 无处记录(须从 Stripe 后台恢复);2026-06-28 handoff 文档 dangling ref(stash `2421367`)。
