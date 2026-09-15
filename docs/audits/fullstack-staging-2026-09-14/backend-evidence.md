# 第三轮：后端只读交叉核证

## Brand 新建商品同步到 Library（2026-09-14）

范围：主线程通过正常 staging UI 新增虚构商品 `R3 Test cup 中文 20260914`，价格 `RM 39`。本 worker 仅读取 staging，未创建、修改或删除数据。连接目标沿用 `environment-investigation.md` 已证明与 staging web 相同的专用数据库；CLI显式指定 staging/Postgres/FIKIRTIVE项目；连接信息只在内存。SQL 使用 `BEGIN READ ONLY`，查询后 `ROLLBACK`。

先查 `packages/db/prisma/schema.prisma:81`、`:918`、`:1161`：Entity 是商品身份；BrandRecord 是价格等附属资料，以 `(entityId,ownerId)` 复合关系指向 Entity；CreditLedger 以 orgId 归属租户。未查询邮箱、验证码或会话。

| 现场证据 | 结果 |
|---|---|
| 精确名称的 Entity | 恰好1行，PRODUCT，未删除 |
| Entity ID | `01M2F1H4D40H6ZEFPQ9FX6Z3RB` |
| 测试租户 | `org_cmts923pm00002mptbuoube0j` |
| 创建时间（DB原始UTC timestamp） | `2026-09-14 04:06:45.419` |
| 同租户关联 BrandRecord | 恰好1行，kind=product，未删除 |
| BrandRecord ID | `01M2F1H4DGMWFX6QACEM8GS6VQ` |
| BrandRecord.entityId | 与上述 Entity ID 相同 |
| BrandRecord.nameKey | `r3 test cup 中文 20260914` |
| BrandRecord.data | 仅 `{"price":"RM 39"}`，没有第二份商品名称 |
| BrandRecord 创建时间 | `2026-09-14 04:06:45.428` |
| ReferenceImage 数量 | 0 |
| 此租户创建时刻前后各2分钟 CreditLedger | 0行；balanceDelta合计0；reservedDelta合计0 |

结论：现场新商品只有一个精确名称的身份，价格记录指向同一身份及同一租户，零关联图片；该次新增附近没有此租户账本变动。结合主线程 Brand 计数1→2、Library Products同名且0 linked images的现场，可交叉证明两处看到的是同一新增商品。这里的零账本只覆盖 `[04:04:45.419,04:08:45.419] UTC`，不外推其他时段，也不宣称所有免费动作已验证。

主线程原拟从 Library 改名，但 dialog 没有编辑入口，因此此阶段未改名；后续若从 Brand 改名，另行追加同一ID的前后核证。

CodeGraph: not used — worker独立worktree依规则直接读schema；事实来自限定范围的只读SQL。

## Brand 改名后保持同一商品身份

主线程随后从 Brand 提交 `R3 Test cup revised 中文 20260914`。同一 staging 数据库、同一 READ ONLY 方式，SQL用上文已识别 Entity ID＋ownerId 限定：

- Entity ID仍为 `01M2F1H4D40H6ZEFPQ9FX6Z3RB`；name为新名称；createdAt不变，updatedAt=`2026-09-14 04:08:29.691` UTC。
- 同租户 BrandRecord ID仍为 `01M2F1H4DGMWFX6QACEM8GS6VQ`，entityId未变；nameKey同步为 `r3 test cup revised 中文 20260914`；data仍仅 `{"price":"RM 39"}`；updatedAt=`2026-09-14 04:08:29.694` UTC。
- 限定该tenant、同时查询新旧精确名称：新名称恰好1行，旧名称0行，未靠创建第二商品实现改名。
- 该tenant修改时刻前后各2分钟 `[04:06:29.691,04:10:29.691] UTC` 的CreditLedger为0行，balanceDelta与reservedDelta均0。

这闭合了数据库的身份持续性与两份资料同步；Library新名称是否显示由主线程真实UI现场单独判定，本文不替代该观察。
