# Fikirtive — Financial Core

> All figures MYR (FX RM4.7/USD). Draft v1 — 2026-06-21.
> Grounded in real current cloud/API pricing + SEA market research.

**Standing assumptions** (stated, not hidden): credits are **COGS-indexed** (internal 1=$0.01 / displayed 1=$0.10; video priced by model-second estimate, rounded to display credits — not a literal video-second), and **video is the dominant COGS**; WhatsApp/SMS = pass-through (shown separately, never in COGS); email/infra absorbed as platform COGS; Otto on Haiku 4.5 default; smart-blend engineering (cheap-tier video + FLUX-dev images) is the modeled wedge, not naive default-expensive. Where data is single-source it's flagged **[thin]**.

---

## A. Full-product COGS evolution (MYR/merchant/mo)

Wedge smart-blend = USD13.35 = **RM62.7**. Otto-Haiku = USD6 = **RM28**. Email-infra (SES/Resend, ~500 emails) = **RM0.7**. Attribution infra (ClickHouse + ingest) ≈ **RM0.5**. CRM/CDP Neon ≈ **RM1.9**. Amortized fixed infra (Railway+Neon base) at ~1k merchants ≈ **RM2.8**.

| Cost line (RM/mo) | Stage 1: WEDGE | Stage 2: EXPANDING | Stage 3: FULL-PRODUCT |
|---|---:|---:|---:|
| Video (8s cheap-tier, the lever) | 44.0 | 47.0 | 50.0 |
| Images (FLUX-dev) | 8.5 | 9.0 | 9.5 |
| Otto LLM (Haiku 4.5) | 28.0 | 33.0 | 40.0 |
| CS-chat (Otto auto-reply DMs, on Haiku) | — | 6.0 | 8.0 |
| Email infra (SES/Resend) | — | 0.7 | 0.9 |
| KOL/affiliate mgmt (software + small Otto) | — | — | 4.0 |
| Attribution (ClickHouse events) | — | 0.5 | 1.5 |
| CRM/CDP profiles (Neon) | — | 1.0 | 2.5 |
| Storage (R2, negligible) | 0.3 | 0.5 | 1.0 |
| Amortized fixed infra | 2.8 | 2.8 | 2.8 |
| **TOTAL COGS** | **~83.6** | **~100.5** | **~120.2** |
| **ARPU (subscription + credits)** | **212** | **400** | **620** |
| **Gross profit** | **128.4** | **299.5** | **499.8** |
| **GROSS MARGIN** | **~61%** | **~75%** | **~81%** |

> **Pass-through (NOT in COGS, NOT Fikirtive margin):** WhatsApp lifecycle/marketing = **RM70–215/merchant/mo** (USD15–45, swings 3× on marketing-vs-utility mix and country) billed to merchant at cost-plus via 360dialog $0-markup or +RM0.024/msg. This is the single most volatile line in the whole stack — keeping it off the P&L is what protects gross margin stability.

**Why margin EXPANDS with depth (land-and-expand, the core thesis):** the post-wedge modules (CS/email/KOL/attribution/CRM) add only **~RM17** of COGS combined; total COGS rises just **RM36.6** wedge→full-product (video — the one cost-heavy line — grows only ~RM6, because merchants don't 3× their video volume; they add *modules*) while ARPU nearly triples (RM212→RM620). So incremental gross margin on expansion revenue is **~91%** = (408−36.6)/408, dragging blended margin from 61% → 81%. **NRR > 100% is the target this makes reachable** — but it requires retained merchants to expand ~2.1× annually to offset ~48% annual logo churn (6%/mo). Treat it as a hypothesis to prove with cohorts, not a given.

*Note on Stage-1 margin:* the wedge is modeled at ~61%, more conservative than the research's headline 70%. The 70% assumes a fully-optimized blend at scale; a real closed-beta merchant on cheap-tier video lands 60–65%. The Phase-2 levers (Modal Otto self-host past ~300 merchants = +8.8pts; video self-host = up to 65%+ on the wedge alone) are upside **not** baked into the base case.

---

## B. Hosting + AI cost at scale (full-product merchants, RM/mo)

Otto on **Claude-Haiku** through 1k; at **10k** a **Modal blend** captures the +8.8pt scale lever. Messaging is pass-through (revenue-neutral, excluded from margin).

| Line (RM/mo total) | 100 merchants | 1,000 merchants | 10,000 merchants |
|---|---:|---:|---:|
| Railway (app/workers/ingest) | 850 | 850 | 8,500 |
| Neon (OLTP: profiles, CRM, CS, KOL) | 700 | 2,070 | 20,700 |
| Warehouse (ClickHouse Cloud events) | 310 *(floor)* | 830 | 3,370 |
| R2 storage (GB→RM) ~3GB/merch | 21 *(300GB)* | 210 *(3TB)* | 2,100 *(30TB)* |
| fal video + images (the wedge AI) | 24,675 | 246,750 | 2,467,500 |
| Otto LLM (Haiku → Modal blend@10k) | 13,160 | 131,600 | 940,000 |
| **TOTAL COGS (RM/mo)** | **~39,716** | **~382,310** | **~3,442,170** |
| Blended COGS / merchant / mo | **~397** | **~382** | **~344** |
| Revenue @ RM620 ARPU (RM/mo) | 62,000 | 620,000 | 6,200,000 |
| **GROSS MARGIN** | **~36%** | **~38%** | **~44%** |
| *Messaging pass-through (off-P&L)* | *~12k* | *~120k* | *~1.2M* |

> **The headline gross-margin gap explained — one variable: AI consumption per merchant.** Section A models a merchant using the AI *included in their plan* (~RM120 COGS → 81% at RM620). Section B is a **stress test**: every full-product merchant burning the *maximum* metered AI (RM344–397 COGS) at a flat RM620 → 36–44%. Both can't be true at flat ARPU, and the honest reconciliation is a **mechanism, not "it converges"**: included credits are **sized so the plan price yields ~70–80% margin**, and usage above the allotment is **billed at cost-plus**, so a heavier user raises their *own* ARPU instead of eroding margin. So in-plan users sit at Section A's margin; heavy users are overage-protected above it. **Section B is the floor the credit cap exists to prevent, not the expected case.** (Consistency: messaging pass-through is excluded from *both* COGS and revenue.)

Two levers that move Section B: (1) **Otto self-host on Modal** past ~300 merchants (+8.8pts); (2) **video self-host** Phase-2 = up to 9× cost cut on the single largest line — not modeled, pure upside.

---

## C. 5-year forecast — 3 scenarios (illustrative, assumption-driven)

**Scenario models, not predictions.** Anchored to research: month-24 ≈ 1,500–4,000 merchants / RM4–10M ARR. Margin is the **correctly-firewalled** margin (credit ledger enforced). Churn is make-or-break: 6%/mo is the SMB-marketing-tool norm (~48% annual retention); 9%/mo (~32% annual) makes the model **fragile, not insolvent** — even there wedge LTV/CAC stays ~3.4×.

### Conservative
| Year-end | Merchants | ARPU/mo | Churn/mo | Ending ARR | GM |
|---|---:|---:|---:|---:|---:|
| Y1 | 350 | 230 | 7% | RM1.0M | 68% |
| Y2 | 1,200 | 270 | 6.5% | RM3.9M | 71% |
| Y3 | 2,800 | 320 | 6% | RM10.8M | 74% |
| Y4 | 5,000 | 360 | 5.5% | RM21.6M | 76% |
| Y5 | 8,000 | 400 | 5% | RM38.4M | 78% |

### Base
| Year-end | Merchants | ARPU/mo | Churn/mo | Ending ARR | GM |
|---|---:|---:|---:|---:|---:|
| Y1 | 500 | 250 | 6.5% | RM1.5M | 69% |
| Y2 | 2,200 | 300 | 6% | RM7.9M | 72% |
| Y3 | 6,000 | 360 | 5.5% | RM25.9M | 75% |
| Y4 | 13,000 | 420 | 5% | RM65.5M | 78% |
| Y5 | 25,000 | 470 | 4.5% | RM141.0M | 80% |

### Bull
| Year-end | Merchants | ARPU/mo | Churn/mo | Ending ARR | GM |
|---|---:|---:|---:|---:|---:|
| Y1 | 700 | 270 | 6% | RM2.3M | 70% |
| Y2 | 4,000 | 340 | 5.5% | RM16.3M | 74% |
| Y3 | 12,000 | 420 | 5% | RM60.5M | 77% |
| Y4 | 30,000 | 490 | 4% | RM176.4M | 80% |
| Y5 | 60,000 | 550 | 3.5% | RM396.0M | 82% |

**Dominant levers, ranked:** (1) **Churn** — the binding constraint. 6%/mo is the SMB norm but brutal (~48% annual logo retention); at 9%/mo (~32%) growth/NRR get fragile — though even then wedge LTV/CAC stays ~3.4× (fragile, *not* insolvent). Driving churn 6%→4.5% via depth lock-in beats any growth tactic. (2) **Expansion/NRR** — the ARPU ramp (RM212→RM550) *is* the model; wedge-only collapses Base toward Conservative. (3) **Acquisition pace** — CAC RM423 vs **wedge** LTV ~RM2,140 (GP RM128.4 ÷ 0.06) = LTV/CAC **~5.1× at the conservative wedge stage**; full-product LTV/CAC is far higher (~20×) but we anchor on the wedge number. **Honest caveat:** Y3–5 compound assumption error; treat Y1–2 as plannable, Y3–5 as directional.

---

## D. The raise (MYR)

**Instrument:** ~**RM1.2M** (~USD250k) on a **post-money SAFE, cap-only**, cap **RM16–21M** (~USD3.5–4.5M) → **~5.7–7.5% dilution**. Malaysia-grounded — explicitly *not* US USD6–9M caps. 18-month milestone plan, **24 months of runway** raised.

**Use of funds (RM1.2M / 24 months):**
| Bucket | RM | What it buys |
|---|---:|---|
| **Team** (~62%) | ~745k | Founder draw RM10k + 1–2 eng @ RM6.5k + 1 marketing @ RM5k (KL rates) |
| **Build / infra** (~18%) | ~216k | fal/video credits, Neon/Railway/ClickHouse, Otto API, SEA integrations (TikTok Shop/Shopee/WhatsApp BSP) |
| **Acquisition** (~20%) | ~239k | ~565 paid acquisitions @ CAC RM423, blended with organic/Otto-led |

**Series-A setup — what this buys:** 18 months to prove the wedge → expansion motion: **target month-18 ≈ 1,000–1,500 paying merchants, ARR RM3–5M, monthly churn ≤6%, NRR >100%** (the one metric that proves land-and-expand). That + the capital-efficiency story (built to revenue on USD250k) is the Series-A narrative: raise **RM8–15M** to fund the mid-market push and video self-host.

---

## CEO summary

1. Wedge sells at **~61% gross margin** today; the model is land-and-expand — margin climbs to **~81%** as merchants add CS/CRM/attribution (modules are cheap software, video cost barely grows).
2. The **credit/spend-cap ledger (already built) is the margin firewall** — turns uncapped AI into metered, pass-through-able cost; without it enforced, fleet margin drops to 36–44% (shown honestly in Section B).
3. **WhatsApp/SMS stays OFF the P&L** as merchant pass-through (RM70–215/merchant/mo) — keeps gross margin stable and trust intact (no % of ad-spend).
4. **Churn is make-or-break:** 6%/mo (~48% annual retention) gives wedge LTV/CAC ~5×; 9%/mo (~32%) makes the model **fragile, not insolvent** (LTV/CAC still ~3.4×). Driving churn down via depth lock-in is the single highest-value lever.
5. **Base case: RM7.9M ARR by month-24, RM141M by Y5** — but Y3–5 are directional; Y1–2 are the plannable, fundable window.
6. **Raise RM1.2M** on a cap-only SAFE (RM16–21M cap, ~5.7–7.5% dilution), 24-mo runway, to hit month-18 ≈ RM3–5M ARR + NRR>100% — the proof points that unlock a RM8–15M Series A.

*Thin-data flags: WhatsApp per-country rates (±20–30%); events-per-merchant infra estimate (±50%); Modal 35B batched throughput (unbenchmarked, swings Otto self-host 2–3×); Y3–5 forecasts compound assumption error. All Phase-2 self-host margin upside is excluded from the base case — headroom, not a promise.*
