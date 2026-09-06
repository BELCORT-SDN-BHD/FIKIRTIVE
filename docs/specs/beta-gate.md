# 上线闸规格书（S1）

> 状态: 草稿
> 批准: 待 Founder grill 后签
> 规格前缀: GATE（验收编号 = GATE-A1、A2…，全仓不得与其他规格撞前缀）

<!--
本文件是「上线闸」这件事本身的规格草稿，不是某一个产品功能的规格。
它把 13 张仍然 open 的上线相关 issue 收成一张可当场演示的验收表，
让「能不能开闸」这个判断有单一权威，而不是散在十三张票、几十条评论里。

素材＝以下 13 张 open issue（每张已亲自读过票面与全部评论）：
#317 #464 #479 #850 #861 #871 #961 #980 #1045 #1052 #1053 #1055 #1057
正文不抄 issue 全文，每行末尾带 issue 链接作证据。

现状证据的取样点：本分支 base = origin/main `3340107c`（2026-09-07）。
行号会随主干漂移，引用前请重新 grep 复核（本仓一贯纪律：
memory 是缓存，Git 与当前代码才是权威）。

状态是「草稿」：本文件尚未冻结，不得被任何产品 PR 引用为 `Spec:`。
-->

## 0. 一句话

把「能不能开公开 beta」从十三张票的口头判断，变成一张 Founder 当场逐条演示就能勾的清单——勾满即开闸，没勾满就说得出差哪一条、差多少。

## 1. 九问（S1 grill 的答案，一问一答；答不出的那问就是还没想清楚的那块）

1. **商家做什么动作、看到什么结果？**
   本规格的直接对象不是商家，是 Founder 与开闸执行者。商家侧的可观察结果是**开闸之后**的：公开注册的任何一位商家，在别家商家同时生成、在自己重放一次付费请求、在把预览链接发出去之后，都不会看到别家的数据、不会被重复扣一次钱、不会等一整条别人的视频。这三件事就是 GATE-A1/A2/A3、A5/A9、A11 存在的理由。

2. **入口在哪里？（列全，含深链）**
   - 权威清单：本文件 §2 验收表。
   - 门项来源台账：https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/850 （Founder 2026-08-11 亲定，含「退出 beta 门」名单，原样收在 §3）。
   - 开闸动作本身没有 UI 入口：它是 Founder 的一句话，前置是本表逐条演示通过。

3. **四态：空、加载、错误、成功各长什么样？**
   本规格无 UI 表面。对应到清单的四态是：
   - 空＝一条验收都没演示过（今天的状态）；
   - 加载＝某条正在修，票面 open、演示脚本已备但未跑；
   - 错误＝演示当场失败，该条打回，按手册在功能 issue 写「S5 打回 GATE-A<n>」；
   - 成功＝十三条全部当场演示成立，Founder 勾满。

4. **数据从哪来、写到哪去？**
   演示证据从生产或本地真库现场取，不从文档取。每条验收都要求「怎么当场演示它成立」是一条可复跑的命令或一段可目击的操作，而不是一句「已修复」。证据落在对应 issue 的关票评论里；开闸判定落在 #850 与本文件 §2 的勾选状态里。

5. **碰不碰钱路（credits / 计费）？碰则幂等键是什么？**
   碰。GATE-A9（资产生成幂等）与 GATE-A12（provider 缺配置仍编造事实并结算）都直接落在钱路上；GATE-A13（报警管道）落在「钱出事时人能不能知道」这一层。幂等键的现行形状是服务端从动作素材派生的 `assetActionKey`（`apps/web/lib/batch-idempotency.ts:351`），A9 要解决的正是它今天仍吃客户端可控的两个盐。本规格自身不新增任何幂等键，也不改任何定价。

6. **权限与租户边界是什么？**
   本规格自身不引入新的权限面。它统摄的三条租户边界票是 GATE-A1（数据库层共租户复合外键）、GATE-A2（请求级身份帧第二段）、GATE-A3（`requireRole`/`requireSession` 入口要不要建帧）。三者共同的判定标准：**跨租户连线要么在数据库层物理不可能，要么在守卫层无帧即拒——不能只靠「每个写路径都记得校验」。**

7. **参考对照：抄哪家？（Mobbin 截图或链接，稿上注明）**
   不适用——本规格没有界面。流程形状照抄本仓已有的做法：#850 的门清单形态（Founder 2026-08-11 亲定）＋《开发作业手册》S1–S5 的验收表形态（`docs/specs/TEMPLATE.md`）。

8. **胃口：轻／中／重挡，为什么？**
   本文件本身是轻挡（新增一份草稿规格，零商家可见行为变化）。**它统摄的十三条各自的挡位不由本文件决定**：碰钱路／迁移／登录租户／新路由的（A1、A2、A3、A8、A9、A12）一律走重挡另立规格或引用已冻结规格，本表只负责判「成没成」，不负责授权怎么做。

9. **Otto 怎么协助这个功能？** 不适用。上线闸是人的判断，不下放给 Otto。

### 待 grill 项（答不出的，明写）

- **① 冻结预览契约（#1053 第 2 条，Founder 拍板题）**：`/schedule/share-preview` 链接今天看到的是**实时最新内容**（现码 `apps/web/lib/share-preview-view.ts:110-120` 每次都重读当前 post 行）；而已归档的 B0-28 契约明确要求分享链接必须**冻结**媒体／文案／账号／时间／模式。链接发出去之后原内容被编辑成别的东西，拿着旧链接的人现在看到的是新内容。两条路二选一：(甲) 保留「发出去就冻结」的旧承诺——需要给分享绑定版本号或快照，改动较大；(乙) 正式改成「分享链接看的是实时内容」——需要在分享页明确告知查看者内容可能已变化，改动小。**这个选择决定 GATE-A11 里那一条要不要动代码、动多大**，在 Founder 拍板前 A11 无法定形。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1053
- **② GATE-A1 的回填范围**：共租户复合外键立为房规之后，是「只对新对象适用、旧外键另排期」，还是「按表族分批回填全部裸外键」？Founder 2026-07-26 已裁「紧随请求级身份守卫落地、与其同属上线前门槛」，但回填口径未定死。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/317
- **③ GATE-A3 的存废**：`requireRole`/`requireSession` 那批入口要不要建身份帧，Founder 从 2026-07-27 拆票起未裁。不裁的话这一条既不能勾也不能删。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/479
- **④ GATE-A6 的挡门层级**：媒体零备份，#871 票面建议「R2 versioning 一键开启的部分进 beta 门，跨区复制 GA 前」，但挡不挡 beta 明写「由 Founder 裁」，至今未裁。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/871
- **⑤ GATE-A7 的采购**：第二 worker 服务是一笔采购（新增 Railway 服务资源）。Founder 已裁「beta 后开闸前启用，报价先行」，但报价尚未呈批，因此这条的**触发时点**（开闸前的哪一步）还没定。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/961
- **⑥ 十三条之间的顺序**：A2（建帧）与 A1（复合外键）在 #464 契约里是硬顺序（先建帧、后执法），A3 依赖 A2 的口径。其余十条是否可并行、要不要切成几波，待 grill 时定。

## 2. 验收表（S5 只认这张表；一行一个可当场演示的判定）

| 编号 | 商家做 X | 看到 Y |
|---|---|---|
| GATE-A1 | Founder 当场跑 `grep -c "references: \[id\]" packages/db/prisma/schema.prisma`，再让一个 agent 试着把 A 租户的子对象外键指向 B 租户的父对象并提交 | 计数为 0（或收敛到 Founder 裁定的白名单），且跨租户写入被**数据库**拒绝而不是被应用层拒绝。现状：主干 `3340107c` 上仍有 **75** 处裸 `references: [id]`（复合形态已在同一份 schema 跑通，样本 `packages/db/prisma/schema.prisma:135`、`:160-162`、`:254`），跨租户连线今天靠写路径记得校验。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/317 |
| GATE-A2 | 当场跑两条计数：`grep -rn "await requireOwner()" apps/web --include="*.ts" --include="*.tsx" \| grep -v "__tests__\|\.test\." \| wc -l` 与同法的 `resolveUserPrincipal(` 计数；再挑一个未建帧的付费 action，在守卫层打开「无帧即拒」后跑它 | 两个数相等（全部生产站点都建了帧），且无帧调用被守卫拒绝而不是走兜底。现状：`requireOwner` 生产站点 **222**、已建帧 **92**，`packages/db/src/tenant-guard.ts:348` 文内自认「Older unframed call sites retain the explicit-ownerId backstop while they migrate」——落闸那一步（B4）没做。值比对与 op 扩容已在（`tenant-guard.ts:138-153`、`:217-218`、`:251`）。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/464 |
| GATE-A3 | 当场跑 `grep -rn "await requireRole(\|await requireSession()" apps/web --include="*.ts" --include="*.tsx" \| grep -v "__tests__\|\.test\."`，逐条对着 Founder 的裁决念「这条建帧／这条不建帧，理由是 X」 | 每一条都有 Founder 记录在案的归属，没有一条是「没人想过」。现状：生产站点 **20**（如 `apps/web/app/admin/reconcile/page.tsx:27`、`apps/web/lib/tenant-actions.ts:37`／`:69`／`:106`；定义在 `apps/web/lib/auth-guard.ts:24`、`:32`），Founder 自 2026-07-27 拆票起未裁。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/479 |
| GATE-A4 | Founder 打开 #850 门清单，与本文件 §2 逐条对照 | 两处不冲突：#850 上每一个「挡 beta」项要么已勾、要么在本表里有对应的 GATE 编号；「退出 beta 门」名单与本文件 §3 逐字一致。现状：#850 仍 open，票面清单最后一次实质更新为 2026-08-16 的审计工单化评论；本表是它的可演示化版本，不取代它的权威。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/850 |
| GATE-A5 | 用两个租户账号：A 连续入队 4 条长视频，随后 B 入队 1 条短图 | B 的开始时间不晚于 A 的第二条完成（票面钉死的测试形状）。现状：入队处 `apps/web/lib/gen-actions.ts:1179-1183` 只传 `{ genJobId }` 与队列 job id，无 tenant key、无 priority、无 group；消费端 `apps/worker/src/index.ts:217-222` 用的是全局 `localConcurrency`——A 占满槽 B 仍要排整条视频的队。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/861 |
| GATE-A6 | 在演练环境删掉一个商家已付费产物的对象，按 runbook 恢复它 | 该产物能恢复回来，且恢复路径像 #870 的数据库演练一样被跑过一次、留了证据。现状：备份只盖数据库——`apps/worker/src/db-backup.ts:192` 是 `pg_dump`，落到 `R2_BACKUP_*` 隔离桶（`packages/storage/src/index.ts:610-620`），账目落 `BackupRun`（`packages/db/prisma/schema.prisma:2597`）；媒体对象**零备份、零复制**，全仓找不到媒体侧的 replication 代码。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/871 |
| GATE-A7 | 在生产查两个 worker 服务各自的 `WORKER_ROLE`，然后各看一眼它们的启动日志 | 两个服务分别自报 `compute` 与 `wait`，队列分工与 `apps/worker/src/plan.ts:156-168` 的计划一致。现状：代码侧已就位且有回归基线（`apps/worker/src/plan.test.ts:64`、`:101`、`:113`），生产侧未设该变量（2026-08-16 脱敏实查，见票面）——#796 的拆分代码在生产休眠。本条含一笔采购，须报价先行。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/961 |
| GATE-A8 | 用受害者邮箱先自助注册设一个密码（不验证邮箱），再用验证码／魔法链接以该邮箱登录，然后拿第一步那个密码去登录 | 第一步那个密码登不进去（被作废或被要求重设），而不是因为 `emailVerified` 被翻真就静默生效。现状：`apps/web/lib/better-auth/server.ts:129` 的 `requireEmailVerification: true` 只挡住未验证密码本身建会话，`emailOTP` 插件（同文件 `:400`）成功登录时把 `emailVerified` 翻真之后，没有任何代码去作废那把未经验证的密码——公开注册放大这条 pre-hijack 面。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/980 |
| GATE-A9 | 对同一次 regenerate 提交两次、只改 `assetAnchorGenerationId`；再对同一 payload 在第一份 job 跑到 `DONE` **之后**重放一次 | 两次都只产生一条 RESERVE。现状：`apps/web/lib/gen-actions.ts:444-453` 只校验这两个字段的类型与长度，`:495` 就把它们喂进 `assetActionKey`（`apps/web/lib/batch-idempotency.ts:351`）当哈希输入——是客户端可控的盐；复用检查只覆盖活跃态（`gen-actions.ts:807`、`:1060`、`:1268`（cowork: 前缀键除外，它查全状态）），数据库部分唯一索引同样只覆盖 `QUEUED`/`GENERATING`（`packages/db/prisma/migrations/20260612140000_genjob_idempotency/migration.sql:12`），终态之后没有 once-ever 约束。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1045 |
| GATE-A10 | 在一台环境里带着 `STORAGE_DRIVER=r2` 与全套 `R2_*` 跑一次 e2e 上传旅程 | 测试 fixture 不可能落进生产桶——围栏在 web-server 启动**之前**就清空／覆盖了这些变量。现状：`e2e/support/env.ts:79-87` 的 `OFF_MACHINE_CREDENTIAL_NAMES` 里没有 `STORAGE_DRIVER` 与 `R2_*`，`appEnv()`（同文件 `:90-133`）只新增变量、不清除环境里已有的；`e2e/playwright.config.ts:58-68` 把 `appEnv()` 交给 webServer，而 `globalSetup`（`:35`）的守卫在那之后才跑。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1052 |
| GATE-A11 | 五件当场各演一次：① 对 `/api/media/pub/<token>` 发一个带 `Range` 的大对象请求；② 把已批准内容编辑成别的再打开旧链接；③ 在开了 `NEXT_PUBLIC_SENTRY_DSN` 的构建上让预览页报一次错，看 Sentry 里那条事件的 URL；④ 打开公开预览页找可点的导航；⑤ 吊销分享后立刻重放一条已复制的媒体 URL | ① 返回分段而不是把整个对象缓冲进 web 进程内存，且限流计数器不可用时是 fail-closed；② 按待 grill 项①拍板后的契约行事（冻结＝旧链接看不到新内容／实时＝页面明说内容可能已变）；③ 事件里没有 `?t=<bearer>`；④ 没有可点的导航、长内容不被裁切；⑤ 立刻失效。现状：④ 已修（`apps/web/app/schedule/layout.tsx:3-5` 已是透明壳）；① 仍整对象进 `Buffer`（`apps/web/app/api/media/pub/[token]/route.ts:67-68`）且限流不可用时放行（`apps/web/lib/rate-limit-gates.ts:240-245`，理由在 `:229-239`）——现码是刻意 fail-open 且写明了理由（HMAC 授权不碰数据库，DB 抖动时拒绝会打断商家已付费的发布），#1053 要推翻的是这个判断本身；② 仍实时读（`apps/web/lib/share-preview-view.ts:110-120`）；③ token 仍在 query（`apps/web/lib/schedule-actions.ts:628`），`apps/web/lib/sentry-browser.ts:32-44` 无 query 脱敏；⑤ 媒体 token 校验只信自身 HMAC 与 TTL（`route.ts:38-46`），不回查 share 行。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1053 |
| GATE-A12 | 在一台 `NODE_ENV=production` 的进程上，分别用「`GENERATION_PROVIDER` 没设」与「显式设成 `mock`」各跑一次素材理解 | 两次都当场拒绝并把预留退回，不产生任何被标 `DONE` 的理解结果、不写进租户 Memory。现状：生成管线已 fail-closed（`packages/generation/src/index.ts:252-267` 的 `UnconfiguredProvider`），理解管线没有——`packages/generation/src/understanding.ts:364-371` 在非 byteplus 时一律回落 `MockUnderstandingProvider`，同文件 `:347-361` 自己写明「这是一个已知缺口，别把这段注释读成已经安全」；显式 `mock` 至今仍是契约允许的合法值（`packages/core/src/env-contract.ts:492-504`）并在生产被 `packages/generation/src/index.ts:260` 直接采纳。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1055 |
| GATE-A13 | 让邮件／Telegram 通道在第一次派发时失败一次，然后等下一趟巡检；另外用一个格式合法但收不到东西的 DSN 发一条关键报警 | 下一趟巡检**仍会**重试人工通道（去重标记记的是「送达」不是「尝试过」），且那个假 DSN 不会被记成「已发送」。现状：`apps/worker/src/jobs/gen.ts:977` 在派发**之前**就写下永久标记（`claimPaidForNothingAlert`，同文件 `:793-800`），随后 `:994` 以 `{ repeat: !firstAlert }` 调用报警；`packages/core/src/founder-alert.ts:109-113` 的抑制分支**根本不调用**邮件与 Telegram——第一次瞬时失败即永久静音人工通道。DSN 侧：生产存在性已收紧为必需（`packages/core/src/env-contract.ts:956-963`），但校验仍只是 `format: "url"`，没有真实探测。https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1057 |

## 3. 不做（非目标；写明为什么和触发条件，防「遗漏」误会）

### 3.1 「退出 beta 门」名单——原样收录

以下名单**原文照录（标点按本文全角体例统一）#850 票面正文的「退出 beta 门（beta 期间继续 dev / GA 前置）」节**，来源：Founder 2026-08-11 裁定，https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/850 。它们不挡 beta，本规格不为它们立验收行：

- CRM 族全部（#496 同意投放语义、广播/工作流/收件箱深化）——beta 期 CRM 零真发，暴露面为零
- Meta 族：#299 商业验证、#554 应用重新启用、#607 删除段二（GA 前置；建议仍尽早启动，Meta 审核周期不受控）
- #585 邀请邮件（邀请制未选）
- E2E S3（真发 IG）、S5（CRM 全流程）、S7（广告）

一条 2026-08-12 的增补同属此列：**#778（人脸参考自动路由）退出 beta 门**——Founder 指示不用 1.5-pro、先直接上、权限在谈，当作没有这个问题；转 #359 延期台账，触发＝官方权限谈妥（来源同票 2026-08-11T18:07 评论）。

### 3.2 本规格自身不做的事

- **不代替 #850**：#850 仍是门清单的权威台账，变更须 Founder。本文件只把它可演示化，不改它的内容、不新增门项、不删门项。
- **不授权任何一条的实现**：本表只判「成没成」。碰钱路／迁移／登录租户／新路由的条目（A1、A2、A3、A8、A9、A12）各自另走 S1 冻结或引用已冻结规格，本文件不是它们的施工许可。触发条件＝任何一条要动产品代码时。
- **不裁待 grill 的六问**：§1 末尾那六项由 Founder 拍板，本草稿只把它们摆上桌。
- **不写任何价格字面量**：定价是 `docs/specs/money-engine.md` 的地盘。
- **不改任何代码、不改任何其他规格**：本 PR 只新增这一份草稿文件。

## 4. 异议栏（AI 必填：本规格最大的风险或异议，一条即可；真没有就写「无异议」——套话算违规）

**最大风险：这十三条不是同一种东西，硬凑成一张表会让最贵的那几条被最便宜的那几条稀释。**

具体地说：A1（回填约 75 处外键）、A2（约 130 个站点建帧再落闸）、A6（媒体备份基建）、A7（一笔采购＋一套新服务）是**周级**工作，各自都够得上一份自己的重挡规格；而 A10（e2e 围栏补几个变量）、A13 第一段（去重标记挪到送达之后）是**小时级**。把它们并排放在一张十三行的表里，读起来像十三件同量级的事，很容易在开闸那天变成「十一条绿、两条黄，那就开吧」——而黄的那两条恰好是周级的。

**我的建议（供 grill 时否决）**：本表保留十三行不动（它的价值就是完整），但在 Founder 拍板时**先给每一条标一个挡位与粗略工期**，再决定哪几条是硬门、哪几条转 #359 带触发条件。挡位一栏我没有替 Founder 填——那是产品方向判断，不是实现细节。

第二条较小的异议：A4（本表与 #850 对齐）在形式上是「一张表验另一张表」，它自身不产生新的安全或钱路保证。保留它的理由是本仓已经吃过「权威清单散在多处、谁也不知道以哪份为准」的亏；但如果 Founder 觉得它是仪式，删掉它并把 #850 直接钉成唯一权威也是干净的一条路。

## 5. 变更登记（冻结后的中途想法只进这里，下次 S5 批量裁决；不当场执行）

| 日期 | 想法 | 裁决（留空待 S5） |
|---|---|---|
| 2026-09-07 | 起草本文件：把 13 张 open 的上线相关 issue 收成 GATE-A1…A13 一张验收表，「退出 beta 门」名单原样收进 §3，#1053 的冻结预览契约列为待 grill 项①。零代码改动、零其他规格改动。 | — |
| 2026-09-07 | 草稿五处订正（G1）：① GATE-A2/§1 取样点 `tenant-guard.ts:349`→`:348`（行号漂移）；② 取样点基线 SHA `c8f0c1c4`→`3340107c`（本分支 base，两处）；③ §3.1「逐字取自」改「原文照录（标点按本文全角体例统一）」；④ GATE-A9 的 `gen-actions.ts:1268` 后补一句 cowork 前缀键除外说明；⑤ GATE-A11 ① 的限流现状锚点改到 `rate-limit-gates.ts:240-245`（理由 `:229-239`），补一句现码是刻意 fail-open。零代码改动、零验收表判定改动。 | — |

## 6. 改签记录

- 无
