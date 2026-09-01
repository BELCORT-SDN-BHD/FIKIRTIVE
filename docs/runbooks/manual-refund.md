# 人工退款

> 政策权威:`docs/specs/money-engine.md`「不做自助退款」+ 验收 MONEY-A14。
> 一句话:未使用的 credits 可申请退,逐单人工审;顺序铁律=**先扣 credits、后退钱**——绝不让商家「留着 credits 又拿回钱」。

## 前置(查不清就不退)

1. 退款申请与理由(逐单人工审,Founder 或其授权者裁定退不退)。
2. **未使用余额 ≥ 申请退的 credits 数**;不足则拒退,或经 Founder 同意按可扣部分退。
3. 找到原充值:Stripe Dashboard → Payments → 该商家的付款(`pi_…`),确认包与实付金额。
4. **退款金额换算=按商家原购包的实付单价**(不是面值):RM = N × 该包 RM 价 ÷ 该包 credits 数。
   例:从 Pro 包(RM250→600cr)退 100cr = 100 × 250/600 ≈ **RM41.67**。台账同时按汇率钉点(`FX_PIN`,现值 4.5)记 USD 口径。

## 步骤(S4 工具落地前的人工版)

1. **扣 credits(先行)**:admin 面调账,负数金额 −N cr;reason 写模板:`Manual refund against <pi_…>; Stripe refund id pending`。
   该行落 ledger `kind=ADJUST`;施工后由专用退款动作写 `refId=manual-refund:<…>`,商家消费历史即显示「Refund」而非泛泛 Adjustment。
   注意:调账走 30 天/2000cr 累计闸(S2 稿 7.6);大额退款撞闸=设计内摩擦,解法是改上限常量走 PR+Founder 批,不绕闸。
2. **Stripe 退款(后行)**:Dashboard → 该笔付款 → Refund → 填换算出的 RM 金额 → 得退款单号 `re_…`。
3. **回填与登记**:把 `re_…` 记入 `docs/ops/manual-money-ledger.md`(事件=人工退款,含 ledger 行 id、pi、re、三口径金额、操作人);施工后工具会把 `re_…` 窄改回填进该 ADJUST 行 reason(A14 要求 reason 载退款单号)。
4. **核对**:ledger 扣减数 × 包单价 = Stripe 退款 RM 数;按 `FX_PIN` 折 USD 两边一致。

## 若第 2 步失败(已扣未退)

方向安全(钱还在我们这边):重试 Stripe 退款;确认不退了就把第 1 步的 ADJUST 用等额正向调账冲回,reason 注明冲销与原因,台账记一行。**禁止**先退钱后扣账的逆序补救。

## 验证(与 MONEY-A14 逐字对应)

- 顺序=先 ledger 负 ADJUST、后 Stripe 退款;余额不足则拒退或按可扣部分退。
- ADJUST 行 reason 载 Stripe 退款单号;两边金额按汇率钉点对得上。
- 商家消费历史该行可读出是「退款」(施工后 `refId` 前缀驱动)。
- 本手册存在于 `docs/runbooks/`。

## 工程侧已备 vs 等 Founder

- ✅ 已备:admin 负向调账通道(`grantCreditsAction`/`grantTenantCredits`);ledger ADJUST 落账与幂等。
- ⏳ 施工中(S2 稿 7.6):专用退款动作(校验→ADJUST→Stripe API→reason 回填一步走);消费历史 Refund 类目;累计闸。
- 👤 永远人工:退不退的裁定、Stripe 后台退款执行(动钱=Founder 或其授权者)。
