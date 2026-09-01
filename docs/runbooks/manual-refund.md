# 人工退款

> 政策权威:`docs/specs/money-engine.md`「不做自助退款」+ 验收 MONEY-A14(v2:退款走 RESERVE→SETTLE 三段,Founder 2026-09-01 裁决,见该规格改签记录)。
> 一句话:未使用的 credits 可申请退,逐单人工审;顺序铁律=**先锁定 credits、后退钱**——绝不让商家「留着 credits 又拿回钱」;账本只追加,永不改历史行。

## 前置(查不清就不退)

1. 退款申请与理由(逐单人工审,Founder 或其授权者裁定退不退)。
2. **未使用余额 ≥ 申请退的 credits 数**;不足则拒退,或经 Founder 同意勾选「Refund what the balance can cover」按可扣部分退。
3. 找到原充值:Stripe Dashboard → Payments → 该商家的付款(`pi_…`),确认包与实付金额。
4. **退款金额换算=按商家原购包的实付单价**(不是面值):RM = N × 该包 RM 价 ÷ 该包 credits 数,**向下取整到仙**。
   例:从 Pro 包(RM250→600cr)退 100cr = 100 × 250/600 = **RM41.66**。台账同时按汇率钉点(`FX_PIN`,现值 4.5)记 USD 口径;该 USD 数也写在账本 SETTLE 行的 reason 上。

## 步骤:admin 面的专用退款动作(已落地,S5 按此演示)

入口:`/admin/tenants/<orgId>` → **Manual refund** 面板(动作 `refundCreditsAction`,`apps/web/lib/refund-actions.ts`;权限 = `tenants.mutate`,即 super-admin)。

1. 填四个东西:退多少 credits(N)、原付款 `pi_…`、商家**原购的包**(下拉,来自在售包表)、理由。需要按可扣部分退时勾选 **Refund what the balance can cover**。
   动作会在**碰 Stripe 之前**自己核三样(核不过就零账本写入直接拒):① 这笔 `pi_…` 真的属于这个商家(PI metadata → Checkout Session metadata → 账本 `stripe:<sessionId>` 反查,三条都问不出来就拒);② PI 的实收金额与币种与所选包逐字相符(选错包会被这一关打回);③ 要退的数没超过这笔付款还没退掉的余额。
2. 面板上那个 **Refund id** 就是这一单的退款单号(uuid),它同时是:
   - 账本 refId(`manual-refund:<uuid>`);
   - Stripe 的 idempotency key。
   **重试必须用同一个号**——面板在这一单结清之前不会换号。自己另起一个新号去重试 = 把防重复退款的保护关掉。
3. 动作内部三段,顺序固定:
   ① `reserveCredits(refId=manual-refund:<uuid>)` 预扣锁定 N cr——余额不足=预扣失败=当场拒退。这一笔的**事实**(`pi_…`、包、credits、马币数)当场钉进 RESERVE 行的 reason;账本只追加,所以它此后不可改,重试只会照着它跑。
   ② `stripe.refunds.create(payment_intent, amount)` 得退款单号 `re_…`;
   ③ **只有 Stripe 报 `succeeded` 才**落账,SETTLE 行 reason 当场载 `stripe-refund:re_… myr_minor:… usd:…`。
   `failed`/`canceled` 或 Stripe 明确拒绝 → `refundReservation` 自动释放,余额净变 0、账本成对,页面明说「已释放」;`pending`/`requires_action` → **不落账**,见下面「受理中」那节。
4. 台账登记一行(见「登记」)。
5. 核对:商家消费历史该行显示 **Refund**;SETTLE 行 reason 里的 `myr_minor` 与 Stripe 上的退款金额逐仙一致;`usd:` 与台账 USD 口径一致。

## 会被挡下来的七种情况(都不是 bug)

| 页面提示 | 含义 | 怎么办 |
|---|---|---|
| Not enough unused credits… | 余额不够扣 | 拒退,或经批准勾 partial 重来 |
| …rolling limit / 30 days | 撞上 30 天 2000 显示 credits 的人工调账累计闸(退款与授信共用同一额度) | 设计内摩擦。真要放大,改 `FINANCE_ADJUST_LIMITS`(`packages/core/src/finance-limits.ts`)走 PR + Founder 批,**不绕闸** |
| That payment belongs to a different workspace / Could not prove… | `pi_…` 不属于这个商家,或归属根本查不出来 | 回 Dashboard 核对付款、填对的那个 `pi_…`;查不出归属的老付款人工核过再说 |
| …is not the Pro price / …not MYR | 选错包,或那笔付款不是马币充值 | 按 Dashboard 上的实付金额选对包 |
| …left to refund | 这笔付款已经退过一部分 | 只退剩下的额度,或换一笔付款 |
| That refund id is already bound to… | 同一个单号却改了付款/包去续跑 | 照账本上钉着的那份事实重填,或换一个新单号 |
| The credits stay held… | Stripe 没给出明确答案(超时/5xx/幂等键撞参数) | 见下节「答案不明」——**不释放**,去 Dashboard 核,再用同一个单号重跑 |

**不再**会挡你的两条(编排者裁定 2026-09-02:**退款不是消费**):商家自设的单笔上限、账号暂停。
被拒付暂停的商家可以直接退款,不必先解除暂停(那一刻他又能花钱了)。30 天 2000cr 的人工调账
累计闸照常罩着退款。

## 若 Stripe 报「受理中」(pending / requires_action)

这是**正常**结局之一,不是故障:Stripe 收下了这笔退款,但还没到终态。此时:

- credits **仍然锁着**(hold 留着),账上一分钱都还没落;
- 页面明说「不要再发起另一笔退款」;
- 落一条审计行 `manual-refund-pending:<uuid>`(带 `re_…`),并发一条三通道报警。

处置:等 Stripe 到终态,回同一个商家页、**用同一个退款单号**按 **Finish pending refund**。它只做
一件事——重读那笔 `re_…` 的状态:`succeeded` 落账、`failed`/`canceled` 成对释放、还在 pending 就
如实说还在等。它**不会**发起第二笔退款。

⚠️ 这条前缀的 hold **没有任何清道夫会自动收口**(`manual-refund:` 登记在
`apps/worker/src/jobs/llm-reservation-reaper.test.ts` 的 `NEVER_REAPED`,有守卫测试逐个清道夫核实):
自动退回 hold、Stripe 随后又退成 = 平台双付。收口只有「Finish pending refund」与人工两条路。

## 若 Stripe 那一步「答案不明」(超时 / 5xx / 幂等键撞参数)

页面会说 **The credits stay held**,并发一条 founderAlert(`finance.manual_refund_outcome_unknown`)。
这不是失败,是**不知道**:超时完全可能发生在钱已经退出去之后。所以预扣**不释放**——释放了就成了
「钱退了、credits 也留着」,平台吃两遍。
处置:去 Stripe Dashboard 看那笔 `pi_…` 上有没有退款。
- 有 → 用**同一个退款单号**重跑,动作会跳过预扣、直接补落账。
- 没有 → 同样用同一个单号重跑,正常退。
**不要**手工把 credits 加回去。

## 若「已退款但没落账」(第 3 段的③失败)

方向是安全的:钱已经回商家,credits 仍锁在 reserved 里花不掉。页面会明说,并且会发一条 founderAlert(`finance.manual_refund_settle_failed`)。
处置=**用同一个退款单号重跑一次**:Stripe 那一步幂等,不会退第二次,动作会跳过预扣直接补落账。
注意:Stripe 的幂等键 24 小时后过期。超过一天才补跑的单子,先去 Dashboard 核一眼那笔 `re_…` 是否已经存在,再决定重跑还是人工收尾。
**禁止**先退钱后扣账的逆序补救;**禁止**修改任何已写行。

## 登记

`docs/ops/manual-money-ledger.md` 追加一行(事件=人工退款),含 org、退款单号(uuid)、`pi_…`、`re_…`、三口径金额(cr/RM/USD)、经手人。台账只追加不改。

## 验证(与 MONEY-A14 v2 逐字对应)

- 顺序=先 RESERVE 预扣、后 Stripe 退款、再 SETTLE 落账;余额不足则拒退或按可扣部分退;失败 REFUND 成对释放。
- SETTLE 行 reason 载 Stripe 退款单号;两边金额按汇率钉点对得上。
- 商家消费历史该退款行可读出是「退款」(类目 Refund,不是 Adjustment)。
- 本手册存在于 `docs/runbooks/`。
- 行为测试:`apps/web/lib/__tests__/refund-actions.test.ts`(三段顺序、成对释放、幂等、累计闸)。

## 工程侧已备 vs 等 Founder

- ✅ 已备:专用退款动作(三段一步走,幂等)、动 Stripe 前的 org/付款/包三重核对、退款单事实钉在账本、pending 收口动作(Finish pending refund)、消费历史 Refund 类目、累计闸下沉 `grantCredits`/退款预扣同事务、暂停咽喉。
- 👤 永远人工:退不退的裁定与金额批准(动钱=Founder 或其授权者),以及台账登记。
