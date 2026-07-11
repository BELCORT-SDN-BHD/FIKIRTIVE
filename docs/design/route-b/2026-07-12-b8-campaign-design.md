# B8 · Campaign 管理一期 —— 设计全图

> **性质**:路线乙 B8 块设计工位(epoch `claude-20260712-03`,工单 L4b·试产)的施工图纸。华语(宪法 9),docs-only,**本 PR 无任何产品代码**。
> **基线**:main@`1b1414d9`(#240 B0 契约签署);矩阵签署件 `docs/ops/route-b/matrix/08-B8.md`(B0-51~B0-58 八行)为范围界。
> **模板地位**:本工位是两个试产工位之一,本文同时作为后续 B 块设计工位的**结构范本**(12 节铁律)。范本注解以 `〔范本注〕` 标出,产品内容不受影响。
> **待动工前提**:本设计图完成后,由总指挥加「体量过目」(Q6 机制),founder 逐大陆裁本程做多深(§九 深度档位);无对标锚不开工(§二)。

## 人话对照表(内部代号必带人话——工作规矩②)

| 代号 | 人话 |
|---|---|
| A′ / 沉浸城 | `apps/web/app/northstar-immersive/*` 原型页(北极星壳,65 页),Campaign 区 7 页在其中 |
| CAMPAIGN_CARD / GEN_CARD / PackCard | 战役提案卡 / 生成提案卡(批了才花钱)/ 一批生成卡的打包确认 |
| proposeCampaign | 新 Otto 技能:把策划结果写成一张卡 + 一行最薄 Campaign,$0 不花钱 |
| TrendSnapshot | 趋势快照:研究结论落档成一行,Otto 以后策划先翻自家存档 |
| 缝 1/3/4/5/7/8/9 | 九条扩展缝(§十),分别 = Otto 技能 / 记账花钱 / 渠道连接器 / 租户 ownerId / 界面设计系统 / 卡片五道缝 / 人机对等清单 |
| 7-3 / 7-7 | 2026-07-07 判决:批量出片必须显示总价确认页 / Otto 花大钱前先复述理解+报价 |
| 审批公式 | `needsApproval = (cost=spend) ∥ (effect=write ∧ reach=external)`(宪法 4),两类明示例外:余额即闸、routine 预授权 |
| 六态 | B0 发布契约六级状态 `spec-ready→code-complete→sandbox-verified→review-submitted→live-verified→release-certified`(+ 第 0 级 `listed`) |
| GM-03 | 极简游戏化「战役目标进度条」(GM 卷 2026-07-03 拍「要」) |
| 完全体 / P3 | Campaign 的终局形态(预算/编排/归因/UTM/campaign 级报表);对应 MASTERPLAN P3-1 |

〔范本注〕**12 节结构对后续设计工位为铁律**:①范围映射 ②对标锚清单(每锚四件套)③IA 对齐 A′ 页 ④六态 ⑤双执行矩阵 ⑥数据契约需求单 ⑦权限/花费闸逐行初判 ⑧假设台账 ⑨深度档位+成本 ⑩九缝映射 ⑪跨区接线 ⑫開放问题。此处只填 Campaign 特有内容;各节标题与顺序不动。开头必带 spec 底钉出处(§〇)。

---

## 〇、spec 底钉出处(第一交付点)

**判决「已有 spec 底」的那份底稿 = `docs/superpowers/specs/2026-07-08-otto-campaign-planner-design.md`**(C 线冲刺施工图,已冻结、代码 0,待 founder 过目)。逐节出处 + 与本设计图的对应:

| spec 底节 | 行号 | 内容 | 本设计图落点 |
|---|---|---|---|
| §一 人话概述 | 24–34 | 研究→提案→生成→排期→发布→复盘全链 | §三 IA、§十一 接线 |
| §二 架构(骑现有轨道) | 38–100 | proposeCampaign / CAMPAIGN_CARD / Block S 复用 / 最薄 Campaign 容器 / generate 闸 / schedulePosts | §六 数据契约、§七 花费闸、§十 九缝 |
| §2.2 CAMPAIGN_CARD 五道缝 | 51–61 | 卡片缝 8 施工点(持久写/重放/流式/去重/渲染) | §十 缝 8 |
| §2.4 轻量 Campaign 容器 | 69–74 | 最小字段清单 + 可空外键归组 | §六 数据契约 A/B |
| §三 审批经济学逐段对账 | 104–116 | 每环三字段 + 审批与否 | §七 花费闸逐行 |
| §四 对标(founder 记得的 SaaS) | 120–138 | Kalodata / Virlo / TikTok Symphony;我们赢在全链一屋檐/品牌记忆/跨月编排/审批经济学 | §二 对标锚(二级锚) |
| §五 founder 增补 | 142–183 | 5.1 专属工作台 / 5.2 TrendSnapshot / 5.3 live reflection(全产品级) | §三、§六 数据契约 C、§十 缝 7 |
| §六 分期与验收 | 187–202 | 第一/二/三期交付与验收 | §九 深度档位、§四 六态 |
| §七 costing 概算 | 206–227 | 零新收费点,全复用既有费率 | §九 成本估算 |
| §八 明确不在本 spec 范围 | 231–237 | 完全体 P3 / 发布 worker / Routine 本体 / 工厂线 A1/A2/A4 | §一 范围映射(排除) |

**时效核对结论(见 §十二 開放问题 O-6)**:spec 底成于 2026-07-08,本设计图成于 07-12;两者之间 B0 契约(六态制、💰行机器强制、84 债棘轮)与矩阵 B8 定版。核对逐节**无实质冲突**,唯一需对齐处 = **UTM 基串**(矩阵 B0-51 列入一期最薄容器,spec §2.4 最小字段未列)——按任务纪律「冲突以矩阵为准」,本图采矩阵口径(一期落一个 `utmBase` 字符串字段),差异记 §十二 O-1。

---

## 一、范围映射(矩阵签署件为界)

**范围 = 矩阵 `08-B8.md` 的 B0-51~B0-58 共八行**(Campaign 一期);上市点背景:旧上市点含「Campaign 一期能收钱」。CRM 起步(B0-59~B0-61)与缺失大陆(B0-62~B0-76)同块但**不在本工位**;Agency 伞层、市政厅 v2 明示范围外。

| 矩阵行 | 能力(人话) | 本图主落节 | 一期落地深度(§九初判) |
|---|---|---|---|
| B0-51 | Campaign 独立对象(最薄容器:状态机/goal/period/UTM 基串;不升格 project)〔GM-03 目标进度条随本行〕 | §六 A | 一期最薄行落地;完全体 = P3 |
| B0-52 | Campaign 归组接线(Project/ScheduledPost/Generation 的 campaignId 可空外键) | §六 B、§十一 | 一期落 ScheduledPost/Generation 外键;Project.campaignId 已预留 |
| B0-53 | Campaign 工作台(结构化表单发起,不靠聊天 prompt)〔mock 风险 7/18:X pricing 静态文案〕 | §三、§五 | 一期最小版(四项表单 + 日历批改) |
| B0-54 | Campaign 日历工作台〔auto-publish 文案出处未核实,mock 风险 6/18——本图钉真伪〕 | §三、§十二 O-2 | 一期日历批改;routine 位 = 第三期占位 |
| B0-55 | Campaign 列表 + 详情页 | §三、§十一 | 一期列表 + 详情最薄(容器 + 只读归组产物);ads/结果/归因 tab = P3 |
| B0-56 | Otto Campaign 策划师(研究 trend→CAMPAIGN_CARD→改/批→排产) | §五(双执行高压区) | 一期提案 + 逐条批;打包批 = 第二期 |
| B0-57 | Campaign 打包总价确认页(server 重算 + generate 闸)💰〔mock 风险 2/18,全舰单最高优先💰〕 | §七(本工位最重) | 一期逐条批;打包总价确认 = 第二期,变真必过 money-safety-review |
| B0-58 | 趋势存档页 + TrendSnapshot 最薄数据层(ownerId 隔离)〔新表走缝 5,引擎侧协调 = B9 复核〕 | §六 C | 一期最薄版(表 + 两写入点 + 读技能) |

**明示排除(spec 底 §八 原样)**:Campaign 完全体(预算/编排/完整归因/campaign 级报表)= P3;发布 worker 与渠道 adapter(X=B4/B 线、Meta 待 App Review);Routine 数据模型本体(P1½-3 另 spec 另批);工厂线 A1 Hook 生成器 / A2 批量变体矩阵 / A4 一口价打包 SKU(本功能只消费其成熟能力,不重复建;A4 若做 costing 先行)。

---

## 二、对标锚清单(无锚不开工——master-plan §六)

主锚三家(蓝图第六章 Campaign 管理区对标,`BLUEPRINT.md:172/180`);每锚四件套 = **对标对象+版本 / 关键旅程 / 通过阈值 / 并排截图打分法**。效果过堂对锚评,「≥3 次尝试」= 三种有证据的不同方案(非机械重试)。

### 主锚 A · Salesforce Campaign 体系(终局深度)
- **对象+版本**:SF Sales/Marketing Cloud Campaign 对象(Lightning,2025-26 版);对标点 = 独立 Campaign 对象、成员/归因模型、campaign 层级。
- **关键旅程**:建 Campaign → 关联资产与成员 → 看 campaign 级报表与 ROI 归因。
- **通过阈值**:我们的 Campaign 是**独立对象、可空外键归组、干净不升格 project**(红旗六判决),一期即达「独立对象」骨架;**不追** SF 的成员对象/首触归因埋点(GRILL 7-3 判「太深奥,不要」)。
- **打分法**:并排「建一个战役→挂三条内容→看目标进度」;我方胜负手 = **创作→投放→归因一人跑通**(SF 要接一堆云),败点 = 报表深度(诚实列 P3)。

### 主锚 B · HubSpot Campaigns
- **对象+版本**:HubSpot Marketing Hub Campaigns 工具(2025-26)。
- **关键旅程**:给一个 campaign 归组邮件/社媒/落地页/广告 → 统一看资产清单与绩效。
- **通过阈值**:我方「详情页 outputs 四类归组(内容/帖子/广告/对话)」对齐 HubSpot 的资产聚合;一期做**只读归组投影**(读 campaignId 外键),绩效聚合 = P3。
- **打分法**:并排「一个 campaign 下能看到它产生的一切」;胜负手 = 归组来自**同一份数据同一个 Otto**(HubSpot 靠手工挂载),败点 = 邮件资产(email 本程挂壳 Coming soon)。

### 主锚 C · Adobe GenStudio(内容供应链)
- **对象+版本**:Adobe GenStudio for Performance Marketing(2025-26),品牌约束下的内容供应链。
- **关键旅程**:品牌规则驱动批量生成 → 审批 → 分发到渠道。
- **通过阈值**:我方 CAMPAIGN_CARD 的「战略洞察→逐条 brief→打包生成」对齐 GenStudio 的供应链;**品牌记忆(6-tab 知识库)天生懂这家店**是胜负手(GenStudio 每次冷启动)。
- **打分法**:并排「从一句目标到一批可发内容」;败点 = 企业级审批链(我方单商家先行,团队 RBAC 挂壳)。

### 二级锚(Otto 策划师 + 趋势面——spec 底 §四 founder 记得的 SaaS)
仅用于 §五 策划师流与 §六 C 趋势层的对标,不替代主锚:

| 二级锚 | 版本 | 关键旅程 | 我方通过阈值 / 不追 |
|---|---|---|---|
| **Kalodata + Kaloclip** | 2025-26 | 爬 TikTok Shop 真实 GMV→排爆款→AI 改写脚本→合成带货视频 | 追「trend 依据带来源、不捏造」;**不追**爬虫型第三方 GMV(合规敞口;O-10 用自家真实投放数据反哺更干净) |
| **Virlo.ai** | 2025-26 | 每天扫百万短视频 outlier 检测→脚本→9:16 成片→名义排期发布 | 追「趋势→提案→排期闭环」;**不追** credits 大礼包定价(宪法 5 毛利地板 + 永禁 unlimited) |
| **TikTok Symphony** | 2025-26 | 官方趋势研究 + Creative Studio + Symphony Agent 攒广告 | 追「Otto 攒整案」;**不追**「agent」营销话术盖住半自动(铁律③状态诚实:哪步免批哪步必批如实告诉用户) |

**我方跨锚共同胜负手(spec 底 §四)**:①全链一屋檐(研究→提案→生成→排期→发布→复盘同一份数据);②品牌记忆;③跨月编排(数天到数月的日历);④审批经济学(总价确认 + 失败自动退款 + 明细可查,对手 credits 黑盒)。

---

## 三、信息架构对齐 A′ 7 页

A′ 沉浸城 Campaign 区实测 **7 页**(`apps/web/app/northstar-immersive/campaign/{workbench,proposal-card,calendar,list,detail,pack-confirm,trends}/page.tsx`;组件在 `apps/web/components/northstar/immersive/campaign/*`)。一页一入口,一期落地深度逐页初判:

| A′ 页 | 组件(行数) | 角色 | 矩阵行 | 一期落地 |
|---|---|---|---|---|
| **workbench** | `campaign-workbench.tsx`(331) | 结构化入口:四项表单(目标/周期/预算/平台)+ 频控/层级 + playbook 模板 + 「Ask Otto」就地帮我 | B0-53 | ✅ 最小版 |
| **proposal-card** | `campaign-proposal.tsx`(406) | 聊天内 CAMPAIGN_CARD:战略洞察 + 目标 + 预期产出 + 受众/护栏/learnings + 逐条策略(受众×角度×明价×KPI×时段)+ 逐条改/删/Approve | B0-56 | ✅ 提案 + 逐条批 |
| **calendar** | `campaign-calendar.tsx`(297) | 日历/列表双视图批改面(与聊天卡同一份 store);逐条批/改/删 Dialog;实时重算预估总价;routine 位(第三期占位) | B0-54 | ✅ 批改;routine=P3 |
| **list** | `campaign-list.tsx`(319) | 完全体列表(DRAFT/ACTIVE/DONE/CANCELLED + 目标进度) | B0-55 | ✅ 列表 |
| **detail** | `campaign-detail.tsx`(764) | 详情:GM-03 目标进度条 + Spent/预算 + outputs 七 tab(overview/calendar/content/ads/chat/results/research) | B0-55 | ⚠️ 容器 + 只读归组(content/posts);ads/results/research tab = P3 骨架 |
| **pack-confirm** | `campaign-pack-confirm.tsx`(284)💰 | 打包确认:Otto 复述理解 + 报价 → 逐条 review 可剔除 → server 重算 → 逐条过 generate 闸 → 失败自动退该条 + Retry → 成片进排期草稿;余额不足分支 | B0-57 | ⚠️ 一期逐条批;打包批=第二期 |
| **trends** | `campaign-trends.tsx`(187) | TrendSnapshot 只读存档:证据句 + 置信度 + 复核期 + 「别追这个」+ 洞察→动作桥 + 来源 + Used by campaign;via 段控过滤 | B0-58 | ✅ 最薄版 |

**IA 主干**:workbench(发起)→ proposal-card / calendar(改批,同一份数据两个面)→ pack-confirm(花钱一关)→ 成片进排期区草稿 → list/detail(容器视角回看);trends 横向为策划提供市场记忆。**双入口殊途同归**(spec 底 §5.1):表单入口(workbench)与聊天入口(CAMPAIGN_CARD)落到同一个 `proposeCampaign` 动作、同一张卡、同一行 Campaign,不建第二份副本。

---

## 四、六态(每行的目标状态轨迹)

依 B0-CONTRACT §一,八行现状全部 `listed`(存量 `absent`)。本设计图合并 = 目标推 `spec-ready`(需附对标锚 §二)。八行均为**内部行**(无外部受审面),六态路径 `listed → spec-ready → code-complete → sandbox-verified →(3→5 直迁,标 n/a-internal)→ live-verified → release-certified`。

| 行 | 目标态(本程终点) | 升级证据要点 | 备注 |
|---|---|---|---|
| B0-51 容器 | release-certified | 最薄行 schema + 2-org 隔离测试;GM-03 字段预留 | 完全体 P3 不在本程 |
| B0-52 归组外键 | release-certified | 加性 migration + 外键可空 + 归组测试 | Project.campaignId 已在 |
| B0-53 工作台 | release-certified | 表单发起 e2e + parity manifest 登记 | X pricing 静态文案不接钱路(mock 风险 7/18) |
| B0-54 日历 | release-certified | 日历批改 e2e + routine 位标 phase-3 slot | auto-publish 文案 = 第三期占位(§十二 O-2) |
| B0-55 列表/详情 | release-certified | 列表四态 + 详情只读归组 e2e | ads/results/归因 tab 标 P3 骨架 |
| B0-56 策划师 | release-certified | proposeCampaign 六处登记 + CAMPAIGN_CARD 五道缝 + 双模走查 | 打包批第二期 |
| B0-57 打包确认💰 | release-certified | **一期**逐条 generate 闸 e2e;**第二期**打包批过 money-safety-review | 💰行,闸列机器强制非 TBD |
| B0-58 趋势存档 | release-certified | TrendSnapshot 表 + ownerId + 2-org 隔离 + 读技能 | 引擎侧协调 = B9 复核 |

**sandbox-verified 双执行器硬性**:每行必须**人工路径 + Otto 话术都走通**(§五 双执行矩阵)才可 3 级迁移。

---

## 五、双执行矩阵(宪法 7 双 100%——Otto 策划师 CAMPAIGN_CARD 提案流是双模高压区)

Otto 策划师流(提案→用户改→批准→排产)是**双模最难对齐处**:每一步 Otto 侧动作都必须有等价的人工面按钮,且**落到同一个 server 动作层**(O-12「就地按钮 = Otto 的手」)。逐步对照:

| 步 | Otto 侧(话术 → 技能) | 人工侧(界面按钮) | 同一动作层落点 | 花费/审批 |
|---|---|---|---|---|
| 发起 | 「帮我策划下个月的 campaign」→ 收资讯门 goal+period | workbench 四项表单 + Submit | `proposeCampaign`(存草稿 + 落一轮往来) | $0 免批 |
| 研究 | 轻查 researchWeb / 深研 proposeResearch | trends 页翻存档 + 手动发起深研卡 | Block S 现役管线 | 轻查随轮计量;深研卡用户批 |
| 提案 | 交 CAMPAIGN_CARD(战略洞察 + 逐条 brief + 预估总价) | proposal-card / calendar 呈现同一张卡 | 同一张卡 + 同一行 Campaign | $0 免批 |
| 改 | 用户对 Otto 说「删第 3 条 / 换日期」→ Otto 改卡 | calendar Dialog 逐条改期/平台/形式/hook;proposal 逐条编辑 hook | `updateCampaignEntry`/`removeCampaignEntry`(store 唯一事实) | $0 |
| 批 | 用户说「就这样批了」 | 「Approve plan」/「Approve remaining · N」 | `approveCampaignEntry` | $0(批的是计划,不是花钱) |
| 排产 | Otto 铺 GEN_CARD → 打包确认 | pack-confirm「Confirm pack · N credits」 | proposePack → generate 闸 ×N | **必批**(§七) |
| 落排期 | 成片进 schedulePosts 草稿(归组 campaignId) | detail「Open schedule」见草稿 | `ctx.schedule.draft` = 人工 createScheduledPost 同一 server 函数 | $0 只建草稿 |
| 发布 | (第三期)routine 预授权自动发 | 排期区逐条点发 | 排期区既有状态机 | **必批**(逐条点发)或 routine 四件套 |

**人工面新按钮出生即登记 parity manifest(缝 9)**:workbench 的 Submit、calendar 的 Approve/Edit/Remove、pack-confirm 的 Confirm 全部要在对等清单登记,该块验收 = 债清零。**live reflection(spec 底 §5.3)**:Otto 排产时界面实时亮(coral 高亮 + 一行叙述「Otto 正在放第 3 张卡…」),工程本质 = headless 动作层 + 推送刷新,**非 computer-use 像素操作**。

〔范本注〕**双执行矩阵是每个设计工位的双 100% 证据**:找出本块最难对齐的一条 Otto 流(此块 = 提案→改→批→排产),逐步列人工等价物 + 同一 server 动作层落点 + 每步花费/审批,才算穿透宪法 7。

---

## 六、数据契约需求单(喂 B2 / 喂 B9)

> 本节是给 B2(数据契约块)与 B9(引擎横切块)的**需求单全文**。新表走缝 5(租户),引擎侧协调由 B9 复核。字段口径对齐 A′ `apps/web/components/northstar/campaign/_data.ts` 与 spec 底 §2.4/§5.2。

### A · Campaign 最薄容器表(缝 5)—— 不升格 project,不建影子对象

一期最小字段(spec 底 §2.4 + 矩阵 B0-51 的 UTM 基串;harmony-01 第一原则:禁止影子副本,P3 在**同一张表**上长成完全体):

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | id | server 端铸 |
| `ownerId` | fk | + organization 关系,进 `TENANT_MODELS`;`requireOwner`;模型永不传(工厂硬规则) |
| `name` | string | `deriveCampaignName(goal)` 可派生 |
| `status` | string | `DRAFT`\|`ACTIVE`\|`DONE`\|`CANCELLED`(code-validated 字符串,house style,不建 PG enum) |
| `goal` | string | GM-03 目标进度条落点 |
| `startAt` / `endAt` | datetime | 周期(几天到几个月);tz 记 Asia/Kuala_Lumpur |
| `utmBase` | string? | **UTM 基串**(矩阵 B0-51 一期要;形如 `utm_source={platform}&utm_medium=social&utm_campaign=<slug>`);一个字符串字段,非完整归因系统(见 §十二 O-1) |
| `planJson` | json | 提案卡快照(逐条 entry:date/platform/format/hook/brief/estCredits) |
| `createdAt`/`updatedAt`/`deletedAt` | datetime | 软删 |

**GM-03**:`goal` + `status` 即目标进度条数据源;进度条 UI 随 P3 完全体,字段本图预留。**状态机**(spec 底轻量口径):`DRAFT`(建/策划中)→`ACTIVE`(已有产物在跑)→`DONE`/`CANCELLED`;一期允许人工/Otto 切,无复杂流转守卫(完全体的编排状态 = P3)。

### B · campaignId 可空外键接线点清单(喂 B9 接口)—— harmony-01 §四①「归组 = 可空外键,不建关联表」

| 宿主表 | 字段 | 现状 | 一期动作 |
|---|---|---|---|
| `Project` | `campaignId?` | **已预留**(`schema.prisma:66` 软引用) | 复用,无需 migration |
| `ScheduledPost` | `campaignId?` | absent | **加性 migration 补**(排期草稿归组;pack-confirm 已按此写草稿) |
| `Generation` | `campaignId?` | absent | **加性 migration 补**(成片归组) |
| `TrendSnapshot` | `campaignId?` | 新表自带(见 C) | 关联 campaign,可空(research 可 standalone) |

**铁律**:一个产物属于零或一个 campaign,不建关联表;外键全部可空 + additive migration(P3-1 原样)。**B9 复核点**:三处外键的 Otto 契约(生成/排期技能是否透传 campaignId)与对等债随块清。

### C · TrendSnapshot 最薄表(缝 5,spec 底 §5.2)—— Otto 的市场记忆

只存**结论层**(结论 + 来源引用),正文仍在 WebPageCache/RESEARCH_REPORT,**不复制正文**:

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | id | |
| `ownerId` | fk | 缝 5 全套:organization 关系进 TENANT_MODELS、requireOwner、2-org 隔离测试 |
| `summary` | string | 结论句 |
| `sources` | json | 来源引用(title + domain 数组) |
| `capturedAt` | date | 采集日 |
| `campaignId` | fk? | 可空,关联 campaign(research 可 standalone) |
| `createdAt`/`deletedAt` | datetime | |

**写入点**:①深研管线(#118)研究报告完成时提炼一行;②`proposeCampaign` 的 rationale 引用的 trend 依据同步落档。**读取点**:配对读技能 `listTrendSnapshots`(缝 1,$0,free/read/internal)——Otto 下次策划先翻存档再决定要不要重查。
**〔情报溢价字段〕** A′ `_data.ts` 的 `TrendIntel`(evidence/confidence/recheck/dontChase/appliedAs/method)是**展示层富化**,一期建议先落最薄六字段,`TrendIntel` 富化字段列 §十二 O-3 供 founder 裁是否一期带。

### D · 归因事件(喂 B2)—— 一期口径

一期**不做完整首触归因埋点**(GRILL 7-3 判「太深奥,不要」)。喂 B2 的仅是**归组事件**(campaign_entry_approved / credits_spent / post_scheduled,A′ trends 页 `recentEvents` 已用此形态)供活动流展示;UTM 基串写进 ScheduledPost 的发布链接由排期/发布区消费。campaign 级归因报表 = P3。

---

## 七、权限/花费闸逐行初判(本工位最重——B0-57 是全舰单最高优先💰)

> 矩阵 B0-57 打包总价确认页是**全舰单最高优先💰**(mock 风险 2/18)。💰行闸列机器强制非 TBD;**任何💰行变真必过 `money-safety-review`**。本节给出闸设计,并逐行初判八行。

### 7.1 八行花费闸逐行初判

| 行 | 三字段(cost/effect/reach) | 审批? | 闸设计 |
|---|---|---|---|
| B0-51 容器 | free/write/internal | 免批 | 只写行,不碰钱 |
| B0-52 外键 | free/write/internal | 免批 | schema |
| B0-53 工作台 | free/write/internal | 免批 | 发起 = $0;X pricing 是**静态展示文案不接钱路**(mock 风险 7/18;X 真实计费随 E4-14/B 线一处收口) |
| B0-54 日历 | free/write/internal | 免批 | 批改 = $0;auto-publish 文案 = 第三期 routine 占位,**出处未核前不接线**(§十二 O-2) |
| B0-55 列表/详情 | free/read/internal | 免批 | 只读容器 |
| B0-56 策划师 | free/write/internal | 免批,$0 | proposeCampaign 只写卡 + 容器行;trend 轻查随轮计量(余额即闸)、深研卡用户批 |
| **B0-57 打包确认💰** | **spend** | **必批** | 见 7.2(核心) |
| B0-58 趋势存档 | free/read/internal(读)+ write/internal(写档) | 免批 | 只写结论层 |

### 7.2 B0-57 打包总价确认页 —— 💰闸设计(核心)

A′ `campaign-pack-confirm.tsx` 已把 UI 流走全(review→confirming→running→settled);本图把 UI 状态翻译成 **server 侧闸要求**:

1. **server 重算总价(不信客户端)**:卡上 `estCredits` 只是展示估价(铁律①:spend 面只显示 credits);用户点「Confirm pack · N credits」后,**server 从持久化的卡逐条重算重验**,以 server 数为准(anti-flip)。A′ 已明写此文案:「The server recalculates this total from the stored card when you confirm. Card estimates are display only.」
2. **逐条过 generate 闸(缝 3)**:打包批的「一次点头」= **对这批卡的批准**,不是绕闸——server 侧仍逐 card 过既有 generate 七步闸,**每张卡自己的幂等键 `cowork:<cardId>` once-EVER**(重复提交/双击零双扣;数据库级 partial-unique 幂等索引)。
3. **审批公式(宪法 4)**:`needsApproval = (cost=spend)` → 命中 spend,必批;打包确认页 = 该批准的载体。第一期逐条批;第二期打包批。
4. **partial 退款语义(判决 7-3)**:任一条生成失败 → **自动退该条 credits**、其余不受累(A′:「Couldn't generate. N credits refunded automatically.」+ Retry);SETTLE/REFUND 互斥,三类回收器防漏(现役账本架构)。
5. **与 7-7 brief 预检的关系**:判决 7-7「Otto 花大钱前先复述理解 + 报价」= A′ 顶部 Otto 复述条(「My understanding: N posts for X, period, across platforms, to goal. The total below is the exact quote.」)+ 精确总价;**复述 = 花大钱前的最后一道人类可读校验**,报价数 = server 重算数。
6. **余额不足分支(STALL #59)**:合计 > 余额 → 显式差额 + 引导充值,**不静默扣到 0**;兜底:余额不足永不进入扣费流。
7. **成片只建草稿**:generate 成功的成片经 schedulePosts **只建 DRAFT**(归组 campaignId),一分钱不花、一条不发;「Nothing publishes without you.」

**变真闸门**:B0-57 变真(第二期打包批触碰批量 spend 路径)时,diff **必过 `money-safety-review`** 的符号清单——typed genRequest gate / startGen / startRefGen / dispatchVariantJob·createVariant·regenerateVariant / coworkGenerate / idempotencyKey·dedup / partial-unique 幂等索引 / `apps/worker/src/jobs/gen.ts` 的 fal provider 调用;总审查员双闸看守。第一期逐条批**不新建钱原语**(走唯一的既有 generate 闸),故第一期不触发 money-safety-review 的批量路径,但仍受其单条 genRequest 闸约束。

〔范本注〕**凡本块含💰行的设计工位,§七是最重节**:必须把 A′ 的 UI 状态逐条翻成 server 侧闸要求(重算/幂等/审批公式/退款语义),并点名 money-safety-review 符号清单;不许只写「有闸」。

---

## 八、假设台账(设计闸门——founder 教义)

| # | 假设 | 依据 | 风险 / 验证法 |
|---|---|---|---|
| A1 | 一期含 `utmBase` 单字段即满足矩阵「UTM 基串」,完整归因留 P3 | 矩阵 B0-51 vs spec §2.4;GRILL 7-3「首触归因不要」 | 冲突项,记 O-1;若 founder 要一期更多 UTM 能力则升深度档 |
| A2 | detail 页 ads/results/research tab 一期只做 P3 骨架(不接广告/归因数据) | 完全体 = P3(蓝图 L180);B0-55 只承诺「列表+详情页」 | 若 founder 要一期看广告归组,升深度档 B→C |
| A3 | 打包批(第二期)才需 money-safety-review;一期逐条批走既有单条闸 | spec 底 §六第一期「不碰钱路结构」 | 一期仍受单条 genRequest 闸约束;第二期变真必过 |
| A4 | TrendSnapshot 一期落最薄六字段,`TrendIntel` 富化列 O-3 | spec §5.2「建议第一期带最薄版」 | 富化字段是展示层,可后续期加,不阻断 |
| A5 | auto-publish/routine 位一期只做 phase-3 占位,不接线 | 出处 = routine 预授权第三期(§十二 O-2) | 出处已核实为真;不接线符合分期 |
| A6 | Campaign 状态机一期无复杂流转守卫(人工/Otto 可切) | spec 轻量口径;完全体编排 = P3 | 若上量出现误切,P3 加守卫 |
| A7 | 零新收费点,全复用既有费率 | spec §七 | 若做 A4 一口价打包 SKU,costing 先行(不在本程) |

---

## 九、深度档位 A/B/C + 成本估算(体量过目,founder 裁)

> 「体量过目」= founder 用 Q6 机制裁本大陆做多深(Fable:前五每个都是小产品,不裁可能让全程翻倍)。Campaign 一期给出三档,推荐档见注。

| 档 | 范围 | 落地形态 | 相对成本 |
|---|---|---|---|
| **A 骨架** | B0-51/52/53/56/57 逐条批 + B0-58 最薄 | workbench 发起 + CAMPAIGN_CARD 提案 + 逐条批生成 + 排期草稿 + TrendSnapshot 表;list/detail 仅容器只读 | 最小(spec 底「第一期」) |
| **B 标准(推荐)** | A + B0-54 日历双视图批改 + B0-55 详情只读归组(content/posts tab)+ 打包批第二期(总价确认 + money-safety-review) | 全 7 页可用;detail 的 ads/results/research 标 P3 骨架 | 中(= spec 底第一+二期) |
| **C 深** | B + detail 广告/结果 tab 接既有 analytics 只读投影 + TrendIntel 富化 + routine 第三期起步 | 逼近完全体边缘;触碰 P3/Routine 本体 | 高(越界 P3,不建议本程) |

**推荐 B 档**:对齐 spec 底第一+二期(零外部依赖,草稿与生成全可用),把「Campaign 一期能收钱」的上市点做实(打包生成 = 真实 spend + 排期草稿),同时把归因/routine/完全体明确留 P3,守住红旗六「干净最重要」。

### 成本估算(spec 底 §七,零新收费点,全复用既有费率)

用户侧一单概算(显示 credits;劳务 = 研究+对话轮):

| 规模 | 内容构成 | 生成 | 策划劳务 | 一单合计 | 毛利口径 |
|---|---|---|---|---|---|
| 一周小 | 6 图 + 1×5s | 14cr | ~5-15cr | ~20-30cr(≈$2-3) | 生成 45-65%、劳动 50%、search 67%,均 ≥45% 地板 |
| 一月中 | 12 图 + 6×5s + 2×10s | 88cr | ~10-30cr | ~100-120cr(≈$10-12) | 同上 |
| 三月大 | 60 图 + 24×5s + 6×10s | 336cr | ~20-50cr | ~360-390cr(≈$36-39) | 同上 |

数字全进 config 层;上量后用 /admin/cost 真实均值回填。若未来做「一口价打包 SKU」(A4 族)则 costing 先行(宪法 5),不在本程。

---

## 十、九缝映射(绕缝直连 = 审查一票否决)

| 缝 | 名 | 本功能触碰? | 施工点 |
|---|---|---|---|
| 缝 1 | defineOttoSkill(Otto 技能框架) | ✅ | 新技能 `proposeCampaign`(六处登记:registry+test 名单 25→26、migration gate 断言、CATALOG 重生、instructions、parity manifest)+ 读技能 `listTrendSnapshots` |
| 缝 2 | GenerationProvider + 模型表 | ❌ | 不新建供应商/模型;消费既有生成 |
| 缝 3 | Credit ledger(记账/花钱缝) | ✅ | 打包生成 reserve→settle;每卡幂等键;partial 退款;§七核心 |
| 缝 4 | Channel/connector(渠道缝) | ✅(轻) | ScheduledPost.campaignId 归组;发布渠道(IG/FB 现有,X=B 线 adapter)不改本结构 |
| 缝 5 | Tenant model(租户 ownerId 缝) | ✅ | Campaign 表 + TrendSnapshot 表进 TENANT_MODELS;requireOwner;2-org 隔离测试 |
| 缝 6 | Queue/worker(异步任务缝) | ➖ | 复用深研 #118 worker;不新建队列 |
| 缝 7 | Design system(.gb + shadcn 界面缝) | ✅ | 单一设计系统不分叉;coral 只属于 Otto(叙述条/落卡 sweep,live reflection);Landed/skeleton/reduced-motion |
| 缝 8 | ChatMessage card kinds(卡片五道缝) | ✅ | `CAMPAIGN_CARD` 五道缝(持久写 PG enum 加性/重放 threadToUiMessages/流式白名单 proposeCampaign/去重 injectCardMessage 按 durableId/渲染分支 CampaignCard) |
| 缝 9 | Parity Manifest(第九缝) | ✅ | 人工面新按钮出生即登记(workbench Submit、calendar Approve/Edit/Remove、pack Confirm);该块清零才验收,禁新增债棘轮 |

**卡→钱定律(缝 8 铁律)**:CAMPAIGN_CARD 永远只是 display+parameters;任何花钱发生在用户点批之后、由 server 从持久化的卡重算重验,卡永不携带自己的花钱路径。

---

## 十一、与创作/排期/分析区的接线(campaign→生成→排期→归因闭环)

全链一图(spec 底 §2.7),标出每个跨区接点:

```
workbench/CAMPAIGN_CARD(策划)
  → [研究区] researchWeb 轻查 / proposeResearch 深研 → TrendSnapshot 落档
  → proposeCampaign:CAMPAIGN_CARD($0) + Campaign 最薄行(DRAFT)
  → 用户改/批(proposal-card ∥ calendar,同一份 store)
  → [创作区] proposePack 铺 GEN_CARD → generate 闸 ×N(reserve→settle,幂等键各卡独立)
  → [排期区] schedulePosts 草稿 ×N(campaignId 归组,$0,不发布)
  → [排期区] 用户点发(逐条)∥ 第三期 routine 预授权自动发(四件套)
  → [分析区] O-10 效果数据喂下一期提案的 rationale「上期表现」节(第三期)
```

| 接点 | 上游 | 下游 | 契约 |
|---|---|---|---|
| 研究→策划 | Block S(#118 深研 / researchWeb) | proposeCampaign rationale | rationale 带来源引用,Otto 不捏造 trend |
| 策划→创作 | CAMPAIGN_CARD | proposePack → generate | 卡的逐条 brief(英文,宪法 9)喂生成;工厂线 A1/A2 成熟后消费,不重复建 |
| 创作→排期 | Generation 成片 | schedulePosts DRAFT | `ctx.schedule.draft` 单一写权威 = 人工 createScheduledPost 同一 server 函数;每条带 campaignId |
| 排期→发布 | ScheduledPost DRAFT | 发布 worker(本程不碰) | 渠道 IG/FB 现有;X=B 线 adapter 落地即自动接通(加渠道 = channel 枚举 +1 + 缝 4 adapter) |
| 发布→分析 | per-ad performance | 下期提案 rationale(第三期) | O-10 用自家真实投放数据反哺(不抄第三方 GMV) |

**B9 复核**:引擎横切块需确认生成/排期技能透传 campaignId、CAMPAIGN_CARD 走上下文桥、TrendSnapshot 表的 ownerId 隔离;84 债随块清。

---

## 十二、開放问题(含 auto-publish 核实 + spec 底时效核对结论)

| # | 問題 | 现状结论 | 待谁裁 |
|---|---|---|---|
| **O-1** | **UTM 基串**:矩阵 B0-51 列入一期最薄容器,spec §2.4 最小字段未列,蓝图 L180 把 UTM 归 P3 完全体 | **按任务纪律矩阵为准**:一期落一个 `utmBase` 字符串字段(与 A′ `_data.ts` 的 `utmBase` 同形);完整首触归因埋点仍 P3(GRILL 7-3 判「不要」)。差异已对齐,提请 founder 确认「一期一个 UTM 基串字段」的口径即可 | founder 确认口径 |
| **O-2** | **auto-publish 文案出处核实**(mock 风险 6/18) | **已核实,出处为真、文案诚实**。原文在 `apps/web/app/northstar/campaign/calendar/page.tsx:385-397`(**旧 northstar 版**,非 immersive A′ 版):「Standing authority for Otto lives here later: monthly plan refreshes and auto publish, always with a budget cap, a scope statement, a kill switch and run summaries.」代码注释明标 `{/* Routine 管理位(第三期,campaign spec §5.1)*/}`、UI 角标「phase 3 slot」。**出处链**:routine 预授权第三期 = spec 底 §四审批经济学末行 + §六第三期 + 蓝图 L188 routine 授权模型 + 宪法 4 例外② + 四件套(预算上限/范围声明/kill switch/事后摘要)逐字对应。**判定**:非虚假 mock 声明——文案明说「lives here **later**」(不声称当前存在)、标 phase-3、四件套齐全;A′ **immersive 版日历不含此文案**(仅 budget headroom)。**结论:风险 6/18 可降级关闭;一期只做 phase-3 占位不接线**(接线待 P1½-3 Routine 本体另 spec 另批) | 已闭合(留档) |
| **O-3** | TrendSnapshot 的 `TrendIntel` 富化字段(证据句/置信度/复核期/别追这个/动作桥/method)一期带否 | 建议一期先落最薄六字段(§六 C);富化是展示层,可后续期加。A′ 已把富化做进 trends 页,若 founder 认其是「情报溢价」核心卖点可提前 | founder / 体量过目 |
| **O-4** | detail 页 ads/results/research tab 一期深度 | 初判 P3 骨架(A2)。A′ 已把广告状态/疲劳/归因做进 detail(764 行),但那越界完全体;守红旗六「干净最重要」建议一期只做容器 + content/posts 只读归组 | founder / 体量过目(B vs C 档) |
| **O-5** | 打包批(第二期)与逐条批(第一期)的上市点归属 | 「Campaign 一期能收钱」上市点:B 档(推荐)含第二期打包批才是完整「一次点头买一批」体验;A 档逐条批也能收钱但体验碎 | founder(上市点定义) |
| **O-6** | **spec 底时效核对结论** | spec 底(2026-07-08)逐节与 07-12 矩阵/B0 契约核对**无实质冲突**,唯一对齐处 = UTM(O-1)。spec 底的分期/审批经济学/五道缝/最薄容器口径全部现行有效,可作为一期施工直接依据 | 已闭合(留档) |

---

**结尾**:本设计图为 B8 Campaign 一期施工图纸(docs-only),推荐 **B 深度档**(= spec 底第一+二期),守红旗六「独立 Campaign 对象、不升格 project、干净最重要」。B0-57 打包确认页是全舰单最高优先💰,变真必过 money-safety-review。auto-publish 出处已核实为真(routine 第三期占位)、spec 底时效核对无实质冲突。待 founder 体量过目裁深度档后动工。
