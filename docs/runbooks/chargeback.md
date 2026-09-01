# 拒付(chargeback)处理

> 政策权威:`docs/specs/money-engine.md` 九问 5「拒付总法」+ 验收 MONEY-A13。
> 一句话:拒付 = 持卡人绕过我们、经自己的银行强制拉回已付款。我们**不建负余额、不做自动 clawback**(2026-07-04 alert-only 裁决维持),一切处置人工、逐案。

## 谁触发

- Stripe webhook `charge.dispute.created` 到达(`apps/web/app/api/stripe/webhook/route.ts`)。
- 你会收到:**founderAlert 三通道**(Sentry + 邮件 + Telegram)一条,标题带金额(如 `MYR 50.00`),正文带
  `orgId` / `orgAttribution` / `currency` / `paymentIntentId` / `disputeStatus` / `disputeReason`;同时落一条
  ActionEvent 审计行(`credits.dispute.created`,主键 `stripe_pullback:<Stripe event id>`——重投不会再来一封)。
  另有 Stripe 官方邮件。
- `orgAttribution` 说的是「这个商家是怎么认出来的」:`payment-intent`(新付款,结账时写在 PaymentIntent 上)/
  `checkout-session`(老付款,按 payment_intent 反查 session metadata)/ `event-metadata` /
  **`unresolved`**(三条路都没认出来——此时 `orgId` 显示 `unresolved`,审计行挂在 `founder` 名下,按下面「前置」第 1 条人工反查)。
- `charge.dispute.closed` 与 `charge.refunded` 是各自独立的报警(`stripe.dispute_closed` / `stripe.charge_refunded`),
  不会与开案那条混在一起。
- 收到任一渠道的拒付通知,即按本手册走。

## 前置(动手前先查清,查不到就停)

1. **认定商家**:报警自带 org。只有 `orgAttribution: unresolved` 才需要人工反查——Stripe Dashboard → Payments → 该笔付款 → 关联 Checkout Session → metadata 里的 `orgId`。
2. **认定金额与包**:拒付金额、对应哪个充值包、该笔在 `CreditLedger` 的入账行(`(orgId, idempotencyKey)`)。
3. **盘点该商家账本**:当前余额、该笔 credits 已花多少。账本结构不允许负数——已花掉的部分**无法倒扣**,那就是平台损失,走台账,不走自动化。

## 步骤

1. **账号级暂停**(Founder 2026-09-01 拍板的冻结形态):admin 面板对该 org 执行 org 级暂停——admin 面 → Tenants → 该商家 → 状态切 `suspended`。
   效果:该 org 全部成员立即踢下线 + 禁止重新登录(`setMembershipStatus` 事务同时 ban 用户、清 session)。
   ⏳ 待落地(钱引擎④b 施工段):`reserveCredits` 单一咽喉检查——暂停后**一切新消费动作**在钱路被拒(fail closed)。
   在它落地之前,暂停挡的是登录与人工操作,深研 worker 的中途轮次仍可能继续消费,人工核对一次余额。
2. **应诉或接受**:Stripe Dashboard → Disputes → 该笔。二选一:提交证据应诉(交付记录、消费历史截图、条款),或接受拒付。注意 Stripe 页面上的应诉截止日。**对外沟通与法律判断是 Founder 红线,agent 不代答。**
3. **登记平台损失**:在 `docs/ops/manual-money-ledger.md` 追加一行(事件=拒付),记 org、金额(RM/credits/USD 三口径)、Stripe dispute 单号、处置、状态=进行中。
4. **等 `charge.dispute.closed`**(台账只追加,不改历史行——结果永远是**新行引用原事件行**):
   - 赢(款项回来):台账**追加**一行「结案·胜诉,引用 <原行单号>」;是否解除暂停由 Founder 逐案裁。
   - 输(款项没了):台账**追加**一行「结案·败诉,损失定案,引用 <原行单号>」;商家保持暂停,后续由 Founder 决定(个案沟通/关闭账号)。
5. **解除暂停**(仅胜诉或 Founder 明示):同一开关切回 `active`。

## 验证(与 MONEY-A13 逐字对应)

- 报警含商家 org 标识与金额,走三通道。
- 暂停后该商家一切消费动作被拒(钱路咽喉待 ④b;登录与人工面已生效)。
- 平台损失在 `docs/ops/manual-money-ledger.md` 有落点。
- 本手册存在于 `docs/runbooks/`。

## 相邻的一件事:对账哨兵的观察行

拒付之外,另有一类会持续吵人的钱事:**商家付了钱、账本没有入账行**(`stripe.paid_but_no_ledger_entry`)。
它由 30 分钟一轮的对账哨兵报出,**每天最多一封**,直到了结。两种了结:

- 账本行补上了(在 Stripe 后台重投那个 webhook 事件)⇒ 哨兵下一轮**自动关闭**,不需要人做任何事。
- 这笔付款是用别的方式了结的(退了款、是测试 session)⇒ 人工关闭:**admin 面 → Reconciliation**
  (`/admin/reconcile`,权限 `credits.mutate`)。清单列出每一笔未了结的缺口(金额 / 商家 / 首见多久 /
  最近一次报警),逐条关闭。处置三选一,各自要一个可核的东西:
  - **Refunded in Stripe** —— 填 Stripe 退款单号 `re_…`;
  - **Credits granted by hand** —— 填账本 refId 或补发时用的幂等键,**服务端当场查账本**,查不到不许关;
  - **Something else** —— 至少 20 字说明 + 勾选二次确认(这一支什么都能装,所以最严)。

## 工程侧已备 vs 等 Founder

- ✅ 已备:webhook 三事件报警(三通道 + org + 金额 + event.id 幂等);admin 暂停开关;30 分钟对账哨兵
  (三通道、每天一次节流、缺口不随 48 小时窗静默消失、账本补上自动关闭)。
- ⏳ 施工中(S2 稿 7.6 节,钱引擎④b):`reserveCredits` 暂停咽喉;专用人工退款动作与调账累计闸。
- 👤 永远人工(Founder 或其授权者):应诉/接受的决定、对外沟通、解除暂停、损失定案。
