# 拒付(chargeback)处理

> 政策权威:`docs/specs/money-engine.md` 九问 5「拒付总法」+ 验收 MONEY-A13。
> 一句话:拒付 = 持卡人绕过我们、经自己的银行强制拉回已付款。我们**不建负余额、不做自动 clawback**(2026-07-04 alert-only 裁决维持),一切处置人工、逐案。

## 谁触发

- Stripe webhook `charge.dispute.created` 到达(`apps/web/app/api/stripe/webhook/route.ts`)。
- 现状(S4 施工前):一条 Sentry 事件 + ActionEvent 审计行 + Stripe 官方邮件;**施工后**:founderAlert 三通道(Sentry+邮件+Telegram)携带商家 org 与金额。
- 收到任一渠道的拒付通知,即按本手册走。

## 前置(动手前先查清,查不到就停)

1. **认定商家**:施工后报警自带 org;施工前人工反查——Stripe Dashboard → Payments → 该笔付款 → 关联 Checkout Session → metadata 里的 `orgId`。
2. **认定金额与包**:拒付金额、对应哪个充值包、该笔在 `CreditLedger` 的入账行(`(orgId, idempotencyKey)`)。
3. **盘点该商家账本**:当前余额、该笔 credits 已花多少。账本结构不允许负数——已花掉的部分**无法倒扣**,那就是平台损失,走台账,不走自动化。

## 步骤

1. **账号级暂停**(Founder 2026-09-01 拍板的冻结形态):admin 面 → Tenants → 该商家 → 状态切 `suspended`。
   效果:该 org 全部成员立即踢下线 + 禁止重新登录(`setMembershipStatus` 事务同时 ban 用户、清 session);施工后追加:一切新消费动作在 `reserveCredits` 咽喉被拒(fail closed)。
2. **应诉或接受**:Stripe Dashboard → Disputes → 该笔。二选一:提交证据应诉(交付记录、消费历史截图、条款),或接受拒付。注意 Stripe 页面上的应诉截止日。**对外沟通与法律判断是 Founder 红线,agent 不代答。**
3. **登记平台损失**:在 `docs/ops/manual-money-ledger.md` 追加一行(事件=拒付),记 org、金额(RM/credits/USD 三口径)、Stripe dispute 单号、处置、状态=进行中。
4. **等 `charge.dispute.closed`**(台账只追加,不改历史行——结果永远是**新行引用原事件行**):
   - 赢(款项回来):台账**追加**一行「结案·胜诉,引用 <原行单号>」;是否解除暂停由 Founder 逐案裁。
   - 输(款项没了):台账**追加**一行「结案·败诉,损失定案,引用 <原行单号>」;商家保持暂停,后续由 Founder 决定(个案沟通/关闭账号)。
5. **解除暂停**(仅胜诉或 Founder 明示):同一开关切回 `active`。

## 验证(与 MONEY-A13 逐字对应)

- 报警含商家 org 标识与金额,走三通道(施工后)。
- 暂停后该商家一切消费动作被拒。
- 平台损失在 `docs/ops/manual-money-ledger.md` 有落点。
- 本手册存在于 `docs/runbooks/`。

## 工程侧已备 vs 等 Founder

- ✅ 已备(现状):webhook 三事件报警+审计;admin 暂停开关;30 分钟对账哨兵。
- ⏳ 施工中(S2 稿 7.5 节):报警升级三通道带 org;`reserveCredits` 暂停咽喉;哨兵缺口持续追踪。
- 👤 永远人工(Founder 或其授权者):应诉/接受的决定、对外沟通、解除暂停、损失定案。
