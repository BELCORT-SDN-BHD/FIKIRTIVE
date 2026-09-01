# 人工退款

> 政策权威:`docs/specs/money-engine.md`「不做自助退款」+ 验收 MONEY-A14(v2:退款走 RESERVE→SETTLE 三段,Founder 2026-09-01 裁决,见该规格改签记录)。
> 一句话:未使用的 credits 可申请退,逐单人工审;顺序铁律=**先锁定 credits、后退钱**——绝不让商家「留着 credits 又拿回钱」;账本只追加,永不改历史行。

## 前置(查不清就不退)

1. 退款申请与理由(逐单人工审,Founder 或其授权者裁定退不退)。
2. **未使用余额 ≥ 申请退的 credits 数**;不足则拒退,或经 Founder 同意按可扣部分退。
3. 找到原充值:Stripe Dashboard → Payments → 该商家的付款(`pi_…`),确认包与实付金额。
4. **退款金额换算=按商家原购包的实付单价**(不是面值):RM = N × 该包 RM 价 ÷ 该包 credits 数。
   例:从 Pro 包(RM250→600cr)退 100cr = 100 × 250/600 ≈ **RM41.67**。台账同时按汇率钉点(`FX_PIN`,现值 4.5)记 USD 口径。

## 步骤 A:S4 专用退款动作落地后(验收 S5 按此演示)

1. admin 面发起退款动作,填 N cr 与 `pi_…`。动作内部三段:
   ① `reserveCredits(refId=manual-refund:<uuid>)` 预扣锁定 N cr——余额不足=reserve 失败=当场拒退;
   ② 调 Stripe refund API 得退款单号 `re_…`;
   ③ `settleCredits` 落账,SETTLE 行 reason 当场载 `re_…`。
   Stripe 退款失败 → `refundReservation` 自动释放,余额净变 0、账本成对。
2. 台账登记一行(见「登记」)。
3. 核对:SETTLE 扣减数 × 包单价 = Stripe 退款 RM 数;按 `FX_PIN` 折 USD 两边一致;商家消费历史该行显示「Refund」。

注意:退款计入 30 天/2000cr 人工调账累计闸(S2 稿 7.6);大额退款撞闸=设计内摩擦,解法是改上限常量走 PR+Founder 批,不绕闸。

## 步骤 B:过渡人工版(专用动作落地前;不改任何已写行)

1. **扣 credits(先行)**:admin 面负向调账 −N cr,reason 写 `Manual refund against <pi_…>`(此时无退款单号,单号**不回填**,只进台账)。
2. **Stripe 退款(后行)**:Dashboard → 该笔付款 → Refund → 填换算 RM 金额 → 得 `re_…`。
3. **登记**:`docs/ops/manual-money-ledger.md` 追加一行(事件=人工退款),含 ledger 行 id、`pi_…`、`re_…`、三口径金额、经手人——过渡期内退款单号的落点是台账,不是账本行。
4. 核对同步骤 A 第 3 条(消费历史此期间显示为 Adjustment,属已知过渡态)。

## 若「已扣未退」(步骤 B 第 2 步失败)

方向安全(钱还在我们这边):重试 Stripe 退款;确认不退了,就用等额**正向调账新行**冲回(reason 注明冲销与原因),台账追加一行引用原行。**禁止**先退钱后扣账的逆序补救;**禁止**修改任何已写行。

## 验证(与 MONEY-A14 v2 逐字对应)

- 顺序=先 RESERVE 预扣、后 Stripe 退款、再 SETTLE 落账;余额不足则拒退或按可扣部分退;失败 REFUND 成对释放。
- SETTLE 行 reason 载 Stripe 退款单号;两边金额按汇率钉点对得上。
- 商家消费历史该退款行可读出是「退款」。
- 本手册存在于 `docs/runbooks/`。

## 工程侧已备 vs 等 Founder

- ✅ 已备:reserve→settle→refund 机械与幂等键;admin 负向调账通道(过渡版用)。
- ⏳ 施工中(S2 稿 7.6):专用退款动作(三段一步走);消费历史 Refund 类目;累计闸下沉 `grantCredits` 事务。
- 👤 永远人工:退不退的裁定与金额批准(动钱=Founder 或其授权者;过渡期的 Stripe 后台退款由其亲手执行,S4 后改为其在 admin 面批准触发)。
