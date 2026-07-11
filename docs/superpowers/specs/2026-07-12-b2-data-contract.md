# B2 数据契约 spec（事件 / 身份 / 同意）（v0.2——已吸收 B8 试产需求单）

> 2026-07-12。epoch `claude-20260712-03`。Sol 原阻断的解：**先冻数据契约，B8 设计与后续块在其上施工**，避免末期发现新 schema。
> 状态：骨架 → **吸收 B8 两试产工位的「数据契约需求单」（blocking 检查点）** → Heavy worker 填证据 → 控制面终审 → 顾问 → SOL 跨族复审后 spec-ready。
> 人话：给全城定三样通用底座——「发生了什么事」怎么记（事件）、「这是不是同一个顾客」怎么判（身份）、「他答应过被联系吗」怎么存（同意）。

## 一、范围与矩阵行映射

B2 块（`docs/ops/route-b/matrix/02-B2.md`）11 行中的量测脊柱行（E5-06 六表悬空 / E5-07 短链 redirect）+ 跨块消费者（B5 收件箱建档、B6 回执、B7 唤回/抑制、B8 CRM/归因、B12 收费点事件）。明示排除：分析区 UI（随 B2 施工另节）、报表引擎（壳，R-008）。

## 二、冻结对象（三契约 + 一链）

### 契约 1 · 事件（AttributionEvent 写入规范）
- 形状（冻结方向，字段名以 L0 六表既有 schema 为基）：`{ ownerId, kind, occurredAt, source: {channel, placementId?, linkId?, voucherId?}, subject: {contactId? , anonymousKey?}, campaignId?, payload }`。
- 规则：**一切用户可感渠道动作必写事件**（扫码/点短链/核销/收发消息/发布回执）；事件命名闭集起点表（待 worker 从 L0 schema + B8 需求单归并）；幂等键=（ownerId, kind, source 指纹, occurredAt 粒度）防重复计数；只增不改（append-only）。
- 宪法 6：ownerId 全链强制（六表已挂 TENANT_MODELS——H1 已证）。

### 契约 2 · 身份（ContactIdentity 判同规范）
- 唯一索引冻结：`(ownerId, channel, externalId)`（harmony-01 §三 #7/P2-2 原样采纳）。
- 判同规则（冻结保守策略）：**跨渠道不自动合并**——同手机号/同邮箱产生「疑似同人」建议，人工或 Otto 提案确认后合并（宪法 11 状态诚实：宁可两条档案，不可错并）；合并留痕可拆。
- 匿名→实名升级：扫码期 anonymousKey → 首次留联系方式时回填关联（B7 欢迎流消费此规则）。

### 契约 3 · 同意（consent/退订/抑制）
- 字段族冻结：`{ contactId, channel, status: opted_in|opted_out|suppressed, source: {kind, evidenceRef}, occurredAt }`——同意有出处（哪个入口、何凭证）。
- 读写边界：写=B5 收件箱/B7 退订流/B8 CRM；**读=B7 抑制名单运行时硬约束的唯一真源**（判决 7-9：自动化系统层跳过，非字段装饰）；频控计数器同源（B7）。

### 归因链（L0 一条码全链，MASTERPLAN L0 行验收原样）
`TrackedLink/QR 生成 → 印出 → 扫码（redirect，E5-07 待建）→ AttributionEvent 落账 → contact 关联（带来源标签）→ 单据出现在归因流`。短链域=founder 供给单项（外部等待位）。

## 三、对标锚清单

| 锚 | 版本 | 关键旅程 | 通过阈值 |
|---|---|---|---|
| Klaviyo（CDP 画像/同意管理——对标地图·生命周期行） | 2026-07 | 联系人档案聚合+同意状态可查 | 同意状态与出处三跳内可见 |
| Metricool（SMB 归因——对标地图·分析区行） | 2026-07 | 来源→转化归因流 | 一条码全链可点（L0 验收原文） |
| 宪法 6 租户铁幕 | v2.11 | 全链 ownerId | tenant-guard 覆盖+测试 |

## 四、假设台账

| 假设 | 依据 | 验证法 |
|---|---|---|
| L0 六表 schema 字段足以承载契约 1 | 迁移已合 main（E5-06） | worker 逐字段核对，缺列=additive migration 提案（schema 变更=founder-only 类别，单列上报） |
| 保守判同不伤 CRM 起步体验 | respond.io 起步形态 | CRM 试产设计需求单回填对表 |
| 同意契约覆盖 WABA 模板规则 | Meta 政策（PLATFORM-TRUTH） | B5 spec 对表 |

## 四点五、B8 试产需求单吸收（v0.2 增补，2026-07-12——出处：PR #244 CRM / PR #245 Campaign 设计 §6）

**采纳入契约（控制面裁定）：**
1. **三表 additive（CRM）**：Contact（+source/firstTouchCampaignId/marketingConsent/doNotDisturb）、ContactIdentity（唯一索引与契约 2 一致 ✓）、Segment（phrase 原文+rulesJson 确定性编译——宪法 10）。沿用 harmony-01 #7/#13，不发明。
2. **写入点归属（CRM，采纳）**：Contact upsert + AttributionEvent 写在 B5 入信 / B2 归因 / B7 欢迎流的**共享 action**；CRM 页面只读消费，自写仅手工/导入/合并/consent 四类——契约 1「谁写事件」由此定稿。
3. **判同细则（CRM，采纳并入契约 2）**：仅强标识精确相等（E.164 手机/小写 email/fbPsid）才建议合并；同名不自动合并；合并=重指+审计留痕，永不物删。**规范化标准（waPhone 国码/email 大小写）= B2/B5 联定一份**，列为本 spec 交付物之一。
4. **consent 边界（CRM，采纳并入契约 3）**：`marketingConsent`+`doNotDisturb` 是 Contact 字段（CRM 写+展示）；抑制名单=B7 运行时硬约束（非字段）；发送资格最终裁决在 B7；分群 contactable = `opt_in AND NOT doNotDisturb`。
5. **Campaign 容器（Campaign，采纳）**：最薄表字段（含 `utmBase?`——**O-1 UTM 口径冲突待 founder 一句话**：矩阵 B0-51 一期 UTM 基串 vs 旧 spec 归 P3，暂按矩阵）；campaignId 可空外键 additive 接线（ScheduledPost/Generation 补迁移；Project 已预留）；TrendSnapshot 最薄表（ownerId 隔离，两写入点+读技能）。
6. **归因一期口径（Campaign，采纳）**：一期只做归组事件；完整首触归因=P3，契约 1 的 kind 闭集预留 `campaign.attributed` 位。

**待第二/三波需求单**（口碑/Marketplace/QR-landing-GBP）：评价/介绍关系/积分账的表与事件、listing 草稿存储、效果衡量事件——v0.3 吸收后才进冻结流程。

## 五、冻结条件与状态

- **Blocking 检查点：B8 两试产（CRM/Campaign）数据契约需求单未吸收前不得冻结**（D-015④）。
- v0.1（本稿）→ 需求单吸收 v0.2 → worker 证据层 → 终审 → SOL 跨族 → spec-ready（02-B2 相关行随冻结 PR 迁级）。
- 開放问题：①事件 payload 的 schema 约束强度（JSON 自由 vs 每 kind 定型——宪法 10 倾向定型）②anonymousKey 的隐私保留期（PDPA 姿态=B13 对表）③收费点事件（宪法 2 账本推论）是否并入 kind 闭集或另账。
