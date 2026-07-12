# B2 数据契约 spec（事件 / 身份 / 同意）（v0.4——冻结候选）

> 2026-07-12。epoch `claude-20260712-03`。Sol 原阻断的解：**先冻数据契约，B8 设计与后续块在其上施工**，避免末期发现新 schema。
> **状态：冻结候选（freeze candidate）——冻结待 founder 明示 ack（D-018②/D-020⑤）。** SOL 跨族复审 §2 的 B2 六条阻断项已逐条闭合，二三波需求单已吸收（§四点六）；**v0.4 闭合 codex 异族评审（第二轮 BLOCK）清单**：ConsentEvent 完整 Prisma 形状（契约 3）、AttributionEvent 完整字段抄录表（契约 1）、anonymousKey 应用层澄清（契约 2）、BusinessEvent/Receipt 互斥职责冻结（契约〇·附）、口碑各 kind 账本归属现在冻结（§四点六·1）、六表列举补 VoucherToken（§四点六·3）。本文本属共享契约/schema=founder-only 类别，异族复审通过不替代 founder 明示过目；未获 ack 前 02-B2 相关行不迁 `spec-ready`。
> 人话：给全城定三样通用底座——「发生了什么事」怎么记（事件）、「这是不是同一个顾客」怎么判（身份）、「他答应过被联系吗」怎么存（同意）。

## 一、范围与矩阵行映射

B2 块（`docs/ops/route-b/matrix/02-B2.md`）11 行中的量测脊柱行（E5-06 六表悬空 / E5-07 短链 redirect）+ 跨块消费者（B5 收件箱建档、B6 回执、B7 唤回/抑制、B8 CRM/归因/口碑/Marketplace/第一米、B12 收费点事件）。明示排除：分析区 UI（随 B2 施工另节）、报表引擎（壳，R-008）。

## 〇、契约〇 · 五账分层（事件账系的宪法级前置——SOL §2·B2③ 采纳）

> **本契约先于契约 1**：SOL 坐实「一切用户可感渠道动作都写 AttributionEvent」把五种不同真相面混进一条流水。冻结前必须钉死：**哪种真相写哪本账**。任何后续块新增写入点，先过此表定账，再谈字段。

| 真相面 | 语义 | 唯一载体 | schema 出处 |
|---|---|---|---|
| Credits 收支（授信/预留/结算/退款） | 平台内部信用账本 | `CreditLedger`（双 delta，`@@unique([orgId, idempotencyKey])`） | `schema.prisma:699-719` |
| 安全 / 操作审计（实质动作留痕、升级门埋点） | 系统自动记录的动作事件 | `ActionEvent`（`type` 命名空间 + `payload`） | `schema.prisma:722-733` |
| observed / attributed 量测（扫码/点击/核销/归因） | 对外可报的量测流水 | `AttributionEvent`（evidence 二值封闭集） | `schema.prisma:1358-1393` |
| 外部经营事实（成交/回执/订单/积分） | 商家系统的真相镜像 | **`BusinessEvent`（事实层）**，凭证挂 `Receipt`（证据层）——互斥职责见契约〇·附 | B6 回执脊柱（表形状归 B6 spec；跨块关系本节冻结） |
| UI 秒级刷新（后台完成→界面感知） | 瞬时通知，非账 | 独立 **live-event envelope**（不落归因流水） | 引 B9 契约 6（`2026-07-12-b9-engine-interface-freeze.md`） |

**明文禁止入归因流水（AttributionEvent）**（机器闸候选，进 REVIEWER-PLAYBOOK 与 CI schema 断言）：
1. **Campaign 的 `credits_spent`**——是 Credits 收支，归 `CreditLedger`；campaign 级花费聚合从 CreditLedger 按 `refId`/`brandId` 读，不在归因流水造第二真源。
2. **Marketplace 操作日志**（`marketplace.listing.generated/exported`、`marketplace.promo.reminder_sent` 等）——是操作审计，走 `ActionEvent` 的 `marketplace.*` 命名空间（PR #247 §6.3 已定，§四点六·2 吸收）。
3. **UI live reflection**（canvas 4s 轮询推送化的界面感知信号）——是瞬时通知，走 B9 live-event envelope，永不落账。

> **一句话给所有块**：写事件前先问「这是量测、审计、收支、外部事实、还是刷新？」——答案决定表，不是都往 AttributionEvent 塞。

### 契约〇·附 · BusinessEvent / Receipt 互斥职责（v0.4 冻结——codex P1③ 采纳）

> 两表均尚未入 schema（B6 未开工）；表形状归 B6 spec 冻结，**本节冻结的是二者的互斥职责与 owner/issuer/幂等/凭证四项跨块关系**——B2 契约〇「外部经营事实」的读方引用自此确定，不再二选一悬置。

| 项 | `Receipt`（凭证层） | `BusinessEvent`（事实层） |
|---|---|---|
| 职责 | 外部系统**原始回执**存证：webhook 原始 payload / 商家确认记录，**不可变、append-only** | 从 Receipt **确定性归一**出的经营事实（`order_paid`/`order_refunded`/`points_changed` 等封闭 kind，宪法 10） |
| 互斥 | **永不承载归一语义**（只存证不解释） | **永不存 raw payload**（只存归一后的事实字段） |
| owner | `ownerId` 全链强制 + `TENANT_MODELS`（宪法 6） | 同左 |
| issuer | `issuerId`=连接命名空间（同契约 2，锚定「哪条连接送来的」） | 同左（继承自其 Receipt） |
| 幂等 | `@@unique([ownerId, idempotencyKey])`，键=`'<issuer>:<externalEventId>'`（外部系统事件号，webhook 重试稳定去重） | 键=`'<issuer>:<externalEntityId>:<factKind>'`（同一订单同一事实精确一次） |
| 凭证关系 | —— | `receiptId` fk → Receipt：**每条事实必挂凭证**，无凭证不落事实（回执脊柱的可审计根） |

- **契约〇的载体裁定**：跨块读方（B8 请评成交时机 / Referral 成交验证 / B2 效果计算）一律引用 **`BusinessEvent`**（事实层）；`Receipt` 是其证据脚注，仅审计/对账下钻时读。
- 与既有账的边界：`VoucherToken.externalOrderId/redemptionEvidence`（`schema.prisma:1315-1316`）是核销事实在 L0 的**就地锚点**，不与 BusinessEvent 冲突——B6 落地后核销回执同样经 Receipt→BusinessEvent 归一，AttributionEvent 的 redeem/clawback 行引用不变。

## 二、冻结对象（三契约 + 一链）

### 契约 1 · 事件（AttributionEvent 写入规范——对齐真 schema，SOL §2·B2② 采纳）

- **形状以 L0 既有 schema 原样为准**（`schema.prisma:1358-1393`），v0.2 的嵌套 `source/subject/payload` 形状**废除**。**完整字段抄录表**（v0.4——codex P1① 采纳，「逐字段对齐」名实相符；类型与可空性照抄真 schema）：

  | 字段 | 类型 | 可空 | 行号 | 语义 |
  |---|---|---|---|---|
  | `id` | `String @id` | 否 | :1359 | ULID |
  | `ownerId` | `String` | 否 | :1360 | 租户键（宪法 6） |
  | `organization` | `Organization @relation(fields:[ownerId], references:[id])` | — | :1361 | 租户关系 |
  | `brandId` | `String?` | 可空 | :1362 | 软引用（无 FK） |
  | `campaignId` | `String?` | 可空 | :1363 | 软引用（无 FK） |
  | `kind` | `String` | 否 | :1364 | 封闭集（下详） |
  | `linkId` | `String?` | 可空 | :1366 | 仪表软引用 |
  | `qrAssetId` | `String?` | 可空 | :1367 | 仪表软引用 |
  | `voucherId` | `String?` | 可空 | :1368 | 仪表软引用 |
  | `sourceTagId` | `String?` | 可空 | :1369 | 仪表软引用 |
  | `evidence` | `String` | 否 | :1373 | 二值封闭集（下详） |
  | `evidenceRung` | `String?` | 可空 | :1374 | 内部细分（下详） |
  | `outcomeDelta` | `Int @default(0)` | 否 | :1375 | 有符号增量（下详） |
  | `valueMinor` | `Int?` | 可空 | :1376 | 订单金额（minor units，source-observed）；未知则 null |
  | `valueCurrency` | `String?` | 可空 | :1377 | 币种 |
  | `utmSnapshot` | `Json?` | 可空 | :1378 | 抄表时刻 UTM |
  | `geoBucket` | `String?` | 可空 | :1380 | 粗区域桶，永不精确定位 |
  | `deviceBucket` | `String?` | 可空 | :1381 | 粗设备类，永不指纹 |
  | `ipHashPrefix` | `String?` | 可空 | :1382 | 截断+哈希，仅限速率/异常 |
  | `idempotencyKey` | `String` | 否 | :1383 | 精确一次键（下详） |
  | `occurredAt` | `DateTime @default(now())` | 否 | :1384 | 业务时间 |
  | `createdAt` | `DateTime @default(now())` | 否 | :1385 | 落库时间 |
  | `@@unique([ownerId, idempotencyKey])` | 索引 | — | :1390 | 精确一次 |
  | `@@index([ownerId, kind, occurredAt])` | 索引 | — | :1391 | 报表 |
  | `@@index([ownerId, campaignId, occurredAt])` | 索引 | — | :1392 | campaign 级报表 |

  载重语义逐条冻结：
  - `kind`（`schema.prisma:1364`）：**封闭集** `'scan' | 'click' | 'source_tag' | 'redeem' | 'clawback' | 'outcome_link'`。仪表软引用按 kind 至少一个非空：`linkId`/`qrAssetId`/`voucherId`/`sourceTagId`（`schema.prisma:1366-1369`）。
  - `evidence`（`schema.prisma:1373`）：**二值封闭集** `'observed' | 'attributed'`；写入器**硬拒** `'incremental'` 及任何集外值（fail-closed，`schema.prisma:1352-1355/1370-1372`）。**`'incremental'` 永久禁写**——L0 无对照实验，一个被核销的码永远不是「Otto 造成了这单」的证据；此纪律与 ModelRegistryOverlay「只能收窄、永不能加」同构。
  - `evidenceRung`（`schema.prisma:1374`）：`'source_observed' | 'merchant_confirmed' | 'associated' | 'model_attributed'`——内部细分供报表，**永不含 incremental**；对外报表桶只有 observed/attributed 两格。
  - `outcomeDelta`（`schema.prisma:1375`）：**有符号增量**——redeem +1 / clawback -1 / scan·click·source_tag 0；净归因 = Σ outcomeDelta（镜像 CreditLedger 双 delta 可重建不变量，退款回卷干净反冲）。
  - `utmSnapshot`（`schema.prisma:1378`）：抄表那一刻捕获的 UTM（结构化，见 §UTM）。
  - 反滥用信号 `geoBucket`/`deviceBucket`/`ipHashPrefix`（`schema.prisma:1379-1382`）：仅粗粒度、隐私安全（PDPA），永不精确定位/指纹/作身份。
- **幂等键=沿用既有 `idempotencyKey` 语义**（`schema.prisma:1383`，格式 `'redeem:<voucherId>' | 'clawback:<externalOrderId>' | 'scan:<dedupHash>'`），唯一约束 `@@unique([ownerId, idempotencyKey])`（`schema.prisma:1390`）。**明确废除** v0.2 的「含 `occurredAt` 粒度的组合幂等键」——webhook 重试去重要**稳定键**：occurredAt 组合既不能稳定去重双 webhook/双扫重放，又可能吞掉同桶内合法的多事件。`occurredAt`（`schema.prisma:1384`）只作时间戳与报表分桶，**不进幂等键**。
- 规则：**量测类**用户可感渠道动作写事件（扫码/点短链/核销/归因）；非量测动作按契约〇 分流（credits→CreditLedger，操作→ActionEvent，外部事实→BusinessEvent，刷新→live-event）。只增不改（append-only）。
- **kind 闭集演进=founder-only 单列**：二三波需求单要求的新事件属**闭集扩展**，是 schema 演进（founder-only 类别），additive migration，冻结时单列上报 founder，不在本 spec 自行落地。**每个新 kind 的账本归属已在 §四点六·1 现在冻结**（v0.4——codex P1④ 采纳，不留 B8）：进 AttributionEvent kind 闭集的近期扩展仅 `referral_converted`（+P3 的 `campaign.attributed`），其余口碑事件分别归 ActionEvent / BusinessEvent / 派生信号 / 镜像表真源。
- 宪法 6：ownerId 全链强制（六表已挂 TENANT_MODELS——H1 已证）。

### 契约 2 · 身份（ContactIdentity 判同规范——SOL §2·B2⑤ 采纳）

- **唯一索引冻结（扩展）**：`(ownerId, channel, issuerId, externalId)`。
  - **`issuerId`=连接命名空间**：FB/IG 的 page-scoped / app-scoped ID 在不同连接（不同 FB Page / 不同 App）下会重号，`(ownerId, channel, externalId)` 会把同租户不同连接下的**不同人错并**。`issuerId` 锚定「哪条连接发的这个 ID」（对齐渠道缝 Seam 4 的 connector 身份），消除跨连接混淆。
  - **schema 演进=additive**；因触及唯一约束（身份铁幕），列为 **founder-only 类别单列标注**，冻结时随契约一并上报。
- **+规范化版本字段** `normalizationVersion`：判同前对强标识做确定性规范化（E.164 手机国码 / email 小写去点别名 / fbPsid 原样），规范化规则集有版本号；规则升级 → 版本号 +1，旧档按旧版规范化值留存、新写按新版，**避免规则漂移导致历史判同不可复现**。规范化标准（waPhone 国码 / email 大小写）= B2/B5 联定一份，列为本 spec 交付物。
- **判同规则（冻结保守策略）**：**跨渠道不自动合并**——仅强标识精确相等（规范化后的 E.164 / 小写 email / fbPsid）才产生「疑似同人」建议；同名/同显示名**永不自动合并**（宪法 11 状态诚实：宁可两条档案，不可错并）。
- **+可逆 merge 契约**：合并=**重指**（把从档指向主档，保留从档 tombstone）+ **审计留痕**（谁/何时/依据哪条强标识，写 ActionEvent）+ **可拆**（unmerge 按 tombstone 反向重指还原），**永不物删**。合并/拆分均 append-only 可回放。
- **匿名→实名升级**（v0.4 澄清——codex P1② 采纳）：**真 schema 无 `anonymousKey` 列**；匿名主体的实际字段组合 = `SourceTag.subjectKind='anon'` + `SourceTag.subjectRef=<匿名会话键>`（`schema.prisma:1335-1336`）。「anonymousKey」仅是**应用层变量名**，指代 subjectKind='anon' 时的 subjectRef 值，不新增列。升级规则：首次留联系方式时回填关联（B7 欢迎流消费）——同一 `subjectRef` 列改 scope 到 contactId（`subjectKind='contact'`），CRM 落地零迁移（同 L0 spec A4 手法，`schema.prisma:1326-1328` 注释原文）。

### 契约 3 · 同意（四轴独立存证——SOL §2·B2④ 采纳）

> SOL 坐实 v0.2 consent 自相矛盾（一处把 opted_in/opted_out/suppressed 当同一状态，一处又落成 Contact 上的 marketingConsent+doNotDisturb）。**法律同意、顾客退订、商家勿扰、频控抑制是四个不同轴**，冻结前必须拆分独立存证 + 确定性派生资格。

**四轴独立存证**（每轴各自 append-only，永不互相覆写）：

| 轴 | 语义 | 载体形态 | 谁写 |
|---|---|---|---|
| A · 法律同意 | 按 `channel` × `purpose` 的**追加式证据记录**（何入口、何凭证、何时同意/撤回） | `ConsentEvent`（完整 Prisma 形状见下——v0.4 冻结） | B5 收件箱 / B7 退订流 / CRM 导入 |
| B · 顾客退订 | 顾客主动 opt-out（STOP / 退订链接） | 同 A 的 `action='revoke'`（顾客发起，`actorKind='customer'`） | B5 / B7 退订流 |
| C · 商家勿扰（DND） | 商家侧对某顾客设「勿扰」 | Contact 上的 `doNotDisturb` 布尔（商家写+展示，CRM） | CRM |
| D · 频控抑制 | 运行时短期次数上限（避免骚扰） | B7 运行时频控计数器（非字段，非持久同意） | B7 自动化系统层 |

**`ConsentEvent` 完整 Prisma 形状（v0.4 冻结——codex P0 采纳；建表本身仍属 founder-only 单列，§五）**：

```prisma
// 同意证据流水（契约 3 轴 A/B）：append-only——无 updatedAt、无 deletedAt、永不 UPDATE/DELETE
// （同 AttributionEvent 纪律）。「同意有出处」：每行必带 evidenceRef。
model ConsentEvent {
  id             String   @id // ULID
  ownerId        String   // 租户键，无默认（宪法 6；进 TENANT_MODELS + Organization back-relation）
  organization   Organization @relation(fields: [ownerId], references: [id])
  contactId      String   // fk → Contact（CRM 起步表，B0-59）
  channel        String   // 'whatsapp' | 'sms' | 'email'（code-validated String，非 PG enum；house style）
  purpose        String   // 'marketing' | 'transactional' | 'review_request'（封闭集，code-validated）
  action         String   // 'grant' | 'revoke'（封闭集）
  actorKind      String   // 'customer' | 'merchant' | 'system'（轴 B 判定依据：customer 发起的 revoke 优先级最高）
  sourceKind     String   // 'inbox_optin' | 'unsubscribe_link' | 'stop_keyword' | 'crm_manual' | 'import'（封闭集：哪个入口）
  evidenceRef    String   // 出处凭证引用：消息 id / 退订 token / 导入批次号——同意有出处，不可为空
  idempotencyKey String   // 稳定幂等键：'stop:<messageId>' | 'link:<unsubTokenId>' | 'import:<batchId>:<rowN>' | 'manual:<uuid>'
  occurredAt     DateTime // 业务时间（同意/撤回发生时刻）
  createdAt      DateTime @default(now())

  @@unique([ownerId, idempotencyKey])                          // 精确一次（镜像 AttributionEvent :1390 手法）
  @@index([ownerId, contactId, channel, purpose, occurredAt]) // 租户前导；派生函数读「最近一条」即此索引
}
```

- 纪律：append-only（无软删——同意证据永不删除）；`@@unique([ownerId, idempotencyKey])` 保证 STOP 双投递/导入重跑精确一次；租户前导索引服务 `contactable` 派生函数的「最近一条 ConsentEvent」查询。

- **`contactable` 由确定性派生函数算出**（宪法 10，不靠模型天赋；派生规则写成表）：

  | 输入 | 判定 |
  |---|---|
  | 该 (channel, purpose) 最近一条 ConsentEvent | `action='grant'` 且无更晚的 `revoke` → 轴 A 通过；否则不可联系 |
  | 轴 B 顾客退订 | 存在顾客发起的 revoke → 立即不可联系（顾客意志优先于商家） |
  | 轴 C 商家 DND | `doNotDisturb=true` → 不可联系 |
  | 轴 D 频控 | 运行时超上限 → 本次抑制（`status='suppressed'`），不改持久同意 |

  `contactable(contactId, channel, purpose) = 轴A通过 AND NOT 轴B退订 AND NOT 轴C·DND`；轴 D 是**运行时叠加**的发送资格闸（B7），不改派生的 `contactable`。
- **读写边界**：写=B5 收件箱/B7 退订流/CRM/B8 请评前置；**读=B7 抑制名单运行时硬约束的唯一真源**（判决 7-9：自动化系统层跳过，非字段装饰）；发送资格最终裁决在 B7 运行时（叠加轴 D）。分群 `contactable` 用上式派生，**不在 Contact 上冻结成单一 status 字段**。

### 契约附 · UTM 结构化（D-021 已批，SOL §2·B2⑥ 采纳）

- **对齐既有 `TrackedLink.utmJson` 结构**（`schema.prisma:1227`）：`{ source, medium, campaign, content, term }`（五键，Json，重定向时附加到 targetUrl）。
- Campaign 的 **`utmBase` 单字符串方案废除**——单字符串会与 `TrackedLink.utmJson` 形成双真源。Campaign 层的 UTM 归组用**结构化 `utmJson` 同形状**（campaign 侧写 `campaign` 键 + 可选 `content`/`term`），经 TrackedLink 承接，不另存捷径字符串。
- `AttributionEvent.utmSnapshot`（`schema.prisma:1378`）抄表那一刻的 UTM，形状同上，单一真源来自 TrackedLink。

### 归因链（L0 一条码全链，MASTERPLAN L0 行验收原样）
`TrackedLink/QR 生成 → 印出 → 扫码（redirect，E5-07 待建）→ AttributionEvent 落账 → contact 关联（带来源标签）→ 单据出现在归因流`。短链域=founder 供给单项（外部等待位）。

## 三、对标锚清单

| 锚 | 版本 | 关键旅程 | 通过阈值 |
|---|---|---|---|
| Klaviyo（CDP 画像/同意管理——对标地图·生命周期行） | 2026-07 | 联系人档案聚合+同意状态可查 | 同意状态与出处三跳内可见（四轴独立可溯） |
| Metricool（SMB 归因——对标地图·分析区行） | 2026-07 | 来源→转化归因流 | 一条码全链可点（L0 验收原文） |
| 宪法 6 租户铁幕 | v2.11 | 全链 ownerId | tenant-guard 覆盖+测试 |

## 四、假设台账

| 假设 | 依据 | 验证法 |
|---|---|---|
| L0 六表 schema 字段足以承载契约 1 | 迁移已合 main（E5-06），本 spec 已逐字段引用 `schema.prisma:1358-1393` | worker 逐字段核对，缺列=additive migration 提案（schema 变更=founder-only 类别，单列上报） |
| `issuerId` 扩索引不伤既有 (ownerId,channel,externalId) 数据 | 唯一约束加列=additive，旧数据 issuerId 回填连接命名空间 | 迁移脚本逐连接回填 + 唯一性冲突预检（founder-only 单列） |
| 四轴 consent 覆盖 WABA 模板规则 | Meta 政策（PLATFORM-TRUTH） | B5 spec 对表 |
| 保守判同不伤 CRM 起步体验 | respond.io 起步形态 | CRM 试产设计需求单回填对表 |

## 四点五、B8 试产需求单吸收（v0.2 增补，2026-07-12——出处：PR #244 CRM / PR #245 Campaign 设计 §6）

**采纳入契约（控制面裁定）：**
1. **三表 additive（CRM）**：Contact（+source/firstTouchCampaignId/doNotDisturb〔轴 C〕）、ContactIdentity（唯一索引与契约 2 一致，含 `issuerId`）、Segment（phrase 原文+rulesJson 确定性编译——宪法 10）。沿用 harmony-01 #7/#13，不发明。**注**：v0.2 曾把 `marketingConsent` 落成 Contact 字段，v0.3 按契约 3 改为四轴独立存证（法律同意/退订走 `ConsentEvent`，DND 留 Contact 布尔）。
2. **写入点归属（CRM，采纳）**：Contact upsert + AttributionEvent 写在 B5 入信 / B2 归因 / B7 欢迎流的**共享 action**；CRM 页面只读消费，自写仅手工/导入/合并/consent 四类——契约 1「谁写事件」由此定稿。
3. **判同细则（CRM，采纳并入契约 2）**：仅强标识精确相等（规范化 E.164/小写 email/fbPsid）才建议合并；同名不自动合并；合并=重指+审计留痕+可拆，永不物删。**规范化标准（waPhone 国码/email 大小写/`normalizationVersion`）= B2/B5 联定一份**，列为本 spec 交付物之一。
4. **consent 边界（CRM，采纳并入契约 3 四轴）**：DND=Contact 字段（轴 C，CRM 写+展示）；法律同意/退订=`ConsentEvent`（轴 A/B）；抑制名单=B7 运行时硬约束（轴 D，非字段）；发送资格最终裁决在 B7；分群 `contactable` = 契约 3 派生函数。
5. **Campaign 容器（Campaign，采纳）**：最薄表字段；**UTM 归组用结构化 `utmJson`（对齐 TrackedLink，见「契约附」），O-1 已由 D-021 裁定=结构化 schema，v0.2 的 `utmBase?` 单字段作废**；campaignId 可空外键 additive 接线（ScheduledPost/Generation 补迁移；Project 已预留）；TrendSnapshot 最薄表（ownerId 隔离，两写入点+读技能；数据层由 B8 后段/B9 协调）。
6. **归因一期口径（Campaign，采纳）**：一期只做归组事件；完整首触归因=P3，契约 1 的 kind 闭集扩展 `campaign.attributed` 位属 founder-only 演进（§契约 1）。

## 四点六、二三波需求单吸收（v0.3 新增，2026-07-12——出处：PR #248 口碑 / #247 Marketplace / #249 第一米，各 §6）

> **总纲**：SOL §2·B2① 坐实「文件自身写明二三波未吸收、需 v0.3」是不可冻结的形式硬伤。本节吸收三波需求单，形式上补齐冻结候选资格。
> **留痕（D-021 圈档）**：D-021 体量过目代批后，**Marketplace B0-70/72、第一米 B0-76 保持 `listed`**；其表设计**仅入册（本节登记）不排产**——不认证、不出程、终验如实显示。下列表设计入契约做前瞻校验，不构成即时建表授权（新增对象=founder-only schema 演进，单列上报）。

### 1 · 口碑五表（PR #248 §6 —— ReviewRequest / ReviewItem / Testimonial / Referral / LoyaltyMember）

五表均**新对象**（非 harmony-01 既有），全部 additive migration，租户铁幕：每表 `ownerId`（无默认）+ 进 `TENANT_MODELS` 守卫 + 领头 `(ownerId, …, deletedAt)` 索引（缝 5）。

| 表 | 关键字段（起步 A 档） | 契约级约束（喂 B2） |
|---|---|---|
| **ReviewRequest**（请评线） | `contactId` fk / `platform`(google/shopee/lazada/fb) / `officialLinkRef` / `channel`(whatsapp/sms/email) / `status`(pending/sent/suppressed/failed) / `triggeredByEventId` fk?(读 B6 回执) / `sentAt` | **禁含 `rewardId`/`incentive`/`satisfactionScore`**（宪法 8 请评不挂奖励；反 gating 不做满意度预筛）——机器闸 |
| **ReviewItem**（监控只读镜像+回评态） | `platform`/`externalReviewId` / `rating` / `body`(只读镜像) / `replyStatus`(none/drafted/replied) / `replyBody`? / `capturedAt` | 唯一索引 `(ownerId, platform, externalReviewId)` 防重复镜像 |
| **Testimonial**（好评转凭证，轻量） | `reviewItemId` fk / `displayText` / `starRating` | 无 widget embed 字段（成本性排除） |
| **Referral**（奖励线） | `referrerContactId`/`refereeContactId` fk / `status`(invited/converted/rewarded) / `convertedEventId` fk? / `rewardKind`(easystore_points/voucher_token/manual) / `rewardVoucherTokenId` fk?(→L0 VoucherToken) | **禁含 `reviewRequestId`/`reviewItemId`**（宪法 8 发奖永不以留评为条件）——机器闸 |
| **LoyaltyMember**（忠诚，积分只读镜像） | `contactId` fk / `pointsBalance`(只读镜像自 EasyStore/B6) / `tier` / `pointsSyncedAt` / `pointsExpireAt`?(交接 B7 唤回) | B8 永不自建积分账本、永不代管（宪法边界表 `BLUEPRINT.md:48`） |

- **事件账本归属（v0.4 现在冻结，逐 kind 裁定——codex P1④ 采纳；规则=操作→ActionEvent，可证观测/成果→AttributionEvent，外部事实→BusinessEvent，确定性可算→不落账）**。注：PR #248 §6.2 原单把七个事件全写 AttributionEvent，按契约〇 五账分层**修正归属**如下（给 B8 的修法，需求单原文留档不改）：

  | 事件 | 归属 | 裁定理由 |
  |---|---|---|
  | `review_requested`（请评发出） | **ActionEvent** `reputation.review.requested` | 我方发起的触达**操作**，非量测；且无仪表软引用可挂（违反契约 1「按 kind 至少一个非空」不变量）。请评链接的扫/点由既有 `scan`/`click` kind 凭 linkId 正常落归因流水（TrackedLink `purpose='review_request'` 已在 schema :1228） |
  | `review_replied`（回评发出） | **ActionEvent** `reputation.review.replied` | 外部写操作的审计留痕 |
  | `review_received`（监控到新评价） | **不写事件——`ReviewItem` 镜像表即真源** | 平台评价不可证归因到任何仪表（Google 不回传评价者来路）；写 AttributionEvent 会违反仪表非空不变量并污染量测流。ReviewItem 唯一索引 `(ownerId, platform, externalReviewId)` 防重，B2 直接读表计数（capturedAt/rating），免双录 |
  | `referral_converted`（介绍成交） | **AttributionEvent 新 kind**（founder-only 闭集扩展） | **可证成果**：成交经 B6 BusinessEvent 验证（evidenceRung 按凭证=merchant_confirmed/source_observed），仪表=介绍链 `linkId` 或 `sourceTagId`（必非空，守契约 1 不变量），`outcomeDelta=+1`。**无仪表的口头介绍不写归因流水**——只更新 `Referral.status` + ActionEvent 留痕（诚实：不可证就不进量测账） |
  | `referral_rewarded`（发奖） | **ActionEvent** `reputation.referral.rewarded` | 发奖是**操作**（商家价值动作，SOL §1·P0-3 要求审计）；奖励载体本身在 `VoucherToken`/EasyStore 积分（只读），不经 FIKIRTIVE 资金 |
  | `loyalty_redeemed`（积分兑换） | **BusinessEvent**（B6 镜像） | 外部经营事实：兑换发生在 EasyStore，经 Receipt→BusinessEvent 归一进城（契约〇·附），B8 永不代写 |
  | `loyalty_expiring`（积分将到期） | **不落账——确定性派生信号** | 从 `LoyaltyMember.pointsExpireAt` 确定性可算（宪法 10），B7 唤回直接读；若 B7 因此发出触达，触达操作由 B7 写 ActionEvent |

  效果数值（NPS/复购率/新客数）由 B2 B0-09 从上述各账+镜像表**自算**，B8 只写不算。**进 AttributionEvent kind 闭集的近期扩展仅 `referral_converted` 一个**（founder-only 单列，§五）。
- **宪法 8 结构隔离机器闸**（本域最关键契约）：ReviewRequest 与 Referral 两表**禁互指外键**；`review_*` 与 `referral_*`/`loyalty_*` 两族事件**不共享关联键**，B2 算效果时不得反推「留评→给奖」耦合归因。任何 migration 加互指=违宪 8，进 REVIEWER-PLAYBOOK 硬拦 + CI schema 断言。

### 2 · Marketplace 复用裁定（PR #247 §6 —— BrandRecord data JSON + ActionEvent 事件族）

- **listing 优化草稿存哪**：**方案 A（推荐，复用）** = 落 `BrandRecord`（kind='product'）的 `data` JSON 子字段（如 `data.listingDrafts[]`，按平台画像分组，zod 校验）——零新表、零新缝、软删/owner 隔离/upsert 键全现成。方案 B（新表 `MarketplaceListingDraft`）仅当「一产品×多平台×多历史版本」查询强到 JSON 撑不住时走缝 5，**决策留块 spec/founder**（Marketplace §12 Q1）。字段建议：`platform`(shopee/lazada)/`title`/`keywords[]`/`attributes{}`/`description`/`imageCopy`/`generatedAt`/`sourceGenJobId`/`rationale`。
- **效果衡量事件走 ActionEvent 事件族**（非 AttributionEvent，遵契约〇 禁令）：`marketplace.*` 命名空间落既有 `ActionEvent` 脊柱（`schema.prisma:722`），B2 直接消费不建平行表：`marketplace.listing.generated`{productId,platform,genJobId,fieldsCount} / `marketplace.listing.exported`{productId,platform,method:copy|csv} / `marketplace.promo.reminder_sent`{eventKey,platform} / `marketplace.selfreport.result`（后程，明标「自报非平台真值」）。
- **大促日历数据源**：种子静态（11.11/12.12/Payday/官方券档期）存 `RuntimeConfig` 或版本化种子文件（非 owner 隔离，平台知识种子）；用户特定研究结果经 `ResearchJob`→未来 `TrendSnapshot`（B0-58，owner 隔离），数据层由 B8 后段/B9 协调。
- **留痕**：B0-70（站内竞价广告）/B0-72（直播挂车）**保持 listed**（D-021）；「代投」变体=调平台 Ads API 真花商家钱=渠道接入=出 OUT-E415 + 修宪级，永不代投（钱路红线）。

### 3 · 第一米（PR #249 §6 —— MicrositePage 唯一新对象 + 全线复用 L0 六表）

- **复用优先铁律**：五行（B0-62/73/74/75/76）全部经 L0 六表（`TrackedLink`/`QrAsset`/`QrPlacement`/`VoucherToken`/`SourceTag`/`AttributionEvent`，`schema.prisma:1216-1393`）抄表，**不各自建归因**；campaignId/brandId 一律软引用（无 FK、无 backfill）。（v0.4 勘误：v0.3 此处漏列 `VoucherToken`，六表实为六——codex P2 采纳。）
- **唯一新对象 `MicrositePage`**（B0-73 微站页面内容）：owner-scoped（`ownerId` + 进 `TENANT_MODELS`）、`brandId?`/`campaignId?` 软引用、`slug`（经 `TrackedLink` 承接短链+归因，`targetKind='own_site'` 已在封闭类目 `schema.prisma:1226`）、`blocksJson`（按钮/链接列表）、`status`、`autoUpdateJson`（品牌记忆驱动换季规则）、软删除。短链归因**不重造**，接 TrackedLink。
- **其余四行零新表复用**：B0-62 QR 物料复用 `QrAsset.imageAssetId`（可选深度档新增 `PrintMaterial`）；B0-74 表单线索→`SourceTag` + 触发 CRM Contact upsert（不建 FormLead 表）；B0-75 GBP 薄试复用 `TrackedLink targetKind='gbp_review'` + 渠道缝 Seam 4（薄试不建本地评价库）；B0-76 增长实验=「两条 TrackedLink/两版 MicrositePage」+ 读 AttributionEvent 按 linkId 分组净值对比（**零新表**——L0 已焊死 incremental，无 holdout 引擎可建）。
- **留痕**：B0-76 增长实验**保持 listed**（D-021）；可选对象 `PrintMaterial`/`GbpProfileSnapshot`/`GrowthExperiment` **仅入册待体量过目 founder 裁**，不排产。任何新对象全链 ownerId + `TENANT_MODELS` + Organization back-relation（否则 prisma generate fail-loud，缝 5）。

## 五、冻结条件与状态

- **状态：冻结候选（freeze candidate）。** v0.1 骨架 → v0.2 吸收 B8 两试产 → v0.3 闭合 SOL §2·B2 六阻断项 + 吸收二三波 → **v0.4 闭合 codex 异族评审 BLOCK 清单（本稿）：ConsentEvent Prisma 形状 / AttributionEvent 完整抄录 / anonymousKey 澄清 / BusinessEvent·Receipt 互斥职责 / 口碑 kind 逐项归账 / VoucherToken 勘误** → **founder 明示 ack（D-018②/D-020⑤）** → spec-ready（02-B2 相关行随冻结 PR 迁级）。异族复审通过不替代 founder 过目（共享契约/schema=founder-only）。
- **开放问题（v0.2 三项处置）**：
  1. ~~事件 payload schema 约束强度~~ → **闭合**：kind 闭集 + 每 kind 软引用非空约束（契约 1，对齐真 schema `schema.prisma:1364-1369`），非自由 JSON；宪法 10 定型。
  2. anonymousKey 隐私保留期（PDPA 姿态）→ **留 B13 对表**（跨块，非本 spec 冻结阻断项；`geoBucket`/`ipHashPrefix` 已按 PDPA 粗粒度冻结）。
  3. 收费点事件是否并入 kind 闭集 → **闭合**：按契约〇=Credits 收支归 `CreditLedger`，**不并入** AttributionEvent kind 闭集；宪法 2 账本推论由 CreditLedger 承载。
- **冻结时随契约上报 founder 的 founder-only 单列项**：①`issuerId` 扩唯一索引（身份铁幕）；②AttributionEvent kind 闭集扩展（近期仅 `referral_converted`；P3 `campaign.attributed`——归属已按 §四点六·1 冻结）；③二三波新对象建表（口碑五表 / MicrositePage / `ConsentEvent`〔形状已冻结于契约 3〕/ 可选对象）。这些**不在本 spec 自行落地**，是冻结 ack 时的明示清单。
