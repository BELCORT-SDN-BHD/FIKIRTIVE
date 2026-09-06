# 《FIKIRTIVE 项目全史》

> 版本坐标：2026-07-24  
> 主要读者：Founder Nicks，以及未来每一位 AI / human collaborator  
> 史料范围：`history-digests/` 全部 18 份 distilled digest、`docs/BLUEPRINT.md` live constitution；时间主轴以 `git-spine.md` 所列 main 历史 763 commits（2026-06-10 → 2026-07-24）为准。（来源：`git-spine.md`；`docs-doctrine.md`；`docs/BLUEPRINT.md`）

## 先记住：FIKIRTIVE 到底是什么

FIKIRTIVE 不是“一个 AI 生成器”，也不是“一个聊天机器人加几页工具”。Founder 写入宪法的定位原话是：（来源：`docs/BLUEPRINT.md` 第一章；PR #187）

> “FIKIRTIVE 是一个 ALL-IN-ONE 的 MARKETING POWER HOUSE PLATFORM —— 意思就是基本上都有全部 feature,像之前我给的那些 reference products(Salesforce 那些)”  
> “FIKIRTIVE 上每一个 feature 都可以 100% 人操作,OTTO 也能操作 100% 全部。”

这两句后来被收紧为：FIKIRTIVE 是给中小商家的世界级 ALL-IN-ONE 营销与营收增长 OS；全球为底、本地为皮，马来西亚/SEA 是滩头，不是天花板；人工工具必须完整，Otto 是会操作同一套工具的“平台操作员”，而不是用 AI 遮住半成品。（来源：`docs/BLUEPRINT.md` 第一章；PR #187；PR #212；PR #444；`transcript-wt-orchestration-50ba3d-current.md`，2026-07-23T08:22–10:56）

商业第一期也不是“先做好其中一页”。它必须同时有三根真实支柱：品类一流的内容、真正可用的发布、完整的 Customer Engagement CRM；任何 mock、Coming soon、单测、provider 返回成功或精选最好样片，都不能冒充一期完成。（来源：`docs/BLUEPRINT.md` 第六章；Founder Resolution #334；PR #337）

本史把“做出了什么”“为什么转向”“哪次出过事”“哪条规则因此成法”放在同一条时间线上。引用 Founder 的话保持原样；PR body 中由 agent 转述的“Founder decision”不冒充 Founder 亲口；digest 互相冲突处会同时列出并标注“待核”。（来源边界：`issues-1-90.md`、`issues-181-270.md`、`issues-361-453.md` 的 source note）

---

## 第一时代：从零到可生成的 Artlio Studio（2026-06-10—06-14）

项目于 2026-06-10 进入可追踪的 Git 历史：pnpm monorepo、Prisma 数据模型、pg-boss worker、Next.js web 与第一版 “Artlio Studio” 工作台同日落地。它从第一天就不是纯前端 demo，而是 web、数据库、异步任务与生成工作流一起起步。（来源：`git-spine.md`；commits `e4c36ee9`、`ba8bfc63`）

视觉方向很快改变。6 月 10–11 日先转向 “Vapor” 语言，随后又按 Claude Design prototype 做 pixel-faithful rebuild；这说明早期团队已经把“产品感觉”当作核心问题，而不只是在补功能。（来源：`git-spine.md`；commits `7ed048a1`、`0ed8f61d`）

6 月 11 日，magic-link 登录与 Shotstack 驱动的 editor→export 链路成形；6 月 11–12 日又接上 R2/S3 object storage、浏览器直传，以及第一条真实付费生成回路。Object storage 是把图片、视频放在专门的文件存储，而不是塞进数据库；这一步让生成结果可以被可靠保存、复用与导出。（来源：`git-spine.md`；commits `cefe9e3d`、`4eb388cc`、`992dd4de`、`e2a1c7ff`）

随后 Studio 的 Elements、Generation、Storyboard、Editor 等面逐个连到 fal-hosted models。6 月 12–14 日的重点从“能生成”转到“生成后不会乱扣钱、编辑器够深、失败能收口”，并开始构思 Cowork——让 AI 不只给答案，而是与用户共同完成创作任务。（来源：`git-spine.md`；commits `1432391d`…`d501defb`、`c6403c17`…`7d697dc0`）

| 日期 | 小事件 | 意义 | 证据 |
|---|---|---|---|
| 2026-06-10 | monorepo、Prisma、worker、web、Artlio Studio 起步 | 产品从一开始就是全栈系统 | commits `e4c36ee9`、`ba8bfc63`；`git-spine.md` |
| 2026-06-10–11 | Vapor → Claude Design pixel-faithful rebuild | 第一次设计方向转向 | commits `7ed048a1`、`0ed8f61d`；`git-spine.md` |
| 2026-06-11 | magic-link auth、Shotstack export | 登录与输出链闭合 | commits `cefe9e3d`、`4eb388cc`；`git-spine.md` |
| 2026-06-11–12 | R2/S3、直传、付费生成 | 第一条真钱生成基础 | commits `992dd4de`、`e2a1c7ff`；`git-spine.md` |

## 第二时代：Cowork、编辑深度与 closed-beta 地基（2026-06-14—06-21）

6 月 14–15 日，Cowork Phase 0A–2 把 agent transport 做成 model-neutral，并加入 Guardian/Coach 两类“省钱角色”：先检查请求是否完整、是否值得花，再让生成发生。同期 reference 逻辑从“给一张参考图”升级为 base identity + variants，让同一角色/品牌可以持续衍生，而不是每次重新抽卡。（来源：`git-spine.md`；commits `6cbdb5d6`…`5080c3d2`）

6 月 15–16 日，Cowork chat threads、propose-only agent turn、可编辑 GenerateCard 与 chatbox sidebar 落地。Propose-only 的含义是 agent 先提案，用户看清楚再行动；它后来长成 FIKIRTIVE 的审批文化：AI 可以聪明，但花钱和对外动作必须有明确授权。（来源：`git-spine.md`；commits `780b7df6`…`3f1001bf`）

6 月 17–18 日，编辑器获得真实 transitions、ripple/split editing、自托管 captions；后台则加入 admin RBAC 与 spend ledger。RBAC 是按角色控制谁能看、谁能改；spend ledger 是每一笔 reserve、settle、refund 都能追溯的账本。这两者后来分别发展成“租户铁幕”和“钱路神圣”。（来源：`git-spine.md`；commits `a90c9e00`…`39d84147`；`docs/BLUEPRINT.md` 第二章第 2、6 条）

6 月 19–21 日，closed-beta SaaS 地基完成：多租户、credits ledger、按 organization 隔离、admin merchant console。6 月 21 日发生第一次身份定型：Artlio 更名为 Fikirtive，Cowork 更名为 Otto，数据库里的 `EntityType.BRAND` 更名为 `BRANDMARK`。今天熟悉的产品名与 agent 名由此固定。（来源：`git-spine.md`；commits `55397741`…`0cc8ba9e`、`6b151d3f`）

| 日期 | 小事件 | 意义 | 证据 |
|---|---|---|---|
| 2026-06-14–15 | Cowork Guardian/Coach、reference variants | agent 开始替用户省钱与保持一致性 | commits `6cbdb5d6`…`5080c3d2`；`git-spine.md` |
| 2026-06-15–16 | propose-only turn、GenerateCard、threads | “先提案再行动”的雏形 | commits `780b7df6`…`3f1001bf`；`git-spine.md` |
| 2026-06-17–18 | editor 深化、admin RBAC、spend ledger | 权限与账本成为平台地基 | commits `a90c9e00`…`39d84147`；`git-spine.md` |
| 2026-06-21 | Artlio→Fikirtive；Cowork→Otto | 产品与超级员工完成命名 | commit `6b151d3f`；`git-spine.md` |

## 第三时代：Otto 平台化、Better Auth 与 34-PR 大整合（2026-06-22—06-28）

6 月 22–23 日，Otto 迁向 OpenAI Agents SDK 架构；spike 判定可行后，Otto v1 tools 与受 spend gate 保护的 `generate` skill 落地。到 6 月 24 日，npm scope 也由 `@artlio/*` 改成 `@fikirtive/*`，同时把 fundraising/business 文件从 main 移走，让主仓专注产品与工程。（来源：`git-spine.md`；commits `f5ed4845`…`50d47957`、`b2e6465f`、`3becf31e`）

6 月 25–26 日完成 Better Auth cutover、Otto streaming chat、Stripe credits top-up 与一轮 41 项 Otto UX audit。Better Auth 是新的统一登录系统；cutover 不是一次硬切，而是先并行、再补齐旧 `auth()` 遗漏、最后退休 NextAuth。这个阶段也暴露并修复了一处真实跨租户读漏洞：`listMemory` / `getBrandContextText` 曾信任 caller 传来的 `ownerId`，后来改为只从 session 取身份。（来源：PR #4、#7–#10；`issues-1-90.md`）

6 月 26 日，`defineOttoSkill()` factory、registry 与 fence 出生；skill 不准直接 import 花钱包，必须走共享 action layer。它把“给 Otto 加能力”从临时 prompt 改成有固定字段、注册步骤、审批 metadata 与测试的工程单位，后来成为宪法九条扩建缝的第一缝。（来源：commits `30d837a0`…`efd00cb2`；PR #28；`issues-1-90.md`；`docs/BLUEPRINT.md` 第四章）

6 月 27 日发生 “Otto 34-PR integration”：33 个以上 canvas、brand memory、ads、mobile、onboarding、brand research、resilience 分支被集中整合。整合不是无脑叠加；PR #47 手工解冲突、统一采用 #22 的 Stripe 实现并吸收 #25 更好的 idempotency key，还修复了 `researchBrandFromUrl` 的 SSRF/DNS-rebinding 漏洞。SSRF 是服务器被诱导去访问不该访问的内部地址。（来源：commit `fba78821`；PR #22、#25、#47；`issues-1-90.md`）

随后 G1–G7 把 Otto 首页重构为 node-based canvas：DetailPanel、crop、campaign packs、多会话、History/Library、Templates、Discover 都进入一张工作台。PR #60 的 ultra-review 报告 0 critical，但找到“agent 会给一个 server 随后拒绝的 video model 报价”的 gate mismatch，并在合并前修好；这成为“审计不是仪式，必须真的能挡 bug”的早期样本。（来源：PR #48–#60；commits `75536256`…`3aee38e8`；`issues-1-90.md`）

6 月 28 日，Meta Ads 从只读 OAuth/analytics 走到受 separation-of-duties 保护的写回，再到“整套 campaign 只建 PAUSED draft，launch 才可能花钱”。同一时期 MYR credit packs 与 BytePlus provider migration 开始，为马来西亚收费与 Seedream/Seedance 生成打底。（来源：PR #64–#67；commits `ea9b6102`…`4c164b9f`；`issues-1-90.md`）

| 日期 | 小事件 | 意义 | 证据 |
|---|---|---|---|
| 2026-06-22–23 | Agents SDK spike 与 Otto v1 | Otto 从聊天功能变成可扩展 agent runtime | commits `f5ed4845`…`50d47957` |
| 2026-06-25–26 | Better Auth、streaming、41 项 UX audit | 认证与交互进入产品化阶段 | PR #6–#10、#11–#44 |
| 2026-06-26 | `defineOttoSkill()` | One Otto 的工程地基 | PR #28；commit `30d837a0` |
| 2026-06-27 | 34-PR integration | 大规模并行第一次集中收口 | PR #47；commit `fba78821` |
| 2026-06-27–28 | canvas G1–G7、Meta Ads G6–G7 | “聊天助手”转成可操作工作台 | PR #48–#65 |

## 第四时代：Grok-bright、shadcn 统一与第一次全库收口（2026-06-29—07-02）

6 月 29 日起，Founder 对照 Grok 连续做 live feedback。Canvas regression、credit badge、Projects sidebar、拖选、DetailPanel、删除与视频确认逐轮修正；6 月 30 日 Grok-bright 被定为默认 skin，旧 `?skin=fk` 只留 rollback hatch。到 7 月 2 日，全产品迁到 shadcn / `.gb` 单一设计系统，旧 Vapor / `.fk` 分叉被拆掉。（来源：PR #69–#82；commits `acfd49af`、`5bb8e54b`、`313eb27f`；`issues-1-90.md`）

这个阶段也确立几条后来长期存在的用户信任规则。Founder 原话“点 ok 再花钱”推动四张 image variant 卡在付费前显示 cost confirm；“刨根问底 · 硬门”推动 `requires` gate，在信息不够时 Otto 必须问清楚，不能猜；一时提供 13 个 video model 的 picker 被收窄到唯一真的可花钱模型，避免“看得见、点了却永远不能成功”的假选择。（来源：PR #63、#83、#88；`issues-1-90.md`）

Provider 从 fal 迁向 BytePlus 时发生一次部署危机：PR #67 加了 `vitest` dependency 却没正确更新 lockfile，导致 Railway worker 部署持续失败，生产静默服务旧 worker；PR #68 用一行 lockfile fix 恢复。它提醒团队：代码合并并不等于 production 已经运行新代码。（来源：PR #67、#68；`issues-1-90.md`）

7 月 2 日，第一次 full-product audit 把 40 项发现分成 P1/P2/P3；PR #100 记录 39/40 修复、4 项 refuted，并首次加入 CI workflow。CI 的第一次真实运行又抓到 3 个 workflow 配置问题。与此同时 storyboard 从 prompt mastery、出卡、编辑走到“首帧确认→再出视频”的两闸闭环，兑现“做个广告 → 分镜 → 看图确认 → 出片”。（来源：PR #91、#99、#100、#111、#114；commits `98fb2488`、`7c53bb05`；`issues-91-180.md`）

| 日期 | 小事件 | 意义 | 证据 |
|---|---|---|---|
| 2026-06-29–07-02 | Grok-bright + shadcn 成为唯一视觉系统 | UI 从多 skin 分裂转向单一地基 | PR #69–#82；commit `313eb27f` |
| 2026-06-29 | MYR packs、BytePlus migration | 收费与生成 provider 本地化 | PR #66、#67 |
| 2026-06-29 | lockfile 导致 worker stale | 第一宗“merge 了但 production 没更新”事故 | PR #67、#68 |
| 2026-07-02 | full audit 39/40 remediation | 第一轮全库审计与 CI 建立 | PR #100 |
| 2026-07-02 | Storyboard 两闸闭环 | 创作链从概念变成可确认流程 | PR #91、#99、#111、#114 |

## 第五时代：宪法、城市模型与 production-scale QA（2026-07-03—07-06）

7 月 3 日是项目从“很多功能”变成“一座有法律的城”的分水岭。PR #109 把 `docs/BLUEPRINT.md` 合入 main；同一合并中，内部版本从 v1 走到 v2.3：双模城市、Otto 全操控、钱路、租户、UIUX、Parity Manifest、对标地图、九条扩建缝、P1→P4 施工顺序与 costing gate 一次成法。git-spine 把这次主干落点记作 v2.3 “地基定稿”。（来源：PR #109；commit `38106f96`；`docs/BLUEPRINT.md` 第七章；`git-spine.md`）

宪法的目的不是写漂亮口号，而是让错误变得“合不进去”。例如每个新 server action 必须在 Parity Manifest 里配 Otto skill 或明示豁免；钱路必须 reserve→settle/refund 且幂等；owner-scoped 数据只能用 session 的 `ownerId`。这些原则同时被放进 CI fence、review playbook 与 expansion seams。（来源：`docs/BLUEPRINT.md` 第二、四、五章；PR #131、#132、#149；`docs-doctrine.md`）

7 月 3–4 日，Schedule UI-first、Analytics Phase A、Meta expert diagnosis、product URL ingest 与 admin “City Hall v2” 接连落地。Schedule 先只建 DRAFT，不假装已经能发布；当 Codex review 发现 UI 与 Otto 各自直写 Prisma、违反共享 action layer 时，作者把两条写路收口到一个 service authority。（来源：PR #116–#131；特别是 PR #123、#128、#129；`issues-91-180.md`）

PR #131 进行 production-scale QA：Founder 批准 $60 cap，第一笔真实 production image generation 成功，实际用 $0.16；同一轮发现 super-admin 即使 UI 显示 “Over finance limit”，仍能 server-side 直接加 1,500 displayed credits，随后封堵。Seedance 10s 毛利被算到 45.0%，正好踩宪法地板，因此任何价格或 COGS 漂移都必须重新定价。（来源：PR #131；`issues-91-180.md`）

同一轮还遇到 Anthropic provider balance 太低，production Otto call 被上游拒绝；digest 把它定性为 provider billing，不是 FIKIRTIVE code bug，但需要 Founder top up 或 rotate production key。7 月 4 日的 51-agent、9 维度地基审计随后产出 schema-drift gate、video margin floor gate 与六组 guard tests；7 月 4–7 日的 dead-code cleanup 则刻意不碰纠缠钱路的 `cowork-actions.ts`，体现“安全 > 效率 > 易管理”。（来源：PR #131、#132、#150、#153；`issues-91-180.md`）

7 月 5 日开始出现许多小型 Codex PR，分别修 canvas recovery、navigation、activity polling；7 月 6 日又用 Grok parity GOAL 做三轮独立挑战，结论是“Grok 画布交互手感”可以追，但字面 100% 复制会撞上对外 MCP、unlimited 并行等宪法禁区。（来源：commits `e81f3373`…`f0f094b0`；`docs-doctrine.md`；PR #178/#191）

| 日期 | 小事件 | 意义 | 证据 |
|---|---|---|---|
| 2026-07-03 | BLUEPRINT v2.3 / PR #109 | 项目第一次拥有成文宪法 | commit `38106f96`；PR #109 |
| 2026-07-03–04 | Schedule、Analytics、Admin v2 | 从生成器扩成运营平台 | PR #116–#131 |
| 2026-07-04 | 首次 production paid image smoke | 钱路在真实环境被证明一次 | PR #131 |
| 2026-07-04 | 51-agent foundation audit | 把审计结论变成机器闸 | PR #132 |
| 2026-07-04–07 | dead-code sweeps | 清理与“钱路不乱动”同时成立 | PR #150、#153、#179 |

## 第六时代：Founder 愿景总爆发、North Star 危机与宪法连修（2026-07-07—07-10）

7 月 7 日，Founder 对现状给出最直接的判断：“整体体验感很糟糕”，并把 Grok canvas 定为体验目标；同一天，他给出后来 v2.5 的定位原话与双 100% 原则，还要求未来任何较弱模型都只能照完美图纸施工，不能自己幻想。（来源：`transcript-main-940bfbd9.md`，2026-07-07T05:09–06:54；`transcript-main-7fcd6fd4.md`）

Founder 与 Fable 当天共同推导出 agent-native UI / live reflection：Otto 不该像 generic computer-use 一样隔着屏幕点像素，因为“它住在 FIKIRTIVE 里面”；Otto 调同一动作层，UI 秒级反映卡片落位、coral 高亮和状态叙述。Founder 同时坚持 Otto “随时可唤起、永不抢主场”，Canvas 才是用户的家。（来源：`transcript-main-940bfbd9.md`，2026-07-07T08:11–08:55；PR #192、#195；`docs/BLUEPRINT.md` 第 11 条）

由此诞生 North Star Prototype：先把整座终局城市做成“完美但未通后台”的 interactive app，再逐块点亮。Founder 担心 page-by-page 会“断代”，要求一次做全；但 Fable quota 耗尽后 Opus 接手，质量开始不一致。7 月 8 日 Founder 亲自指出：“这不是完整版的愿景吧。你有按照FABLE的计划走吗？拼凑看起来并不整齐。若有FABLE原计划，请遵循。”（来源：`transcript-main-940bfbd9.md`，2026-07-07T10:11–18:24；`transcript-main-rest.md`，2026-07-08T04:51）

随后的自审确认：57 个 immersive routes 中有 34 个只是旧 gallery pages 套 `GalleryFrame`、改链接、藏旧 chrome，并没有真正重建；更严重的是，先前根本不存在一份 Fable-authored immersive composition plan。恢复动作是先写 636 行 `IMMERSIVE-COMPOSITION-BLUEPRINT.md`，统一 merchant data spine 与 component kit，再按 flagship zones 重建。这个 “gallery re-skin incident” 使“不监守自盗”“图纸先行”“builder 不能自评为完成”从口号变成切身教训。（来源：`transcript-main-rest.md`；North Star crisis/recovery section）

同一时期发生 staging money leak：staging 使用真实生成 provider、可能共用 live Stripe keys 与 production file storage，测试会花真钱并可能污染生产。Founder 最终批准“两级 staging”：先全 mock，再 prod-like final check；真实 provider 只能在隔离且明确批准的最后一层使用。（来源：`transcript-main-940bfbd9.md`；`transcript-wt-serene-swartz.md`，2026-07-07T08:28–08:41；PR #194）

密钥卫生也在这几天连续出事。7 月 7 日 Founder 把 X API keys 贴进聊天，assistant 当场按暴露处理并要求 rotate；7 月 10 日又有 Cloudflare Global API key 被贴进另一 session。后者的 transcript digest 明确说没有证据证明后来已 rotate 或 scope down，因此这不是可以假定已关闭的历史事项。（来源：`transcript-main-7fcd6fd4.md`、`transcript-main-940bfbd9.md`；`transcript-wt-handoff-1ec82f.md`，2026-07-10T10:57）

GitHub 也出现两层问题：一是 Actions billing 被挡，7 月 7 日后改用本地 gates 兜底；二是史料对 GitHub Pro / branch protection 的状态冲突。`transcript-main-940bfbd9.md` 记载 Founder 买了 Pro 并启用 branch protection；PR #104 body 则记载“Founder 决定不升级 GitHub Pro，私有免费仓以 CLAUDE.md+CI 代替”。两者不能同时当最终事实，故本史标为 **待核：当日可能先不升级、后又升级，或两个 session 对状态认知不同**。（来源：`transcript-main-940bfbd9.md`；PR #104；`issues-91-180.md`）

宪法在这四天快速成熟：v2.5 收入 ALL-IN-ONE + 双 100%；v2.6 收入 agent-native/live reflection；v2.7 澄清 Otto 常驻但不抢主场；v2.8 加六句解歧义；v2.9 写入零学习曲线；v2.10 澄清“我们消费平台官方协议”不等于开放外部 MCP；v2.11 把定位升级成 revenue-growth OS、建立四层边界，并永久拆开“请评”与“奖励”。同一时期多次出现 Fable quota/fallback 与 model drift，Founder 在 7 月 10 日质疑 hallucination 并提醒：“你要记得，你还是ochestrcutur。不要跑偏。”，为后来 process-level model identity 法条埋下直接前因。（来源：PR #187、#192、#195、#198、#204、#206、#212；commits `fdd18ef4`、`e746beb6`、`56364d7b`、`cba5fba2`、`2aa28b2d`、`52648239`、`94a5cfbf`；`transcript-main-7fcd6fd4.md`，2026-07-10T04:22–04:35）

| 日期 | 小事件 | 意义 | 证据 |
|---|---|---|---|
| 2026-07-07 | Founder 定义 ALL-IN-ONE + 双 100% | 产品梦正式入宪 | PR #187；commit `fdd18ef4` |
| 2026-07-07 | agent-native UI / live reflection | Otto 与 UI 关系定型 | PR #192、#195 |
| 2026-07-07 | staging leak 被发现 | 隔离与逐笔花费成为硬要求 | `transcript-main-940bfbd9.md`；PR #194 |
| 2026-07-07 / 07-10 | X / Cloudflare keys 贴入聊天 | 凭据卫生事故；Cloudflare rotation 待核 | `transcript-main-7fcd6fd4.md`；`transcript-wt-handoff-1ec82f.md` |
| 2026-07-08 | gallery re-skin incident | 图纸与独立复审成为必要条件 | `transcript-main-rest.md` |
| 2026-07-10 | v2.10 / v2.11 | 外部协议边界、业务责任边界定型 | PR #206、#212 |

## 第七时代：从“点亮一条真闭环”到 Route-B 冻结施工（2026-07-11—07-14）

7 月 10–11 日，战略从“继续扩原型城”转成“一个板块一个板块点亮”。Founder 要求先做一条真实闭环，而不是把 factory 排在所有东西前面；L0 measurement、L1 Meta organic publish 与 L-C creation zone 同时有了施工图。（来源：PR #214–#217；commits `f5da8d0c`、`0461d1a1`、`8de50a2d`、`c2f6a45a`）

L1 publish chain 很快发生“堆栈事故”：视频曾被静默降级成首帧 JPEG，reconcile/recovery 还有潜在 double-post 时序。由于 Meta publish 仍 fail-closed OFF，事故当时没有真实用户外发后果；修复则把媒体契约、IG 前置验证、exactly-once publish 与 recovery 测试收进一个重建 PR。（来源：PR #220–#231、特别是 #227、#231；commits `09cd9060`、`64d43701`；`transcript-wt-orch-skill-setup.md`）

7 月 11 日 Founder 选择“路线乙”：agent 的速度不应按人类几个月估算，应该一次把全城 functions、tests 与 Otto 连贯性做好；外部审批未到的功能先建全地基并显示 Coming soon，最后一次总验收。D7 审计同时纠正一项地面真相：旧记录说“约 3 个真实用户”，Founder 当场说“还没有用户，只有我”；Stripe 零成交、production monitoring 也未建立。（来源：`transcript-wt-small-batch.md`，Route-B 与 D7 sections）

7 月 12 日，B0 release contract 把全城冻结成 204 行有限清单，随后加 block ownership、capability hash 与 true-bijection parity semantic lock。Founder 还签署 Standing Merge Delegation：中途不逐个审批，但真实花费、production deploy、外部动作、Blueprint 与终验仍不可转授。（来源：PR #240、#251、#254；commits `1b1414d9`、`ce5c3d6c`、`7dc10b0b`；`issues-181-270.md`）

North Star 也完成角色转换：57 页城被 65 页 immersive city 超集取代，随后 Founder 又关闭它的工程 merge lane，把 `54c1de0b` 留作设计基准；真正工程从 main 按 journey PR 重建。这个决定直接吸收了 gallery re-skin 教训：prototype 是图纸，不再假装就是 production code。（来源：Founder closing comments #202、#203；`issues-181-270.md`）

B3 先落七页 `$0 shell`：canvas、factory、storyboard、home、ideas、media-editor、asset-viewer，再一笔笔清偿 shell→real-backend 的 parity debt；B8 则把 CRM、Campaign、Marketplace、口碑、first-mile/micro-site 先做成 docs-only 设计全图。B2/B9 contracts 经 Codex R3–R8 多轮复审，R-009 最终选择 split-freeze，而不是为了速度放松机械一致性。（来源：PR #244–#268；commits `a11dd368`、`cd549c6f`、`6c7fc5d9`、`356fa583`、`d4cbfea2`、`62360aac`；`transcript-wt-orch-skill-setup.md`）

7 月 13–14 日，gross-margin floor gate 与 backup/restore drill 完成；orchestration skill 也多次 re-pin。Founder 一边授权 ordinary work 自行处理，一边质疑 Codex 复审是否过多、`/orchestration` 是否造成两天可见产出太少；最终形成 review 分层：Codex 看节点/小节总结，Claude 看小修，重大合同仍要跨族 challenge。（来源：commit `d3f5cacd`；PR #269、#270、#281；`transcript-wt-orch-skill-setup.md`）

| 日期 | 小事件 | 意义 | 证据 |
|---|---|---|---|
| 2026-07-11 | L1 publish stack incident | 外发 exactly-once 从概念变成事故后硬闸 | PR #227、#231 |
| 2026-07-11 | Route-B 选择 | 从 prototype-first 转向全城直建 | `transcript-wt-small-batch.md` |
| 2026-07-12 | B0 204 行 contract | Scope 第一次被有限清单冻结 | PR #240 |
| 2026-07-12 | Standing Merge Delegation | 中途效率与 Founder-only 边界并存 | PR #254 |
| 2026-07-12–13 | B3 shells + debt ratchet | Coming soon 不再被误当完成 | PR #261–#268 |
| 2026-07-14 | Grill verdicts / wayfinder | “卖什么、先卖哪条纵切”重判 | PR #298；commit `ce65cbe8` |

## 第八时代：权威来源整顿与商业第一期重定义（2026-07-15—07-17）

Route-B 的高速施工暴露另一个问题：计划、memory、旧 control-plane、GitHub 票与 Founder 口令同时存在，fresh session 不知道谁才是权威。7 月 15–19 日的 sanitation 把唯一入口改为 GitHub Founder Resolution，要求保存批准原话、时间、范围与 supersedes 链，不再靠翻聊天拼授权。（来源：Founder Resolution #335；issues #331–#336；`issues-271-360.md`）

7 月 15 日，Founder 用 #334 连续重确认 16 个产品问题。产品本体是营销与增长平台，Otto 当时被表述为平台里的 AI 营销员工；目标客户收窄为马来西亚已经经营、有商品、社媒和老客、但没有完整营销团队的老板/极小团队；“可用内容”必须过理解、判断、手艺、采用、证据五关。（来源：Founder Resolution #334；`issues-271-360.md`）

最重要的纠偏是：施工波次 P1→P4 不等于商业第一期。商业第一期必须纵向同时交付“做出好内容、发出去、经营顾客的 CRM”，其中 CRM 要达到 respond.io 类别完整度，但不建假的 Salesforce Companies/Deals/Forecast 骨架；第一期只要求 WhatsApp 这一条顾客渠道真实上线。（来源：#334；PR #337；commit `1dd479b8`；`docs/BLUEPRINT.md` 第六章）

同一时期 governance ledger 记下 “Codex 接管”与 Founder 边界；commit `1fae4dbc` 首次把 generation-spend uncertainty 明标 `[Founder-only]`。另一次跨族 review 在 issue #320 找到 tenant guard 真空：`update` / `delete` / `upsert` 未被 `tenant-guard.ts` 全覆盖，约 69 个 call sites 可能需要独立审计，因此没有顺手塞进别的 PR。（来源：commit `7dd03329`；PR #325；issue #320；`issues-271-360.md`）

| 日期 | 小事件 | 意义 | 证据 |
|---|---|---|---|
| 2026-07-15 | authority sanitation 开始 | 批准与 current state 回到 GitHub | issues #331–#336 |
| 2026-07-15 | #334 产品身份 16 问 | 抽象愿景被改写成可验收产品 | Founder Resolution #334 |
| 2026-07-15 | `[Founder-only]` money marker | 钱路合并权限显式化 | PR #325；commit `1fae4dbc` |
| 2026-07-16 | BLUEPRINT v2.12 | 商业一期三支柱入宪 | PR #337；commit `1dd479b8` |
| 2026-07-15+ | tenant-guard vacuum | 跨租户写风险被单列而非掩盖 | issue #320 |

## 第九时代：CRM C1–C7、商家数据原则与治理事故（2026-07-18—07-22）

7 月 18 日起，CRM 从设计全图进入真实施工。Dynamic Segments（C3）与 Campaign zero-spend base（C2a）先落；7 月 19 日，append-only consent ledger、fold/replay engine 与 Contacts vertical slice 完成。Append-only 的意思是事件只追加、不偷偷改旧记录，当前状态由历史折叠计算，因此能审计同意、勿扰与拒发如何形成。（来源：commits `04c006e7`、`0613e961`、`83946443`、`1f8d8f26`；PR #361–#366）

这些设计受一条 Founder 原话统领：“商家的 data，商家的权利，我们只是提醒。”因此第一期不代商家硬删除 permission evidence，只做 tag/提醒；导出是商家权利；平台是受托保管人；企业级 field encryption / customer-managed key 被定为未来必须项。（来源：Founder Resolution #356；PR #363/#364；`transcript-wt-mid-batch.md`，2026-07-18–19）

WhatsApp 路线在这一时期两次转向。7 月 14 日先因 360dialog 固定月费难 scale 而选 Gupshup 起步；7 月 21 日又 supersede 为 Meta Cloud API 直连 + Embedded Signup，让商家在 FIKIRTIVE 内连接自己的 WABA，号码和数据仍归商家自己的 Meta Business Manager。（来源：issue #293；Founder decision #301；ledger #359 item 29；`issues-271-360.md`）

7 月 19–21 日，Inbox C4a/C4b、Broadcast eligibility C5 与 simulated provider workbench 完成；发送资格由 permission、suppression、frequency 等四轴共同判断。7 月 22 日，C6 receipts/reconciliation/reporting 与 C7 workflows/lifecycle 又按 M0 contract→M1 schema→M2 engine→M3 UI 分站推进；所有外部 provider 仍模拟，`SEND_PATH_UNAVAILABLE` 全域 fail-closed，不能把“UI 能点”写成“已经真的发出”。（来源：commits `660efe0e`、`99a192a6`、`2c3f1d89`、`07ca184e`、`29d01de1`、`9dcf8078`、`6378279e`、`9a17412e`、`f2adffac`、`287fdde3`、`fabb61c4`、`44d28497`；issues #368–#422）

7 月 20 日 GitHub Actions 多次出现 zero-step（`steps=[]`）运行。项目没有把它当绿灯：每次需要 exact-head 本地四 job、跨族 P0/P1=0、非作者 executor，再由 Founder 单独批准 CI-unavailable merge。这是“GitHub outage”在史料里的准确含义：不是已证实的全站 outage，而是本仓当时 CI 无法产生有效步骤。（来源：issues #368–#371；`issues-361-453.md`；`docs/runbooks/local-ci.md` 摘要见 `docs-doctrine.md`）

7 月 21 日发生 model-identity stop-line incident：一个 session 根据未经验证的 model/harness claim 继续行动。PR #390/#391 随即把“必须以 process evidence 验证模型身份；失败则该身份授予的权限立即暂停”写进项目法；claim scope 也必须列出 registry/export touch points，无法解析的 evidence pointer 本身成为 finding。（来源：issue #390/#391；`issues-361-453.md`）

7 月 22 日又发现 8 个前一日 PR 的 GitHub 记录都显示 Founder account 同时 author/mergedBy，reviews 为空，无法辨认是 Founder 本人点击还是 session 使用 token。Founder Resolution #404 与 PR #406 因此要求每次 merge 留 executor evidence。治理从“谁的账号”升级为“谁实际执行、凭什么授权、何时执行”。（来源：issue #404；PR #406；commit `55ef59d1`；`issues-361-453.md`）

| 日期 | 小事件 | 意义 | 证据 |
|---|---|---|---|
| 2026-07-18–19 | C3/C2a/C1 | CRM 由图纸进入数据与 UI | PR #361–#366 |
| 2026-07-19 | 商家数据原则重申 | privacy 以商家权利为轴 | Resolution #356；PR #364 |
| 2026-07-21 | Gupshup→Meta direct | 渠道 ownership 回到商家 | Founder decision #301 |
| 2026-07-21 | model-identity incident | 未验证模型不再拥有身份权限 | PR #390/#391 |
| 2026-07-20–22 | zero-step CI | “CI unavailable 不是绿”成惯例 | issues #368–#371 |
| 2026-07-22 | merge executor evidence | Token/account 不再等于执行者 | issue #404；PR #406 |
| 2026-07-22–23 | C6、C7 | receipts 与 workflows 建成模拟闭环 | PR #399–#422 |

## 第十时代：上线前测试战役、v2.13 与 fix batch（2026-07-23—07-24）

Founder 在 7 月 22 日下令：“在整个上线前，我要你帮我做全面的 Full UIUX user flow test（优化完美全部的UIUX，让用户体验感丝滑流畅）和 full product readiness test 和其他类似且必要的 test。请记下来。”测试战役 #424 以 main `44d28497` 为 baseline，覆盖 C1–C7，desktop-only，任何外部 release 必须等战役完成。（来源：`transcript-wt-orchestration-07ae75.md`，2026-07-22T02:14；issue #424）

测试不是只跑单测。它实际走 login、global navigation、Otto first turn、zero-balance generation、Campaign、Inbox、Broadcast、receipts、workflows 与 accessibility。结果包括：全局导航断裂 #427、登录错误提示不诚实 #428、0 balance 没显示拦截且完全失败却报 “Generation started” #430、Otto 零 credit 首轮静默空白 #431、dead links、contrast 失败，以及 broadcast purpose 可被 client spoof #438。（来源：issue #424；issues #427–#438；`issues-361-453.md`）

钱路本身在 #430 中仍被验证为 fail-closed、zero-charge；出错的是“诚实层”——server 拒绝了，但 UI 吞掉真实原因并报成功。修复批次随后落地：global nav #435、broadcast spoof #446、Otto zero-balance #448、generation confirmation honesty #449、P2/P3 站二批 #452、provider secrecy #454。Dialog close-focus-return 因三次实现都无法浏览器证实而回退，另拆 #451；这比留下一个“看起来修了”的 patch 更符合证据纪律。（来源：PR #435、#446、#448、#449、#452、#454；issue #451；commits `4049323d`、`4ed2c920`、`50e1ab95`）

跨族只读审计给出不一致但诚实的 verdict：#385/#408 PASS，#396/#398 PASS_WITH_NOTES，#383/#387/#394/#392 FAIL；不过审计同时确认当前没有真实用户发送风险，因为 send path 全域 unavailable。FAIL 的意义不是“产品已经伤害用户”，而是“在允许真实发送前，这些证明缺口必须闭合”。（来源：`issues-271-360.md`，2026-07-23 audit verdicts）

7 月 23 日，Founder 把 Otto 的身份从“AI 营销员工”再收紧成 “FIKIRTIVE’s operator — the platform’s hands”：Otto 应先理解用户想要什么，再用 skills 操作整个平台，不预设用户一定是商家。这个变化没有否定 FIKIRTIVE 的营销产品本体，而是避免 Otto 的执行能力被一段 persona 文案人为缩窄。（来源：`transcript-wt-orchestration-50ba3d-current.md`，2026-07-23T08:22–10:56；issue #437）

同日 Founder 决定 video 只用 Seedance、image 只用 Seedream、移除 fal，并把 provider identity 设为 trade secret：UI、toast、email、export、API response 都不得泄漏。公开 privacy policy 是否应具名 provider 被留给独立 Founder 决定，audit #436 不得顺手改。（来源：issue #436、#443；PR #454；`issues-361-453.md`）

BLUEPRINT v2.13 也在 7 月 23 日合并：第 9 条“spec 华语 / prompt 英文 / UI sentence case”从宪法移出，编号留墓碑；prompt 语言改由每个 engine 的权威模块按实测决定，触发案例是 Seedance 2.0 中文 prompt 更好；同时把“Parity fence 仍 warn→hard 在建”的旧句更正为“hard gate 已上线”。PR #445 补上 #444 漏掉的 integrity hash。（来源：PR #444、#445；commits `281794ab`、`6928dbe6`；`docs/BLUEPRINT.md` 第 9 条与修订表）

| 日期 | 小事件 | 意义 | 证据 |
|---|---|---|---|
| 2026-07-23 | test campaign #424 | 从 code review 进入真实 user-flow 验证 | issue #424 |
| 2026-07-23 | #430 / #431 | “server 诚实、UI 说谎”成为跨流模式 | issues #430、#431 |
| 2026-07-23 | v2.13 | 工程事实不再冒充永恒宪法 | PR #444、#445 |
| 2026-07-23 | sole providers + secrecy | provider 选择与用户体验解耦 | issues #436、#443 |
| 2026-07-24 | fix batch #449/#452/#454 | P1 money honesty、P2/P3、保密修复 | commits `4049323d`、`4ed2c920`、`50e1ab95` |

---

## 宪法修订全线：v2.0 → v2.13

> 说明：v2.0–v2.3 是 2026-07-03 在同一 PR #109 内连续形成的内部版本；Git commit history 只把最终合入点记作 v2.3。以下按 live Blueprint 修订表复原，不把同一 PR 内部版本误写成多次 main merge。（来源：`docs/BLUEPRINT.md` 第七章；`git-spine.md`）

| 版本 | 日期 | 改了什么 | 证据 |
|---|---|---|---|
| v2.0 | 2026-07-03 | 收入 harmony 六件、Parity Manifest 第九缝、P1→P4 施工顺序与 costing 动工闸 | `docs/BLUEPRINT.md` 修订表；PR #109 |
| v2.1 | 2026-07-03（后补记） | 5-agent 40+ findings 后重写毛利≥45%、效率良心、开发花费边界、账本推论、O-12/O-09、团队协作、账务透明、资源包告警等 | `docs/BLUEPRINT.md` 修订表；PR #109 |
| v2.1a | 2026-07-03 | SEA 是滩头，终点是全球世界级平台 | `docs/BLUEPRINT.md` 修订表；PR #109 |
| v2.2 | 2026-07-03 | harmony-06 UIUX/gamification 补件，总设计从六件变七件 | `docs/BLUEPRINT.md` 修订表；PR #109 |
| v2.2a | 2026-07-03 | GM-02/03/04/05 要，GM-01 streak 不要 | `docs/BLUEPRINT.md` 修订表；PR #109 |
| v2.3 | 2026-07-03 | 11 区对标地图与“深研→WHAT-pass”活清单入宪 | PR #109；commit `38106f96` |
| v2.4 | 2026-07-04 / git 2026-07-06 | 回填批准列；修订表 append-only、不重排；刷新区划图 | PR #134；commit `bff7f502` |
| v2.5 | 2026-07-07 | Founder 原话：ALL-IN-ONE powerhouse + 人/Otto 双 100%；禁止 agent 自创 feature | PR #187；commit `fdd18ef4` |
| v2.6 | 2026-07-07 | Agent-native UI、live reflection 四原则 | PR #192；commit `e746beb6` |
| v2.7 | 2026-07-07 | “常驻陪伴”改成“随时可唤起、永不抢主场”，避免与 canvas-first 冲突 | PR #195；commit `56364d7b` |
| v2.8 | 2026-07-07 | 六句解歧义：豁免、租户/admin、秒级实时、开发花费/routine、webhook、credits display | PR #198；commit `cba5fba2` |
| v2.9 | 2026-07-09 | 零学习曲线：只需会“说要什么”和“点批准”；实力是信任引擎 | PR #204；commit `2aa28b2d` |
| v2.10 | 2026-07-10 | 我方消费平台官方协议（含官方 MCP）不属于“开放外部 agent 操作面” | PR #206；commit `52648239` |
| v2.11 | 2026-07-10 | revenue-growth OS 定位、四层责任边界、请评×奖励永久分离 | PR #212；commit `94a5cfbf` |
| v2.12 | 2026-07-16 | 商业第一期三支柱；CRM 对标 respond.io；WhatsApp 唯一必真实上线顾客渠道 | PR #337；commit `1dd479b8` |
| v2.13 | 2026-07-23 | 语言约定移出宪法；Article 9 留墓碑；prompt 语言按 engine 实测；第九缝状态更正 | PR #444/#445；commits `281794ab`、`6928dbe6` |

**v2.13 状态的史料差异：** `git-spine.md` 与 issues digest 明确记录 #444 已 merged、#445 已补 hash；live `docs/BLUEPRINT.md` 最新修订行仍写“待 founder 终审”，而该文件自己的规则又写“Founder 合并即定稿，批准列由下一次修订回填”。因此依 Git 与文件自身规则，v2.13 应视为已定稿；但批准列尚未回填。`docs-doctrine.md` 还写“尚未合并”，属于与 Git 冲突的旧摘要，标记 **待核/待下次修订回填**，不可再引用为 current truth。（来源：`git-spine.md`；`docs-doctrine.md`；`docs/BLUEPRINT.md` 第七章；PR #444/#445）

## 审计、危机与恢复：一眼看懂

| 时间 | 审计 / 危机 | 当时 verdict | 恢复 / 后果 | 证据 |
|---|---|---|---|---|
| 2026-06-25 | Otto v1 prod-readiness | 找到真实跨租户 Brand Memory read | 改为 session-scoped owner | PR #4 |
| 2026-06-27 | G1–G59 ultra-review | 0 critical；找到 video gate mismatch | 默认 spendable model 与 server gate 对齐 | PR #60 |
| 2026-07-02 | full-product audit | 39/40 remediation，4 refuted | CI 首次建立并抓 3 个配置 bug | PR #100 |
| 2026-07-03 | Blueprint v2.1 challenge | 5-agent 40+ findings | 重写毛利、效率、边界、parity、账本 | PR #109 |
| 2026-07-04 | foundation audit | 51-agent / 9 维度 | schema drift、margin floor、guard tests 成机器闸 | PR #132 |
| 2026-07-07 | full-repo cleanup audit | 37-agent；Actions billing blocked | -4,931 lines、parity debt ratchet、本地 gates | PR #179/#180 |
| 2026-07-08 | gallery re-skin incident | 34/57 routes 非 native rebuild | 636 行 composition blueprint；禁止自评冒充完成 | `transcript-main-rest.md` |
| 2026-07-11 | L1 publish incident | video→JPEG、潜在 double-post | 合并重建媒体契约与 exactly-once tests | PR #227/#231 |
| 2026-07-21 | model identity stop-line | 未验证 model claim 被用于授权 | process-evidence rule、claim/evidence 加固 | PR #390/#391 |
| 2026-07-22 | merge provenance audit | 8 PR 无法辨认实际 executor | 每次 merge 必留执行者证据 | issue #404；PR #406 |
| 2026-07-23 | cross-family read-only audit | PASS / PASS_WITH_NOTES / FAIL 并存 | send path 继续 fail-closed；finding 全进票 | issues #383–#408 |
| 2026-07-23–24 | pre-launch campaign | 0 P0；多项 P1/P2/P3 user-flow finding | #435/#446/#448/#449/#452/#454 fix batch | issue #424 |

---

## 当前坐标（截至 2026-07-24）

### 梦与法律

产品终局已经相当清楚：一座世界级 ALL-IN-ONE 营销与营收增长平台；人工工具完整，Otto 用同一动作层操作全城；安全、钱路、租户、毛利、双模、UIUX 与零学习曲线都有成文法和部分机器闸。（来源：`docs/BLUEPRINT.md` 第一、二、四章；PR #109、#149、#180）

商业第一期的完成定义也已固定为三支柱，而不是旧的波次编号：内容、发布、Customer Engagement CRM 必须一起达到真实可售；Founder 的终验与 full-product production gate 仍未完成。（来源：`docs/BLUEPRINT.md` 第六章；#334；PR #337）

### 已经建成的产品骨架

创作侧已经有 Canvas、image/video generation、reference、Storyboard、Brand Memory、Assets、Templates/Discover、Otto skills 与 credits ledger；但 Blueprint 的“品类一流内容”还要求系统性证明理解、判断、手艺、采用与证据，不可因技术链跑通就宣布完成。（来源：`docs/BLUEPRINT.md` 第三、六章；PR #48–#114）

CRM 侧已经完成 consent/contacts/segments/campaign/inbox/broadcast/receipts/workflows 的数据、engine 与 UI 骨架；其中多条 provider 行为仍是 simulated，production DB apply 与 backup cadence 多次被记为 Unknown/withheld。（来源：PR #361–#422；ledger #359 item 12；`issues-361-453.md`）

发布侧有 Schedule UI、draft model、PublishAttempt 防双发、Meta adapter 基础与 reminder-assisted 设计；但真实 channel×post-type 的 direct publish 仍受 Meta permission/App Review/连接与外部验收限制，不能称“发布支柱已真实完成”。（来源：PR #123/#129/#215–#231；`docs/BLUEPRINT.md` 第六章）

### 安全与治理现状

钱路的 reserve/settle/refund、idempotency、fail-closed 与 money-safety-review 已多次通过真实/模拟验证；最新 #430 证明 server money path 在 UI 误报时仍 zero-charge。可是 #453 仍记录一个 pre-existing money-adjacent bug：video 已 charged 后若缺 `taskId`，抛普通 `Error` 而非 `chargedError`，尚需独立 money review。（来源：PR #449；issue #453；`issues-361-453.md`）

治理已经从“session 说自己是谁”升级为 task claim、process model evidence、GitHub Founder Resolution、CI-unavailable explicit approval、cross-family review 与 merge executor evidence。它比早期严密得多，但这些制度本身也来自实际事故，不能因为写成法就假定执行永远无误。（来源：PR #390/#391/#406；current project law；`issues-361-453.md`）

### 仍未闭合的主线

- #320 tenant-guard vacuum：约 69 个 `update/delete/upsert` call sites 的系统审计与翻闸仍是独立任务。（来源：issue #320；`issues-271-360.md`）
- #423 CI flakiness 与 #439–#442 四项 P2：transaction recovery、provider connection locking、concurrent resume、AST-level auth fence 尚未闭合。（来源：issues #423、#439–#442；`issues-361-453.md`）
- #451 dialog close-focus-return 仍等待可信浏览器环境；已有三次实现因无法实证而回退。（来源：issue #451；PR #452）
- #437 Seedance/Seedream full-capability prompt engineering 尚未完成。（来源：issue #437）
- #379/#380 competitor/trend data ports 与 #397 trend-reactive content 仍等待 provider/spend/legal gate。（来源：issues #379、#380、#397）
- WhatsApp Meta direct self-serve、真实 send、production apply、全量 UIUX macro walkthrough、Founder final review 与正式 launch 均未被当前史料证明完成。（来源：decision #301；issue #424；ledger #359；`docs/BLUEPRINT.md` 第六章）

因此，2026-07-24 的准确说法不是“产品完成”，而是：**宪法与一期定义已定；创作与 CRM 的大部分骨架已建；测试战役已进入 fix batch；真实外部连接、production apply、剩余安全票、宏观 UIUX 终验与 Founder final gate 尚未闭合。**（来源：`git-spine.md` 最后事件；issue #424；`issues-361-453.md`；`docs/BLUEPRINT.md` 第六章）

---

## 已知历史缺口

1. **Git 历史从 2026-06-10 才开始。** 在此之前的 ideation、原型或删除过的 early sessions 没有进入 763-commit spine；本史无法把缺失的口头过程补写成事实。（来源：`git-spine.md` source completeness）
2. **早期 GitHub #1–#180 几乎全是 Claude Code 生成的 PR body，不是 Founder 亲写 issue。** 其中“Founder chose/approved”多数是 agent 转述；只有 digest 明标的 `nicksgan-belcort` comments 与 transcript 原话可当 verbatim。（来源：`issues-1-90.md`、`issues-91-180.md` source note）
3. **部分 transcript 被复制、fork 或截断。** `110d818c…` 与 `e87e5eeb…` 是 byte-identical；serene-swartz 四个文件是同一会话不同长度 fork；这类重复已去重，但分叉尾部仍可能遗漏。（来源：`transcript-main-rest.md`；`transcript-wt-serene-swartz.md`）
4. **两个 worktree 目录没有 `.jsonl`。** `issue-311-money-hardening-r003` 与 `quizzical-jepsen-4a383a-apps-web` 因空目录无法取证；若曾有 Founder 对话，目前无本地 transcript 证据。（来源：`transcript-wt-small-batch.md`）
5. **有些 digest 只抽 Founder-authored messages。** 这能保护“Founder 原话”的纯度，却也会失去 assistant menu、tool output 与当时完整上下文；本史只在 digest 已回查相邻 context 时使用对应裁决。（来源：各 `transcript-*` source note）
6. **GitHub Pro / branch protection 历史冲突待核。** transcript 记“已买 Pro 并设 protection”，PR #104 记“决定不升级，用流程代替”；需要 GitHub billing/audit log 才能最终裁决。（来源：`transcript-main-940bfbd9.md`；PR #104）
7. **v2.13 批准列尚未回填。** Git 与 PR 证明已合并，但 live Blueprint 表格仍写“待 founder 终审”，`docs-doctrine.md` 又误写“尚未合并”；应由下一次合宪修订按 append-only 规则回填。（来源：PR #444/#445；`docs/BLUEPRINT.md` 第七章；`docs-doctrine.md`）
8. **Cloudflare Global API key 的 rotation 无证据。** 史料只证明它曾贴进聊天，未证明后来已 rotate/scope；不得从沉默推定安全关闭。（来源：`transcript-wt-handoff-1ec82f.md`）
9. **D-014、D-028 等部分 Founder 原话只在 route-b decision log 被引用，GitHub issue body 没有逐字文本。** 本史只记录其摘要，不伪造原句。（来源：`issues-181-270.md` Open threads）
10. **当前 external/production facts 不是历史文档能替代的。** Meta approval、Railway env、backup cadence、production schema、真实 send、CI 与 deploy 状态每次都必须 live query；没查就是 Unknown。（来源：`docs/runbooks/staging.md`、`local-ci.md` 摘要见 `docs-doctrine.md`；current project law）

---

## 给未来协作者的一句话

FIKIRTIVE 的历史不是“功能越堆越多”的直线，而是一次次把 Founder 的梦翻译成可验证边界：从 Artlio Studio 到 Otto Canvas，从“AI 会做”到“人工与 Otto 操作同一座城”，从 gallery re-skin 与 staging leak 到图纸、钱路、租户、模型身份、证据与执行者都可审计。未来任何工作若只让 demo 更像完成，却没有让三支柱更真实、让用户更丝滑、让钱与数据更安全，就是在重复这段历史已经付过代价的错误。（来源：全线总结依据 `git-spine.md`；`docs/BLUEPRINT.md`；PR #100/#109/#132/#240/#337/#424）
