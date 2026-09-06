# Harmony 05 —— 通道费独立账道设计(第二账道)

> **性质**:harmony 交付物 5/6。落实红旗五(founder):**WhatsApp 等通道过路费单独收,不进 credits** —— "混进 credits 不是 best practice"。
> ⚠️ 本设计是新 money 面:动工时全程 money-safety-review + 总审查员终审;本文先钉安全边界。

## 一、为什么两条账道(founder 判决的工程理由)

| | Credits 账道(现有) | 通道费账道(新) |
|---|---|---|
| 卖什么 | **我们的服务**(生成/Otto 劳动) | **代收的过路费**(Meta 按会话收的钱) |
| 定价权 | 我们定(毛利 40-50%) | Meta 定,**透明直传零加价**(G-07) |
| 币种 | USD 锚定,显示 credits | **MYR 实价显示**(用户要能对账 Meta 价目) |
| 心理 | "雇员工干活" | "帮我垫付话费" |

混在一起的恶果:credits 汇率波动污染直传承诺、Meta 调价逼我们改 credits 定价、"零加价"无法被用户验证。分开 = 每条账道各自诚实。

## 二、对象设计(镜像 Credit 引擎的安全形状,不共享一行代码路径)

```
ChannelFeeWallet   { id, ownerId, currency("MYR"), balanceCents, updatedAt }
ChannelFeeLedger   { id, ownerId, walletId, kind(TOPUP|CHARGE|REFUND|ADJUST),
                     amountCents, refId, idempotencyKey, meta(会话id/渠道/Meta费类), createdAt }
```

**从 Credit 引擎原样继承的五条安全律**(它们是审计验证过的形状):
1. 账本行先行,`createMany({skipDuplicates})` + count===0 早退 —— 幂等靠唯一键,不靠 try/catch;
2. 每笔带确定性 `idempotencyKey`(`watopup:<stripeSession>` / `waconv:<conversationId>:<Meta计费窗口>`);
3. CHARGE 只在会话计费事件确认后记账(Meta webhook/对账拉取),**永不预估扣**;
4. 余额不足 → 拒发新出站消息(fail-closed,像 InsufficientCredits),**永不透支**;
5. REFUND/ADJUST 走与 CreditLedger 同款 finalizer 互斥索引形状。

**与 Credits 的物理隔离**:独立表、独立 server actions、独立充值 Stripe price(MYR 实价)、独立显示区。共享的只有哲学。

## 三、用户面(respond.io 形态,他们已教育好市场)

- Account → **WhatsApp 费用**面板:余额(RM)、充值、每月会话费明细(营销/服务类目按 Meta 价目)、"我们不加价"声明 + Meta 价目链接。
- Otto 群发前报价卡:"这波 ~N 个营销会话,Meta 大约收 RM X(直传),我们的服务费 Y credits" —— **两条账道在同一张报价卡上分行列示**,透明即卖点。

## 四、边界与顺序

- **P2(消息进场)才动工**,与 WhatsApp BSP 接入同一 spec 包;
- BSP 资质/号码管理是运营前置(founder 侧 KYC 类动作,像 BytePlus 签约那次);
- 上线前对账演练:Meta 账单 vs 我们 ledger 全量对平,差异 = 阻断缺陷。

## 给审查员的钉子
- [ ] 与 CreditLedger 零共享表/actions/finalizer;grep 级隔离检查
- [ ] 五条安全律逐条对(幂等键/行先行/事件后记账/fail-closed/互斥索引)
- [ ] 报价卡两账道分行列示(透明直传可被用户验证)
- [ ] 动工 PR 必过 money-safety-review(该 skill 的 Step-1 范围要先扩进第二账道符号)
