# B2 数据契约 spec（事件 / 身份 / 同意）（v1.2——已冻结〔拆分稿：观测流门机制段=设计草案，见 §五冻结范围〕）

> 2026-07-12。epoch `claude-20260712-03`。Sol 原阻断的解：**先冻数据契约，B8 设计与后续块在其上施工**，避免末期发现新 schema。
> **2026-07-16 D-038 使用语义修订（Blueprint v2.12/#334）**：下文 `ConsentEvent` 仍只记录可验证的 permission 事实，schema/排序/撤回优先级不变；但 `contactable` 只表示「已有可验证 grant 且无 DND」，不再被解释成平台替商家定义联系人名单或自动删除未知状态受众。商家选择并确认发送对象；import 不伪造 opt-in；真正发送时已知 STOP/opt-out/DND/provider hard limit 必须 fail-closed。未知状态必须如实显示，不得冒充 consent，也不得仅因没有平台证据而静默缩小商家名单。本修订不设计新 schema。
> **当前状态勘误**：v1.2 的冻结范围已经四权放行，并经 #260 补落 `main`（`f9a7fd9e`）生效；下文残留的「冻结候选 / 未来迁 spec-ready」只保留为原审查轨迹，不是当前状态。
> **[R-010 schema authority](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/339) 硬停**：本冻结契约要求 identity issuer/version、`ConsentEvent` 四轴与 Campaign 结构化 `utmJson`；#314 已合 schema 实际为较窄 identity、Contact consent 字段与 `utmBase`。D-038 没有选择哪边胜出，现状也不能自行成为方向。独立 Founder-approved schema alignment 前，三处相关施工不得启动；本稿与本对齐 PR 都不改 schema。
> **历史审查状态：冻结候选（freeze candidate）——冻结走四权闭环（双顾问签核+异族复审+机器闸+非作者合并），依 #254 §一.2。** SOL 跨族复审 §2 的 B2 六条阻断项已逐条闭合，二三波需求单已吸收（§四点六）；v0.4 闭合 codex 异族评审（第二轮 BLOCK）清单：ConsentEvent 完整 Prisma 形状（契约 3）、AttributionEvent 完整字段抄录表（契约 1）、anonymousKey 应用层澄清（契约 2）、BusinessEvent/Receipt 互斥职责冻结（契约〇·附）、口碑各 kind 账本归属现在冻结（§四点六·1）、六表列举补 VoucherToken（§四点六·3）；v0.5 闭合 codex 第三轮两项：consent 派生顾客优先级修法、口碑观测流 `ReviewObservation` 追加式冻结；v0.6 闭合 codex 第四轮（四反例全真）两项：①consent 派生全序**换轴 `(receivedAt, id)` 到达序**（occurredAt 降级 advisory；`entryMode` interactive/backfill——迟到旧 grant 不复活；在途窗口不可归零诚实条款+`consent.late_revoke`+B7 发送记录带 `consentStateAt`；四验收案例）②观测流幂等键**嵌 `lifecycleEpoch` 生命周期纪元**（同 hash 删→现→删键碰撞全解；removed 行在对账中视同本地无，重现=epoch+1 补写）；**v0.7 闭合 codex 第五轮（权限位+并发层）四项**：①`entryMode` 改**服务端派生 computed 字段**（写入接口不接受此参数；派生表冻结；import 构造 interactive=结构不可能）②consent 折叠写入**per-三元组 advisory xact lock 序列化**（「到库即推进」改述为锁内维护的缓存列，读者随时重算得同值）③复活主权 **CAS**（epoch 推进条件更新，仅赢家插观测；输家规则冻结）④**键内纪元一致性不变量**（解析 `e<epoch>` 断言==行列，fail-loud 修复流程写明）+ 全文并发主权主动扫。**v0.8 闭合 codex R5 复审（机械层）五项**：①`sourceKind` 服务端绑定（端点→sourceKind 常量表，`entryMode`+`sourceKind` 两字段皆不可由调用方传；I-C1 扩为「interactive ⇔ 端点∈顾客亲为四端点」编译期常量断言，契约 3）②`receivedAt` **锁内 `clock_timestamp()` 赋值**（弃 `@default(now())`；一事务恰写一三元组、禁多锁消死锁面，契约 3）③`ReviewItem` 增 `lastObservationId`(ULID)，在线投影按 `(observedAt,id)` 字典序 tie-break（§四点六·1）④`ReviewItem` 增 `integrityStatus`（quarantined 冻写+界面诚实降级）+ `lifecycleEpoch` 缓存语义澄清（修列=缓存修复非篡史，受控例外+`integrity_repair` 审计，§四点六·1）⑤两缝收口（ContactIdentity merge 沿链解根→双锁→复核根未变，契约 2；LiveEventOutbox 空洞判废双条件，B9 契约 6）。**v0.9 闭合 codex R6 定向复审四项（R6 判②receivedAt 锁内赋值已 CLOSED）**：①sourceKind 常量表补闭集不变量+B8 请评前置改判读方+`evidenceRef` 定型诚实降准为**运行时格式断言**（I-C1 断言分两层：编译期=端点↔sourceKind↔entryMode 常量映射与接口签名类型级断言，运行时=evidenceRef 非空+逐端点格式断言，契约 3）③复活 CAS 补**字典序门**（WHERE 增 `(observedAt,id)` > `(lastObservedAt,lastObservationId)`，附与重建全序的一致性论证，§四点六·1）④quarantined **冻写谓词入机械层**（复活 CAS 与常规投影更新两条 WHERE 均增 `AND integrityStatus='ok'`；隔离期观测流照常 append、真源不冻，§四点六·1）⑤空洞判废改**登记式双条件**（首见登记 `firstSeenAt`+`xmaxAtFirstSeen` 快照——修 v0.6「读回滚 seq 行的 txid」不可执行缺陷，B9 契约 6）。**v1.0 闭合 codex R7 两项（③STILL-OPEN ④NEW-DEFECT；①judged CLOSED ②未破坏）——修复方向经当时 bounded cross-family 顾问轮裁定（SOL lane incomplete → fallback Fable complete，按协议标注；memo+provenance 仅留 Git 历史，当前证据取对应 GitHub task/PR）**：§四点六·1 观测流**整节重写为到达序折叠架构**（单一连贯块，取代 v0.6–v0.9 分层补丁）——到达序轴 `arrivalSeq`（per-review 计数器锁内自增）、入流闸新原则「**入流才需确定性；不入流只需留痕**」（陈旧/同态观测不入流，记 `stale_observation_dropped` 留痕——同杀 codex③ 分叉与键槽污染 (i)(ii)(iii) 整族）、CAS 赢家/输家全套**净删**由 per-review 锁取代、epoch 改述**折叠态计数**、quarantine 改「入流不折叠」+解除隔离**单事务原子**（修 v0.9 谓词方案的解除竞态）、投影列**唯二写入点 I-R2**+机器闸、**列所有权分区**（投影列 vs 回评运营列——重建不抹回评）、对账降为普通观测同路径+第四类漂移、验收表收编全部对手弹药（在线=重建双判恒等；v0.6 反例表仅表头「全序」→「到达序」，行判定不变）；并发主权总注加 **READ COMMITTED** 隔离级别假设行（覆盖含契约 3 的全部锁协议，不改契约 3 已 CLOSED 内文）、LiveEventOutbox 行改**引用不复述**。**v1.1 闭合 codex R8 四项（③④⑤NEW-DEFECT + ②契约 3 被 NTP 回拨反例连带）——修复方向经 SOL 顾问 round two（complete，置信 0.87；memo+provenance 仅留 Git 历史，当前证据取对应 GitHub task/PR）**：②契约 3 **reopened by R8 counterexample → 保义勘误=receivedAt 单调钳位六步协议**（精度冻结 `@db.Timestamptz(6)`/tick=1μs；两表均未建=无历史逆序；契约测试义务=在线锁序 vs 离线重放等价含 NTP 前后跳；同一 head 重新过四权闭环）+假设台账 receivedAt 行改述（=每分区逻辑接收时间与规范性重放序，非「仅展示」）③**删同态 no-op 谓词**（一切过门观测一律入流含重爬未变——R8 双反例同死；门比较键 `(observedAt,id)` 完整全序+equal-time policy=观测 id 锁内铸造与 arrivalSeq 同序、相等落到 id 恒入流；重试语义=memo 选项 (b) 新行+副作用仅派生态实变；门判定源改**观测流自身**——lastObservedAt/lastObservationId 降为展示缓存，quarantine 依赖冻结列问题根除）④**删 `lastArrivalSeq` 计数器列**（取号=锁内流 `MAX(arrivalSeq)+1`，**七条件**冻结：共锁/首条锁载体=advisory 锁本身/MAX 于锁后/READ COMMITTED 交叉引用/流永不物删重编号+归档保 sequence floor/唯一约束 `(ownerId,platform,externalReviewId,arrivalSeq)` 入 model/一切查询带 ownerId）+`integrityStatus` 移出投影列族成**完整性列三写者**（初始化器 ok/I-R1 幂等隔离/rebuild 尾端捕获后原子复位、失败保持 quarantined；fold 只读）⑤B9 v0.9 origin-primary 限定+安全域+fencing 三件套+60s age 纯活性声明（B9 契约 6，交叉引用）；新增 **§并发义务表**（12 最小场景×七字段；B9 场景 10-12 交叉引用）。**v1.2 拆分冻结（本稿）——R-009 founder 裁定 B（渠道内原话，2026-07-12）**：R9 全 CLOSED 的内容维持冻结候选**语义零变更**（契约〇/1/2/3〔含 R8 重开-勘误-重闭件〕/UTM 附/五表形状+账本归属+宪法 8 闸/Marketplace/第一米/义务表场景 7-12）；R9 两个未闭反例（①锁内普通 ULID 同毫秒不保证后到更大→equal-time policy 被打穿〔ids.ts 用普通 ulid()〕②时钟前跳毒化 observedAt 水位→真删除被永久丢弃）命中的**观测流门机制整段降级为设计草案（非冻结）**，随 B8 口碑块 spec 再冻——本稿只做降级标注与引用注记、机制零修改（修复归 B8）；冻结文本对草案段仅资讯性引用。本文本属共享契约/schema=founder-only 类别（高后果，#254 §三 双顾问之一 complete 签核入 provenance）；冻结走四权闭环放行（#254 §一.2）后 02-B2 相关行随冻结 PR 迁 `spec-ready`，founder 终验一次过审计索引（#254 §一.3/§二.5）。
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
- **merge/upsert 并发主权（v0.7 主动扫补条；①v0.8 升级——codex R5 复审⑤ 采纳）**：①合并/拆分操作**先沿 redirect/tombstone 链把涉事两 contactId 各自解析到根档**，再对 **{根A, 根B} 按 ULID 升序取双 advisory xact lock**，**锁内复核两根未变**（未被其它并发合并重指）+ 重指目标非 tombstone 后才执行——**解根后按全序双锁**使三方并发链（A→B、B→C、C→A 同时发起）在根解析下亦**无法成环**（v0.7 只锁「涉事两 contactId 排序对」，两方反向合并可防、三方链仍可成环）；②**Contact upsert（共享 action）并发仲裁=ContactIdentity 唯一索引** `(ownerId, channel, issuerId, externalId)`：并发同人首建时 insert 冲突者转 update（读-改-写重试），**结构上不会双建档**。
- **匿名→实名升级**（v0.4 澄清——codex P1② 采纳）：**真 schema 无 `anonymousKey` 列**；匿名主体的实际字段组合 = `SourceTag.subjectKind='anon'` + `SourceTag.subjectRef=<匿名会话键>`（`schema.prisma:1335-1336`）。「anonymousKey」仅是**应用层变量名**，指代 subjectKind='anon' 时的 subjectRef 值，不新增列。升级规则：首次留联系方式时回填关联（B7 欢迎流消费）——同一 `subjectRef` 列改 scope 到 contactId（`subjectKind='contact'`），CRM 落地零迁移（同 L0 spec A4 手法，`schema.prisma:1326-1328` 注释原文）。

### 契约 3 · 同意（四轴独立存证——SOL §2·B2④ 采纳）

> SOL 坐实 v0.2 consent 自相矛盾（一处把 opted_in/opted_out/suppressed 当同一状态，一处又落成 Contact 上的 marketingConsent+doNotDisturb）。**法律同意、顾客退订、商家勿扰、频控抑制是四个不同轴**，冻结前必须拆分独立存证 + 确定性派生资格。
> **【v1.1 重开手续】本契约 reopened by codex R8 counterexample（2026-07-12——NTP 回拨可使在线锁序与离线 `(receivedAt,id)` 重放序分叉，破「revoke 到库即刻生效」）→ 保义勘误=receivedAt 单调钳位六步协议（见「折叠写入序列化」）→ 契约测试义务（在线锁序 vs 离线重放等价，含 NTP 前跳/回拨）→ 于同一 head 重新过四权闭环（#254 §一.2）。不留旧 CLOSED 措辞：此前各轮对本契约 NTP 面的「已闭合」判定不再有效，以本勘误后文本为准。**

**四轴独立存证**（每轴各自 append-only，永不互相覆写）：

| 轴 | 语义 | 载体形态 | 谁写 |
|---|---|---|---|
| A · 法律同意 | 按 `channel` × `purpose` 的**追加式证据记录**（何入口、何凭证、何时同意/撤回） | `ConsentEvent`（完整 Prisma 形状见下——v0.4 冻结，v0.6 换派生轴） | B5 收件箱 / B7 退订流 / CRM 导入 |
| B · 顾客退订 | 顾客主动 opt-out（STOP / 退订链接） | 同 A 的 `action='revoke'`（顾客发起，`actorKind='customer'`） | B5 / B7 退订流 |
| C · 商家勿扰（DND） | 商家侧对某顾客设「勿扰」 | Contact 上的 `doNotDisturb` 布尔（商家写+展示，CRM） | CRM |
| D · 频控抑制 | 运行时短期次数上限（避免骚扰） | B7 运行时频控计数器（非字段，非持久同意） | B7 自动化系统层 |

**`ConsentEvent` 完整 Prisma 形状（v0.4 冻结形状，v0.6 换派生轴——codex P0/R4① 采纳；建表本身仍属 founder-only 单列，§五）**：

```prisma
// 同意证据流水（契约 3 轴 A/B）：append-only——无 updatedAt、无 deletedAt、永不 UPDATE/DELETE
// （同 AttributionEvent 纪律）。「同意有出处」：每行必带 evidenceRef。
// v0.6（codex R4①）：派生全序轴 = receivedAt（服务端赋时，入库即定，永不回排）+ ULID id tie-break；
// occurredAt 降级 advisory（展示/审计用，不参与派生）——乱序在途与外部时钟偏移从此与派生无关。
model ConsentEvent {
  id             String   @id // ULID（tie-break 轴：receivedAt 同刻按 id 字典序，全序无歧义）
  ownerId        String   // 租户键，无默认（宪法 6；进 TENANT_MODELS + Organization back-relation）
  organization   Organization @relation(fields: [ownerId], references: [id])
  contactId      String   // fk → Contact（Customer Engagement CRM 底座，B0-59）
  channel        String   // 'whatsapp' | 'sms' | 'email'（code-validated String，非 PG enum；house style）
  purpose        String   // 'marketing' | 'transactional' | 'review_request'（封闭集，code-validated）
  action         String   // 'grant' | 'revoke'（封闭集）
  actorKind      String   // 'customer' | 'merchant' | 'system'（顾客优先规则的判定轴）
  entryMode      String   // 'interactive' | 'backfill'——【v0.7 computed 字段】服务端派生，写入接口**不接受**
                          // 此参数（不可由调用方断言）；派生表见下。grant 仅 interactive 可覆盖在场 revoke（派生规则③）
  sourceKind     String   // 'inbox_optin' | 'unsubscribe_link' | 'stop_keyword' | 'double_optin' | 'crm_manual' | 'import'
                          //（封闭集：哪个入口；v0.7 增 'double_optin'——双重确认回执）。【v0.8 服务端绑定】每个写入
                          // 端点硬编码本端点的 sourceKind，写入接口**不接受**此参数（同 entryMode——调用方两字段皆不可传）；
                          // 端点→sourceKind 常量表见下
  evidenceRef    String   // 出处凭证引用：消息 id / 退订 token / 导入批次号——同意有出处，不可为空。
                          // 【v0.9】普通 String 列，格式按端点定型=写入时运行时格式断言（非编译期），见 I-C1(b)
  idempotencyKey String   // 稳定幂等键：'stop:<messageId>' | 'link:<unsubTokenId>' | 'import:<batchId>:<rowN>' | 'manual:<uuid>'
  occurredAt     DateTime // 【advisory】外部声称的业务时间——仅展示/审计，不参与派生（外部时钟不可信）
  receivedAt     DateTime @db.Timestamptz(6) // 服务端赋时=派生全序唯一轴（每三元组逻辑接收时间+规范性重放序）。
                          // 【v0.8】锁内赋值（弃 @default(now())：now()=事务开始时刻、早于取锁）；【v1.1 单调钳位】
                          // 精度冻结 μs（tick=1μs），锁内 GREATEST(精度化 clock_timestamp(), 前值+1μs)——
                          // 六步协议见「折叠写入序列化」；入库即定、永不回排、每三元组严格单调
  createdAt      DateTime @default(now())

  @@unique([ownerId, idempotencyKey])                          // 精确一次（镜像 AttributionEvent :1390 手法）
  @@index([ownerId, contactId, channel, purpose, receivedAt]) // 租户前导；派生函数按到达序回放即此索引
}
```

- 纪律：append-only（无软删——同意证据永不删除）；`@@unique([ownerId, idempotencyKey])` 保证 STOP 双投递/导入重跑精确一次；租户前导索引服务派生函数的**到达序回放**。派生只依赖已到库事件的 `(receivedAt, id)` 到达序——单调、无回排，任意时点重算结果相同（宪法 10）。

- **端点→`sourceKind` 服务端绑定常量表（v0.8 冻结——codex R5 复审① 采纳）**。R5 复审发现：v0.7 只封了 `entryMode`（computed），但**权限位下移到仍可被调用方断言的 `sourceKind`**——调用方传 `sourceKind='inbox_optin'` 即可反推出 `interactive`。修法：**每个写入端点硬编码自己的 `sourceKind` 常量**，写入接口**不接受** `sourceKind`（与 `entryMode` 同——**调用方两字段皆不可传**）；`evidenceRef` 的形态**按 `sourceKind` 定型**（下表末列）：

  | 写入端点 | 硬编码 `sourceKind` | `evidenceRef` 定型 | 顾客亲为？ |
  |---|---|---|---|
  | B5 收件箱 inbound-reply handler | `inbox_optin` | 入信消息 id（非空） | 是 |
  | B7 退订/再订阅链接端点 | `unsubscribe_link` | 退订 token id（非空） | 是 |
  | B5/B7 STOP/START 关键词解析器 | `stop_keyword` | 触发消息 id（非空） | 是 |
  | DOI 双重确认端点 | `double_optin` | 确认回执 id（非空） | 是 |
  | CRM 手工录入 action | `crm_manual` | 录入者 + 依据（非空） | 否 |
  | 导入 / 批量 API / webhook 补录端点 | `import` | 导入批次号:行号（非空） | 否 |

  - **顾客亲为四端点** = 上表 `inbox_optin` / `unsubscribe_link` / `stop_keyword` / `double_optin` 对应的四个端点；**唯有**这四端点产 `entryMode='interactive'`，`crm_manual`/`import` 端点恒产 `backfill`。
  - **闭集不变量（v0.9 冻结——codex R6① 采纳）**：本表=**ConsentEvent 写入端点全集（闭集）**；新增写入端点=修改本表=契约演进（founder-only 单列同纪律）。（R6 当时核实：`B8 请评前置`是**读方**非写方且不写 ConsentEvent；其旧「消费 `contactable` 做完整发送资格判定」解释已由 D-038 取代。当前 `contactable` 只是一项 verified-permission fact；B7 另分 unknown 与 known hard-negative 决定最终执行策略。本注不改 schema 或折叠算法。）
  - **`evidenceRef` 定型的落地机制（v0.9 诚实降准——codex R6① 采纳）**：`evidenceRef` 是普通 `String` 列，**不宣称编译期定型**；定型=**每端点写入时的运行时格式断言**——按上表末列逐端点冻结格式（消息 id / 退订 token id / 确认回执 id / 录入者+依据 / 批次号:行号——**格式表即验收基准**）+ 非空断言，违格式=整笔拒写。

- **`entryMode` 服务端派生表（v0.7 冻结——codex R5① 采纳；computed 字段，不可由调用方断言。v0.8：其输入 `sourceKind` 亦由端点常量表服务端绑定，同样非调用方所能断言）**：

  | sourceKind | 派生 entryMode | 依据 |
  |---|---|---|
  | `inbox_optin`（顾客直接回话 inbound reply） | `interactive`（且 `evidenceRef` 非空，否则整笔拒写） | 顾客本人当下动作 |
  | `unsubscribe_link`（顾客本人点退订/再订阅链接） | `interactive`（同上） | 顾客本人 UI 动作 |
  | `stop_keyword`（顾客直接回话 STOP/START） | `interactive`（同上） | 顾客本人当下动作 |
  | `double_optin`（double-opt-in 确认回执） | `interactive`（同上） | 双重确认=本人明示 |
  | `crm_manual`（商家代录） | **`backfill`（强制）** | 非顾客本人动作 |
  | `import`（批量导入 / webhook 补录 / API 批量） | **`backfill`（强制）** | 补录性质 |

  - **写入接口签名既不含 `entryMode` 亦不含 `sourceKind`（v0.8）**：两字段均由**端点内部常量**确定——`sourceKind`=端点硬编码常量（上表），`entryMode`=由 `sourceKind` 按本表计算。**经 import 路径构造 interactive grant = 结构上不可能**（`sourceKind='import'` 由 import 端点硬编码 ⇒ backfill，恒真；调用方无从改写 sourceKind 反推 interactive）。
  - **不变量 I-C1（v0.8 扩权限位；v0.9 划定断言层级——codex R6① 采纳：`evidenceRef` 撑不起编译期断言的说法，明确分层）**：`entryMode='interactive' ⇔ 写入端点 ∈ 顾客亲为四端点 ∧ evidenceRef ≠ ''`。断言分两层，范围**明确限定**：
    - **(a) 编译期常量断言**（范围仅此）：端点↔sourceKind↔entryMode **三段常量映射**（sourceKind 为每端点编译期常量，此段编译期即可判定）+ 「接口签名无 `entryMode`、无 `sourceKind` 参数」的**类型级断言**。
    - **(b) 运行时断言**：`evidenceRef ≠ ''` + **逐端点格式断言**（见上「evidenceRef 定型的落地机制」——`evidenceRef` 部分明示为运行时断言，**不再宣称编译期定型**）。
    - 两层合并 + 专项测试双覆盖。
  - **revoke 不设 interactive 门（R4 认可保留）**：revoke 不分 entryMode 到库一律生效（折叠规则①）——宁多抑制，fail-closed 一致。

- **折叠写入序列化（v0.7 冻结——codex R5② 采纳）**：一切 ConsentEvent 写入者在**同一事务**内先取 **per-三元组 Postgres advisory xact lock**（锁键=稳定哈希 `(ownerId, contactId, channel, purpose)`，`pg_advisory_xact_lock`，事务结束自动释放），锁内 `INSERT` + 重算折叠态。**语义澄清**：折叠 fold=对**已提交事件集合**的纯函数；v0.6「到库即推进」改述为——**状态列=锁内维护的缓存**（载体=派生缓存列/读模型，位置归 B5/B8 块 spec；缓存≠真源），读者可随时对已提交集合全量重算，**必得同值**。
  - **receivedAt 锁内赋值（v0.8——codex R5 复审② 采纳）**：v0.7 用 `@default(now())` 赋 receivedAt，但 PG `now()`=事务开始时刻、在**取锁之前**固定，赋值序 ≠ 锁序，「回摆」竞态未真正消灭。v0.8 改为**取得 advisory lock 后由 `clock_timestamp()` 赋值**（锁内实时时钟，赋值序严格随锁序单调）——低 receivedAt 行晚提交的竞态由此从根消灭：同三元组的 insert+赋时+重算全序化。
  - **批量规则「一事务恰写一个三元组」（v0.8——codex R5 复审② 采纳）**：一次事务只取**一把** advisory lock、只写一个 `(ownerId, contactId, channel, purpose)` 三元组；import/批量补录**逐三元组一事务循环**（每笔独立取锁-赋时-写-提交），**禁在单事务内取多把 advisory lock**（多锁乱序取会互等成环——消死锁面）。
  - **单调钳位六步协议（v1.1 保义勘误——codex R8② NTP 回拨反例 + SOL round-two memo 采纳；一切写入/导入/回填路径必走）**：R8 反例：grant 锁内取 `10:00` 提交后时钟回拨，后到 revoke 取 `09:59`——在线锁序终态=revoke，离线 `(receivedAt,id)` 重放终态=grant，分叉。勘误六步：①取得**与重放分区完全相同范围**的锁（per-三元组 advisory xact lock）②锁内读取该三元组**已持久化的最大 `receivedAt`**（前值）③把 `clock_timestamp()` **转成列实际存储精度**（冻结 `@db.Timestamptz(6)`，tick=1μs——精度不冻则钳位后写入仍可相等、`id` 重新决定错误顺序）④`receivedAt := GREATEST(精度化当前时间, 前值 + 1 tick)`⑤**写入后验证严格大于前值**（违者 fail-loud）⑥insert+在线折叠**同一事务**。receivedAt 每三元组严格单调 ⇒ **按构造 `(receivedAt,id)` 重放序≡锁序**，NTP 前跳/回拨从此只影响时间戳观感、不影响序。**历史数据**：ConsentEvent 与 ReviewObservation 两表均未建（founder-only 单列待批）=**无历史逆序问题**。**契约测试义务（冻结）**：在线锁序 vs 离线 `(receivedAt,id)` 重放等价，含 NTP 前跳/回拨/存储精度碰撞三组（§并发义务表场景 7/8/9）。

- **`contactable` 由确定性派生函数算出**（宪法 10，不靠模型天赋）。**v0.6 修法（codex R4① 采纳——R3 版四反例全真：乱序在途、外部时钟偏移、及其对「最新 occurredAt」全序的破坏）**：派生全序**换轴到 `(receivedAt, id)` 到达序**，`occurredAt` 降级 advisory。冻结派生（到达序折叠；**v0.7 改述**：折叠=对已提交集合的纯函数，缓存列仅在上述 advisory lock 内维护，读者随时全量重算得同值）：

  ```
  consentState(contactId, channel, purpose)：            // 轴 A+B 合一求值；全序 = (receivedAt, id ULID) 到达序
    按到达序遍历该三元组的全部 ConsentEvent，维护 (state, stateOwner)：
      事件 actorKind='customer'：
        action='revoke'                     → state=revoke, stateOwner=customer   // ① 顾客 revoke 到库即刻生效
        action='grant' 且 entryMode='interactive'
                                            → state=grant,  stateOwner=customer   // ② 真实 re-opt-in：本人当下
                                                                                  //    动作可覆盖更早到达的 revoke
        action='grant' 且 entryMode='backfill'：
          若 state≠(revoke by customer)     → state=grant,  stateOwner=customer   // ③ 补录 grant 只能「建立」状态
          否则 忽略 + 记审计 consent.backfill_ignored                              //    永不「复活」已 revoke（迟到的
                                                                                  //    旧 grant 到达序反而更晚——正面击破）
      事件 actorKind∈{merchant,system}：
        仅当 stateOwner≠customer 时 → state=该事件 action, stateOwner=merchant/system
                                                                                  // ④ 顾客一旦表过态，非顾客事件
                                                                                  //    永不改写（零表态时才有效力）
    无任何事件 → state=unknown（无平台可验证 grant；不得伪装成 opt-in，也不得自动从商家名单删除）

  contactable(contactId, channel, purpose) = (state == 'grant') AND NOT 轴C·DND
  ```

  - **D-038 读法（取代「contactable=唯一可发送资格」的旧执行含义）**：`contactable=true` 是一条已验证 permission 事实；`false` 可能是已知 revoke/DND，也可能只是 unknown。受众预览必须分开显示这两类：已知 STOP/opt-out/DND/provider hard limit 在发送层硬拦；unknown 保留在商家选择的受众中并如实标示，由商家作发送决定，平台不得替其编造 grant 或无声删名单。频控继续由轴 D 叠加。本段只修读法，不改变 ConsentEvent 真源、折叠算法或撤回优先级。

  - **在途窗口不可归零（诚实条款，冻结）**：分布式撤回**在途期间**（顾客已按退订、事件尚未到库）发出的消息无法绝对防止——这是物理事实，不假装能防。冻结补救语义三件套：(1) revoke **到库即刻生效**抑制（无需等对账/重算——折叠即推进）；(2) revoke 到库时若该三元组存在「发送评估 cursor 早于本 revoke」的已发送记录 → 记 `consent.late_revoke` ActionEvent `{consentEventId, lastSendCursor}` 供报表/申诉追溯；(3) **B7 每条发送记录冻结携带 `consentStateAt`**（=评估资格时消费到的 `(receivedAt, id)` cursor 快照）——事后可精确回答「发这条时系统知道什么」。
  - 轴 B（顾客退订）由折叠的顾客优先级承载（到达序最新的顾客事件决定状态；merchant/system 仅顾客零表态时有效力）。轴 C（DND）仍是 Contact 字段独立与；轴 D（频控）仍是 **B7 运行时叠加**的发送资格闸（`status='suppressed'`），不改派生的 `contactable`。
  - **验收案例（v0.6 改写到 receivedAt 轴 + 新增两例，冻结进契约测试）**：

    | 案例 | 事件序列（同一 contact×channel×purpose，按**到达序**） | 判定 |
    |---|---|---|
    | 1 · re-opt-in 恢复资格 | `customer revoke` 到库 @r1 → `customer grant (interactive)` 到库 @r2 | 折叠②：state=grant → `contactable=true`（无 DND 时）——旧 revoke 不锁死 |
    | 2 · 商家不可代授 | `customer revoke` @r1 → `merchant grant` @r2 | 折叠④：stateOwner=customer，merchant 事件被忽略 → state=revoke → `contactable=false` |
    | 3 · 迟到旧 grant 不复活（v0.6 新增） | `customer revoke (interactive)` @r1 → webhook 补录历史 `customer grant (backfill)` @r2——**其 receivedAt 反而更晚** | 折叠③：state=(revoke by customer) → backfill grant 忽略 + `consent.backfill_ignored` 审计 → state=revoke——迟到的旧同意永不推翻更晚到达的撤回 |
    | 4 · 迟到 revoke 即刻压制（v0.6 新增） | `customer grant` @r1 → 发送若干（各带 `consentStateAt=r1`）→ `customer revoke` 到库 @r2（在途期间有发送） | 折叠①：r2 起 state=revoke 即刻抑制后续；记 `consent.late_revoke`{consentEventId, lastSendCursor=r1}；在途已发送不可追回但可精确追溯（诚实条款） |
    | 5 · import 构造 interactive=结构不可能（v0.7 新增） | `customer revoke (interactive)` @r1 → 攻击面：经 import/批量 API 提交「interactive grant」@r2 | 写入接口**无 entryMode 参数**；`sourceKind='import'` ⇒ 派生表强制 `backfill` → 折叠③忽略 + `consent.backfill_ignored` → state=revoke——权限位不可由调用方伪造（I-C1 专项测试覆盖） |
- **读写边界（v0.9，D-038 修订读法）**：写=B5 收件箱/B7 退订流/CRM（=端点常量表全集，闭集）；读方把 consent 状态作为**已知事实**而不是名单所有权。B7 运行时必须消费已知 STOP/opt-out/DND/provider hard limit 并硬拦；B8 请评前置同样不得越过这些已知负面事实。`contactable=true` 可直接证明已有 grant，`contactable=false` 必须再区分 revoke/DND 与 unknown；unknown 不写成 grant，也不自动从商家所选受众消失。`ReviewRequest status='suppressed'` 是已知硬拦的产物，不写 ConsentEvent；分群不在 Contact 上冻结成单一 status 字段。

### 契约附 · UTM 结构化（D-021 已批，SOL §2·B2⑥ 采纳）

- **对齐既有 `TrackedLink.utmJson` 结构**（`schema.prisma:1227`）：`{ source, medium, campaign, content, term }`（五键，Json，重定向时附加到 targetUrl）。
- Campaign 的 **`utmBase` 单字符串方案废除**——单字符串会与 `TrackedLink.utmJson` 形成双真源。Campaign 层的 UTM 归组用**结构化 `utmJson` 同形状**（campaign 侧写 `campaign` 键 + 可选 `content`/`term`），经 TrackedLink 承接，不另存捷径字符串。
- `AttributionEvent.utmSnapshot`（`schema.prisma:1378`）抄表那一刻的 UTM，形状同上，单一真源来自 TrackedLink。

### 归因链（L0 一条码全链，MASTERPLAN L0 行验收原样）
`TrackedLink/QR 生成 → 印出 → 扫码（redirect，E5-07 待建）→ AttributionEvent 落账 → contact 关联（带来源标签）→ 单据出现在归因流`。短链域须在对应 current GitHub task 向 Founder 获取并 live-verify；未查询即 `Unknown`，不读取静态 dossier。

### 并发主权总注（v0.7 主动扫——codex R5⑤：多写入者面逐个定序列化/主权，一次清完）

| 多写入者面 | 序列化 / 主权机制 | 出处 |
|---|---|---|
| ConsentEvent 折叠缓存 | per-三元组 **advisory xact lock**（锁内 insert+重算；缓存≠真源可重算） | 契约 3（R5②） |
| ReviewItem 投影列（全部状态）**〔草案——随 B8 冻结，R-009 裁定 B〕** | **per-review advisory xact lock 内单一 `fold`**（入流+折叠同事务同锁；到达序轴 `arrivalSeq`=锁内流 MAX+1〔v1.1 七条件〕；重建/解除隔离同锁单事务；唯二写入点 I-R2+机器闸——CAS/条件式谓词方案已全套净删） | §四点六·1 草案段（v1.1，R7③④/R8③④） |
| ReviewItem 完整性列（`integrityStatus`）**〔草案——随 B8 冻结〕** | **唯三写者共锁**：初始化器 / I-R1（幂等隔离）/ `rebuild`（尾端捕获后原子复位，失败保持 quarantined）；`fold` 只读 | §四点六·1 草案段（v1.1 分族） |
| ReviewItem 运营列（`replyStatus`/`replyBody`）**〔草案——随 B8 冻结〕** | B8 回评流，写时同持该 review 锁；**不受 quarantine 冻结**（列所有权分区） | §四点六·1 草案段（v1.0） |
| AttributionEvent | **append-only + `@@unique([ownerId, idempotencyKey])`**（`schema.prisma:1390`）——无派生缓存承诺；消费者聚合=纯重算（Σ outcomeDelta），无需锁 | 契约 1（既有） |
| CreditLedger | 同手法（`@@unique([orgId, idempotencyKey])` `schema.prisma:717`，双 delta 可重建不变量）——既有账道，援引不改 | 契约〇（既有） |
| BusinessEvent / Receipt | append-only + 幂等键两式（无派生缓存承诺，同 AttributionEvent 手法） | 契约〇·附（R2③） |
| ConsentEvent 本体 | append-only + `@@unique([ownerId, idempotencyKey])`（STOP 双投递/导入重跑去重） | 契约 3（R2·P0） |
| ContactIdentity merge/unmerge | **沿链解根 → {根A,根B} 按 ULID 升序双 advisory xact lock → 锁内复核根未变**（解根+全序双锁使三方并发链亦无法成环） | 契约 2（v0.8） |
| Contact upsert（共享 action） | 仲裁=**ContactIdentity 唯一索引**，insert 冲突转 update 重试——结构上不双建档 | 契约 2（v0.7） |
| LiveEventOutbox seq 分配 | **BIGSERIAL=DB 原生序列化**（确认无需额外锁）；seq 消费端语义与空洞判废协议**冻结于 B9 契约 6，本行引用不复述**（登记式双条件+单写函数 XID 先取协议+CACHE 1+**origin-primary 限定与 fencing〔v0.9〕**——v1.0 改引用：杜绝两处复制漂移） | B9 契约 6（v0.9） |

> **隔离级别假设（v1.0 冻结——覆盖本表全部锁协议，含契约 3 折叠锁）**：一律假设 PostgreSQL 默认 **READ COMMITTED**。REPEATABLE READ 下事务快照在**取锁语句开始时**已定格，锁等待结束后读到的仍是取锁前世界——「锁内读行态/读已提交集合」协议整套静默失效。此假设为总注级冻结，约束表内每一行锁协议。
> 扫描范围=本文件+B9 全部承诺面；上表之外本两份 spec 无其它「多写入者共享可变状态」承诺（RunState/上下文桥会话态=per-thread 单写者；TrendSnapshot/MicrositePage 等新对象为单写入点或普通行级更新，无派生缓存承诺）。

### 并发义务表（v1.1 新增——R8 SOL round-two memo 工件形态裁定：语义契约＋最小机械协议＋冻结测试义务三层；本表=测试义务层，实装时逐行机器验证。场景 10–12 属 B9 契约 6，本表为唯一冻结处、B9 交叉引用。**v1.2 拆分〔R-009 裁定 B〕：场景 1–6=口碑流草案义务（随 B8 冻结）；场景 7–9〔契约 3〕与 10–12〔B9〕维持冻结**）

| # · 场景 | 不变量 | 分区/锁 · linearization point | 隔离 · 写者集 | durable 序键 | 初态 → 交错 → 预期终态 | 在线=重放等价断言 | failover/recovery scope |
|---|---|---|---|---|---|---|---|
| 1 · 同 hash 推进水位**〔草案义务——随 B8 冻结〕** | 门水位由 durable 入流行推进；陈旧观测恒被拦 | per-review advisory lock；LP=锁内 insert+fold 提交 | READ COMMITTED；写者=`fold` | `arrivalSeq` | present h1@t1 → 重爬 P(h1,t7) **入流**（水位→t7，无副作用）→ 迟到 A(t4) 门拦 | 在线终态 present h1 = 按 arrivalSeq 重放终态 | 单主（origin primary） |
| 2 · removed 后同 hash 复活**〔草案义务——随 B8 冻结〕** | 真复活不被吞（v1.1 无 no-op 谓词） | 同上 | 同上 | `arrivalSeq` | removed（最后在场 h1）→ P(h1,t8) 过门入流 → fold epoch+1、present | 同上 | 单主 |
| 3 · equal timestamp**〔草案义务——随 B8 冻结；R9 未闭反例①命中〕** | observedAt 相等 ⇒ 门落到 id、恒入流；终态=到达序 | 同上；观测 id 锁内铸造（与 arrivalSeq 同序） | 同上 | `arrivalSeq`（id 同序） | P(hA,t) 入流 → P(hB,t) 同刻到达 → id 更大过门入流 → 终态 hB | 同上 | 单主 |
| 4 · transport retry**〔草案义务——随 B8 冻结〕** | 重试成新行；副作用仅派生态实变时产生 | 同上 | 同上 | `arrivalSeq` | P(h1,t) 入流 → 同笔重投 → 新行入流、fold 无实变 ⇒ 无投影写/无 live-event | 重放含两行、终态同 | 单主 |
| 5 · quarantine 并发入流+rebuild**〔草案义务——随 B8 冻结〕** | 隔离期入流不折叠；rebuild 尾端捕获后原子复位；失败保持 quarantined | 同一把锁互斥；LP=rebuild 事务提交 | RC；写者=`fold`（只入流）/`rebuild`/I-R1 | `arrivalSeq` | quarantined+backlog → rebuild 重放至锁内尾端 → 复位 ok；并发观测锁上排队后正常折叠 | 解除后投影=全量重放 | 单主 |
| 6 · 并发 MAX+1**〔草案义务——随 B8 冻结〕** | `arrivalSeq` 无碰撞 | 锁互斥；**MAX 于取锁后执行** | RC（语句级新快照见已提交行）；唯一约束 (f) 数据库级防御 | `arrivalSeq` | 双 writer 并发同 review → 后到者锁等待 → 重读 MAX=前者+1 | 取号序=锁序 | 单主 |
| 7 · NTP 前跳下 grant/revoke（契约 3） | receivedAt 每三元组严格单调；重放序≡锁序 | per-三元组 advisory lock；LP=锁内 insert | RC；写者=六端点共享写入 action | `(receivedAt, id)` | grant@T → 时钟前跳 → revoke 取 GREATEST(前跳后当前, T+1μs) | 在线折叠终态=离线重放终态=revoke | 单主 |
| 8 · NTP 回拨下 grant→revoke（R8 反例正解） | 同上 | 同上 | 同上 | `(receivedAt, id)` | grant 锁内取 10:00 提交 → 回拨 → revoke 取 GREATEST(09:59 精度化, 10:00+1μs)=10:00.000001 | 重放终态=revoke=锁序——R8 反例消除 | 单主 |
| 9 · 存储精度碰撞（契约 3） | 写后值严格大于前值（tick=1μs=列精度） | 同上；六步协议③④⑤步 | 同上 | `(receivedAt, id)` | 两笔同 μs 到达 → 第二笔钳位 +1 tick → 无相等 | 同上 | 单主 |
| 10 · subscriber 禁投递（B9 冻结五） | 判废/投递只于 origin primary 求值 | dispatcher 三件套 fail-closed（租约+部署位授权+`pg_is_in_recovery()` 自检） | ——；写者=唯一 dispatcher | `seq` | 逻辑 subscriber 上起 dispatcher → 三件套任一不满足 ⇒ 拒绝启动、不判废不投递 | 无 subscriber 侧误判废 | B9 冻结五安全域 |
| 11 · promotion fencing（B9 冻结五） | 域外恢复形态 dispatcher fenced 直至门槛四步 | 门槛：停写停投递→追平对账→open/prepared→sequence 提升至全部 durable 水位之上 | —— | `seq` | logical promotion / PITR / 丢 WAL promotion → fenced → 门槛完成 → 恢复 | 恢复后无 acknowledged 丢失/重复越界 | B9 冻结五（域外=unsupported and dispatcher remains fenced） |
| 12 · outbox 长事务+时钟跳变（B9 冻结六） | 60s age=纯活性；安全性由 XID/同快照承载 | 登记式判废；同快照双判 | ——；写者=单一 SQL 写函数 | `seq` | 低 seq 长事务未提交、期间时钟前跳>60s → 条件(2) 不满足 ⇒ **不判废** → 提交后正常投递 | cursor 不越活洞 | 单主（B9 冻结六） |

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
| 保守判同不伤 CRM 底座体验 | respond.io Contact/Identity 形态 | CRM 试产设计需求单回填对表 |
| append-only 观测/同意流与 PDPA/GDPR 擦除权相容（已知未爆点，v1.0 依 R7 顾问轮纪律不开新战线、只入台账） | 擦除载体可为匿名化/去标识而非物删（待裁定） | B13 隐私对表时正面裁定 |
| `receivedAt`=服务端分配的**每分区（三元组）逻辑接收时间与规范性重放序**，**非「仅展示」**（v1.1 改述——v1.0 本行「派生正确性由锁内折叠承载、时间戳仅作高水位/展示」表述已被 codex R8 NTP 回拨反例推翻：契约 3 冻结的派生全序就是 `(receivedAt,id)` 重放而非锁序。修复已升格为契约 3 单调钳位六步协议正文，非台账假设）；UI 需真实墙钟时间用 `occurredAt`（已有，advisory） | 契约 3 v1.1 保义勘误（R8 反例+SOL round-two memo） | 契约测试义务：在线锁序 vs 离线 `(receivedAt,id)` 重放等价，含 NTP 前跳/回拨/精度碰撞（§并发义务表场景 7/8/9） |
| 全量入流（重爬未变也入流，v1.1 删同态 no-op）的存储容量可承受——「24h 爬频下可忽略」仅为容量猜想，**不作契约事实**〔草案机制假设——随 B8 冻结，R-009 裁定 B〕 | 待证：评价数 × 爬频 × 单行尺寸 × 保留期 | worker 容量测算落数；若需收缩走归档（必须保 sequence floor，§四点六·1 草案段七条件 (e)） |

## 四点五、B8 试产需求单吸收（v0.2 增补，2026-07-12——出处：PR #244 CRM / PR #245 Campaign 设计 §6）

**采纳入契约（当时 approved outcome；执行前复核 GitHub supersedes）：**
1. **三表 additive（CRM）**：Contact（+source/firstTouchCampaignId/doNotDisturb〔轴 C〕）、ContactIdentity（唯一索引与契约 2 一致，含 `issuerId`）、Segment（phrase 原文+rulesJson 确定性编译——宪法 10）。沿用 harmony-01 #7/#13，不发明。**注**：v0.2 曾把 `marketingConsent` 落成 Contact 字段，v0.3 按契约 3 改为四轴独立存证（法律同意/退订走 `ConsentEvent`，DND 留 Contact 布尔）。
2. **写入点归属（CRM，采纳）**：Contact upsert + AttributionEvent 写在 B5 入信 / B2 归因 / B7 欢迎流的**共享 action**；CRM 页面只读消费，自写仅手工/导入/合并/consent 四类——契约 1「谁写事件」由此定稿。
3. **判同细则（CRM，采纳并入契约 2）**：仅强标识精确相等（规范化 E.164/小写 email/fbPsid）才建议合并；同名不自动合并；合并=重指+审计留痕+可拆，永不物删。**规范化标准（waPhone 国码/email 大小写/`normalizationVersion`）= B2/B5 联定一份**，列为本 spec 交付物之一。
4. **consent 边界（CRM，采纳并入契约 3 四轴；D-038 修订读法）**：DND=Contact 字段（轴 C，CRM 写+展示）；法律同意/退订=`ConsentEvent`（轴 A/B）；抑制名单=B7 运行时硬约束（轴 D，非字段）；最终外发裁决在 B7。分群把契约 3 的 `contactable` 当 verified-permission fact，并另显 unknown 与 known hard-negative；它不是商家名单所有权或唯一发送资格。
5. **Campaign 容器（Campaign，采纳）**：最薄表字段；**UTM 归组用结构化 `utmJson`（对齐 TrackedLink，见「契约附」），O-1 已由 D-021 裁定=结构化 schema，v0.2 的 `utmBase?` 单字段作废**；campaignId 可空外键 additive 接线（ScheduledPost/Generation 补迁移；Project 已预留）；TrendSnapshot 最薄表（ownerId 隔离，两写入点+读技能；数据层由 B8 后段/B9 协调）。
6. **归因一期口径（Campaign，采纳）**：一期只做归组事件；完整首触归因=P3，契约 1 的 kind 闭集扩展 `campaign.attributed` 位属 founder-only 演进（§契约 1）。

## 四点六、二三波需求单吸收（v0.3 新增，2026-07-12——出处：PR #248 口碑 / #247 Marketplace / #249 第一米，各 §6）

> **总纲（历史审查轨迹）**：SOL §2·B2① 坐实「文件自身写明二三波未吸收、需 v0.3」是不可冻结的形式硬伤。本节吸收三波需求单，当时据此补齐冻结候选资格；当前冻结状态见文件头。
> **留痕（D-021 圈档）**：D-021 体量过目代批后，**Marketplace B0-70/72、第一米 B0-76 保持 `listed`**；其表设计**仅入册（本节登记）不排产**——不认证、不出程、终验如实显示。下列表设计入契约做前瞻校验，不构成即时建表授权（新增对象=founder-only schema 演进，单列上报）。

### 1 · 口碑五表（PR #248 §6 —— ReviewRequest / ReviewItem / Testimonial / Referral / LoyaltyMember；**v0.5 增列第六对象 `ReviewObservation` 观测流**，见本节末〔v1.2 起该观测流机制段=设计草案，随 B8 冻结——R-009 裁定 B；本节的五表形状表+事件账本归属表+宪法 8 闸保持冻结〕）

五表均**新对象**（非 harmony-01 既有；连同 v0.5 观测流=六个新对象——体量数字如实，SOL §3 教训），全部 additive migration，租户铁幕：每表 `ownerId`（无默认）+ 进 `TENANT_MODELS` 守卫 + 领头 `(ownerId, …, deletedAt)` 索引（缝 5）。

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
  | `review_received`（监控到新评价） | **`ReviewObservation` 追加式观测流 + `ReviewItem`=当前状态读模型**（本行冻结的是**账本归属**——不入归因流水、观测流为真源；流的门机制详见下方设计草案段，随 B8 冻结〔R-009 裁定 B〕） | 平台评价不可证归因到任何仪表（Google 不回传评价者来路）；写 AttributionEvent 会违反仪表非空不变量并污染量测流——**仍不入归因流水**。v0.4 曾裁「不写事件、ReviewItem 即真源」，codex R3 坐实缺口：ReviewItem 是可覆写读模型，单表会丢观测历史、无法审计平台侧删改——v0.5 补观测流为真源，ReviewItem 降为其确定性投影 |
  | `referral_converted`（介绍成交） | **AttributionEvent 新 kind**（founder-only 闭集扩展） | **可证成果**：成交经 B6 BusinessEvent 验证（evidenceRung 按凭证=merchant_confirmed/source_observed），仪表=介绍链 `linkId` 或 `sourceTagId`（必非空，守契约 1 不变量），`outcomeDelta=+1`。**无仪表的口头介绍不写归因流水**——只更新 `Referral.status` + ActionEvent 留痕（诚实：不可证就不进量测账） |
  | `referral_rewarded`（发奖） | **ActionEvent** `reputation.referral.rewarded` | 发奖是**操作**（商家价值动作，SOL §1·P0-3 要求审计）；奖励载体本身在 `VoucherToken`/EasyStore 积分（只读），不经 FIKIRTIVE 资金 |
  | `loyalty_redeemed`（积分兑换） | **BusinessEvent**（B6 镜像） | 外部经营事实：兑换发生在 EasyStore，经 Receipt→BusinessEvent 归一进城（契约〇·附），B8 永不代写 |
  | `loyalty_expiring`（积分将到期） | **不落账——确定性派生信号** | 从 `LoyaltyMember.pointsExpireAt` 确定性可算（宪法 10），B7 唤回直接读；若 B7 因此发出触达，触达操作由 B7 写 ActionEvent |

  效果数值（NPS/复购率/新客数）由 B2 B0-09 从上述各账+镜像表**自算**，B8 只写不算。**进 AttributionEvent kind 闭集的近期扩展仅 `referral_converted` 一个**（founder-only 单列，§五）。

> ⚠️ **【设计草案（非冻结）——R-009 founder 裁定 B（拆分冻结，2026-07-12）：本段随 B8 口碑块 spec 冻结】**
> 自本横幅起至「验收案例表」止的**观测流门机制整段**（`ReviewObservation` 模型形状〔含 `arrivalSeq`〕/锁协议/取号七条件/入流闸/`fold` 折叠/epoch 语义/I-R1/quarantine 冻写与解除/I-R2/列所有权分区/周期全量对账/验收案例表）**不属本 spec 冻结范围**——下方文本=移交 B8 的设计草案基线，语义照 v1.1 原样保留、本稿零修改（修复归 B8）。其后的「宪法 8 结构隔离机器闸」**不在降级范围**，保持冻结。
> **B8 继承的 R9 两个未闭反例（原文照录，B8 冻结前必须闭合）**：
> ① 「锁内普通 ULID 同毫秒不保证后到更大→equal-time policy 被打穿（ids.ts 用普通 ulid()）」
> ② 「时钟前跳毒化 observedAt 水位→真删除被永久丢弃」

- **口碑观测流 `ReviewObservation`（〔设计草案——见上方横幅〕v0.5 冻结观测流真源；v1.0 本节整体重写为**到达序折叠架构**——codex R7 ③④ + 当时 bounded cross-family 顾问轮裁定采纳；本节=单一连贯块，取代 v0.6–v0.9 分层补丁文本，历史演进见 §五版本链）**：`ReviewItem` 保留为**当前状态读模型**——其**投影列**（列清单见下「列所有权分区」）=观测流按**到达序**折叠的确定性投影，可随时全量重建（宪法 10）。观测流为真源，**仍不入归因流水**（契约〇——此两点属账本归属，已在上方归属表冻结）。完整形状（建表属 founder-only 单列，§五；形状=**草案基线，随 B8 冻结**〔v1.2 拆分，原文「形状本节冻结」降级〕）：

  ```prisma
  // 口碑观测流（append-only）：每行=一次「生效观测」（在场快照或消失 tombstone）。
  // ReviewItem 投影列是本流按到达序折叠的确定性投影（读模型），可随时全量重建（宪法 10）。
  // v1.0（codex R7 ③④）：到达序轴 = arrivalSeq（per-review 计数器，锁内自增）；
  // 入流闸原则「入流才需确定性；不入流只需留痕」——陈旧/同态观测不入流。
  model ReviewObservation {
    id               String   @id // ULID——【v1.1】铸造于锁内（与 arrivalSeq 同序）：兼任入流闸 equal-time
                              // tie-break（observedAt 相等时比较落到 id、新到必大）；到达轴仍是 arrivalSeq
    ownerId          String   // 租户键，无默认（宪法 6；进 TENANT_MODELS + Organization back-relation）
    organization     Organization @relation(fields: [ownerId], references: [id])
    platform         String   // 'google' | 'shopee' | 'lazada' | 'fb'（code-validated，同 ReviewRequest 闭集）
    externalReviewId String   // 平台内评价 ID
    arrivalSeq       Int      // 【v1.0 到达序轴；v1.1 取号改自流——lastArrivalSeq 计数器列删除】锁内
                              // SELECT COALESCE(MAX(arrivalSeq),0)+1 FROM ReviewObservation
                              //   WHERE (ownerId, platform, externalReviewId)
                              // ——MAX 必于取锁后执行，安全性由七条件承载（见「取号七条件」）；取号不写任何
                              // ReviewItem 列（quarantine「入流不折叠」矛盾根除）。重建 ORDER BY arrivalSeq
    lifecycleEpoch   Int      // 本观测入流时的折叠纪元。观测行真源=idempotencyKey（嵌 e<epoch>）+payload（写入后
                              // 不可变）；本列是行内派生缓存（非真源，可由 key 反解）——修它=缓存修复非篡史（I-R1 见下）
    observationKind  String   // 'present'（在场快照）| 'absent'（tombstone：平台侧已删除/隐藏）——删除语义，永不物删本地行
    externalVersion  String?  // 平台自带版本号/更新时间戳（平台有则录）
    contentHash      String   // sha256(归一化 rating+body+回评状态)——外部无版本号时的版本替身；absent 观测=最后在场 contentHash
    rating           Int?     // present 时快照；absent 为 null
    body             String?  // present 时快照；absent 为 null
    observedAt       DateTime // 本次观测发生时刻——入流闸高水位轴之一；到达轴是 arrivalSeq 非此列
    createdAt        DateTime @default(now())
    idempotencyKey   String   // '<platform>:<extId>:e<epoch>:a<arrivalSeq>:<contentHash>'（present）
                              // | '<platform>:<extId>:e<epoch>:a<arrivalSeq>:absent:<最后在场 contentHash>'（absent）
                              // 【v1.0】键含 arrivalSeq=按构造唯一；重试/重爬去重由锁内比对（入流闸）承担，
                              // unique 键降为防御性护栏——v0.9 键槽污染整族（烧槽卡死/陈旧吞写/回摆吞写）随之消失
    @@unique([ownerId, idempotencyKey])
    @@unique([ownerId, platform, externalReviewId, arrivalSeq]) // 【v1.1 七条件 (f)】取号碰撞的数据库级防御；
                              // 兼作重建回放 / 锁内 MAX / 流内水位查询的租户前导覆盖索引
  }
  ```

  - **锁协议（v1.0 冻结——一切路径共此一锁）**：对某评价的全部处理序列化于 **per-`(ownerId, platform, externalReviewId)` advisory xact lock**：`取锁 → 读流内水位与投影态 → 判定（入流闸）→（可能）插观测 →（可能）折叠写投影`——**插入+折叠同事务且同锁**。三条投影写路径——在线摄入折叠、对账重建、解除隔离全量重建——**均在同一把锁内**。**首条观测的锁载体=advisory 锁本身（v1.1 写明——七条件 (b)）**：锁 keyed by `(ownerId, platform, externalReviewId)` 稳定哈希、**不依赖任何行存在**，无需 stub row。
  - **取号七条件（v1.1 冻结——codex R8④ + SOL round-two memo 采纳；`lastArrivalSeq` 计数器列删除，取号改锁内流 MAX+1）**：`arrivalSeq` = 锁内 `SELECT COALESCE(MAX(arrivalSeq),0)+1 FROM "ReviewObservation" WHERE (ownerId, platform, externalReviewId)`。其安全性由七条件**共同承载**（任一无法冻结 ⇒ 改用独立 sequencing row，预授权后手）：**(a)** 一切观测写入路径先取得**同一把** per-review advisory lock；**(b)** 首条观测的锁载体=**锁本身**（advisory 锁不依赖行存在）；**(c)** **MAX 必于取锁之后执行**（READ COMMITTED 下语句级新快照可见前一持锁事务已提交行——锁等待结束后重读）；**(d)** 隔离级别=**READ COMMITTED**（并发主权总注隔离级别假设行，交叉引用；日后若升更强隔离级别，须补 serialization/unique-conflict 重试协议）；**(e)** 观测流**永不物删/永不重编号**；若允许归档，必须保留 **sequence floor**（MAX 语义不回退）；**(f)** 唯一约束 `(ownerId, platform, externalReviewId, arrivalSeq)`（已入上方 model——碰撞的数据库级防御）；**(g)** 一切查询携带 `ownerId`（宪法 6）。
  - **入流闸（v1.0 原则「入流才需确定性；不入流只需留痕」；v1.1 修订——codex R8③ 采纳：删同态 no-op 谓词+门判定源改流自身）**：锁内判定，present 与 absent **对称**；**门判定源永远是观测流自身**——高水位=锁内查流按 `arrivalSeq` 最大行的 `(observedAt, id)`（入流行两轴同序；七条件 (f) 唯一键即覆盖索引；**不读投影列**——`lastObservedAt`/`lastObservationId` 降为展示缓存，quarantine 依赖冻结列的问题根除）：
    - **门比较键（v1.1 明定完整全序）**：`(observedAt, id)`。平台自带 revision（`externalVersion`）仅记录、不参与门序（平台能力不齐，不可组全序）。**equal-time policy**：观测 `id`（ULID）**铸造于锁内**=与 `arrivalSeq` 同序 ⇒ `observedAt` 相等时比较落到 `id`、新到必大 ⇒ **恒入流**，终态由 fold 到达序决定——入反例测试（§并发义务表场景 3）。
    - **陈旧**（`(observedAt, id)` ≤ 流内高水位）→ **不入流**，记 ActionEvent `reputation.review.stale_observation_dropped` `{observedAt, contentHash, kind}` 留痕——契约〇分账纪律：陈旧观测是**运营噪声**，归 ActionEvent，不占观测账；观测账收录的是**生效观测**，其确定性投影承诺因此成立（非放宽 append-only，是两种真相面分开记账）。
    - **其余一律入流（v1.1：含内容未变的重爬——同态 no-op 谓词删除）**：R8 双反例坐实该谓词：(甲) no-op 不入流则不推进 durable 水位——`P(h1,t1)` 后重爬 `P(h1,t7)` 被丢，迟到 `A(t4)` 错误过门置 removed（平台 t7 真相被遗忘）；(乙) 谓词未限定 present 态——removed 后同 hash 真复活被判 no-op 吞掉、永不复活。**删除谓词后两反例同死**：重爬入流即推进水位、拦下 A(t4)；复活正常入流+fold epoch+1。键含 arrivalSeq 按构造恒唯一、无碰撞面；容量代价=每爬一行，**不作「可忽略」契约断言**（容量结论待证，入假设台账）。入流步骤：锁内取号（七条件）→按 fold 铸 epoch 入键→插观测行→**同事务**折叠写投影。**入流行的折叠效果=该行与前序入流行的纯函数**；入流行沿到达序在 `(observedAt, id)` 上亦严格递增（闸按构造保证）——到达序与逻辑序对入流行恒一致。
    - **重试语义（v1.1 冻结——memo 选项 (b)）**：transport retry（同一爬取结果重复投递）**成新观测行**（不设去重键）；fold 的**状态副作用**（投影列变更、live-event 发出）**仅于派生态实变时产生**——重复行的折叠为无副作用步（行在账、效果幂等；§并发义务表场景 4）。
  - **折叠 `fold`（v1.0 冻结——投影的唯一定义；v1.1 修订：`lastArrivalSeq` 列删除、水位列降为展示缓存、fold 只读 `integrityStatus`）**：投影全部状态（`status`/`lifecycleEpoch`/`rating`·`body` 显示内容/`firstObservedAt`/`lastObservedAt`/`lastObservationId`〔后二者 v1.1 降为**展示缓存**——门判定源=观测流自身，见入流闸〕）=对**已入流观测行**按 **`arrivalSeq` 到达序**的单一确定性折叠：present 且前态 removed ⇒ `lifecycleEpoch`+1（生效转换）；present ⇒ `status='present'`、显示内容=该行快照；absent ⇒ `status='removed'`（epoch 不变；本地行**永不物删**——评价被平台删掉也是经营事实，差评预警/合规审计要看得见）；每行更新展示缓存 `(lastObservedAt, lastObservationId)`。**状态副作用（投影变更、live-event 发出）仅于派生态实变时产生**（重试语义，v1.1）。`fold` **只读不写** `integrityStatus`（完整性列，见列所有权分区）。**在线=插入时同事务锁内折叠一步；离线重建=同一 `fold` 按到达序全量重放——在线与重建恒等按构造成立**。`firstObservedAt`=epoch 0 首条 present 的 observedAt（跨纪元不重置——「第一次见到这条评价」；v0.3 表中 `capturedAt` 语义并入 `lastObservedAt`）。
  - **epoch 语义（v1.0 改述）**：`lifecycleEpoch`=**折叠态计数**——到达序下 absent→present 的**生效转换数**（弃 v0.9「`(observedAt,id)` 全序转换计数」表述）；评价首现=epoch 0。**CAS 赢家/输家规则全套删除（净删）**——由锁取代：锁内先到先折叠，后到者读到新态后按普通规则（入流闸+fold）处理自己那笔。
  - **键内纪元一致性（不变量 I-R1——原样保留）**：`parse(idempotencyKey).epoch == lifecycleEpoch`（行内嵌键与列必须一致；Prisma 无 CHECK ⇒ 应用层不变量+专项测试，写入路径断言+对账全量断言双覆盖）。**不一致=fail-loud 修复流程（原样保留）**：①记 ActionEvent `reputation.review.integrity_failed` `{observationId, keyEpoch, columnEpoch}`；②`ReviewItem.integrityStatus` 置 `'quarantined'`（真字段；**I-R1 流程=完整性列合法写者之一，`ok→quarantined`，重复隔离幂等**——v1.1 分族，见列所有权分区）——投影冻写、差评预警对该条**界面诚实降级**「数据核对中」（宪法 11）；③以键嵌值为准修正 `lifecycleEpoch` 列=**缓存修复非篡史**（受控例外+ActionEvent `reputation.review.integrity_repair` `{observationId, fromEpoch, toEpoch}` 审计）；④解除隔离（见下条）。**永不静默吞**。
  - **quarantine 冻写与解除（v1.0 重述——修 R7 ④ 解除竞态；v1.1 精确化 rebuild 协议）**：隔离期间摄入=锁内**「入流不折叠」**（观测流照常 append——真源不冻，投影列不写；v1.1：取号读流 MAX、门读流水位，**均不触投影列**——R8 指出的「取号须写冻结列」矛盾根除）；**运营列不受 quarantine 冻结**（商家在数据核对期照样起草回评）。**解除隔离=单事务原子**：`{取锁 → 全量重放折叠至锁内捕获的 backlog 尾端（=锁内所见流内最大 arrivalSeq）→ 写投影快照 → integrityStatus 原子复位 'ok' → 提交}`——积压观测由重放一次性消化；**失败的 rebuild（重放未达尾端/断言不过/事务回滚）保持 `quarantined`**（v1.1 冻结）；并发摄入在锁上排队，等到时看到的已是 ok+新快照，正常折叠其上。
  - **写入点不变量（I-R2，v1.0 冻结+机器闸；v1.1 分族精确化）**：**投影列**的写入点**唯二**=`fold`（在线折叠）/`rebuild`（全量重放）；**完整性列 `integrityStatus`** 的写入点**唯三**=初始化器/I-R1 隔离流程/`rebuild`（见列所有权分区）——**全部写者必持同一把 per-review advisory lock**。机器闸：CI grep 断言仓库内无族外写者；可选 DB 触发器查 `pg_locks` 断言持锁。（「第 N 条写路径」用不变量关死，不靠枚举。）
  - **列所有权分区（v1.0 冻结；v1.1 三分族——`integrityStatus` 自投影列族移出、`lastArrivalSeq` 列删除）**：

    | 列族 | 列 | 写者 | quarantine 冻结？ |
    |---|---|---|---|
    | 投影列 | `status` / `lifecycleEpoch` / `rating` / `body` / `firstObservedAt` / `lastObservedAt` / `lastObservationId`（后二者=展示缓存，门判定源=观测流自身） | 唯二：`fold`/`rebuild`（必持锁，I-R2）；`fold` 副作用仅于派生态实变时产生 | 是（入流不折叠） |
    | 完整性列（v1.1 分族） | `integrityStatus` | **唯三（共锁）**：①初始化器（建行写 `'ok'`）②I-R1 隔离流程（`ok→quarantined`，重复隔离幂等）③`rebuild`（**仅于成功重放至锁内捕获的 backlog 尾端后**原子 `quarantined→ok`；失败保持 quarantined）。`fold` **只读不写** | ——（本列即隔离开关） |
    | 运营列（回评线） | `replyStatus` / `replyBody`（本节五表表+PR #248 reputation 设计 §6 的回评字段全集；Testimonial 引用在 `Testimonial.reviewItemId` 外键侧，ReviewItem **无**反向列） | B8 回评流（写时同持这把 review 锁） | **否** |

    「可全量重建」的宣称**只对投影列成立**；`rebuild` 只触投影列与完整性列复位、永不触运营列——**重建不会抹掉回评草稿**。
  - **周期全量对账（v1.0 简化——对账不再是特殊路径）**：每 **24 小时**（冻结常量，founder ack 可调）对平台真值全量比对；**对账补写=以拉取时刻为 `observedAt` 的普通观测**，走同一把锁同一入流闸（observedAt=now 必过门）。四类漂移：①平台在场而本地无（含**本地 removed**——在场性判定上 removed 视同本地无）→ 普通 present 观测入流（前态 removed 则 fold 自然 epoch+1——**不再是特殊路径**；全新评价建行 epoch 0）；②本地 present 而平台无 → 普通 absent 观测入流；③读模型字段 ≠ 按流重放结果 → `rebuild`（锁内全量重放），同时全量断言 I-R1（解析每行键 `e<epoch>` 段==列）；④**同为 present 而内容≠平台**（v1.0 新列名——键槽缺陷 (ii)(iii) 修复后由①同路径的普通 present 观测自然承接，无需特案）。对账记 ActionEvent `reputation.review.reconciled` `{platform, checked, drifted, tombstoned, resurrected}`。
  - **验收案例表（v1.0 冻结进契约测试——原 v0.6 反例表仅表头「全序」改「到达序」、行判定不变〔=R1 行〕；新增五行收编对手弹药；每行「在线/重建」双判定，恒等按构造）**：

    | 案例（按到达序） | 在线判定 | 重建判定（ORDER BY arrivalSeq 重放） |
    |---|---|---|
    | R1 · 顺序四步（v0.6 原反例，判定不变）：首现 h1 → 删除 → 同 hash 重现 → 二次删除 | e0 present → e0 removed → e1 present → e1 removed（各键含 arrivalSeq 互异，完整留痕） | 同左（顺序到达 ⇒ 到达序=逻辑序） |
    | R2 · codex R7③ 五事件：P(t1)→A(t2)→P(t7)〔复活 e1〕→迟到 A(t4)→迟到 P(t3) | 迟到两笔**不入流**（闸拦+`stale_observation_dropped`×2）；终态 e1 present | 流内仅前三笔 ⇒ 同判 e1 present——在线/离线分叉消除 |
    | R3 · 键槽 (i) 门外 absent：迟到 absent 被拦后，平台真删（t8>t7） | 迟到 absent 不入流（**不烧键槽**）；真删 absent 过门入流 → removed | 同左（旧机制下同键被 unique 吞、本地永久 present——已不可能） |
    | R4 · 键槽 (ii) 门外 present：迟到旧 present(h_old) 被拦后，平台真改回 h_old | 迟到笔不入流；真实改回笔（过门且内容≠当前投影）正常入流 → 显示 h_old | 同左 |
    | R5 · 键槽 (iii) 同纪元 A→B→A 内容回摆（顺序到达，与迟到无关） | 三笔全过门全入流（键含 arrivalSeq 各唯一）→ 显示回 A | 同左（旧机制下第三笔同键被吞、显示永停 B——已不可能） |
    | R6 · 解除隔离并发：`rebuild` 进行中新观测到达 | 新观测在锁上排队；解除事务提交后其见 ok+新快照，正常入流折叠 | 重放含该笔 ⇒ 同判 |

> **——设计草案段到此为止（R-009 裁定 B）；以下恢复现已冻结范围的文本（其中候选措辞为历史审查轨迹）。**

- **宪法 8 结构隔离机器闸**（本域最关键契约——**保持冻结，不在草案降级范围**）：ReviewRequest 与 Referral 两表**禁互指外键**；`review_*` 与 `referral_*`/`loyalty_*` 两族事件**不共享关联键**，B2 算效果时不得反推「留评→给奖」耦合归因。任何 migration 加互指=违宪 8，进 REVIEWER-PLAYBOOK 硬拦 + CI schema 断言（ReviewObservation〔草案对象，形状随 B8 冻结〕同属评价线，**禁含**任何 referral/loyalty 关联键）。

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

> **当前状态（2026-07-16）**：以下版本链保留原冻结审查用语；有效结论是 v1.2 冻结范围已由 #260 补落 `main`。它不因 R-010 被撤销，但 R-010 三处 schema 实施在新 Founder 决定前不得施工。

- **历史审查状态：冻结候选（freeze candidate）。** v0.1 骨架 → v0.2 吸收 B8 两试产 → v0.3 闭合 SOL §2·B2 六阻断项 + 吸收二三波 → v0.4 闭合 codex R2 BLOCK 清单 → v0.5 闭合 codex R3 两项（consent 顾客优先级 / ReviewObservation 观测流） → v0.6 闭合 codex R4 两项（consent 换轴到达序+entryMode / 观测键嵌 lifecycleEpoch） → **v0.7 闭合 codex R5 四项+主动扫：entryMode 服务端派生 computed / 折叠写入 advisory lock 序列化 / 复活主权 CAS+输家规则 / 键内纪元一致性 I-R1+fail-loud 修复 / 并发主权总注** → **v0.8 闭合 codex R5 复审（机械层）五项：①sourceKind 服务端绑定（端点常量表，两字段不可传，I-C1 升编译期常量断言，契约 3）②receivedAt 锁内 clock_timestamp 赋值 + 一事务一三元组禁多锁（契约 3）③ReviewItem 增 lastObservationId 在线字典序 tie-break（§四点六·1）④ReviewItem 增 integrityStatus + lifecycleEpoch 缓存语义澄清（修列=缓存修复非篡史，integrity_repair 审计，§四点六·1）⑤两缝收口（ContactIdentity merge 沿链解根双锁·契约 2；LiveEventOutbox 空洞判废双条件·B9 契约 6）** → **v0.9 闭合 codex R6 定向复审四项（R6 判②locked-clock 已 CLOSED）：①sourceKind 端点表闭集不变量+B8 请评前置改读方+evidenceRef 运行时格式断言（I-C1 断言分层，契约 3）③复活 CAS 字典序门+一致性论证（§四点六·1）④quarantined 冻写谓词入两条更新路径 WHERE+真源不冻只冻投影（§四点六·1）⑤LiveEventOutbox 判废登记式双条件（B9 契约 6）** → **v1.0 闭合 codex R7 ③④——R7 判定：①CLOSED ②未破坏 ③STILL-OPEN ④NEW-DEFECT；修复方向经当时 bounded cross-family 顾问轮裁定（SOL lane incomplete → fallback Fable complete，按协议标注；memo+provenance 仅留 Git 历史，当前证据取对应 GitHub task/PR）：§四点六·1 观测流整节重写为到达序折叠架构（arrivalSeq 到达轴/入流闸「入流才需确定性；不入流只需留痕」/CAS 全套净删/epoch=折叠态计数/解除隔离单事务原子/唯二写入点 I-R2+机器闸/列所有权分区/对账普通路径化+第四类漂移/验收表收编对手弹药）+并发主权总注 READ COMMITTED 假设行+LiveEventOutbox 行改引用。给 founder 一行点名：v0.6 反例表随本 spec 版本化（非外部已签冻结件），本轮仅表头「全序」→「到达序」+新增验收行，原行判定不变** → **v1.1 闭合 codex R8 四项——R8 判定：③④⑤NEW-DEFECT+②契约 3 被 NTP 回拨反例连带；修复方向经 SOL 顾问 round two（complete，置信 0.87；memo+provenance 仅留 Git 历史，当前证据取对应 GitHub task/PR）：②契约 3 reopened by R8 counterexample→单调钳位六步协议（@db.Timestamptz(6)/1μs tick；两表未建=无历史逆序；契约测试义务=在线锁序 vs 离线重放等价含 NTP 前后跳；同一 head 重新过四权闭环）③删同态 no-op 谓词（门比较键完整全序+equal-time policy=id 锁内铸造；重试=新行+副作用仅实变；门判定源=流自身，水位列降展示缓存）④删 lastArrivalSeq（取号=锁内流 MAX+1+七条件；integrityStatus 分族=完整性列三写者）⑤B9 v0.9 origin-primary 限定+安全域+fencing+60s 纯活性声明；新增 §并发义务表（12 场景×七字段）** → **v1.2 拆分冻结（本稿）——R-009 founder 裁定 B（渠道内原话，2026-07-12）：R9 全 CLOSED 内容维持冻结候选（语义零变更——本稿只加降级标注/引用注记）；观测流门机制整段（§四点六·1 草案段）降级为设计草案随 B8 再冻，横幅内原文照录 R9 两个未闭反例（①锁内普通 ULID 同毫秒 equal-time 被打穿〔ids.ts 用普通 ulid()〕②时钟前跳毒化 observedAt 水位→真删除永久丢弃）作为 B8 继承的已知未闭项；并发主权总注三行+义务表场景 1-6 标注草案；冻结范围重述见下一条** → **四权闭环放行（#254 §一.2）** → spec-ready（02-B2 相关行随冻结 PR 迁级）。异族复审+双顾问签核+机器闸+非作者合并放行；founder 终验一次过审计索引（#254 §一.3/§二.5）。
- **冻结范围重述（v1.2 拆分——R-009 Founder 裁定 B；#260 已生效）**：**已冻结范围** = 契约〇（五账分层+契约〇·附 BusinessEvent/Receipt 互斥职责）／契约 1（AttributionEvent 写入规范）／契约 2（身份判同+merge 并发主权）／契约 3（同意四轴——**含 R8 重开-勘误-重闭件**：单调钳位六步协议+契约测试义务）／契约附 UTM／归因链／§四点六·1 的**五表形状表+事件账本归属表+宪法 8 结构隔离机器闸**／§四点六·2 Marketplace／§四点六·3 第一米／§四点五 B8 试产吸收／并发主权总注与并发义务表中**非口碑流行**（义务表场景 7–12）。**明示除外（设计草案，非冻结——随 B8 口碑块 spec 冻结）** = §四点六·1 观测流门机制整段（`ReviewObservation` 形状〔含 arrivalSeq〕/锁协议/取号七条件/入流闸/fold/epoch/I-R1/quarantine/I-R2/列所有权分区/对账/验收案例表）+ 并发主权总注 ReviewItem 三行 + 义务表场景 1–6——草案携带 R9 两个未闭反例为 B8 继承的已知未闭项（横幅原文照录）。
- **开放问题（v0.2 三项处置）**：
  1. ~~事件 payload schema 约束强度~~ → **闭合**：kind 闭集 + 每 kind 软引用非空约束（契约 1，对齐真 schema `schema.prisma:1364-1369`），非自由 JSON；宪法 10 定型。
  2. anonymousKey 隐私保留期（PDPA 姿态）→ **留 B13 对表**（跨块，非本 spec 冻结阻断项；`geoBucket`/`ipHashPrefix` 已按 PDPA 粗粒度冻结）。
  3. 收费点事件是否并入 kind 闭集 → **闭合**：按契约〇=Credits 收支归 `CreditLedger`，**不并入** AttributionEvent kind 闭集；宪法 2 账本推论由 CreditLedger 承载。
- **冻结时随契约上报 founder 的 founder-only 单列项**：①`issuerId` 扩唯一索引（身份铁幕）；②AttributionEvent kind 闭集扩展（近期仅 `referral_converted`；P3 `campaign.attributed`——归属已按 §四点六·1 冻结）；③二三波新对象建表（口碑五表 + `ReviewObservation`〔**形状=设计草案，B8 冻结时定**——R-009 裁定 B，v1.2〕/ MicrositePage / `ConsentEvent`〔形状已冻结于契约 3〕/ 可选对象）。这些**不在本 spec 自行落地**，是冻结 ack 时的明示清单。
