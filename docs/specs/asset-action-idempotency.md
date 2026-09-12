# 图片动作防重复扣钱（幂等加固）规格书（S1）

> 状态: 已冻结 · v1
> 批准: https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1368 Founder 评论「S1 批准 asset-action-idempotency.md」(2026-09-12)
> 规格前缀: ASSET（验收编号 = ASSET-A1、A2…，全仓不得与其他规格撞前缀）

## 0. 一句话

图片详情面板与 Otto 模板窗里那些要花钱的动作（Regenerate / Animate / Edit / Template），同一次意图无论重发多少次都只扣一次钱；商家想再要一张，必须自己再按一次按钮。

范围＝两个缺口一起修：① 锚点（`assetAnchorGenerationId`）服务端校验归属；② 终态（DONE）之后的重放不再当「新购买」。本版做、挡 GO——**Founder 已裁 2026-09-12（#1359 场②）**。

## 1. 九问（S1 grill 的答案）

1. **商家做什么动作、看到什么结果？**
   - 商家在图片详情面板按 Regenerate（或 Animate / Edit），扣一次钱、出一单。
   - 生成途中网断、页面重连、浏览器刷新后自动重发同一次提交：回到**原来那一单**（进行中看进度，已跑完直接看结果），不再扣钱。
   - 商家自己再按一次同样的按钮：这是「再来一张」，新的一单、再扣一次钱。
   - 例：商家 Aisha 对一张椰浆饭照片按 Regenerate，手机进电梯断网，回到信号区页面自动重连——她看到的是刚才那一单的成品，余额只少了一次的钱。她觉得还想换个角度，再按一次 Regenerate，这次余额再少一次。
2. **入口在哪里？（列全，含深链）**
   - 图片详情面板 `apps/web/components/asset/DetailPanel.tsx:462 / :531 / :690`（regen / animate / edit 三个按钮）。
   - Otto 模板窗 `apps/web/components/otto/TemplateModal.tsx:287`（`assetOp = "template"`）。
   - 服务端唯一入口 `apps/web/lib/gen-actions.ts:434` `startAssetGen`；`ASSET_ACTION_OPS = ["regen","animate","edit","template"]`（`apps/web/lib/batch-idempotency.ts:348`）。
   - 不新增页面、不新增按钮、不新增深链。
3. **四态：空、加载、错误、成功各长什么样？**
   - 空：不适用（面板里本来就有这几个按钮，形状不变）。
   - 加载：沿用现有按钮加载态与进度；重放命中原单时直接落在原单的加载态或结果态，不出现第二条进度。
   - 错误：锚点不属于本工作区 → "That image isn't available in this workspace."（不建单、不扣钱）。重放命中一单已失败的原单 → 照原样显示那次失败，按钮可再按（再按＝新的一单）。其余错误文案不变。
   - 成功：与今天一致（出图/出片，余额扣一次）。
4. **数据从哪来、写到哪去？**（行号以主干 `368e9094` 为准，2026-09-12 只读核证员，见 #1045）
   - 幂等键仍**只由服务端算**：`assetActionKey(op, anchorGenerationId, request)`（`batch-idempotency.ts:373-387`，sha256 over `op + anchorGenerationId + canonicalJson(request)`），键形 `asset:<op>:<64 hex>`。
   - **改动一（锚点归属）**：`gen-actions.ts:444-453` 今天只校验 `assetAnchorGenerationId` 的类型与长度（`ASSET_ANCHOR_ID_MAX_LENGTH`），`:495` 直接把它喂进摘要；全仓 `/usr/bin/grep assetAnchorGenerationId` 只在这 5 行出现，**没有任何 prisma 查询确认这张 Generation 属于当前商家**。本规格要求：在算键、进 `startGen`、动账本之前，用服务端会话里的 `ownerId` 查一次该 Generation；查不到或不归本租户 → 拒收（$0、零 GenJob）。
   - **改动二（意图编号）——Founder 已裁 2026-09-12（场⑦）**：摘要里加一个「意图编号」（一次点击生成一次的随机串，类似 Stripe 的 idempotency key 惯例）。同一次提交的所有重发沿用同一个编号 ⇒ 同一把键；商家再按一次按钮 ⇒ 新编号 ⇒ 新键 ⇒ 新的一单。
   - **改动三（跨终态 once-ever）——索引覆盖全部状态，Founder 已裁 2026-09-12（场⑦）**：复用查询 `gen-actions.ts:807 / :1069` 今天只认 `status in ["QUEUED","GENERATING"]`；数据库侧 `20260612140000_genjob_idempotency` 的唯一索引带同样的状态谓词。本规格把 `asset:` 族的复用查询放开状态限制（任何状态都命中原单），并新增一条跨终态唯一索引，形状照 `20260617000000_genjob_cowork_idempotency_once`：`UNIQUE ("ownerId","projectId","idempotencyKey") WHERE "idempotencyKey" LIKE 'asset:%'`。
   - 迁移前先核历史是否已有同 owner+project+key 的多行（未公测，预期为零）；有则迁移**报错停下**，不静默丢行。fresh-database 验证必须过。
   - 旧口径同步作废：`gen-actions.ts:430-432` 那段「终态之后的重试是新的一次购买」的注释与 `apps/web/lib/__tests__/asset-idempotency-ledger.test.ts:288-316` 的绿测随施工改写（`:226`「换一张底图 ⇒ 各自独立的一单」仍然成立，不动）。
5. **碰不碰钱路（credits / 计费）？碰则幂等键是什么？** 碰。重复 RESERVE 就是重复扣商家余额。幂等键 = `asset:<op>:sha256(op + 锚点 + 意图编号 + 规范化请求体)`（示意；精确构造以 `batch-idempotency.ts` 现行实现为准——含域分隔与长度前缀，施工勿照字面重算），由服务端算、调用方不许自带（`gen-actions.ts:440-443` 的拒收纪律不变）。命中原单一律**不新建 GenJob、不调 reserveCredits**，直接返回原单。价格、单价、计费口径一个字不动；账本单一权威仍在 `packages/core/src/spend.ts`。
6. **权限与租户边界是什么？** 租户身份只来自服务端会话（`ownerId` / `projectId`），客户端送来的任何编号都不作数。锚点归属检查就是这条边界的落地：客户端给的 `assetAnchorGenerationId` 必须在当前租户内查得到，否则 fail closed。复用查询与新唯一索引都以 `(ownerId, projectId, idempotencyKey)` 为范围，跨租户不可能撞键、也不可能读到别人的单。双租户测试覆盖 ASSET-A1。
7. **参考对照：抄哪家？** 不适用：加固类规格，无 UI 参照（不改版面、不加按钮）。工程惯例参照 Stripe 的 idempotency key：键由调用方按「一次意图」生成，同键重放永远拿回第一次的结果。
8. **胃口：轻／中／重挡，为什么？** 重挡：碰钱路、带数据库迁移、且改变商家可见行为（原本会扣第二次钱的重放不再扣）。胃口两天（含迁移、双租户测试与一条端到端旅程）。超过就先砍 `template` 一支（只做 DetailPanel 三个动作），其余不砍。
9. **Otto 怎么协助这个功能？** 不给 Otto 新能力。Otto 的模板动作与人工面板共用 `startAssetGen` 这一层，因此自动继承同一把键与同一条防重复规矩（ASSET-A9）。

## 2. 验收表（S5 只认这张表；一行一个可当场演示的判定）

| 编号 | 商家做 X | 看到 Y |
|---|---|---|
| ASSET-A1 | 商家 A 在详情面板按 Regenerate，请求里的 `assetAnchorGenerationId` 被换成商家 B 的一张图的编号 | 请求被拒，面板显示 "That image isn't available in this workspace."；数据库里零新 GenJob、账本零新行、余额不变 |
| ASSET-A2 | 商家对自己工作区里的图按 Regenerate（正常路径） | 正常出一单，余额扣一次；锚点检查不误伤任何合法动作 |
| ASSET-A3 | 第一单已 DONE 之后，原样重发同一次提交（同一意图编号） | 拿回原来那一单的结果，不新建 GenJob，账本零新行，余额不变 |
| ASSET-A4 | 商家在面板上**再按一次** Regenerate（同一张图、同样提示词） | 新的一单、账本一条新的 RESERVE，余额再扣一次 |
| ASSET-A5 | 生成中断网，页面重连自动重发同一次提交 | 回到同一单的进度，页面上只有一条进度条，账本零新行 |
| ASSET-A6 | 同一把 `asset:` 键并发两次落库（第一单已 DONE） | 第二次被数据库唯一索引挡掉，零新 GenJob、$0 |
| ASSET-A7 | 跑完 A3、A4、A5 后核对账本（钱守恒） | 余额减少量 = 该期间 RESERVE/SETTLE/REFUND 净额 = 实际生成次数 × 单价；无悬挂 reserve、无重复 settle |
| ASSET-A8 | 一单 FAILED（钱已退）后商家按一次重试 | 允许新的一单、扣一次钱；余额与账本对得上，退款那一行不被抵消或重复 |
| ASSET-A9 | Otto 模板窗发起模板动作后原样重发同一次提交 | 与 A3 一致：命中原单、账本零新行 |
| ASSET-A10 | 在全新数据库上跑迁移并执行 A3、A4 | 迁移成功、唯一索引存在（谓词 `LIKE 'asset:%'`），两条验收行为一致 |

## 3. 不做（非目标；写明为什么和触发条件）

- 不动画布族（`canvas:`）与 cowork 族（`cowork:`）的键与索引：它们各有自己的规矩，本票只修 `asset:` 一族。
- 不改价格、单价、计费口径与任何金额常量：这票是防重复扣钱，不是调价。
- 不做全局请求级幂等中间件：YAGNI，今天只有这一族出问题；哪天第二族出同样的洞再提。
- 不加新按钮、不做「再来一张」独立入口：再按一次现有按钮就是再来一张。
- 不做历史数据回填或清理：未公测、零商家数据（`docs/specs/` 外的判断依据见 #1045 现状核证）；若迁移时真发现重复行，停下报 Founder。

## 4. 异议栏

- 最大风险在「意图编号」活多久：它生在浏览器，服务端无法验证。存得太短，商家刷新后的自动恢复会被当成「再来一张」，又扣一次钱；存得太长，商家真想再来一张时会被当成重放，按钮像坏了。这条边界靠 ASSET-A3（重放不扣）与 ASSET-A4（再按要扣）两行从两个方向夹住；施工时必须明写编号的存活范围（建议：这一次提交的内存 + sessionStorage，提交落地即丢弃），不能留给实现随手决定。

## 5. 变更登记（冻结后的中途想法只进这里，下次 S5 批量裁决；不当场执行）

| 日期 | 想法 | 裁决（留空待 S5） |
|---|---|---|

## 6. 改签记录

- 无

<!--
起草说明（S1 未冻结，供场⑦拍板）：
- 「本版做、挡 GO」= Founder 已裁 2026-09-12（#1359 场②）；两个缺口都修亦为已裁范围。
- §1.4 改动二「意图编号 / 显式新键」与 §1.4 改动三对 FAILED 的处理：Founder 已裁 2026-09-12（场⑦），本稿按推荐立场落笔。
-->
