# Brand 产品身份 规格书（S1）

> 状态: 已冻结 · v1
> 批准: https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1313 Founder 评论「S1 批准 brand-product-identity.md」(2026-09-09)
> 规格前缀: PRODID（验收编号 = PRODID-A1、A2…，全仓不得与其他规格撞前缀）

<!--
来源：E2E Round 1 FSE-007（creation-engine.md §5 :168，Founder 2026-09-09 裁「下一场开 S1 grill」）。
决策记录：整理地图 #1304 子票 #1305（Founder 2026-09-10 逐题拍板）。备料事实见 #1305 评论。
-->

## 0. 一句话

商家在 Brand 页、Library、Otto 对话或网站理解里建的产品，是同一件东西：一处建，Library Products、@Products、确认卡、Otto 记忆处处可用；改名换图一处改两边同步；删除一起消失、可一起恢复。

## 1. 九问（S1 grill 的答案，一问一答；答不出的那问就是还没想清楚的那块）

1. **商家做什么动作、看到什么结果？** 在 Brand 页「新增产品」填名字、主图、价格、卖点、分类，保存。Library Products 立刻出现同一张产品卡；画布 @ 输入产品名能选到它；确认卡与生成结果的谱系指向同一个产品；问 Otto「我店里卖什么」答的是同一份。
2. **入口在哪里？（列全，含深链）** 写入口四个，走同一条共享动作：`/brand` 产品分区「新增产品」与 `/brand/records`；`/library`「新建元素 → 产品」；画布 Otto 对话「记下这个产品」（saveProduct 技能）；网站／素材理解自动提取（先进草稿，商家确认后才建身份）。读入口：Library Products 栏、@ 菜单、确认卡、Otto 记忆「Your products」段。
3. **四态：空、加载、错误、成功各长什么样？** 空：Library Products 空态写「还没有产品，去 Brand 页或这里新增」；加载：列表骨架；错误：建产品整笔回滚、不留半条，提示重试；成功：两边同时出现，带同一个 id。
4. **数据从哪来、写到哪去？** 身份 = `Entity(type=PRODUCT)`：名字、主图（`baseAssetId` + `ReferenceImage`）。价签 = `BrandRecord(kind=product)`：价格、卖点、分类、链接、描述，新增 `entityId` 以复合外键 `(entityId, ownerId) → Entity(id, ownerId)` 指向身份。一条共享动作 `createProduct` 在一个事务里建两行；改名换图改 Entity（两边入口都可改）；价格卖点只改 BrandRecord（只在 Brand 页）。读路：Library、@ 搜索、确认卡读 Entity；Brand 五分区与 Otto 读 BrandRecord join Entity。@ 菜单来源标签由「Product · Otto IQ」改为「Product」。迁移：一次性回填——每条活跃 `BrandRecord(product)` 建对应 Entity 并把 `data.imageAssetId` 挂为主图；迁移前预检，发现跨租户或同名冲突即失败不落库；带 rollback.sql。
5. **碰不碰钱路（credits / 计费）？碰则幂等键是什么？** 建、改、删产品不扣 credits，不动 reserve / settle / ledger。产品作为参考进入生成时按 Creation 引擎既有规则计价，本规格不改。建产品的幂等键沿用既有 `(ownerId, brandId, kind, nameKey)` 查重转 update。
6. **权限与租户边界是什么？** `ownerId` 只来自服务端 principal；`BrandRecord.entityId` 复合外键由数据库拒绝跨租户连线（ADR 0002）；@ 搜索与 Library 只查本租户；双租户测试。
7. **参考对照：抄哪家？** Shopify 后台「Add product」：一件产品一个身份，Media、Price、Publishing「All channels」在同一张卡上，各销售渠道读同一条记录——https://mobbin.com/screens/16bd3aef-c6d9-48c9-a716-193482c90b57 。我们的「渠道」= Library、@ 引用、确认卡、Otto。
8. **胃口：轻／中／重挡，为什么？** 重挡：碰 schema 与迁移（M1 路径地板）、回填、共享动作、读路改标签、双租户测试、一条自动化旅程。估 3–4 天。Founder 2026-09-10 裁「不设上限，做完为止」（效果为王常令）。
9. **Otto 怎么协助这个功能？** `saveProduct` 与 `lookupProducts` 走同一条共享动作与同一读路；理解 worker 提取的产品先落草稿（`contextStatus` Draft），商家在 Brand 页确认后才建身份，Otto 在确认前不把草稿当事实。

## 2. 验收表（S5 只认这张表；一行一个可当场演示的判定）

| 编号 | 商家做 X | 看到 Y |
|---|---|---|
| PRODID-A1 | 在 Brand 页新增产品（名字、主图、价格） | Library Products 出现同一产品卡；该 BrandRecord 的 `entityId` 等于卡片的 Entity id |
| PRODID-A2 | 在画布输入 @ 加产品名 | 菜单出现该产品，来源标签为「Product」；选入确认卡后，生成结果谱系的 `approvedEntities` 指向同一个 Entity id |
| PRODID-A3 | 在 Library「新建元素 → 产品」 | Brand 页产品分区出现同一产品，价格卖点为空待填 |
| PRODID-A4 | 在 Library 改名或换主图；再在 Brand 页改名或换主图 | 另一边同步显示（同一行 Entity），无第二份名字或图 |
| PRODID-A5 | 在 Library 元素页找价格、卖点、分类的编辑入口 | 没有；这三项只在 Brand 页可改 |
| PRODID-A6 | 在 Brand 页删除产品；再在 Library 恢复它 | Library 该元素随删随消失、随恢复回来；反向亦然；已生成的成片不动 |
| PRODID-A7 | 对 Otto 说「记下产品 X」；另让网站理解提取一个产品但不确认 | 前者两边出现；后者在确认前不出现在 Library 与 @ 菜单 |
| PRODID-A8 | Founder 当场跑迁移前后两条计数 | 活跃 `Entity(PRODUCT)` 数 ≥ 迁移前活跃 `BrandRecord(product)` 数，且每条 `BrandRecord(product).entityId` 非空；预检对一条人造跨租户行报错且不落库；fresh DB 迁移无错 |
| PRODID-A9 | 用租户 B 的账号在 @ 菜单与 Library 找租户 A 的产品；再直接构造指向 A 产品的 `entityId` 写入 | 找不到；写入被数据库拒绝 |
| PRODID-A10 | 建、改、删产品各一次后看余额与账本 | 余额不变，账本零新行 |

## 3. 不做（非目标；写明为什么和触发条件，防「遗漏」误会）

- 产品变体 / SKU / 库存——不是营销工具的活；触发 = 商家提出且与商务连接规格一起立项。
- 新的多图管理 UI——主图之外的图用 Library 元素页现有 `ReferenceImage`；触发 = Round 2 走查发现商家找不到。
- 价格进计费或报价——价格只是营销事实；触发 = 商务功能规格。
- CRM / 订单关联——Otto IQ 词条已写「按 id 链、不复制」；触发 = CRM 出 beta 门。
- 同名旧产品自动合并——回填预检报出，人工处理；触发 = 真实商家数据出现批量冲突。
- Otto IQ 其它记录（segment / offer）——本规格只动 product。

## 4. 异议栏（AI 必填：本规格最大的风险或异议，一条即可；真没有就写「无异议」——套话算违规）

- 最大风险是回填迁移在生产跑一次不可逆，而生产里是 Founder 自己的数据。对策：迁移前预检（跨租户、同名冲突即失败）、`rollback.sql`、既有每日库备份（`docs/runbooks/db-backup.md`）；执行前 Founder 另行确认。第二风险：四个写入口只要有一处绕过共享动作，两套真相就回潮——加围栏测试「除 `createProduct` 外无人能 `brandRecord.create(kind=product)`」。

## 5. 变更登记（冻结后的中途想法只进这里，下次 S5 批量裁决；不当场执行）

| 日期 | 想法 | 裁决（留空待 S5） |
|---|---|---|
| 2026-09-10 | PR #1337：回填只做「价签 → 身份」一个方向，存量 Library 里已有的 PRODUCT 元素（商家自己建的）没有价签，Brand 页看不到它们，待裁 | |
| 2026-09-10 | PR #1337：迁移预检②（同租户同名活跃 Entity）在开发库上 100% 命中 —— 同名的 Library 产品与 Brand 价签要不要一次性链接，待 Founder 裁 | **Founder 2026-09-10 裁（#1321 评论）：一次性链接**。同店（同 ownerId）且 nameKey 相同的活跃 Library 产品卡恰有一张时，价签直接指向它、不新建身份，价签主图挂到该卡（仅当它自己没有主图）；两张以上同名才拒绝并报出（整条迁移不落库）；没有同名的照旧新建。只限这次迁移，运行时新增同名仍不自动合并（§3 不变）。落地 PR #1337（`packages/db/prisma/migrations/20260910120000_brand_product_identity/migration.sql` 预检②；验收 PRODID-A8 三例） |
| 2026-09-10 | PR #1337 判官第 4 轮：产品的**两个删除方向都不再清扫封面字节**（`deleteBrandRecord` 原本就不清扫，本轮 `softDeleteEntity` 也跟上）——理由是 `restoreBrandRecord` 能把行接回来，而字节删了接不回来（fail open）。代价：商家删掉的产品卡仍占着存储字节。「两边都删了才清扫」要不要做、什么时候做，待裁 | |
| 2026-09-10 | PR #1337 第五轮：`BrandRecord.data` 不再承载 `name` / `imageAssetId`，身份（`Entity`）成为名字与主图的**唯一源**（写路入库前剥掉这两个键，读路一律 `withProductIdentity` 从身份取，`nameKey` 列保留作去重索引、值取自 `Entity.name` 归一化）；回填把这两格搬进身份，同名一次性链接照 Founder 2026-09-10 裁（#1321）；两个方向的删除均**不清扫**封面字节（fail open），「两边都删才清扫」待 S5 裁 | |
| 2026-09-10 | **PRODID-R1**（登记编号）票 #1322：`updateEntity` 的类型守卫 —— 底下挂着**活价签**的 `PRODUCT` 卡不许改成别的类型（改了就是「Brand 页有这件产品、Library 里它不是产品」）。数据库那条 CHECK 只管「product 行有没有 entityId」，管不到那一行是什么 `type`。落地在 PR #1337，本票只把借着 PRODID-A1 的那条测试改挂这个登记编号 | |
| 2026-09-10 | **PRODID-R2**（登记编号）票 #1322：删掉一件产品**唯一**那张照片时，字节真删（`softDeleteReferenceImage` 把封面一起清掉，两个面同时变成「这件产品没有封面」，照 Founder 2026-09-03 裁「商家删掉一张参考照，存储桶里的字节也必须真的没了」，与演员、场景一个口径）。分界线是**有没有恢复入口**：删整件产品有（`restoreBrandRecord`，所以 fail open、字节留着），删一张照片没有。行为已在 PR #1337 落地，本票补登记 | |
| 2026-09-10 | **PRODID-R3**（登记编号）票 #1322：PRODID-A8 对**草稿行**的例外 —— CHECK `BrandRecord_product_needs_entity` 放行 `contextStatus = 'Draft'` 且 `entityId IS NULL` 的 product 行（规格 §1.9 / A7：确认前根本没有身份，「不出现在 Library 与 @」由数据本身保证）。所以 A8 那句「每条 `BrandRecord(product).entityId` 非空」读作「每条**非草稿**的 product 行」；迁移每一步都带 `contextStatus <> 'Draft'` | |
| 2026-09-10 | **PRODID-R4**（登记编号）票 #1322：存量 Library 里商家自己建的 `Entity(PRODUCT)` **没有价签**时 Brand 页看不到它们（回填只做「价签 → 身份」一个方向）；此时商家在 Brand 页新增一个同名产品，`createProduct` 的查重只看价签的 `nameKey`，于是会**新建第二个身份**，同名的两张 Library 卡并存。运行时不自动合并是 §3 明写的（一次性链接只限那一次迁移），所以这不是 bug 而是一条待裁的边：要不要给这些无价签的卡补一条空价签（反方向回填）／要不要在新增时按 `Entity.name` 也查一次重。**本票不改**，待 Founder 裁 | |
| 2026-09-10 | **PRODID-R5**（登记编号）票 #1322 判官 P2-b：核心不变量「非草稿的 product 价签不承载 `name` / `imageAssetId`」加**机器闸** —— 迁移 `20260910140000_brand_product_data_identity_gate` 的 CHECK `BrandRecord_product_data_has_no_identity`（`kind <> 'product' OR contextStatus = 'Draft' OR NOT (data ? 'name' OR data ? 'imageAssetId')`）。两个选项里选数据库 CHECK 而不是源码围栏：`BrandRecord` 的写路散在四个包，静态判据分不清「这一句写的是产品还是受众」，要么误报要么漏报；约束不需要分辨调用者。**回滚按时间倒序**：先跑这份的 rollback（只丢约束），再跑 20260910120000 的 rollback（它的 ①.5 要把两格写回价签） | |
| 2026-09-10 | **PRODID-R6**（登记编号）票 #1322 判官 P2-a：`saveBrandRecord` 的产品更新分支原先无条件把客户端 `data.name`／`data.imageAssetId` 当改名换图意图递给共享动作。可读路 `withProductIdentity` 会把身份那两格**补进** `data` 交给界面，于是归档、换封面、撤销一次 Otto 改动这三条与名字无关的路，手里都攥着一份可能过期的快照 —— 一次归档就能把商家刚改的名字打回去。改成显式 `identity` 意图：哪一个界面真的在编辑这两格，就由它自己交上来（Brand 页整张产品表单交两格；换/清封面只交主图；归档、撤销、Otto、理解 worker 一格都不交） | |
| 2026-09-10 | **PRODID-R7**（登记编号）票 #1322 判官 P2-e：`rollback.sql` ③ 前置原先用 `e.baseAssetId = ri.assetId` 判「这一格是不是本迁移写的」，判不准 —— 卡在 up 之前就把这张图当封面、而那条硬引用已被软删时，回滚会把**商家自己挑的**封面擦成 NULL。迁移未在生产跑过，故本票直接修 `rollback.sql`（只改 rollback 与演练，`migration.sql` 一个字节没动）：再排掉「这张卡除本迁移那一条外从来没有过指向这张图的引用行（含软删）」。今天所有写 `baseAssetId` 的路径都要求先有一条 `ReferenceImage`，所以这个判据是精确的 | |
| 2026-09-10 | **PRODID-R8**（登记编号）票 #1322 判官 P2-c：名字槽位已被新的那件占住时，`restoreBrandRecord` 给的是一句按 `kind` 分的人话，而不是一次被 catch 吞成「请重试」的 P2002。落地在 PR #1337，本票只把那条借着 PRODID-A6 的测试改挂这个登记编号 | |

## 6. 改签记录

- 无
