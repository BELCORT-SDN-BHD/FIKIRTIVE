# Monetization — Credit Packs (MYR) + BytePlus Pricing — Design

**Date:** 2026-06-29
**Status:** ✅ SHIPPED — merged as PR #66 (`d52b9c3`), LIVE on prod 2026-06-29 (`68efad4`): 100 free credits, 3 MYR packs (live Stripe), Otto 1.5×.
**Decides:** the FIKIRTIVE credit economics (post-BytePlus), the MYR credit packs, and the implementation sequence.

---

## 创始人摘要 (Founder TL;DR)

定价全定了。**模型 = 官方 BytePlus 的 Seedream(图)+ Seedance(视频,用户选 720p/1080p)**(从 fal 迁过来)。**1 credit = $0.10**,用 MYR 卖(约 RM0.50/credit)。利润藏在「每次生成扣多少 credit」里(图 1cr/3.3×;视频 720p 3cr;1080p 11cr),**Otto 聊天按真实 token × 1.5 算**(便宜,你的差异化),**新用户送 100 credits**(≈5 条完整 campaign),**一个 credit 池**(Otto + 生成共用)。一条完整 campaign ≈ **16–19 credits ≈ RM8–9.5**。

**关键:买 credit 的整套代码早就建好了(PR #22:billing 页 → Stripe Checkout → webhook → 幂等 grantCredits)。** 缺的只是:① 在 Stripe 里建那 3 个 MYR 包(纯配置)② 设免费额度 + Otto 乘数 ③ 验证。这是**马上能上的「收钱」**,跟模型无关。BytePlus 迁移是**更大的第二步**(单独的 plan)。

---

## 1. The decided economics (the figure)

**Credit unit:** 1 **display** credit = **$0.10 USD** (internal credit = $0.01; `CREDITS_PER_USD=100`, `INTERNAL_PER_DISPLAY=10` — unchanged). Sold at base **RM 0.50/credit** (FX assumed USD 1 ≈ RM 4.7; credit price ≈ the peg, so margin lives in the per-generation credit count, not the credit price).

**Per-generation charge** (BytePlus costs; margin = the credit count):
| Generation | BytePlus cost | Charge | Sell @RM0.50 | Margin |
|---|---|---|---|---|
| Image — Seedream 4.0 | $0.03 | **1 cr** | RM0.50 | 3.3× |
| Video 720p — Seedance 1.0 Lite *(default)* | $0.18 | **3 cr** | RM1.50 | 1.8× |
| Video 1080p — Seedance 1.0 Pro *(user opts up)* | $0.74 | **11 cr** | RM5.50 | 1.6× |

**Otto chat:** already metered by **real input/cached/output tokens** (`actualCostInternal`), at **margin = 1.5×** (`OTTO_LLM_MARGIN=1.5`, default is 3 → change to 1.5). Prompt-caching keeps raw cost tiny → ~0.3–0.5 display credit/turn. Otto is the cheap differentiator; profit is generations + a future Otto subscription.

**Credit packs (MYR, one-time top-up — provider-independent):**
| Pack | Price | Credits | RM/cr | Bonus |
|---|---|---|---|---|
| Starter | RM 25 | 50 | 0.50 | — |
| Standard ⭐ | RM 100 | 220 | 0.45 | +10% |
| Pro | RM 250 | 600 | 0.42 | +20% |

Every pack is profitable across every generation mix (all-image ≈ 3×; worst-case all-1080p-video ≈ 1.56× floor).

**Free credits (onboarding grant): 100** (≈ 4–5 complete campaigns; controlled CAC). *(Founder to confirm; current grant is 1000 — far too generous at BytePlus costs.)*

**One complete campaign** (efficient run, Otto @1.5×): ~12 chat credits + ~7 generation credits ≈ **~16–19 credits ≈ RM 8–9.5**. (Light ~12 / chatty ~30.)

**One credit pool** — Otto chat + generations both draw from the same `CreditLedger`. Otto's margin is an independent knob (`OTTO_LLM_MARGIN`). (A separate Otto *subscription* tier is a deferred future upgrade.)

---

## 2. What's already built vs missing

**Built (PR #22 + the credit engine):**
- `apps/web/lib/billing-actions.ts` — `listCreditPacks()` (reads active Stripe Prices carrying `metadata.credits` — **packs are pure Stripe config, no redeploy**) + `createTopupCheckout(priceId)` (requireOwner-gated; org+credits in metadata).
- `apps/web/app/api/stripe/webhook/route.ts` — on `checkout.session.completed` → **idempotent `grantCredits`** (`stripe:<sessionId>` key; bad metadata → logged + 200). The only money-in path.
- `apps/web/app/billing/page.tsx` + `BuyPackButton.tsx` — the buy-credits UI.
- The ledger (`packages/db/src/credits.ts`: reserve/settle/grant) + Otto token metering (`packages/otto/src/meter.ts`: `withLlmBudget`, `actualCostInternal`, `OTTO_LLM_MARGIN`).

**Missing:**
- The actual **credit packs don't exist** (no Stripe Prices with `metadata.credits` → `listCreditPacks()` returns empty → billing page shows nothing).
- The **per-generation credit costs** aren't set to the BytePlus figure, and the **generation provider is still fal** (not BytePlus Seedream/Seedance).
- `OTTO_LLM_MARGIN` is at the default 3 (→ set to 1.5).
- The **free-credit grant** is 1000 (→ 100).

---

## 3. Implementation — two phases

### Phase 1 — Stripe credit packs + config (SHIP NOW; provider-independent = "收钱")
The buy-flow code exists; this is config + a small build + verify:
1. **Create the 3 Stripe Prices** in the FIKIRTIVE account (acct_1TmgiPAD, **MYR**) via the Stripe CLI/API: each a one-time Price on a Product, `currency=myr`, `unit_amount` = the RM price ×100, `metadata.credits` = the pack credits (50/220/600), product name = the label. (TEST mode first.)
2. **Set `OTTO_LLM_MARGIN=1.5`** (dev `.env.local` + prod Railway).
3. **Set the free-credit grant = 100** (find where new-org credits are granted — the signup/grant path; change 1000 → 100).
4. **Verify end-to-end** with a Stripe test card: billing page lists the 3 packs → checkout → webhook → `grantCredits` → balance updates (idempotent on redelivery). Confirm Otto turns now charge ~1.5× and a campaign ≈ the figure.
5. (UI polish only if needed — the billing page already renders `listCreditPacks()`.)
*This phase ships the buy-credits feature on the CURRENT (fal) generation provider — the per-gen credit costs stay as-is until Phase 2 re-costs them.*

### Phase 2 — BytePlus migration + re-cost (the bigger build; its OWN plan)
Move generation fal → **BytePlus ModelArk (Ark)**: image **Seedream 4.0**, video **Seedance 1.0** (Lite 720p default + Pro 1080p as a user-selectable quality). Then **re-cost** the per-generation credit charges to the figure (image 1cr; video 720p 3cr / 1080p 11cr). This needs its own design pass (the `GenerationProvider` seam, the Ark API client + auth via the stored `ark-…` key — note the SDK env is conventionally `ARK_API_KEY`, also set on Railway; **sync→async polling** is the one real architectural change per the provider-migration plan; the video **quality picker** UI; the money-path untouched — only the provider behind it). See memory `fikirtive-video-provider-migration`. **Brainstorm + spec + plan this separately before building.**

---

## 4. Money-safety (unchanged invariants)
- **Money-in = `grantCredits` only**, idempotent (`stripe:<sessionId>`); the webhook verifies the Stripe signature; bad/missing metadata → no grant, 200 (no retry storm).
- The credit **spend path** (reserve/settle, the gen gate, Otto metering) is NOT modified by Phase 1 — only the pack config + the Otto margin knob + the free grant value.
- Phase 2 swaps the provider **behind** the existing spend gate; the gate/ledger/idempotency are untouched.
- Confirm before any LIVE Stripe switch (TEST keys until the founder flips to live).

## 5. Open questions / risks
- **FX**: USD 1 ≈ RM 4.7 assumed for the credit peg; the pack MYR prices are fixed round numbers (RM25/100/250) regardless of FX drift (re-check yearly).
- **Free-credit grant location**: confirm where the 1000 is granted (signup) and that 100 is the right number.
- **Seedance 2.0** pricing is uncertain/much higher; v1 uses Seedance 1.0 (Lite/Pro). 2.0 = a later premium option.
- **BytePlus async**: Phase 2's sync→async is the real change — design it carefully (the poll absorbs inside the provider; the money-path stays exactly-once).
- **Where Otto subscription fits** (the future margin tier) — deferred; one pool for now.

## References
- Existing Stripe/credit infra: `billing-actions.ts`, `stripe/webhook/route.ts`, `packages/db/src/credits.ts`, `packages/otto/src/meter.ts`, `packages/core/src/{spend,llm-prices}.ts`.
- BytePlus pricing research (this session): Seedream $0.03/image; Seedance 1.0 Lite ~$0.18/5s 720p, Pro ~$0.74/5s 1080p; sources on docs.byteplus.com/ModelArk.
- Memory: `fikirtive-credit-economics`, `fikirtive-stripe-config`, `fikirtive-pricing-market-benchmark`, `fikirtive-video-provider-migration`, `fikirtive-dev-env-layout`, `ask-before-spending-real-money`.
