# 人工退款

> 政策权威:`docs/specs/money-engine.md`「不做自助退款」+ 验收 MONEY-A14(v2:退款走 RESERVE→SETTLE 三段,Founder 2026-09-01 裁决,见该规格改签记录)。
> 一句话:未使用的 credits 可申请退,逐单人工审;顺序铁律=**先锁定 credits、后退钱**——绝不让商家「留着 credits 又拿回钱」;账本只追加,永不改历史行。

## 前置(查不清就不退)

1. 退款申请与理由(逐单人工审,Founder 或其授权者裁定退不退)。
2. **未使用余额 ≥ 申请退的 credits 数**;不足则拒退,或经 Founder 同意勾选「Refund what the balance can cover」按可扣部分退。
3. 找到原充值:Stripe Dashboard → Payments → 该商家的付款(`pi_…`),记下实收金额。
4. **退款金额换算=按那笔付款自己的事实**(不是面值,也**不是**由操作员挑一个在售包):
   RM = N × 这笔付款的实收金额 ÷ **这笔付款当初入账的 credits 数**,**向下取整到仙**。
   实收金额取自 Stripe 的 `payment_intent.amount_received`;入账 credits 取自账本上这笔充值的 GRANT 行
   (幂等键 `stripe:<sessionId>`)。两者都是当时留下的记录,所以改价、换包、做促销都不会算错。
   例:从今天的 Pro 包(RM250→600cr)退 100cr = 100 × 250 ÷ 600 = **RM41.66**;
   同样是 RM250、但当年只给 500cr 的老包退 100cr = 100 × 250 ÷ 500 = **RM50.00**。
   ⚠️ 这两笔在 Stripe 上金额一模一样,只有账本分得清 —— 所以单价**只认账本**。
   台账同时按汇率钉点(`FX_PIN`,现值 4.5)记 USD 口径;该 USD 数也写在账本 SETTLE 行的 reason 上。

## 步骤:admin 面的专用退款动作(已落地,S5 按此演示)

入口:`/admin/tenants/<orgId>` → **Manual refund** 面板(动作 `refundCreditsAction`,`apps/web/lib/refund-actions.ts`;权限 = `tenants.mutate`,即 super-admin)。

1. 填三个东西:退多少 credits(N)、原付款 `pi_…`、理由。需要按可扣部分退时勾选 **Refund what the balance can cover**。
   **没有包的下拉了**——包由那笔付款自己说了算(在售包表此后只用来在页面上标一句「看起来像 Pro 包」,不参与算钱)。
   动作会在**碰 Stripe 之前**自己核四样(核不过就零账本写入直接拒):
   ① 这笔 `pi_…` 真的属于这个商家(PI metadata → Checkout Session metadata / `client_reference_id` → 账本 `stripe:<sessionId>` 反查,三条都问不出来就拒);
   ② 那笔付款当初**入过账**——账本上有 `stripe:<sessionId>` 的 GRANT 行;没有就拒(它从没变成过 credits);
   ③ Session 上记的 credits 与账本 GRANT 行**对得上**;对不上说明记账本身有问题,拒退,先对账;
   ④ 要退的 credits 没超过这笔付款还能退的 credits(= 入账 credits − 已退金额折算回的 credits),金额与币种同时核。
   另外三条硬性拒绝:实收为 0 的付款(授权了没扣到钱)不能退;一笔 `pi_…` 命中**多个** Checkout Session
   时不许随便挑一个当分母,拒;那笔付款上的退款多到一次翻不完时,拒。
2. 面板上那个 **Refund id** 就是这一单的退款单号(uuid),它同时是:
   - 账本 refId(`manual-refund:<uuid>`)—— 账本的唯一键是 (org, refId),org 已经在键里;
   - Stripe 的 idempotency key(`manual-refund:<orgId>:<uuid>`)—— Stripe 那边没有 org 这一维,
     键里不带 org 的话,两个商家恰好用同一个 uuid 就会共用一把幂等键,第二笔请求拿回第一笔的结果,
     钱退给错的商家而两边账本都写着「成功」。注意它**只是第二道带子**(24 小时就过期),防重复退款
     真正靠的是下一段那条。
   **重试必须用同一个号**——面板在这一单结清之前不会换号。自己另起一个新号去重试 = 把防重复退款的保护关掉。
   同一个单号重跑**不会退第二次**,但依据不是幂等键:Stripe 的幂等键 24 小时就过期,过期之后同样的
   请求会被当成全新一笔。真正的依据是**先查后建**——账本上只要已经有这张单的预扣,动作在发起退款
   之前一定先只读地问一次 Stripe「这张单是不是已经有退款了」(审计行 → 按 `metadata.manualRefundId`
   翻完该付款的退款列表);查到就按它的状态收口,查不到才发起。查不全(退款多到一次翻不完)时整趟
   拒绝,不在看不全的清单上发起第二笔。
3. 动作内部三段,顺序固定:
   ① `reserveCredits(refId=manual-refund:<uuid>)` 预扣锁定 N cr——余额不足=预扣失败=当场拒退。这一笔的**事实**(`pi_…`、申请与实扣的 credits、马币仙数、币种、是否按可扣部分退)当场钉进 RESERVE 行的 reason,单位是内部整数,不会四舍五入;账本只追加,所以它此后不可改,重试只会照着它跑,任何一项对不上都当场拒。
   ② `stripe.refunds.create(payment_intent, amount)` 得退款单号 `re_…`;这笔退款上带 `metadata.manualRefundId = <uuid>`,是事后从 Stripe 认回它的唯一凭据;
   ③ **只有 Stripe 报 `succeeded` 才**落账,SETTLE 行 reason 当场载 `stripe-refund:re_… myr_minor:… usd:…`。
   `failed`/`canceled` 或 Stripe 明确拒绝 → `refundReservation` 自动释放,余额净变 0、账本成对,页面明说「已释放」;`pending`/`requires_action` → **不落账**,见下面「受理中」那节。
4. 台账登记一行(见「登记」)。
5. 核对:商家消费历史该行显示 **Refund**;SETTLE 行 reason 里的 `myr_minor` 与 Stripe 上的退款金额逐仙一致;`usd:` 与台账 USD 口径一致。

## 会被挡下来的十二种情况(都不是 bug)

| 页面提示 | 含义 | 怎么办 |
|---|---|---|
| Not enough unused credits… | 余额不够扣 | 拒退,或经批准勾 partial 重来 |
| …rolling limit / 30 days | 撞上 30 天 2000 显示 credits 的人工调账累计闸(退款与授信共用同一额度) | 设计内摩擦。真要放大,改 `FINANCE_ADJUST_LIMITS`(`packages/core/src/finance-limits.ts`)走 PR + Founder 批,**不绕闸** |
| That payment belongs to a different workspace / Could not prove… | `pi_…` 不属于这个商家,或归属根本查不出来 | 回 Dashboard 核对付款、填对的那个 `pi_…`;查不出归属的老付款人工核过再说 |
| …never credited this workspace | 账本上找不到这笔付款的 GRANT 行 | 这笔钱从没变成过 credits,不能按 credits 退;先查充值为什么没入账 |
| …Refusing until that is reconciled | Session 记的 credits 与账本 GRANT 行对不上 | 记账本身有问题,**先对账再退**,不要在错的底数上叠退款 |
| Could not find the checkout… / …not MYR | 查不到那笔 Checkout Session,或那笔付款不是马币充值 | 回 Dashboard 核对是不是这一笔 `pi_…` |
| …nothing received | 那笔付款实收为 0(授权未捕获 / 已撤销) | 钱从没到账,没有可退的东西 |
| …maps to multiple checkout sessions | 一笔付款查出多个 Checkout Session | 归属与入账 credits 有歧义,先人工对账 |
| …more than we can check in one pass | 那笔付款上的退款超过一万条 | 去 Stripe 人工对账后再退 |
| …left to refund | 这笔付款已经退过一部分 | 只退剩下的额度,或换一笔付款 |
| That refund id is already opened for… | 同一个单号却改了付款/退多少/partial 勾选去续跑 | 照账本上钉着的那份事实重填,或换一个新单号 |
| The credits stay held… | Stripe 没给出明确答案(超时/5xx/幂等键撞参数) | 见下节「答案不明」——**不释放**,用同一个单号重跑(重跑自己会先查 Stripe) |

**不再**会挡你的两条(编排者裁定 2026-09-02:**退款不是消费**):商家自设的单笔上限、账号暂停。
被拒付暂停的商家可以直接退款,不必先解除暂停(那一刻他又能花钱了)。30 天 2000cr 的人工调账
累计闸照常罩着退款。

## 若 Stripe 报「受理中」(pending / requires_action)

这是**正常**结局之一,不是故障:Stripe 收下了这笔退款,但还没到终态。此时:

- credits **仍然锁着**(hold 留着),账上一分钱都还没落;
- 页面明说「不要再发起另一笔退款」;
- 落一条审计行 `manual-refund-pending:<uuid>`(带 `re_…`),并发一条三通道报警。

处置:回同一个商家页,那一单会自己出现在 **Open refund holds** 面板上——这张表**从账本读**
(所有 `manual-refund:` 的 RESERVE 行,减去已经落账或已释放的),所以刷新、换人、换机器都还在,
不依赖任何页面上的临时状态。判定顺序是**先减后截**:先把收口过的排除掉,再按时间取一页,所以一张
很老、但一直没收口的单不会被更新的单挤没。真的多到一页装不下时,面板顶部会明说「还有更早的未收口
退款」——**看到这句就找工程把剩下的列出来**,每一张没被列出的 hold 都是商家花不了的 credits。
每行两个按钮:

- **Complete** —— 重读那笔退款的状态:`succeeded` 落账、`failed`/`canceled` 成对释放、还在 pending 就如实说还在等。它**不会**发起第二笔退款。
  找那笔 `re_…` 的顺序是:先看审计行 `manual-refund-pending:<uuid>`;没有(审计行当时写失败,页面会回 `auditRecorded: false` 并在日志里留一条 error)就**翻完** Stripe 上这笔 `pi_…` 的全部退款,按 `metadata.manualRefundId` 认回来;两处都没有才说找不到,而且**什么都不动**。
  找到之后还要**逐项核对**才算数:那笔退款的 `payment_intent`、`metadata.manualRefundId`、`metadata.orgId`
  必须与本单钉着的事实三项全中。对不上就拒(「does not match this ticket」),既不落账也不释放 ——
  审计行只是一个指针,拿错了指针就是用别人的退款给这张单结账。
- **Abandon** —— 只在**钱确定没出去**时放行,两种情形:
  ① Stripe 上根本没有这笔退款 → 成对释放(reason `manual-refund:abandoned`);
  ② Stripe 上有,但它自己说 `failed` / `canceled` → 同样成对释放(reason `manual-refund:stripe-failed`),
     页面会写明「Stripe reports … as failed or canceled」。这一条以前是被拒绝的,结果是一张已经失败的
     单把商家的 credits 永远锁在那儿等人改库。
  查到的退款还是 `succeeded` / `pending` / `requires_action` → 拒绝放弃,让你改用 Complete。
  ⚠️ 仍有一个人工判断留给你:退款刚发出、Stripe 还没把它列出来的那个瞬间点 Abandon,理论上可能释放一个其实会成功的 hold。**没在 Dashboard 上亲眼确认那笔 `pi_…` 上没有退款之前,不要点 Abandon。**
  ⚠️ 另一种拒绝:那笔付款上的退款多到一次翻不完(超过一万条),Complete 与 Abandon 都会**拒绝动作**
     而不是拿一份看不全的清单下判断 —— 先去 Stripe 人工对账。

⚠️ 这条前缀的 hold **没有任何清道夫会自动收口**(`manual-refund:` 登记在
`apps/worker/src/jobs/llm-reservation-reaper.test.ts` 的 `NEVER_REAPED`,有守卫测试逐个清道夫核实):
自动退回 hold、Stripe 随后又退成 = 平台双付。收口只有人来做:Open refund holds 上的 Complete / Abandon
(用同一个单号重跑主动作走的也是同一次查找,结果一样)。

## 若 Stripe 那一步「答案不明」(超时 / 5xx / 幂等键撞参数)

页面会说 **The credits stay held**,并发一条 founderAlert(`finance.manual_refund_outcome_unknown`)。
这不是失败,是**不知道**:超时完全可能发生在钱已经退出去之后。所以预扣**不释放**——释放了就成了
「钱退了、credits 也留着」,平台吃两遍。
处置:**用同一个退款单号重跑**就行 —— 重跑自己会先查一次 Stripe(审计行 → 按
`metadata.manualRefundId` 翻完这笔 `pi_…` 的退款列表):
- 查到 → 按它的状态收口(`succeeded` 落账 / `failed`·`canceled` 成对释放 / pending 保持 hold);
- 查不到 → 才发起退款,正常退。

所以「那一笔到底建出来没有」不需要你先替它判断,超过 24 小时也一样(挡住第二笔的是这次查找,
不是会过期的幂等键)。去 Dashboard 亲眼看一遍那笔 `pi_…` 仍然值得,但那是额外的复核。
**不要**手工把 credits 加回去。

## 若「已退款但没落账」(第 3 段的③失败)

方向是安全的:钱已经回商家,credits 仍锁在 reserved 里花不掉。页面会明说,并且会发一条 founderAlert(`finance.manual_refund_settle_failed`)。
处置=**用同一个退款单号重跑一次**。它不会退第二次,依据是**先查后建**,不是 Stripe 的幂等键:
账本上这张单的预扣还在,所以动作在发起任何退款之前,先只读地问一次 Stripe「这张单是不是已经有退款
了」——先看审计行 `manual-refund-pending:<uuid>`,没有就按 `metadata.manualRefundId` 翻完这笔 `pi_…`
的退款列表。找到就按它的状态补收口(`succeeded` 落账 / `failed`·`canceled` 成对释放 / 还在 pending
就保持 hold 继续等),查不到才真的发起。
**超过 24 小时的单子走的是同一条路**,不需要另做人工判断:虽然 Stripe 的幂等键那时已经过期,但挡住
第二笔的从来不是它。翻不完那笔付款的退款列表时(超过一万条)动作整趟拒绝,而不是在看不全的清单上
再建一笔。
去 Dashboard 核一眼那笔 `re_…`仍然值得做,但它是**额外的复核**,不是重跑的前置条件。
**禁止**先退钱后扣账的逆序补救;**禁止**修改任何已写行。

## 登记

`docs/ops/manual-money-ledger.md` 追加一行(事件=人工退款),含 org、退款单号(uuid)、`pi_…`、`re_…`、三口径金额(cr/RM/USD)、经手人。台账只追加不改。

## 验证(与 MONEY-A14 v2 逐字对应)

- 顺序=先 RESERVE 预扣、后 Stripe 退款、再 SETTLE 落账;余额不足则拒退或按可扣部分退;失败 REFUND 成对释放。
- SETTLE 行 reason 载 Stripe 退款单号;两边金额按汇率钉点对得上。
- 商家消费历史该退款行可读出是「退款」(类目 Refund,不是 Adjustment)。
- 本手册存在于 `docs/runbooks/`。
- 行为测试:`apps/web/lib/__tests__/refund-actions.test.ts`(三段顺序、成对释放、幂等键带 org、续跑先查后建、累计闸、单价按账本事实、pending 收口两态、审计行三项核对、翻页 fail closed);未收口清单的租户约束、先减后截与 hasMore 在真库测试 `apps/web/lib/__tests__/open-refund-holds-db.test.ts`。

## 工程侧已备 vs 等 Founder

- ✅ 已备:专用退款动作(三段一步走,重跑先查后建)、动 Stripe 前的四重核对(归属/入过账/记账对得上/还能退多少)、单价由账本事实推导、退款单事实钉在账本、未收口清单 + Complete/Abandon 两个收口动作、消费历史 Refund 类目、累计闸下沉 `grantCredits`/退款预扣同事务、暂停咽喉。
- 👤 永远人工:退不退的裁定与金额批准(动钱=Founder 或其授权者),以及台账登记。
