# FIKIRTIVE 执行总路线图(MASTERPLAN)

> **文件性质 —— 先读这个**
> 本文件是**蓝图(`docs/BLUEPRINT.md`,宪法)之下的执行层路线图**:宪法回答"这座城是什么、什么永远不变",本文件回答"接下来按什么顺序施工"。**任何条目与蓝图冲突时,蓝图赢** —— 发现冲突即停手报告 founder。
> **版本:v1 草案,待 founder 终审。** founder 批准(合并本 PR)后,本文件 = **执行模型(runner)的唯一作业队列来源**:runner 只从本表取活,不自行发明工作项。
> 维护:由总审查员随施工进度更新(状态列流转、新增项走"待拍板"通道);产品决定永远归 founder。
>
> **每个条目五字段**:来源(判决/宪法条/审计发现,必须可查证)· 缝(走 `docs/review/EXPANSION-SEAMS.md` 哪条)· 验收(可执行命令或可点击验证)· 规模(S/M/L)· 状态(**待拍板** = founder 未批,不得动工 / **可开工** = 依据齐全 / **在途** = 已有 PR)。
> **铁律:凡"待拍板",在 founder 批准前 runner 不得动工、不得默认"应该会批"。** 本文件不制造任何新决定 —— 没有既有依据的项一律进第七章待拍板清单。

---

## 〇、决策语料与效力顺序(runner 取活前必读)

本文件的每一行都**引用**下列文件,不复述、不改写;两边不一致 = 本文件有错,以被引文件为准并报告总审查员。效力从高到低:

| 层 | 文件 | 本文件如何用它 |
|---|---|---|
| 宪法 | `docs/BLUEPRINT.md`(**永不编辑**,CI `check-blueprint-integrity.sh` 看守) | 一切条目的合宪性来源;冲突即停 |
| 判决记录 | `docs/research/GRILL-VERDICTS-2026-07-03.md`(含 2026-07-07 追加节)+ `docs/review/DECISION-INVENTORY-2026-07-02.md` | "来源"列引用的判决原文 |
| 建筑规范 | `docs/review/REVIEWER-PLAYBOOK.md` | 每个 PR 的终审清单 |
| 总设计 | `docs/design/2026-07-03-harmony-01~06`(七件) | P1→P4 的结构与数据形状 |
| 地质报告 | `docs/review/EXPANSION-SEAMS.md` / `CODEBASE-MAP-2026-07-02.md` / `DEAD-CODE-INVENTORY-2026-07-04.md` | "缝"列的施工配方;清理项的安全删法 |
| 审计 | 2026-07-04 地基审计(`docs/review/LAUNCH-READINESS-AUDIT-2026-07-04.md` 等)+ 2026-07-07 引擎/卫生审计(会话产出,关键数字已核入本文件与引擎 spec) | "审计发现"类来源 |

---

## 〇点五、里程碑顺序总览(一眼版)

```
P0 安全带收尾 ──┐
                ├─→ P0.5 引擎升级(caching → 分域)─→ P0.75 对等债 84 条分批清偿
                │        (判决④:先引擎后还债)
                └─→ P1 创作变现(工厂 Wave 1→2→3;P1-0 告警可先行)
                        └─→ P1½ 排期+Routine → P2 消息+第二账道 → P3 CRM+Campaign → P4 深化
```
P0 与 P0.5/P1 可并行(不同文件面);P0.75 严格在 P0.5 之后;P1½ 以后严格按 harmony-01 §六 顺序。

---

## 一、P0 —— 安全带收尾(上量前必须闭合的地基项)

| # | 项 | 来源 | 缝 | 验收 | 规模 | 状态 |
|---|---|---|---|---|---|---|
| P0-1 | **数据库夜间备份**。方案待 founder 三选一:① Neon 升 Launch 档开 PITR(~$19+/月起,平台级)② $0 方案:worker 定时 `pg_dump` → R2(独立 bucket、保留 N 天)③ 两者都做 | 审计发现:2026-07-04 地基审计即列"Neon PITR 仍是 founder-only 遗留项",2026-07-07 审计复核仍未闭合(prod 无任何备份;推 main 自动跑 prisma migrate,见 `AGENTS.md` 规则 1) | 方案② 走缝 6(queue/worker 定时任务);方案① 纯平台设置 | 一次**真实恢复演练**:从最近备份在临时库 restore,`psql -c 'select count(*) from "CreditLedger"'` 与 prod 对账一致;备份任务连续 7 天绿(admin 可见最近成功时间戳) | S-M | **待拍板**(方案选择) |
| P0-2 | **verify-auth-guards.mjs 修复并接 CI**:`scripts/verify-auth-guards.mjs:12` 的 GUARDS 正则只认 requireSession/requireRole/requireAdmin,**不认 requireOwner**(全库最核心的守卫,见缝 5),导致 105 误报、脚本长期无法接 CI | 审计发现(2026-07-07);requireOwner 契约见 `docs/review/EXPANSION-SEAMS.md` 缝 5 | 工具修复,不碰业务代码 | `node scripts/verify-auth-guards.mjs` exit 0;加入 `.github/workflows/ci.yml`;自测:临时注入一个 prisma-before-guard 的样例函数必须红 | S | 可开工 |
| P0-3 | **ESLint 128 errors 清理并接 CI**:`pnpm lint` 当前 128 errors,且 CI 不跑 lint(ci.yml 只有 lint:parity) | 审计发现(2026-07-07);判决④(2026-07-07,见第六章)"最好的全都做" | 逐包清理,禁止顺手改逻辑(surgical) | `pnpm lint` 0 error;ci.yml 增加 lint job 且全绿 | M | 可开工 |
| P0-4 | **批次 3 清理** —— 五个子项,**每一子项单独待 founder 逐项批**;明细见下方 1.1 小节 | `docs/review/DEAD-CODE-INVENTORY-2026-07-04.md` §1/§5 明文要求"founder 逐项显式批准";判决⑤(2026-07-07)只授权了批次 1/2(PR #179/#180),批次 3 未授权 | 见 1.1 | 见 1.1 | 见 1.1 | **待拍板(逐子项)** |
| P0-5 | **parity 扫描器盲区修补**:`scripts/check-parity.mjs:43` 只认 `export async function`,不认 `export const x = async` 形状(与 verify-auth-guards 已支持的两形状对齐);`apps/web/lib/data.ts` 的 8 个读面补登记 | 审计发现(2026-07-07);第九缝本义(宪法第 7 条机器围栏,`docs/design/2026-07-03-harmony-02-parity-manifest.md`) | 缝 9 | `pnpm lint:parity` 绿;自测:临时加一个 `export const x = async` 形状的未登记 action 必须红 | S | 可开工 |

### 1.1 批次 3 子项明细(对应第七章 7-10~7-14)

| 子项 | 内容 | 风险与安全删法 | 验收 | 规模 |
|---|---|---|---|---|
| 3a | 删 3 个死付费端点:`apps/web/lib/cowork-actions.ts` 的 coworkTurn / enhancePrompt / coworkDraftStoryboard(死的付费面 —— `"use server"` 导出,任意已认证客户端理论可 POST 触发付费 LLM) | 与钱路核心 coworkGenerate 同处一个 789 行文件;**严格按 DEAD-CODE-INVENTORY §1 已测绘的 helper/import 归属图执行**(getEnhanceDirective/familyHasPromptSkill 共用必留;coworkTurnRequest 是 LIVE schema 绝不能碰);同 PR 删 money-safety-review SKILL.md:41 的死不变量 + 对应 parity 条目 | typecheck + 全量测试绿;末尾对抗审查确认 coworkGenerate 逐行未动;money-safety-review 过闸 | M |
| 3b | NextAuth 3 张死表(Account/Session/VerificationToken)DROP 迁移 | 破坏性迁移推 main 自动改 prod,**不可逆**;迁移必须带 `-- DESTRUCTIVE-OK: <理由>` 过 `scripts/check-destructive-migrations.sh` 闸;**前置:P0-1 备份已落地** | 迁移在本地库与 prod 影子库各演练一次;三表在代码 0 读 0 写的 grep 证据贴 PR | S |
| 3c | 11 个花钱/prod 脚本加确认锁(交互确认或 `CONFIRM_SPEND=yes` 式显式 env) | 纯加锁不改逻辑;锁的形态统一一种 | 逐个脚本裸跑必须拒绝执行并说明所需确认 | S |
| 3d | `scripts/` 分层归档(活跃工具 / 一次性验证存档 / 花钱脚本三层) | 纯移动 + 引用路径修正(ci.yml/package.json 引用的脚本路径同步) | CI 全绿;`pnpm lint:parity`、blueprint 闸照常可跑 | S |
| 3e | 重复代码统一:Meta 错误处理 6 处复制统一 + extractText 三副本统一(`apps/web/lib/otto-actions.ts:303`、`:794`、`apps/worker/src/otto-resume.ts:113`) | 紧邻 Otto 回合与 Meta 写路径,surgical 提取、不改行为;otto-resume 的副本涉及 worker 无 spend 上下文,提取的共享函数放 packages/otto(结构类型,不得让 worker 反向 import apps/web) | typecheck + 全量测试绿;行为零变化(无新测试语义,只有去重) | M |

---

## 二、P0.5 —— 引擎升级(判决④:先修引擎,后规模化还债)

| # | 项 | 来源 | 缝 | 验收 | 规模 | 状态 |
|---|---|---|---|---|---|---|
| P0.5-1 | **Phase 1:Anthropic prompt caching**(固定前缀 ≈12.4k tokens/步 × 10 步/轮全价重发,cache 读价 $0.30/M vs $3/M) | 判决④(2026-07-07,第六章);效率良心条款(宪法 5;GRILL-VERDICTS 定价终案节效率工单①,含前置"先补 meter 的 cache_write 处理");harmony-04 §四·2 点名"最大降本杠杆" | 引擎内部(meter/model 层),碰计量 = money-safety-review | 见 spec 的验收节:真实 turn `usage.cached_tokens > 0` 且 settle 下降、env 开关可回滚 | M | spec 已交(`docs/superpowers/specs/2026-07-07-otto-engine-caching-scoped-loading-design.md`),**动工前待 founder 过目**(宪法第五章:图纸先行) |
| P0.5-2 | **Phase 2:技能分域装载**(25 技能全静态挂载 → 按 viewContext+意图确定性选域装载;core 域常驻) | 判决④(2026-07-07);宪法 10(确定性代码,不靠模型天赋);效率良心条款(臃肿上下文按缺陷处理) | 缝 1(registry 加 domain 字段)+ 引擎内部 | 同上 spec 验收节:各域前缀 token 报表、RunState 三场景回归绿、回滚开关 | M-L | 同上,**动工前待 founder 过目**;顺序在 Phase 1 之后 |

> 两个 Phase 的完整设计、验证清单与回滚方案 = `docs/superpowers/specs/2026-07-07-otto-engine-caching-scoped-loading-design.md`(本 PR 交付物 2)。

---

## 三、P0.75 —— 对等债务清偿(84 条 todoSkill)

**来源**:宪法 7(Otto 全操控 + 读的对等)、第九缝(harmony-02);棘轮基线 84 由 PR #180 落地(在途)。**顺序依据**:判决④ —— 引擎升级(P0.5)完成后再规模化还债,还债轮次即享受分域装载(新增技能不再线性加重每轮前缀)。

**清偿纪律**:每批 = 一个 PR;批内每条 todoSkill → 配对 skill(走缝 1 六处登记)或转四类封闭豁免之一;PR 合并即把棘轮基线下调到新值;**读技能优先**(宪法 7"读的对等":Otto 不做瞎子操作员)。

**建议分批表**(依据 = 当前 manifest 实际分布;批的边界可由执行时微调,批的优先序不可倒):

| 批 | 域 | 约多少条 | 代表条目 | 状态 |
|---|---|---|---|---|
| D1 | 排期读+写(读优先) | 5 | schedule-actions.listScheduledPosts / listOwnerTargets / approveScheduledPost… | 可开工(P0.5 后) |
| D2 | Library / 资产 / 账户读 | ~9 | data.getProjects / getEntities、library-actions.getGenerationHistory、account-actions.getMyAccount | 可开工(P0.5 后) |
| D3 | Analytics / Ads 读 | ~3 | analytics-actions.getAnalytics、data.getMyAds / getMyAdJobs | 可开工(P0.5 后) |
| D4 | 项目 / thread 管理 | ~12 | actions.createProject / deleteProject / setProjectPinned、thread 增删钉 | 可开工(P0.5 后) |
| D5 | 画布 | ~6 | canvas-actions 五件 + otto-canvas-bridge.syncOttoCanvasNodes | 可开工(P0.5 后) |
| D6 | 上传 / 媒体 | ~7 | upload-actions 五件、actions.uploadReference / loadMoreMedia | 可开工(P0.5 后) |
| D7 | 分镜 / 编辑器 | ~10 | storyboard-actions / studio-actions / actions.saveShotPrompt 等 | 可开工(P0.5 后) |
| D8 | 生成生命周期 + 杂项写 | ~12 | attach/detach/softDelete 系、refgen-actions.deleteVariant、brand-record-actions、owner-settings | 可开工(P0.5 后) |
| D9 | **Otto 自身机件甄别** | ~8 | otto-actions.ottoTurn / ottoApprove / buildOttoContext / finalizeOttoRun 等 | 特殊:这些是 Otto 自己的回合机件,"给 Otto 配 skill"逻辑不通;若结论是需要**新豁免类别**,按 harmony-02 规则 = 修宪 → **停手报 founder** |

**每批施工模板**(runner 照抄,不再各自发明):
1. 列出本批全部条目 → 逐条判:配对 skill(缺 = 写)/ 已有 skill 可覆盖(登记指向)/ 应属四类豁免(给 reason)。
2. 读面 skill 一律 `cost:"free", effect:"read"`,走 ctx 端口(缝 1),**绝不**在 skill 里直连 Prisma 写。
3. 写面 skill 逐个过 3 字段诚实检查(playbook「Otto 包」:describeRefs 因 updateMany 定为 write 是判例)。
4. 棘轮基线在同 PR 下调;`pnpm lint:parity` + catalog:check 绿。
5. 分域装载(P0.5 Phase 2)已上线的前提下,新 skill 出生即带 domain 字段。

**每批验收**:`pnpm lint:parity` 绿 + 棘轮基线数字下降 + 新 skill 过缝 1 六处登记(registry / registry.test / migration.test / CATALOG / instructions / parity)。

---

## 四、P1 —— 创作变现(主轴 = harmony-03 三波工厂,已拍板)

**来源**:C 区封卷(GRILL-VERDICTS,C-01~C-10、C-12 要)+ harmony-03 三波路线 + 升级票纪律(founder 条件批准原话:"要很严格的执行那个步骤")。工厂每步 = skill、无人手断点(C-07);Wave 1 全部复用现有生成管线不开新钱路;Wave 2 新供应商过 money-safety + founder 逐笔批验证花费。

| # | 项 | 来源 | 缝 | 验收 | 规模 | 状态 |
|---|---|---|---|---|---|---|
| P1-0 | **BytePlus 资源包余量告警**(包烧完静默跳裸价,10s 档毛利 45%→13%) | 定价终案护栏(GRILL-VERDICTS"护栏升级 = P1 必做");蓝图第六章 P1 必做护栏 | admin/cost 展示层 + worker 定时查 | admin/cost 出现包余量与告警阈值;模拟余量低于阈值时告警可见 | S | 可开工(出 S 级 spec 走第五章流程) |
| P1-1 | Wave 1:Product 建档 + 3 模式无口播成片 + 风格卡片 + 全流程 Otto 可驱动 | harmony-03 Wave 1(已拍) | 缝 1/2/3/6/8/9 按件 | Wave 出口 = founder 验收(runtime QA + 出片成功率/成本/用量数字,harmony-03 §三) | L | 可开工(各件动工前按第五章出 spec) |
| P1-2 | Wave 2:口播(lipsync/TTS 选型三硬标准)+ UGC 口播模式 ×2 + 改台词不重拍 + 升级票 U-1 | harmony-03 Wave 2(已拍);costing 先行(宪法 5) | 缝 2(新供应商)+ money-safety | 同上 + 供应商选型报告(Otto 可驱动/costing/多语三关) | L | 可开工(选型 spec 先行;真实验证花费逐笔问 founder) |
| P1-3 | Wave 3:Ad Reference 逆向(schema 化拆解)+ 一稿多尺寸 + 三语套装 + Avatar 选角库 + 效果反哺(O-10) | harmony-03 Wave 3(已拍);O-10 判决"要" | 同上 | 同上 | L | 可开工(顺序在 Wave 2 后) |

**2026-07-07 竞品研究增补候选(A1-A5)—— 全部待拍板**(研究为会话内产出,未入库;见第七章清单。与已拍项的重叠部分不需要新判决,只有"新增量"待拍):

| # | 候选 | 挂靠 | 与已拍项的关系(不重复拍) | 状态 |
|---|---|---|---|---|
| A1 | Hook 生成器(前 3 秒钩子文案/画面变体) | Wave 2(UGC 口播的 Hook 模板前置 3 秒已在 harmony-03) | harmony-03 只定了"Hook 模板前置";**独立的 Hook 生成器功能**是新增量 | 待拍板 |
| A2 | 批量变体矩阵(一次 brief × N 平台 × N 尺寸 × N 钩子的矩阵出片) | Wave 1-2 | C-03 一稿多尺寸已拍(Wave 3);**矩阵式批量组合**是新增量 | 待拍板 |
| A3 | 改台词不重拍**折价 SKU**(重合成音画按更低价收) | Wave 2 | "改台词不重拍"能力本身已拍(harmony-03 Wave 2);**单列折价 SKU** 是新收费点 → costing 先行(宪法 5) | 待拍板 |
| A4 | 成品广告打包 SKU("给我 3 条可投广告"一价打包) | Wave 1-2 | 新收费点,**必须 costing 先行**(宪法 5:任何新收费点定价前 costing 先行,毛利 ≥45%) | 待拍板 |
| A5 | SEA 本地化选角库(马来/华裔/印度裔面孔 + 场景包优先建库) | Wave 3 | Avatar 选角库含"按 SEA 面孔/场景本地化"已拍(harmony-03 Wave 3);**建库优先序与库容投入**是新增量 | 待拍板 |

---

## 五、P1.5 → P4(结构照抄 harmony-01 §六 与蓝图第六章,方向已定、动工前各出 spec)

> 每项动工前走第五章扩建守则(spec 华语 → founder 过目 → TDD → 走缝)。以下条目**方向均已拍板**(来源列可查证),"可开工"指依据齐全 —— 但 spec 过目这道闸对每项照常适用。

### P1½ 排期 + Routine

| # | 项 | 来源 | 缝 | 验收 | 规模 | 状态 |
|---|---|---|---|---|---|---|
| P1½-1 | ScheduledPost(+PostVariant)全量 + 实发布 worker 通电(FB/IG 先行,发布基建平台可插拔:加平台 = 加 adapter 不改核心) | harmony-01 §三 #4;红旗一(平台矩阵全要 + 可插拔);蓝图区划图(UI-first 已通电,实发布等 App Review 钥匙) | 4 / 5 / 6 / 9 | 一条真实 DRAFT→SCHEDULED→PUBLISHED 全链(App Review 通过后);PublishAttempt 防双发测试绿 | M | 可开工(实发布部分等钥匙) |
| P1½-2 | ChannelConnection 通用渠道连接(kind 开放串 + 加密 token,Meta 日后择机迁入) | harmony-01 §三 #5 | 4 | 新渠道 = 新 adapter 零核心改动(以 TikTok 骨架为证) | M | 可开工 |
| P1½-3 | Routine/RoutineRun(范围声明/每次+每月预算上限/kill switch 全部是**字段 + DB 约束**,不是文档) | O-02+O-05 routine 授权模型(判决);harmony-01 §三 #6、§四⑤ | 1 / 3 / 5 / 6 | 超预算的 RoutineRun 被 DB 层拒绝的测试;kill switch 即时生效的测试;事后摘要可见 | L | 可开工(细化 spec 动工前仍需 founder 过目 —— 蓝图第六章明文) |
| P1½-4 | ApprovalRequest 最小版(kind=PUBLISH)随排期提前 —— 不许排期区自建第二套审批 | harmony-01 §六"已知的两个提前"①、§四④(payload hash,G7 模式) | 5 / 9 | 审批后 payload 漂移即失效的测试(hash 绑定) | S | 可开工(随 P1½-1 同 PR 或紧前) |

### P2 消息进场(WhatsApp + 第二账道)

| # | 项 | 来源 | 缝 | 验收 | 规模 | 状态 |
|---|---|---|---|---|---|---|
| P2-1 | WhatsApp BSP 接入(M 区第一波入场券);BSP 供应商选型摆选项给 founder | 红旗五(判决"要,M 区第一波") | 4 | 真实收发一条消息(选型后;真实花费逐笔批) | L | 可开工(顺序在 P1½ 后;选型 = founder 拍) |
| P2-2 | Contact/ContactIdentity + Conversation/CustomerMessage(与 ChatMessage **零交叉**,import 级检查)+ KnowledgeDoc | harmony-01 §三 #7/8/9、§四②③ | 5 / 9 | ContactIdentity 唯一索引 `(ownerId, channel, externalId)`;Conversation↔ChatMessage import 隔离检查绿 | L | 可开工 |
| P2-3 | 第二账道 ChannelFeeWallet/ChannelFeeLedger(MYR 实价、透明直传、与 CreditLedger **零共享表/actions/finalizer**) | 红旗五 + 宪法 5(通道费独立账道);harmony-05 五条安全律 | 新 money 面(动工前**先扩 money-safety-review Step-1 符号范围** —— playbook 钱路增补明文) | harmony-05 五条安全律逐条测试;报价卡两账道分行列示;grep 级隔离检查 | L | 可开工(全程 money-safety-review) |
| P2-4 | O-06 护栏 + 试驾场(对客 AI 硬前置)+ 公开评论收件箱 | O-01+O-06 绑定顺序判决("护栏是硬前置,如 money-gate 不可绕");N (Buffer) 公开评论收件箱判决"要" | 1 / 5 | 溯源("这句答案来自哪份 KnowledgeDoc")可点击验证;转人工路径 QA | L | 可开工(顺序:护栏先于任何对客 AI 上线) |

**origami 研究候选挂此区(均待拍板,见第七章 7-8/7-9)**:"人回复自动暂停自动化"(M 区设计原则候选);"勿扰名单硬编码进 agent 运行"(North-Star 已纳入 consent/勿扰**字段**,但**运行时硬约束**是新增量)。

### P3 CRM + Campaign

| # | 项 | 来源 | 缝 | 验收 | 规模 | 状态 |
|---|---|---|---|---|---|---|
| P3-1 | Campaign 独立对象(目标/预算/周期/状态机/UTM 基串;归组 = 可空外键,不建关联表) | 红旗六(founder:"要 scale 去 Salesforce 那种,干净最重要");harmony-01 §三 #11、§四① | 5 / 9 | campaignId 外键全部可空 + additive migration;GM-03 目标进度条随区落地(GM 卷已拍"要") | M | 可开工(最小版可随工厂提前 —— harmony-01 §六) |
| P3-2 | Deal/PipelineConfig + Segment(NL→**确定性规则编译**,不靠模型天赋) | 红旗三(分阶段:respond.io 级起步);harmony-01 §三 #12/13;宪法 10 | 1 / 5 / 9 | Segment 编译输出为规则 JSON 的确定性测试(同输入同输出) | L | 可开工 |
| P3-3 | ApprovalRequest 全量 + 团队协作/审批流(创作席/审批席 RBAC,Membership 扩 seatType/orgRole) | G-11 + O-13(判决"要",founder 硬要求"非常丝滑" —— 宪法 11 适用);宪法 7 租户 RBAC;harmony-01 §五 | 5 / 7 / 9 | "小编做→老板批→才发布"全链浏览器 QA + 设计审;审批一个原语两个表面(数据层一张表) | L | 可开工 |

**plane.so 研究参考挂此区(实现形状参考,不需新判决 —— 团队协作/审批/开店模板本身均已拍)**:
- **审批状态机四概念**(状态/流转/审批人/退回态)→ P3-3 ApprovalRequest 设计的形状参考(harmony-01 §四④ 一表两面)。
- **审批席比例定价**(付费创作席送 N 免费审批席)→ G-01 双档已拍("审批席便宜到老板愿意全员拉进来");**"送 N 席"这个具体档位形状**在 G 档位 spec 时作为选项摆给 founder —— 席位精确价本就待 costing 闭合(harmony-04 §三),不在此新拍。
- **两级模板**(官方行业模板 + org 自有模板)→ G-09 行业开店模板已拍"要";两级结构是实现形状参考。

### P4 深化

| # | 项 | 来源 | 状态 |
|---|---|---|---|
| P4-1 | 报表引擎数据面(读现有全部对象,自身无新表)+ G-12 品牌化报告 | 红旗二(founder 否决"Otto 替代报表"提案 —— 双模无例外,卖 seats 的根);G-12(要,分析区后) | 方向已定(远期;动工前 spec) |
| P4-2 | Company(B2B 档案) | harmony-01 §三 #15(红旗三:留在深化期) | 方向已定(远期) |
| P4-3 | Agency 伞层,顺序已拍:G-09 行业开店模板 → 团队协作+G-11 → G-10 多客户伞 | G-09/G-10/G-11 判决;蓝图第六章 Agency 楼层(顺序已拍) | 方向已定(远期) |
| P4-4 | 市政厅 v2(团队阶级制度:SECTION_MATRIX 扩展 + 钱的阶级 + staff 成员制;Otto 永久豁免 admin) | 蓝图第六章"市政厅 v2"(founder 点名);X-01~X-05 判决 | 方向已定(远期) |

---

## 六、2026-07-07 新判决记录(founder 已拍板;合并本 PR 即入档 GRILL-VERDICTS)

> 完整表格版已追加至 `docs/research/GRILL-VERDICTS-2026-07-03.md`「追加判决(2026-07-07)」节(本 PR 交付物 3)。摘要:

1. **Otto 对话计费维持每轮 reserve→settle**;origami"思考免费"原则**不采纳**(founder 原话:"OTTO对话还是要扣credit的,这个是我们的costing那边要cover的")。
2. **基础设施不迁 Sevalla**(贵 2-3 倍 + 迁移风险);Railway + Neon 维持。
3. **GitHub 迁 BELCORT-SDN-BHD org + Team 档 + main ruleset 硬保护**(org 迁移已生效 —— origin 已指向 BELCORT-SDN-BHD/FIKIRTIVE;Team 档与 ruleset 落地后,`.claude/CLAUDE.md`"free 计划无分支保护"的表述由总审查员随后更新)。
4. **改进路线 = "最好的全都做",顺序 = 先修引擎(prompt caching + 技能分域)再规模化还对等债** —— 本文件 P0.5 在 P0.75 之前的排序依据。
5. **2026-07-07 审计清理批次 1/2 已授权执行**(PR #179 死码删除 / PR #180 文档修正 + parity 债务棘轮,均在途);**批次 3 未授权**,逐项见第七章。

---

## 七、待拍板集中清单(founder 逐行回复即可;回复前 runner 一律不动工)

| 行 | 项 | 问题(一句话) | 选项 |
|---|---|---|---|
| 7-1 | 数据库备份方案(P0-1) | prod 目前零备份,选哪个? | ① Neon Launch 档 PITR(~$19+/月)② $0 nightly pg_dump→R2 ③ 都做 |
| 7-2 | A1 Hook 生成器 | 要不要做独立的 Hook 生成器(Wave 2 挂靠)? | 要 / 不要 / 以后 |
| 7-3 | A2 批量变体矩阵 | 要不要矩阵式批量出片(平台×尺寸×钩子)? | 要 / 不要 / 以后 |
| 7-4 | A3 改台词折价 SKU | "只重合成音画"要不要单列更低价?(costing 先行) | 要(先跑 costing)/ 不要 / 以后 |
| 7-5 | A4 成品广告打包 SKU | 要不要"N 条可投广告"打包价?(costing 先行) | 要(先跑 costing)/ 不要 / 以后 |
| 7-6 | A5 SEA 选角库优先建库 | Wave 3 选角库要不要提前投入建 SEA 本地库? | 要 / 不要 / 按 Wave 3 原节奏 |
| 7-7 | origami:贵活前 brief 预检 + 报价预览 | 大额生成前 Otto 先出结构化 brief + 报价确认页? | 要 / 不要 / 以后 |
| 7-8 | origami:人回复自动暂停自动化 | 客户对话中人一插手,自动化立刻停(M 区设计原则)? | 要(入 M 区原则)/ 不要 |
| 7-9 | origami:勿扰名单硬编码进 agent 运行 | 勿扰/consent 从"字段"升级为 agent 运行时硬约束? | 要 / 不要 / 以后 |
| 7-10 | 批次 3a:删 3 个死付费端点 | coworkTurn/enhancePrompt/coworkDraftStoryboard(死付费面,紧邻 coworkGenerate 钱路,按已测绘安全删法) | 批 / 不批 |
| 7-11 | 批次 3b:NextAuth 3 张死表 DROP | 破坏性迁移推 main 即改 prod(建议 7-1 先落地再做) | 批 / 不批 |
| 7-12 | 批次 3c:11 个花钱/prod 脚本加确认锁 | 防误跑真实花费脚本 | 批 / 不批 |
| 7-13 | 批次 3d:scripts/ 分层归档 | 纯整理,无行为变化 | 批 / 不批 |
| 7-14 | 批次 3e:重复代码统一 | Meta 错误处理 6 处 + extractText 三副本(紧邻钱路,surgical) | 批 / 不批 |

---

## 八、执行协议(给 runner 模型的作业规则 —— 引用而不复制,以被引文件为准)

1. **取活**:只从本文件取"可开工"项;"待拍板"未批不碰;同一时间一个 PR 一件事。
2. **图纸先行**:动工前出 spec(华语,`docs/superpowers/specs/`)→ **founder 过目**(蓝图第五章第 1 条)。
3. **施工**:TDD(RED→GREEN)、小批提交、走对应的缝(`docs/review/EXPANSION-SEAMS.md` + 缝 9 = harmony-02)、不越图纸改邻居的楼(蓝图第五章第 2 条)。
4. **验收三关**:CI 全绿 → 总审查员按 `docs/review/REVIEWER-PLAYBOOK.md` 区域清单终审 → UI 改动附浏览器 runtime QA + 设计审证据(playbook 协议 #4 扩)。
5. **钱路加一关**:任何 spend-path diff 过 `money-safety-review` skill;**每笔真实供应商花费逐笔问 founder,"问"就是上限**(宪法 2)。
6. **禁止事项**:蓝图第八条"明确不盖的楼"永不提案;蓝图第五章第 6 条(不直推 main、不自批自己的 PR、不绕缝、skill 不 import 花钱包);发现代码与蓝图冲突 → 停手、报告、等裁决(蓝图第七章)。
7. **入册**:合并后大变更由总审查员更新地质报告层与本文件状态列(蓝图不动)。
8. **状态列流转规则**:待拍板 →(founder 批)→ 可开工 →(PR 开出)→ 在途 →(合并)→ 从表中移入"已完成"归档节(由总审查员操作);**只有 founder 能把"待拍板"翻成"可开工"**;runner 发现表与现实不符(如 PR 已合并但状态未更新)→ 报总审查员,不自行改表。

---

## 修订记录

| 日期 | 修订 | 批准 |
|---|---|---|
| 2026-07-07 | v1 草案(总审查员起草;依据 = 宪法 + GRILL-VERDICTS(含同日追加判决)+ harmony 七件 + 2026-07-04/07 审计) | 待 founder 终审 |
