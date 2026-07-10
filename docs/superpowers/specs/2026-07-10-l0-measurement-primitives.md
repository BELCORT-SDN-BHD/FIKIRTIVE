# L0 量测原语 —— 设计 spec(第 0 大陆:所有环共用的水表,2026-07-10)

> **性质**:施工图层(蓝图金字塔最下层)。**本文件只是图纸,不含任何代码,待 founder 过目后动工**(蓝图第五章第 1 条)。
> **依据**:R5 双脑裁定 D4 —— 「先做量测原语:短链、QR、voucher token、UTM、来源确认、退款回卷。**这不是一个营销大陆,而是所有大陆共同的仪表**」(`docs/strategy/SOL-R5-2026-07-10.md` §Q1 / `TWO-BRAIN-MEMO-2026-07.md` R5 节);归因诚实教义 —— 「voucher/UTM 最多证明 source-observed 或 attributed;**不能证明 incrementality**;月一只能报告 observed/attributed」(同上 §Q2)。
> **宪法锚点**:v2.11 **边界四层表**「**读取并验证**」层(`docs/BLUEPRINT.md`:订单/付款/退款/库存/履约/积分等经营事实——**只读**,用于状态、归因与回执,**类比 pixel tracking,永不代管、永不自建账本**)。L0 就是这一层的「表」;也是「本体负责」层里**请评/推荐/复购与唤回/增长实验**的共用载体。
> **走的缝**:租户缝(Seam 5,ownerId 全链 + TENANT_MODELS)、Parity(Seam 9,每个新 action 出生即登记)、设计缝(Seam 7,报表面 .gb + coral 只属 Otto)、Otto 技能缝(Seam 1,生成/吊销/读表经 ports)、队列缝(Seam 6,扫码异常侦测 + 报表滚合可异步)。**不走记账缝(Seam 3)** —— L0 生成即 $0,不扣 FIKIRTIVE credits(见 §五)。

## 名词对照(人话)

| 术语 | 人话 |
|---|---|
| 量测原语(measurement primitive) | 一套「装在营销动作上的水表」:每条链接/每张码/每个优惠码天生带编号,谁扫了、谁用了、退了没,都能对上账 |
| 先装表再开水 | 先把水表(L0)装好,再开任何一条水管(创作/发布/请评/唤回);没表就开水 = 花了钱不知道有没有效果 |
| 短链(TrackedLink) | 一条我们自己域名下的短网址,点它先经过我们再跳到真正目的地——中间那一下就是「抄表」 |
| QR / 二维码(QrAsset) | 印在海报/贴纸/名片上的方块码,扫它 = 打开一条短链;码永远指向短链、不直接指向目的地(这样才能事后一键作废) |
| placement ledger | 「这张码贴在哪、印了第几版、印了没、贴出去没、召回没」的台账——码一旦印出去,错误不能靠部署回滚,只能靠这本账召回 |
| 优惠码 token(VoucherToken) | 商家发给**自家顾客**的折扣码/赠品码(顾客在**商家**店里核销),**不是** FIKIRTIVE credits;我们只记账不代管 |
| 退款回卷(clawback) | 顾客退款后,把之前记成「归因成单」的那一笔**反冲掉**,报表看的是净值不是毛值 |
| UTM | 挂在链接尾巴上的来源参数(source/medium/campaign…),平台通用的「你从哪来」标记 |
| 来源确认 / 来源标(SourceTag) | 某人扫了码/点了链接后又变成了联系人(比如 WhatsApp 找上门),给这个联系人贴上「他从哪张码来的」标签 |
| 归因流水(AttributionEvent) | 一条只进不改的流水账:扫了、点了、核销了、退款回卷了——每笔都标「这是我亲眼看到的(observed)还是我推断关联的(attributed)」 |
| observed / attributed / incremental | 证据阶梯:**observed** = 亲眼看到的事件(扫码/核销);**attributed** = 关联/推断(这单可能因这条链接);**incremental** = 对照实验证明的净增量。**L0 只到 attributed 为止,永远说不出 incremental** |
| 品牌中间页(brand interstitial) | 码/链接被作废后,扫它看到的不是死掉的 404,而是一张商家品牌的「此码已失效,试试这里」的体面页 |
| 开放跳转(open redirect) | 短链若允许跳到任意网址,就会被坏人拿去做钓鱼跳板;必须用「目标 allowlist」焊死 |

## 一、目标与非目标

**目标**:
1. **先装表再开水。** 把六件一等公民量测原语(短链 / QR / 优惠码 token / UTM / 来源确认 / 退款回卷)做成**所有环共用的水表**,任何环(创作→发布、请评、唤回、增长实验)动工前都能直接接表,不各自重造归因。
2. **诚实归因的物理载体。** 让「有没有效果」有据可查,但**结构性地封死吹牛路径**:数据模型层面就让「incremental(是我带来的)」写不进去,报表只能说 observed/attributed(D4 诚实教义入模型)。
3. **合规请评的接入点。** Google 请评只接受「链接 / 二维码」(不接受平台 API 代发评价),L0 的 TrackedLink + QrAsset 就是**合规请评的唯一合规载体**;同时结构上保证「请评」与「奖励」永久分离(宪法第 8 条 v2.11)。
4. **L4 唤回归因的载体。** 来源标(SourceTag)把「这个联系人从哪来」一路带到未来的复购/唤回环,唤回 campaign 的归因不必回头补建。

**非目标(明确不做,防越界)**:
- **不自建资金/积分账本。** VoucherToken 记的是「一次性折扣码的核销/回卷」(二值状态,不是余额),**不是** loyalty 积分余额;积分余额永远**只读自商家店铺系统**(EasyStore/Shopee),L0 不建余额真相(v2.11「永不自建账本」+ R5 Q3 3.10「积分是第二条 money path」)。
- **不代管商家资金。** 优惠码是商家发给商家顾客的,核销发生在商家店里;L0 只记录事实,不经手一分钱。
- **不说增量。** 没有对照实验就永不声称 incrementality(D4);L0 不含实验/holdout 引擎,那是未来「增长实验」环的事,L0 只提供它需要的干净流水。
- **不碰 FIKIRTIVE credits。** 生成短链/码/优惠码是 $0 确定性动作(像 schedulePosts 只建 DRAFT),不走记账缝、不扣 credits。

## 二、六原语 → 对象模型映射

六件一等公民由 **5 个 owner-scoped 对象 + 1 张 placement 支撑表**实现(UTM 是 TrackedLink 上的字段并在扫/点时快照进流水;退款回卷是流水上的一种事件,非独立对象):

| 一等公民 | 落在哪 |
|---|---|
| 短链 | `TrackedLink`(本体)+ 重定向端点(公共热路径) |
| QR | `QrAsset`(永远编码一条 TrackedLink)+ `QrPlacement`(物理台账) |
| 优惠码 token | `VoucherToken` |
| UTM | `TrackedLink.utmJson`(定义)+ `AttributionEvent.utmSnapshot`(抄表时快照) |
| 来源确认 | `SourceTag` |
| 退款回卷 | `AttributionEvent`(kind=`clawback`,带负 outcomeDelta 反冲) |
| 归因流水(承载全部) | `AttributionEvent` |

### 2.1 `TrackedLink` —— 短链

```prisma
// L0 量测原语:owner-scoped 短链。重定向端点是公共热路径(匿名点击者),但每条链接
// ownerId 全链隔离 + 目标 allowlist 焊死开放跳转。QR 永远编码短链 URL(不编码 targetUrl),
// 这样吊销短链即可让已印刷的码集中失效,无需重印(物理攻击面对策,§六)。生成 = $0,不扣 credits。
model TrackedLink {
  id           String    @id // ULID
  ownerId      String
  organization Organization @relation(fields: [ownerId], references: [id])
  // v1 additive:未来 agency/campaign 层的 nullable 软引用(无 FK、无 backfill;house 惯例,见 GenerationBatch)
  brandId      String?
  campaignId   String?
  domain       String    // 短链域名(config 层选型,§十);多域名就绪
  slug         String    // 短码,如 "raya-h7";server 铸造 / 校验唯一,永不信客户端裸传
  targetUrl    String    // 最终目的地;写入时刻必过 allowlist,重定向时刻再校验一次(纵深防御)
  targetKind   String    // 'wa' | 'shopee' | 'easystore' | 'gbp_review' | 'own_site' | 'other'(封闭类目,校验用)
  utmJson      Json?     // { source, medium, campaign, content, term };重定向时附加到 targetUrl
  purpose      String    @default("generic") // 'generic' | 'review_request' | 'winback' | 'promo'(报表分组;'review_request' 触发请评护栏 §七)
  title        String    @default("") // 人话标签
  status       String    @default("active") // 'active' | 'revoked'(code-validated String,非 PG enum;house style)
  revokedAt    DateTime?
  revokedReason String?
  source       String    // 'otto' | 'owner'(谁建的)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  deletedAt    DateTime? // 软删除——永不硬删历史

  qrAssets QrAsset[]

  // 重定向解析 (domain, slug) → link,与 owner 无关(点击者匿名),故唯一约束在 (domain, slug)。
  // 一条 raw partial UNIQUE INDEX ON (domain, slug) WHERE deletedAt IS NULL 落 migration
  // (Prisma 无法表达 partial index;同 BrandRecord.nameKey / PublishAttempt 手法)。
  @@index([ownerId, createdAt])
  @@index([ownerId, purpose, createdAt]) // 报表:按用途聚合
}
```

### 2.2 `QrAsset` + `QrPlacement` —— 二维码与物理台账

```prisma
// QR 永远编码一条 TrackedLink 的短链 URL(linkId 必填),绝不编码 targetUrl —— 这是可吊销性的根:
// 撤链接即让所有印出去的码集中跳向品牌中间页,无需重印。渲染出的 QR PNG 走内容寻址存储
// (storageKey(ownerId, sha256, "png"));生成 = $0。
model QrAsset {
  id           String    @id // ULID
  ownerId      String
  organization Organization @relation(fields: [ownerId], references: [id])
  brandId      String?
  campaignId   String?
  linkId       String    // FK→TrackedLink;QR 的一切扫码事件经这条短链抄表
  link         TrackedLink @relation(fields: [linkId], references: [id], onDelete: Cascade)
  label        String    // "Raya 海报 / GM Klang 门店橱窗"
  imageAssetId String?   // 渲染好的 QR PNG(R2,可选;也可前端即时渲染)
  status       String    @default("active") // 'active' | 'revoked'
  revokedAt    DateTime?
  revokedReason String?
  source       String    // 'otto' | 'owner'
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  deletedAt    DateTime?

  placements QrPlacement[]

  @@index([ownerId, linkId])
}

// placement ledger:一张码贴在哪、第几版、印刷/铺设/召回到哪一步。码一旦印刷,
// 错误无法靠部署回滚(R5 Q3 3.7),故物理放置本身是「有版本、有位置、有撤销成本」的资产。
model QrPlacement {
  id          String    @id // ULID
  ownerId     String    // 反范式冗余,供 tenant guard 直接过滤
  organization Organization @relation(fields: [ownerId], references: [id])
  qrAssetId   String
  qr          QrAsset   @relation(fields: [qrAssetId], references: [id], onDelete: Cascade)
  location    String    // 人话:"GM Klang 门店橱窗" / "Raya 海报 A 批"
  version     Int       @default(1) // 重印版本;换码即 version+1
  printStatus String    @default("DRAFT") // 'DRAFT' | 'PRINTED' | 'DEPLOYED' | 'RECALLED'(code-validated;状态机是纯 helper)
  quantity    Int?      // 印了多少张贴纸/海报
  deployedAt  DateTime?
  recalledAt  DateTime?
  note        String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([ownerId, qrAssetId, printStatus])
}
```

### 2.3 `VoucherToken` —— 优惠码(生成 / 核销 / 退款回卷)

```prisma
// 商家发给自家顾客的一次性营销码,顾客在商家店里核销。二值生命周期(issued→redeemed/void/expired
// + clawed_back),不是余额账本(与 loyalty 积分余额严格区分:后者只读自商家店铺,L0 不建)。
// 核销/回卷的**事实**来自 source-observed(店铺 webhook)或 merchant-confirmed;不经手资金。
// 生成 = $0。⚠️ 宪法第 8 条 v2.11:优惠/奖励与「请评」永久分离——voucher 永不可挂在写评价动作上(§七)。
model VoucherToken {
  id            String    @id // ULID
  ownerId       String
  organization  Organization @relation(fields: [ownerId], references: [id])
  brandId       String?
  campaignId    String?
  code          String    // 可核销码,如 "RAYA-9F3K";server 铸造 / 校验唯一
  kind          String    @default("no_discount") // 'no_discount' | 'percent' | 'amount' | 'gift'
                          // 默认无折扣(§八 量测即干预:优先无折扣 token,折扣是会改变行为的 treatment)
  discountJson  Json?     // { percent } | { amountMinor, currency } | { giftSku };no_discount 时为 null
  linkId        String?   // 可选:优惠码经某条短链/QR 派发
  status        String    @default("issued") // 'issued' | 'redeemed' | 'clawed_back' | 'void' | 'expired'
  issuedAt      DateTime  @default(now())
  redeemedAt    DateTime?
  clawedBackAt  DateTime?
  startsAt      DateTime? // 有效期起(读时判过期,永不后台 job;同 BrandRecord offers 手法)
  endsAt        DateTime?
  externalOrderId    String? // 核销对应的商家订单号(source-observed 真相锚点)
  redemptionEvidence String? // 'source_observed' | 'merchant_confirmed'(核销事实的证据级别)
  source        String    // 'otto' | 'owner'
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime?

  // 一条 raw partial UNIQUE INDEX ON (ownerId, code) WHERE deletedAt IS NULL 落 migration —— 每 owner 一个活码。
  @@index([ownerId, status, endsAt])
}
```

### 2.4 `SourceTag` —— 来源确认(扫码/点击 → 联系人打标)

```prisma
// 某人扫码/点链后又成为联系人(WhatsApp 找上门等),把「他从哪张码来」贴到这个主体上。
// CRM/Contact 尚未进 live 库(Sol 已核 schema),故 subjectRef 用 nullable 软引用形态承接:
// 现在挂 phone/wa_id/anon 会话键,CRM 落地后经同一列 scope 到 contactId,零迁移。
model SourceTag {
  id           String    @id // ULID
  ownerId      String
  organization Organization @relation(fields: [ownerId], references: [id])
  brandId      String?
  campaignId   String?
  subjectKind  String    // 'contact' | 'phone' | 'wa_id' | 'anon'(打标对象类型)
  subjectRef   String    // 未来 CRM contactId 软引用 | 电话 | wa_id | 匿名会话键
  linkId       String?   // 来源短链
  qrAssetId    String?   // 来源 QR
  voucherId    String?   // 在场的优惠码
  utmSnapshot  Json?     // 成为来源那一刻捕获的 UTM
  evidence     String    // 'source_observed'(扫/点已记录) | 'merchant_confirmed'
  firstSeenAt  DateTime  @default(now())
  source       String    // 'otto' | 'owner'
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  deletedAt    DateTime?

  @@index([ownerId, subjectKind, subjectRef])
  @@index([ownerId, linkId])
}
```

### 2.5 `AttributionEvent` —— 归因流水(证据只到 attributed,结构性禁 incremental)

```prisma
// 只进不改的流水账(append-only),承载全部量测事件。核心纪律(R5 D4):evidence 是**二值封闭集**
// { 'observed' | 'attributed' } —— 写入器**硬拒** 'incremental' 及任何集外值(fail-closed):
// L0 无对照实验,一个被核销的码永远不是「Otto 造成了这单」的证据。这与 ModelRegistryOverlay
// 「只能收窄、永不能加」同构:证据字段永远够不到 incremental 那一格。
// outcomeDelta 用**有符号增量**让退款回卷干净反冲(镜像 CreditLedger 的双 delta 可重建不变量):
// redeem 事件 +1,clawback 事件 -1,净归因 = Σ outcomeDelta。
model AttributionEvent {
  id           String    @id // ULID
  ownerId      String
  organization Organization @relation(fields: [ownerId], references: [id])
  brandId      String?
  campaignId   String?
  kind         String    // 'scan' | 'click' | 'source_tag' | 'redeem' | 'clawback' | 'outcome_link'(封闭集)
  // 产生它的仪表(软引用,按 kind 至少一个非空):
  linkId       String?
  qrAssetId    String?
  voucherId    String?
  sourceTagId  String?
  // 证据:二值——'observed'(亲眼看到的事件)| 'attributed'(经启发式/模型关联到下游成果)。
  // 'incremental' 永久禁写。细鳞(源观测/商家确认/关联/模型归因)折进 evidenceRung 供内部报表,
  // 但对外报表桶只有 observed / attributed 两格。
  evidence     String    // 'observed' | 'attributed'(写入器封闭校验,拒 'incremental')
  evidenceRung String?   // 'source_observed' | 'merchant_confirmed' | 'associated' | 'model_attributed'(内部细分,永不含 incremental)
  outcomeDelta Int       @default(0) // +1 归因成果 / -1 回卷 / 0(scan/click/source_tag)
  valueMinor   Int?      // 订单金额(minor units,source-observed);未知则 null
  valueCurrency String?
  utmSnapshot  Json?     // 抄表那一刻的 UTM
  // 反滥用可观测性(§六 异常扫描)—— 只存粗粒度、隐私安全信号(PDPA,§十):
  geoBucket    String?   // 粗区域桶(国家/州),永不精确定位
  deviceBucket String?   // 粗设备类,永不指纹
  ipHashPrefix String?   // 截断+哈希,仅限速率/异常,不作身份
  idempotencyKey String  // 精确一次:'redeem:<voucherId>' | 'clawback:<externalOrderId>' | 'scan:<dedupHash>'
  occurredAt   DateTime  @default(now())
  createdAt    DateTime  @default(now())

  // 一条 raw UNIQUE INDEX ON (ownerId, idempotencyKey) 落 migration —— 精确一次(双 webhook / 双扫防重放)。
  @@index([ownerId, kind, occurredAt])
  @@index([ownerId, campaignId, occurredAt]) // campaign 级报表
}
```

**Organization 反向关系**(Seam 5 要求,否则 prisma generate 失败——fail-loud):`trackedLinks / qrAssets / qrPlacements / voucherTokens / sourceTags / attributionEvents` 六条 back-relation 加进 `Organization`;六个模型名加进 `packages/db/src/tenant-guard.ts` 的 `TENANT_MODELS`。

## 三、evidence 二值 + 结构性禁 incremental(D4 的模型落地)

- **对外报表只有两桶**:`observed`(我们亲眼看到的事件:扫码、点击、核销 webhook 到账)与 `attributed`(我们把事件关联到下游成果:这张核销码对应了这笔订单,但**不证明因果**)。
- **写入器封闭校验(fail-closed)**:`AttributionEvent.evidence` 只接受 `observed | attributed`,任何集外值(尤其 `incremental`)在写入路径被拒——**incremental 不是「暂不填」,是「永远填不进去」**。要拿到 incremental 必须有对照实验对象,而 L0 蓄意不含它。这与「验证先于花费」的 zod 门同一精神:危险状态在落库前就被挡。
- **细鳞不丢**:两脑证据阶梯的中间鳞(源观测 / 商家确认 / 关联 / 模型归因)存进 `evidenceRung` 供内部诊断,但**永不冒头到对外报表桶**,报表永远只显示 observed / attributed 两级(R5 §Q2:观测/关联/归因/增量在报表上永远分开、绝不默认把一条关联回执升级成 ROI 断言)。
- **回执语言绑定认识论动词**(R2 §V):observed → 「我看到 8 单」;attributed → 「其中 5 单带了这条链接——这是关联,不是 Otto 造成 8 单的证明」;永不用 "I know" 表推断。

## 四、安全六态

1. **开放跳转防护(目标 allowlist)。** `TrackedLink.targetUrl` 在**写入时刻**必过 allowlist:`targetKind ∈` 封闭类目,host ∈{owner 已验证的自有域 + 平台安全 host 白名单(wa.me / api.whatsapp.com / *.shopee.com.my / *.easystore.co / g.page / search.google.com 的写评深链 等)};**重定向时刻再校验一次**(纵深防御——库里的旧行也不放过)。任意用户裸传 host 一律拒。**后果**:少了这道闸,短链变钓鱼跳板(R5 险牌 15)。
2. **异常扫描告警(异地 / 异常设备量)。** 扫/点事件写粗粒度信号(geoBucket / deviceBucket / ipHashPrefix + 每链速率),异常侦测器发现异地激增 / 异常设备量 / 目的地漂移 → 告警(admin/cost 面 + owner 侧 NEEDS_ATTENTION 卡)。侦测可异步(Seam 6),**重定向热路径永远轻**。
3. **吊销后的用户体验(品牌中间页而非 404)。** `status='revoked'` 的链接/码,重定向到**商家品牌中间页**(owner 品牌 + 「此码已失效」+ 一个安全的下一步),**HTTP 200,不是死 404**。已吊销与从不存在**返回同一张中性品牌页**——不给存在性预言(no existence oracle;同存储层 `keyOwnerMatches` 返回 404 而非 403 的精神)。
4. **租户隔离(ownerId 全链)。** 六对象全 ownerId + 进 `TENANT_MODELS` + 每个 server action `requireOwner()` 开场、`gate.ownerId` scope 每查询。重定向 / 扫码端点是**公共匿名**的,但解析 (domain, slug) → link 在 server 侧完成,写事件一律 scope 到 `link.ownerId`(**永不信客户端传的 owner**)。slug/code 由 server 铸造 / 校验唯一,防跨租户枚举。
5. **幂等 / 防重放(精确一次)。** 核销 / 回卷 / 扫码经 `idempotencyKey` + raw UNIQUE INDEX 去重(双 webhook、双击、重投递都只落一笔)。这是「归因不虚高」的地基:一次核销被记两次 = 报表撒谎。
6. **凭证机密性与最小暴露。** slug/code 不可猜(默认随机 base62;vanity 码经校验且全域唯一);码内**不嵌 PII**;扫码信号只留粗桶、截断 IP、无指纹(PDPA,§十)。retention 有窗口,不长期囤明细。

## 五、不碰 FIKIRTIVE credits(与记账缝的关系,防接错线)

- **生成短链 / QR / 优惠码 / 来源标 = $0 确定性动作**,像 `schedulePosts` 只建 DRAFT——不调任何供应商、不 reserve/settle、**不走 Seam 3**。任何人若把 L0 生成接进 credit ledger 都是错的。
- **优惠码是商家的钱,不是我们的钱。** 折扣由商家承担、在商家店里核销;L0 只记录事实(v2.11「读取并验证:只读、永不代管、永不自建账本」)。**不建余额账本**——VoucherToken 是二值码状态,不是运行余额(R5 Q3 3.10「积分是第二条 money path」的规避:一次性码有「核销了没」的二值真相,没有余额;loyalty 积分余额永远只读自商家系统)。
- 未来若把「量测/归因面」做成付费席位功能,那是**席位**定价的事(costing 另行闭合),与 L0 生成即 $0 不冲突——**生成永远免费,像装水表不收钱,卖的是水**。

## 六、物理面风险对策(R5 Q3 3.7 采纳)

**问题**:贴纸可被覆盖 / 海报会过期 / 二维码可被恶意替换 / 开放重定向变钓鱼基础设施;**码一旦印刷,错误无法靠部署回滚**。

**对策**:
1. **可吊销性根植于「QR 永远编码短链」**:`QrAsset.linkId` 必填,码印的是短链 URL 不是 targetUrl。于是**撤链接 = 所有已印码集中跳品牌中间页**,不必回收实体也能立刻止血(逻辑吊销 < 秒级;物理召回是后续操作)。
2. **placement ledger(`QrPlacement`)**:每次物理放置留台账——`location`(贴哪)+ `version`(第几版)+ `printStatus`(DRAFT→PRINTED→DEPLOYED→RECALLED)+ `quantity`。码是「有版本、有位置、有撤销成本」的资产,不是一次性 API 副作用。
3. **一键吊销 → 品牌中间页**:owner/Otto 一个动作把 `QrAsset.status='revoked'`;所有 placement 逻辑置 RECALLED;扫码即见品牌中间页(§四.3)。
4. **召回流程(recall flow)** = 一张可执行清单,不是一个魔法按钮:① 撤链接(逻辑止血,秒级)→ ② placement ledger 全部 RECALLED + 记 `recalledAt` → ③ 生成一张 owner 侧「物理召回任务」(去门店/海报撕掉或覆盖旧码)→ ④ 需要重贴则新建 `version+1` 的 placement + 新 QrAsset(指向新链接)→ ⑤ 全程 ActionEvent 留痕(审计)。
5. **异常即触发**:目的地漂移 / 异常地区扫描 / 贴纸被换的信号(§四.2)直接喂召回流程的第①步——数字吊销可自动(fail-safe,§七),物理召回需人批(§七 approval 推导)。
6. **风险登记对齐**:R5 险牌 15「QR/短链物理攻击」的缓解四件套(一键吊销 / 品牌中间页 / placement ledger / 必要时召回实体物料)在此逐条落地。

## 七、量测即干预的自省(R5 Q3 3.8 采纳)

**问题**:优惠码为可归因而给折扣,会抬转化、压毛利,并**把 Otto 训练成偏好「容易量测的折扣动作」**——这不是 attribution 问题,是 measurement intervention(测量手段本身成了 treatment)。

**对策**:
1. **默认无折扣 token**:`VoucherToken.kind` 默认 `no_discount`(纯归因码,不改价);折扣码是 opt-in,且在 UI/报表标注为「测量 treatment,会改变购买行为」。首测优先无折扣(R5 首测口径)。
2. **报表看净值三件套,不只看核销数**:任何 voucher/attribution 报表**必须同屏**显示 {核销数、**净归因成果(回卷后)**、AOV、退款/回卷率、毛值 vs 净值};永远不把「X 次核销」单独当头条。这与 §三 evidence 二值一并构成诚实报表契约。
3. **Otto 自利偏置护栏**(R5 险牌 10):Otto 提折扣动作时**强制并列显示无折扣 / 不动手的替代**;不因「折扣好量」就偏推折扣。度量埋点:每结果 credits、付费动作占比、商家净贡献是否同步增长。
4. **文案纪律**:报表/回执只说 observed/attributed;永不「Otto 带来了这单」;折扣码泄漏 >10% 或净贡献下降 → 全部文案降级 observed、移除折扣 treatment、重建 holdout(R5 险牌 6 的止损动作)。

## 八、合规请评:L0 的一等消费者(Google 只给链接/二维码)

Google 请评不开放「代发评价」API,唯一合规路径是**给顾客一条链接 / 一张码**让其自愿留评——正好是 L0 的 TrackedLink(`purpose='review_request'`,`targetKind='gbp_review'`)+ QrAsset。三把锁(`docs/research/LEADER-PLAYBOOK-2026-07-10.md` 第三章 A / Birdeye)在 L0 落地:

1. **产品层锁——全量触达、无情感预检**:请评链接对所有顾客同一入口,**不做「先问满意不满意、只给满意的人发」的 review gating**。L0 结构上**不提供**按满意度分流请评对象的开关(拔掉即合规)。
2. **产品线隔离锁——奖励与请评永久分离(宪法第 8 条 v2.11 硬约束)**:`VoucherToken`(奖励)**永不可**挂在「写评价」动作 / `purpose='review_request'` 的链接上;奖励只能挂「成功转介绍 / 复购」。**这是硬拦不是建议**:凡试图把 voucher 与 review_request 关联的写入路径应被拒(fail-closed),对齐 v2.11「评价×奖励合体流永久不做——请评与奖励两线永久分离」。
3. **合同层锁**:「商家用请评功能不得 gating、须一视同仁」写进 FIKIRTIVE↔商家服务条款(抄 Birdeye §1.5)——本条属条款/法务面,L0 只保证产品层不给违规的技术手段。

> 诚实分级(playbook 第四章):目前无「Google 因请评 gating 处罚某具体商家」的可核实一手案例;这条线由 Google 系统性匿名执法,**是长期盯防的活风险,不是一次打勾的合规项**。L0 的职责是「结构上不给违规的手」,不是承诺豁免。

## 九、Parity + Otto 同一动作层(审批数学逐条推导)

**单一动作层**:UI 按钮与 Otto skill 调**同一** server action(宪法第 7 条);每个新 action 出生即登记 parity manifest(Seam 9,CI 硬拦)。读面(报表/仪表)配 free/read skill(读的对等,Otto 不做瞎子)。

**审批数学**:`needsApproval = (cost=spend) ∥ (effect=write ∧ reach=external)`。L0 全部动作 **cost=free**(生成 $0)、**reach=internal**(只写我们自己的库与重定向行为,不写第三方平台)——故**公式一律得 false**。信任是格子不是梯子(R5 §一.4):在公式之上按「动作类别 × 波及面 × 可逆性」**只加严、永不放松**(安全 > 效率),补一道**物理召回**的人工闸:

| 动作 | cost | effect | reach | 公式 needsApproval | 格子加严 | 结论 |
|---|---|---|---|---|---|---|
| 生成短链 / QR / 优惠码 / 来源标 | free | write | internal | **false** | — | **Otto 可代办,无审批** |
| 记录 source tag / 记录核销(source-observed) | free | write | internal | false | — | 自动,无审批 |
| **退款回卷 clawback** | free | write | internal | false | — | 自动,fail-safe(只会**下调**归因——诚实方向,永不需批) |
| 吊销**数字**短链 / void 优惠码(无印刷 placement) | free | write | internal | false | — | Otto 可代办(异常可**自动**吊销止血) |
| 吊销 QR(有 PRINTED/DEPLOYED placement)= **物理召回** | free | write | internal | *false(公式)* | **格子加严 → 需人工审批** | 物理召回不可逆、波及印刷物料,**人批** |
| 读报表 / 仪表 | free | read | internal | false | — | Otto 读对等 skill |

**推导要点**:
- **生成 = Otto 可代办**——正是 D4 期望的「先装表」体验:Otto 起草 campaign 时顺手把水表装好,不打断用户。
- **回卷 fail-safe**——clawback 只让归因**变小、变诚实**(把退款单从「成果」里反冲掉),朝安全方向,永不需批;理想由 source-observed 退款 webhook 自动触发。
- **物理召回是唯一人工闸**:公式说不用批(内部+免费),但撤一张印在 10,000 张贴纸上的码 = 高波及、不可逆的现实成本;格子据此加严为**人批**。这是「比公式更严」的收窄(宪法允许 overlay 只收窄),不是绕过公式的旁路。**建议做成一种审批卡**(Seam 8:可选新增 `MEASUREMENT_CARD` kind,Otto 提「建议召回可疑 QR」→ 人点批准 → 执行);数字吊销 / 生成不需要卡。
- **豁免归属**:L0 不碰 money-in(优惠码是商家↔商家顾客,不是用户给 FIKIRTIVE 充值,不触第 7 条 money-in 豁免;v2.11 释义②同理)。

## 十、验收 / 规模 / 假设台账

### 验收(一条码全链可点、可核实)
1. **端到端一条码走通**:Otto/owner 为 Raya 海报生成 `TrackedLink`(targetKind=`wa`)+ `QrAsset` → 渲染 QR PNG → placement DRAFT→PRINTED→DEPLOYED → 顾客扫码 → 重定向解析 + 写 `AttributionEvent(kind=scan, evidence=observed)` scope 到 owner → 顾客 WhatsApp 找上门 → 建 `SourceTag(subjectKind=wa_id, linkId=…)` → 发/核销 `VoucherToken`(店铺 webhook)→ 写 `AttributionEvent(kind=redeem, evidence=attributed, outcomeDelta=+1, externalOrderId)` → 报表显示「N 次 observed 扫码 + 1 单 attributed 核销」并带诚实文案 → 退款 → 写 `AttributionEvent(kind=clawback, outcomeDelta=-1)` → 净归因回落 → 报表显示净值不是毛值。
2. **开放跳转**:写入 off-allowlist 目标被拒(测试);重定向时刻二次校验旧行(测试)。
3. **吊销 UX**:吊销后的链接/码 → **品牌中间页(200)**,不是 404;从不存在与已吊销返回同一中性页(no existence oracle 测试)。
4. **物理召回**:吊销带 PRINTED/DEPLOYED placement 的 QR **需人工审批**;数字吊销 / 生成不需。
5. **租户隔离**:双 org 测试——A 读不到 / 撤不了 B 的链接/优惠码;重定向只把事件写给链接的 owner。
6. **精确一次**:双核销 webhook / 双扫码 → 只落一笔(partial-unique 测试)。
7. **诚实**:`evidence` 写 `incremental` 被拒(fail-closed 写入测试);报表文案不含「incremental / caused / 带来了这单」。
8. **PDPA**:扫码事件只存粗桶,无精确定位 / 无指纹 / 无原始 IP(断言测试)。
9. **请评合规**:`purpose='review_request'` 的链接**无法**关联 `VoucherToken`(fail-closed 测试);请评入口无按满意度分流的开关。

### 规模
- **短链重定向是唯一热路径**:解析 (domain, slug) → link 要极轻(行缓存 / 边缘友好);扫码事件写入 fire-and-forget 或异步入队(Seam 6),**永不阻塞跳转**。每链速率上限 + 粗去重窗防扫码洪水。
- **多域名就绪**(`domain` 列);placement ledger 低量;voucher/attribution 中量;report 走聚合读(可预滚合)。
- 与 X publishing 的 app 级配额不同:短链是**我们自己的**基础设施,无第三方 10k/24h 门,但仍须自我约束扫码写入量(反滥用 + 成本)。

### 假设台账(设计定稿闸门——平台真相研究前置,R5 全图先设计律)
| # | 假设 / 待拍板 | 现状 / 风险 | 谁定 |
|---|---|---|---|
| A1 | **短链域名选型**(如 `r.fkrtv.co` / 品牌短域 / 分市场域) | Meta/WhatsApp 可能把**陌生短链域**判 spam(playbook 第一/三章 anti-spam)→ 需可辨识的品牌域 + 声誉预热;成本/投递率待核 | **founder** |
| A2 | **扫码统计隐私口径(PDPA 2010,马来西亚)** | 可存:粗地理(国/州)+ 粗设备类 + 截断哈希 IP(仅异常);retention 窗口;不外卖。角色:扫码是顾客对**商家**的动作 → **商家是 data controller,FIKIRTIVE 是 processor**;呼应 Sol「连接营收 ≈ 顾客耳里的连接税务局」的税务恐惧,口径宜保守,merchant-confirmed 永远是一个诚实档位 | **founder + 法务** |
| A3 | **核销 / 退款事实来源** | 来自 EasyStore/Shopee webhook(source-observed)vs merchant-confirmed vs 人工。L0 定义对象;**喂数据的 connector 是渠道缝(Seam 4)按渠道分期**,不在 L0 范围 | 施工 plan |
| A4 | **CRM/Contact 尚未进 live 库** | `SourceTag.subjectRef` 用软引用承接(现挂 phone/wa_id/anon),CRM 落地经同一列 scope 到 contactId,**零迁移**——确认此软引用形态 | 施工 plan |
| A5 | **优惠码 vs 积分账本边界** | L0 只做**一次性营销码**(二值核销/回卷),**不建积分余额**;loyalty 积分永远只读自商家店铺(v2.11 永不自建账本 + R5 3.10)。确认此边界不被后续「口碑经济」环侵蚀 | **founder** |
| A6 | **vanity slug/code 政策** | 默认随机不可猜;是否允许 owner 自定义 vanity(如 `raya-sale`)+ 全域唯一校验 + 防跨租户枚举 | 施工 plan |
| A7 | **`MEASUREMENT_CARD` 卡类型是否要** | 仅物理召回审批需要卡(Seam 8 五道缝);生成/数字吊销不需要。确认是否本期就上卡,还是先用现成审批面 | 施工 plan |

### PR 切片(小批提交,每片独立可审)
1. **PR-L0a 对象与迁移**:六模型 + QrPlacement + raw partial-unique 索引 + TENANT_MODELS + Organization back-relations(全 $0,无重定向)。
2. **PR-L0b 短链重定向 + allowlist + 品牌中间页 + 扫码事件写入**(公共热路径 + 幂等 + PDPA 粗桶)。
3. **PR-L0c QR 渲染 + placement ledger + 一键吊销 + 召回流程**。
4. **PR-L0d 优惠码核销/回卷 + AttributionEvent 净值报表 + evidence 二值 fail-closed**。
5. **PR-L0e Otto 技能(生成/吊销/读表经 ports)+ parity 登记 + 请评护栏(voucher×review 隔离硬拦)**。
6. 异常扫描告警(Seam 6)可并入 L0b 或独立跟进。

---

**结尾:本 spec 为图纸,待 founder 过目后动工**(蓝图第五章第 1 条)。待拍板项:①短链域名选型(A1);②PDPA 扫码口径(A2);③优惠码/积分账本边界确认(A5);④`MEASUREMENT_CARD` 是否本期上(A7)。一切真实供应商/平台花费(若域名注册、短链服务采购涉费)逐笔问 founder(宪法 2)。
