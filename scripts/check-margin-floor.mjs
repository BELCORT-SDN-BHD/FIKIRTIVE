#!/usr/bin/env node
/**
 * 宪法 5 毛利 CI 闸 —— **双线**(MONEY-A2,Founder 2026-09-01,docs/specs/money-engine.md §7.2):
 *
 *   ① **65% 目标线**(生成侧 SKU,**面值口径**)—— 价就是照这条线算出来的
 *      (`spend.ts` 的 `GEN_MARGIN_TARGET`),破线 = 供应商涨价了 = **等 Founder 重定价**。
 *      停车展期只有一条路:进 `BELOW_FLOOR_PENDING_FOUNDER_RULING`(带登记与复核期),
 *      到期自动转红。按量计价的三行(聊天 LLM / 深研 LLM / 搜索(深研+聊天))不吃这条线
 *      —— 各有各的裁决费率。
 *   ② **45% 宪法地板**(全部付费面,**最坏实收口径**)—— 面值 × 最坏包实收系数
 *      (包折扣 × Stripe 手续费钉点 × 汇率钉点,由 core 现算,系数今天 0.8944)。
 *      这条是**压力测试口径**(假设马币已贬到钉点 4.5),不是「正在亏钱」:按参考现汇复算,
 *      同样的价目离地板还很远。破线的意思是「哪天真贬到这里就破了」,那正是要提前知道的事。
 *      「不许亏着卖」(R1:收费 ≤ 成本恒红)仍按**面值**判,见 evaluateMarginFloor 的注释。
 *
 * (B10 · MASTERPLAN P0 · money-safety. Constitution 5: docs/BLUEPRINT.md:64 +
 *  docs/research/GRILL-VERDICTS-2026-07-03.md:105.)
 *
 * 闸尾还跑两张**钉点表**:FX 汇率钉点(裁决 10)与成本钉点表(MONEY-A4)—— 同一套四要素声明,
 * 同一套红黄分界(声明坏掉 = 红;复核到期 = 黄,不拦发布)。
 *
 * What it does (deterministic, no DB, no LLM, no network):
 *   - LIVE CHARGE side: imports the ACTUAL charge function from @fikirtive/core
 *     (packages/core/dist/spend.js → pricedGenCredits / pricedRefgenCredits). A
 *     price cut in spend.ts turns this gate red on the next run.
 *   - COST side: an INDEPENDENT COGS input table, transcribed BY HAND from the
 *     provider's own published pricing page — https://docs.byteplus.com/en/docs/ModelArk/Pricing,
 *     re-verified 2026-08-05 (#644). It is deliberately NOT imported from the code.
 *     (It previously carried the 2026-07-03 locked-costing numbers, which were the
 *     resource-pack discounted rate; #644 re-transcribed it to list price.)
 *   - AGREEMENT: the two cost sources are then pinned to each other tier-by-tier
 *     (assertCogsAgreement, using @fikirtive/core's marginTruthTable). Independence
 *     WITHOUT an equality check is how "two truths" silently diverge; an equality
 *     check WITHOUT independence just means a code edit moves both at once. We keep
 *     both: hand-transcribed here, derived from the token formula in core, and any
 *     drift between them turns this gate red naming the tier.
 *
 * Why it is NOT redundant with packages/core/src/spend.test.ts: that unit test
 * compares the charge against the code's OWN record-only COGS (genSpentUsd). If
 * someone edited genSpentUsd downward, that test would still pass — but the
 * agreement check here would go red, because this file's number did not move.
 * It also runs in the fast `check` job (not just the `test` job) and carries a
 * red/green self-test proving every alarm still fires.
 *
 * This gate NEVER changes pricing (pricing = B12/founder). It only reports red/green.
 * A tier below the floor may be parked ONLY via @fikirtive/core's
 * BELOW_FLOOR_PENDING_FOUNDER_RULING, which demands a per-tier reason, a ruling
 * reference and a reviewBy date — and goes red once that date passes, so a parked
 * tier can never quietly become a permanent exemption.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Constitutional margin floor: (price − cost)/price ≥ 45%.
 *  **口径身份(MONEY-A2,2026-09-01):这条线按「最坏实收」量,不按面值量。** 见 main() 的
 *  实收段落与 `worstPackReceiptCoefficient` 的注释 —— 它是压力测试口径,不是「正在亏钱」。 */
export const MARGIN_FLOOR = 0.45;
/** IEEE754 tolerance: pricing is allowed to sit EXACTLY on the 45.0% floor, and a tier
 *  that does lands one ulp under it in float. Under the #644 Founder ruling (2026-08-06)
 *  the 720p tiers are priced to the floor from above — 720p/10s is 22cr = $2.20 against
 *  $1.2096 (0.9904/2.20 = 45.0%), 720p/5s is 11cr = $1.10 against $0.6048 (same 45.0%) —
 *  so neither currently depends on this epsilon; the exactly-on-the-floor case is kept
 *  alive as a fixture in scripts/__tests__/check-margin-floor.test.mjs. Same epsilon the
 *  existing spend.test.ts uses. */
const FLOOR_EPSILON = 1e-9;

/**
 * Provider COGS, transcribed BY HAND from the provider's own published price record —
 * deliberately NOT imported from @fikirtive/core, so a code-side COGS edit can never
 * silence this gate. Keyed by sellable-SKU id (see buildSellableSkus). Do NOT edit these
 * to make the gate pass — a change here is a costing decision (B12/founder), and drift is
 * exactly what this gate should catch.
 *
 * #644 (2026-08-05): re-transcribed from https://docs.byteplus.com/en/docs/ModelArk/Pricing.
 * The previous video numbers ($0.39 / $0.77 / $0.85) came from the 2026-06 RESOURCE-PACK
 * effective rate ($3.564/M incl. tax, harmony-04-costing-model.md §二). The pack is neither
 * guaranteed active nor auto-renewed (§二 itself flags "资源包烧完静默跳裸价 ≈ +57%", and
 * pack monitoring is parked on the founder's ops list per #641), so the honest costing
 * basis is the LIST price. Video is token-priced:
 *   tokens = (input video seconds + output seconds) × W × H × fps / 1024
 *   720p 16:9 @24fps = 21,600 tokens/s
 * #769 (2026-08-08): the video engine changed to Seedance 2.0 mini, so the per-M-token rate
 * changed with it — $3.50/M without video input, $2.10/M with it (was $5.60 / $3.30 on Fast).
 * The formula, the pixel table and the hand-transcription discipline are untouched; the
 * per-tier provenance right above each block records where mini's two rates were read.
 */
/** 按量计价面的成本来源说明(三行共用;见下方 otto:* 条目的注释)。 */
const USAGE_PRICED_COGS_SOURCE =
  "计量单位定义:每 $1 的 provider 成本(按量计价面没有档位价,毛利率 = 1 − 1/倍数,与用量无关)";

export const COGS_INPUTS = {
  "image:seedream": {
    cogsUsd: 0.035,
    source: "docs.byteplus.com/en/docs/ModelArk/Pricing (2026-08-05) — $0.035/img, per-image billing, size/aspect-independent; matches BytePlus bill 3003327224 (harmony-04-costing-model.md:22)",
  },
  "refgen:seedream": {
    cogsUsd: 0.035,
    source: "docs.byteplus.com/en/docs/ModelArk/Pricing (2026-08-05) — refgen shares the image per-image basis",
  },
  // ── #645 T4: every sellable duration × resolution, costed at the tier's WORST ratio ──
  // #769 (2026-08-08): the engine these tiers run on changed (Seedance 2.0 Fast → 2.0 mini,
  // founder-ruled after eyeballing 7 real side-by-side clips), so every video COGS below was
  // re-transcribed at mini's LIST price. The 12 merchant price cells did NOT move — the
  // margin improvement is ours to keep, and repricing is a separate founder decision.
  // Two primary sources, both hand-transcribed:
  //   PRICE  ModelArk model record `dreamina-seedance-2-0-mini-260615`, read read-only with
  //          `arkcli models get dreamina-seedance-2-0-mini` (2026-08-08). Its `pricing`
  //          block carries the same two charge items every Seedance 2.0 tier has:
  //            NV2VCompletion (no video input) original_price 0.0035 / K tokens = $3.50/M
  //            V2VCompletion  (video input)    original_price 0.0021 / K tokens = $2.10/M
  //          TRANSCRIBE THE LIST PRICE, NOT THE DISCOUNTED ONE: the same record's `price`
  //          field shows 0.0014 / 0.00084 per K (what we pay today). A discount is neither
  //          guaranteed nor auto-renewed, so the floor is only honest against list.
  //
  //          READ-CHECK (a DIFFERENT model record — do not confuse it with mini's):
  //          the same two fields on `dreamina-seedance-2-0-fast-260128` give $5.60/M and
  //          $3.30/M — byte-for-byte the numbers #644 transcribed off the published pricing
  //          page. Two independent sources agreeing on the RETIRED tier is what confirms
  //          this way of reading the record; mini's own rates are the $3.50 / $2.10 above.
  //          Same rate for 480p and 720p; tokens = W × H × 24fps × seconds / 1024. The
  //          formula still reproduces fast's published worked examples exactly (480p 16:9
  //          5s = $0.28, 720p 16:9 5s = $0.60 — both at fast's $5.60/M, not mini's).
  //
  //          ⏰ AND WE NOW HAVE THE DATE. mini's discount is a PROMO that expires
  //          **2026-09-07 14:00 (UTC+8)**, after which the unit price goes ×2.5. That date
  //          is NOT in the API response — it lives only in the provider's docs, so it cannot
  //          be re-derived from `arkcli models get` and is written down here on purpose.
  //          The arithmetic confirms what "×2.5" means: $1.40/M × 2.5 = $3.50/M and
  //          $0.84/M × 2.5 = $2.10/M — i.e. the promo simply ends and the price returns to
  //          the LIST rate this table already uses. So THIS TABLE NEEDS NO EDIT on that
  //          date, and the margin floor is already immune: we have never counted on the
  //          discount. What does change is CASH — real spend on video ×2.5 overnight.
  //          That is a runway question for the founder, not a margin question.
  //          (Automatic price-drift alerting is #761's job, deliberately not built here.)
  //   PIXELS docs.byteplus.com/en/docs/ModelArk/1520757 (Create task, 2026-07-31, Seedance 2.0
  //          series row — the whole 2.0 series shares it, mini included). Per resolution the
  //          six ratios differ in pixel count, so a tier is a COST RANGE, not a point. The
  //          floor is only meaningful against the worst of it:
  //            720p worst = 4:3 / 3:4 at 1112×834 = 927,408 px → 21,736.125 tok/s → $0.0760764375/s
  //                         (21:9 at 1470×630 = 926,100 px is a hair cheaper; 16:9 = 921,600 px)
  //            480p worst = 21:9 at 992×432   =   428,544 px → 10,044     tok/s → $0.035154/s
  //                         (480p 16:9 at 864×496 is the same 428,544 px — a tie, not cheaper)
  // Each entry below is that per-second figure × the tier's seconds. Do NOT "fix" one of these
  // to make a tier pass — the cost is the provider's, not ours.
  "video:seedance-2-mini:4:720p": { cogsUsd: 0.30430575, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 4s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $3.50/M" },
  "video:seedance-2-mini:5:720p": { cogsUsd: 0.3803821875, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 5s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $3.50/M; 16:9 would be $0.3780" },
  "video:seedance-2-mini:6:720p": { cogsUsd: 0.456458625, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 6s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $3.50/M" },
  "video:seedance-2-mini:7:720p": { cogsUsd: 0.5325350625, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 7s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $3.50/M" },
  "video:seedance-2-mini:8:720p": { cogsUsd: 0.6086115, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 8s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $3.50/M" },
  "video:seedance-2-mini:9:720p": { cogsUsd: 0.6846879375, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 9s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $3.50/M" },
  "video:seedance-2-mini:10:720p": { cogsUsd: 0.760764375, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 10s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $3.50/M; 16:9 would be $0.7560" },
  "video:seedance-2-mini:11:720p": { cogsUsd: 0.8368408125, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 11s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $3.50/M" },
  "video:seedance-2-mini:12:720p": { cogsUsd: 0.91291725, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 12s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $3.50/M" },
  "video:seedance-2-mini:13:720p": { cogsUsd: 0.9889936875, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 13s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $3.50/M" },
  "video:seedance-2-mini:14:720p": { cogsUsd: 1.065070125, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 14s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $3.50/M" },
  "video:seedance-2-mini:15:720p": { cogsUsd: 1.1411465625, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 15s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $3.50/M" },
  "video:seedance-2-mini:4:480p": { cogsUsd: 0.140616, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 4s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $3.50/M" },
  "video:seedance-2-mini:5:480p": { cogsUsd: 0.17577, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 5s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $3.50/M; 480p 的 16:9(864×496)与 21:9(992×432)像素数相同,所以这一档没有更便宜的比例" },
  "video:seedance-2-mini:6:480p": { cogsUsd: 0.210924, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 6s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $3.50/M" },
  "video:seedance-2-mini:7:480p": { cogsUsd: 0.246078, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 7s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $3.50/M" },
  "video:seedance-2-mini:8:480p": { cogsUsd: 0.281232, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 8s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $3.50/M" },
  "video:seedance-2-mini:9:480p": { cogsUsd: 0.316386, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 9s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $3.50/M" },
  "video:seedance-2-mini:10:480p": { cogsUsd: 0.35154, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 10s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $3.50/M" },
  "video:seedance-2-mini:11:480p": { cogsUsd: 0.386694, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 11s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $3.50/M" },
  "video:seedance-2-mini:12:480p": { cogsUsd: 0.421848, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 12s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $3.50/M" },
  "video:seedance-2-mini:13:480p": { cogsUsd: 0.457002, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 13s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $3.50/M" },
  "video:seedance-2-mini:14:480p": { cogsUsd: 0.492156, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 14s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $3.50/M" },
  "video:seedance-2-mini:15:480p": { cogsUsd: 0.52731, source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 NV2VCompletion.original_price + docs/1520757 像素表 — 15s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $3.50/M" },
  // ── Creation S2 §8.1①(2026-09-02):高清槽位 seedance-2-0 的 1080p 档,12 个时长 ──
  // 这一台**只卖 1080p**。它的 720p/480p 是能力而不是 SKU —— 那两档没有属于这个槽位的
  // 成本钉点,而这个闸的规矩是「可售却没量过 = 红」,不是「先编一个数让它过」。
  // 独立手抄的那一份在这里:$0.0077/K token × 245,025 token/5s(实测账单,不是官方公式
  // 推的 243,000 —— 差 0.83% 未解释,取实测;记高不记低)⇒ $0.3773385/s。
  // core 那边由 cost-pins 的同两条钉点现算(SEEDANCE_1080P_COGS_USD_PER_SECOND),
  // 两边算完必须逐位相等,不等 = assertCogsAgreement 红。
  // 收费侧:11cr/秒(Founder 2026-09-02 追认,规格 §5 2026-09-01 回填行)⇒ 毛利率 65.7%,
  // 清 65% 目标线,也清 45% 地板。
  "video:seedance-2-0:4:1080p": { cogsUsd: 1.509354, source: "cost-pins video:seedance-2.0:1080p-per-ktoken $0.0077/K + :1080p-tokens-per-5s 245,025(2026-08-29 arkcli 实查 + 实测账单,回执 preserved/creation-probe-2026-08-29/)— 4s × 245,025 tok/5s = 196,020 tok × $0.0077/K;官方公式推 243,000 未采,取实测(记高不记低)" },
  "video:seedance-2-0:5:1080p": { cogsUsd: 1.8866925, source: "cost-pins video:seedance-2.0:1080p-per-ktoken $0.0077/K + :1080p-tokens-per-5s 245,025(2026-08-29 arkcli 实查 + 实测账单,回执 preserved/creation-probe-2026-08-29/)— 5s × 245,025 tok/5s = 245,025 tok × $0.0077/K;官方公式推 243,000 未采,取实测(记高不记低)" },
  "video:seedance-2-0:6:1080p": { cogsUsd: 2.264031, source: "cost-pins video:seedance-2.0:1080p-per-ktoken $0.0077/K + :1080p-tokens-per-5s 245,025(2026-08-29 arkcli 实查 + 实测账单,回执 preserved/creation-probe-2026-08-29/)— 6s × 245,025 tok/5s = 294,030 tok × $0.0077/K;官方公式推 243,000 未采,取实测(记高不记低)" },
  "video:seedance-2-0:7:1080p": { cogsUsd: 2.6413695, source: "cost-pins video:seedance-2.0:1080p-per-ktoken $0.0077/K + :1080p-tokens-per-5s 245,025(2026-08-29 arkcli 实查 + 实测账单,回执 preserved/creation-probe-2026-08-29/)— 7s × 245,025 tok/5s = 343,035 tok × $0.0077/K;官方公式推 243,000 未采,取实测(记高不记低)" },
  "video:seedance-2-0:8:1080p": { cogsUsd: 3.018708, source: "cost-pins video:seedance-2.0:1080p-per-ktoken $0.0077/K + :1080p-tokens-per-5s 245,025(2026-08-29 arkcli 实查 + 实测账单,回执 preserved/creation-probe-2026-08-29/)— 8s × 245,025 tok/5s = 392,040 tok × $0.0077/K;官方公式推 243,000 未采,取实测(记高不记低)" },
  "video:seedance-2-0:9:1080p": { cogsUsd: 3.3960465, source: "cost-pins video:seedance-2.0:1080p-per-ktoken $0.0077/K + :1080p-tokens-per-5s 245,025(2026-08-29 arkcli 实查 + 实测账单,回执 preserved/creation-probe-2026-08-29/)— 9s × 245,025 tok/5s = 441,045 tok × $0.0077/K;官方公式推 243,000 未采,取实测(记高不记低)" },
  "video:seedance-2-0:10:1080p": { cogsUsd: 3.773385, source: "cost-pins video:seedance-2.0:1080p-per-ktoken $0.0077/K + :1080p-tokens-per-5s 245,025(2026-08-29 arkcli 实查 + 实测账单,回执 preserved/creation-probe-2026-08-29/)— 10s × 245,025 tok/5s = 490,050 tok × $0.0077/K;官方公式推 243,000 未采,取实测(记高不记低)" },
  "video:seedance-2-0:11:1080p": { cogsUsd: 4.1507235, source: "cost-pins video:seedance-2.0:1080p-per-ktoken $0.0077/K + :1080p-tokens-per-5s 245,025(2026-08-29 arkcli 实查 + 实测账单,回执 preserved/creation-probe-2026-08-29/)— 11s × 245,025 tok/5s = 539,055 tok × $0.0077/K;官方公式推 243,000 未采,取实测(记高不记低)" },
  "video:seedance-2-0:12:1080p": { cogsUsd: 4.528062, source: "cost-pins video:seedance-2.0:1080p-per-ktoken $0.0077/K + :1080p-tokens-per-5s 245,025(2026-08-29 arkcli 实查 + 实测账单,回执 preserved/creation-probe-2026-08-29/)— 12s × 245,025 tok/5s = 588,060 tok × $0.0077/K;官方公式推 243,000 未采,取实测(记高不记低)" },
  "video:seedance-2-0:13:1080p": { cogsUsd: 4.905400500000001, source: "cost-pins video:seedance-2.0:1080p-per-ktoken $0.0077/K + :1080p-tokens-per-5s 245,025(2026-08-29 arkcli 实查 + 实测账单,回执 preserved/creation-probe-2026-08-29/)— 13s × 245,025 tok/5s = 637,065 tok × $0.0077/K;官方公式推 243,000 未采,取实测(记高不记低)" },
  "video:seedance-2-0:14:1080p": { cogsUsd: 5.282739, source: "cost-pins video:seedance-2.0:1080p-per-ktoken $0.0077/K + :1080p-tokens-per-5s 245,025(2026-08-29 arkcli 实查 + 实测账单,回执 preserved/creation-probe-2026-08-29/)— 14s × 245,025 tok/5s = 686,070 tok × $0.0077/K;官方公式推 243,000 未采,取实测(记高不记低)" },
  "video:seedance-2-0:15:1080p": { cogsUsd: 5.6600775, source: "cost-pins video:seedance-2.0:1080p-per-ktoken $0.0077/K + :1080p-tokens-per-5s 245,025(2026-08-29 arkcli 实查 + 实测账单,回执 preserved/creation-probe-2026-08-29/)— 15s × 245,025 tok/5s = 735,075 tok × $0.0077/K;官方公式推 243,000 未采,取实测(记高不记低)" },
  "image:seedream-pro": {
    cogsUsd: 0.045,
    source:
      "cost-pins image:seedream-pro:per-image $0.045/张(2026-08-29 arkcli 实查)—— Creation S2 §8.1① 上架的 pro 图槽位;" +
      "收费 2cr/张(Founder 2026-09-02 追认)⇒ 毛利率 77.5%",
  },
  "video:seedance-2-mini:ref": {
    cogsUsd: 0.49896,
    source: "ModelArk 模型档案 dreamina-seedance-2-0-mini-260615 V2VCompletion.original_price — (6s ref cap + 5s output) × 21,600 tok/s × $2.10/M = $0.49896(含视频输入档;我们参考片窗口的最坏情形)",
  },
  // ── 钱路 M1-c(2026-08-18):按量计价的三个付费面 ──────────────────────────────
  // 这三行的成本是 **$1 的 provider 成本** —— 一个计量单位的定义,不是从哪张价目表抄来的
  // 数字。按量计价面的收费 = 这一次真实的 provider 成本 × 倍数,所以毛利率与用量无关,
  // 而唯一有内容的输入是那个倍数;倍数由 @fikirtive/core 现取(margin-truth.ts 的
  // USAGE_PRICED_SURFACES),这边一格都不抄。手抄独立性对这三行不适用,因为这里根本
  // 没有第二个「真实价格」可抄 —— 有的只是单位本身,两边填 1.0 是同义反复而非重复副本。
  "otto:chat": { cogsUsd: 1, source: USAGE_PRICED_COGS_SOURCE },
  "otto:research:llm": { cogsUsd: 1, source: USAGE_PRICED_COGS_SOURCE },
  "otto:research:search": { cogsUsd: 1, source: USAGE_PRICED_COGS_SOURCE },
  // ── MONEY-A9(2026-09-01):素材理解三类,从平台自费改成商家计费面 ─────────────
  // 这三行是**按件**的(有档位价),不是按量计价 —— 所以它们和图片档一样吃 65% 目标线。
  // 成本是各类**最坏情况**的一次调用:token 上限吃满 × 理解牌价钉点。手抄一遍是这个闸的
  // 独立性本身(core 那边由 UNDERSTANDING_CAPS × cost-pins 现算,两边算完必须逐位相等,
  // 不等 = assertCogsAgreement 红):
  //   in  $0.10/M token、out $0.40/M token(cost-pins 的 understanding:in/out-per-mtoken)
  //   看图   11,200 in(16MP 像素闸 × 700 tok/MP)+   400 out = $0.001120 + $0.000160 = $0.00128
  //   读文档 11,200 in(同一张图,同一道闸)      + 1,200 out = $0.001120 + $0.000480 = $0.00160
  //   看视频 12,000 in(时长闸 × 抽帧 × 每帧 400)+   500 out = $0.001200 + $0.000200 = $0.00140
  "understanding:image-caption": {
    cogsUsd: 0.00128,
    source:
      "UNDERSTANDING_CAPS 最坏 token(11,200 in / 400 out)× 理解钉点(cost-pins understanding:in-per-mtoken $0.10/M、out-per-mtoken $0.40/M),2026-09-01 手算双证人",
  },
  "understanding:doc-extract": {
    cogsUsd: 0.0016,
    source:
      "UNDERSTANDING_CAPS 最坏 token(11,200 in / 1,200 out)× 理解钉点(cost-pins understanding:in-per-mtoken $0.10/M、out-per-mtoken $0.40/M),2026-09-01 手算双证人",
  },
  "understanding:video-qa": {
    cogsUsd: 0.0014,
    source:
      "UNDERSTANDING_CAPS 最坏 token(12,000 in / 500 out)× 理解钉点(cost-pins understanding:in-per-mtoken $0.10/M、out-per-mtoken $0.40/M),2026-09-01 手算双证人",
  },
};

/**
 * PURE: given rows [{ id, label, chargeUsd, cogsUsd, cogsSource }], compute the
 * margin and pass/fail for each against `floor`. Returns { rows, ok }.
 * Exported for the red/green self-test in scripts/__tests__/check-margin-floor.test.mjs.
 *
 * `receiptCoefficient`(MONEY-A2,2026-09-01)= **实收系数**:商家账面付 $1,我们真收到多少
 * 美元(包折扣 × Stripe 手续费 × 汇率钉点,由 @fikirtive/core 的 `worstPackReceiptCoefficient`
 * 现算)。默认 1 = 面值口径,与本函数的历史行为逐字相同。
 *
 * **注意 `chargeUsd` 保持面值不动**,新增的 `receiptChargeUsd` 才是实收 —— 这不是洁癖:
 * `evaluateFloorDecisions` 的 R1(「收费 ≤ 成本 = 恒红」)按**面值**判,是 §7.0 明写的口径
 * (「不许亏着卖」不变量维持面值评估)。把实收塞进 chargeUsd 会让聊天 1.05×(实收 0.939 < 成本 1)
 * 当场触发 R1,而 Founder 从没裁过那件事 —— 那会是闸自己造出来的假红。
 */
export function evaluateMarginFloor(rows, floor = MARGIN_FLOOR, receiptCoefficient = 1) {
  const evaluated = rows.map((r) => {
    const receiptChargeUsd = r.chargeUsd * receiptCoefficient;
    const margin = (receiptChargeUsd - r.cogsUsd) / receiptChargeUsd;
    return { ...r, receiptChargeUsd, margin, pass: margin >= floor - FLOOR_EPSILON };
  });
  return { rows: evaluated, ok: evaluated.every((r) => r.pass) };
}

/**
 * PURE: **65% 目标线**(MONEY-A2,规格 §7.2「65% 目标线闸」;此前代码里没有任何 65% 机制)。
 *
 * 与 45% 地板的分工是**一句话**:65% 是定价照着算的**目标**(生成侧 SKU 的价就是
 * `cogs / (1 − 0.65)` 向上取整来的,`spend.ts` 的 `GEN_MARGIN_TARGET`),45% 是宪法**地板**。
 * 目标线破了不代表在亏钱,代表**价目该重定了** —— 所以判词逐字是「等 Founder 重定价」,
 * 而不是「修一下代码」。定价是 B12/founder,闸只负责让它停下来问。
 *
 * 三件事故意与地板闸不同:
 *   ① **只量生成侧**(`usagePriced` 的三行不吃这条线)。聊天 1.05×、深研 2.06×、搜索 3× 各有
 *      各的 Founder 裁决,拿一条为「按张按秒的商品」定的目标线去判它们是张冠李戴。
 *   ② **按面值口径**(§7.2 明写)。实收口径是地板那条线的事。
 *   ③ **停车展期只降黄,不豁免**:必须在 `BELOW_FLOOR_PENDING_FOUNDER_RULING` 里带
 *      reason / rulingRef / reviewBy,过期自动转红。
 *
 * ⚠️ **已知耦合(留给第一个真的要停车的人)**:这里复用的是地板闸那张待裁决名单。一个
 * 「破 65% 但仍清 45%」的档位停进去,`evaluateFloorDecisions` 的 R3(「在名单上却已经清了
 * 地板 → 红」)会同时响。今天名单是空的,所以这不是活着的冲突;真要停第一个的时候,该做的是
 * 给名单加一个「停的是哪条线」的字段,而不是把 R3 放松 —— R3 防的是豁免烂在账上,不能动。
 *
 * `today` 注入,所以「到期」这条在自测里是可测的。
 */
export function evaluateTargetLine(rows, target, pending, today) {
  const reds = [];
  const parked = [];
  const byTier = new Map((pending ?? []).filter((p) => typeof p?.tier === "string").map((p) => [p.tier, p]));

  for (const r of rows) {
    if (r.usagePriced) continue;
    const faceMargin = (r.chargeUsd - r.cogsUsd) / r.chargeUsd;
    if (faceMargin >= target - FLOOR_EPSILON) continue;

    const head =
      `${r.id}: 面值毛利 ${(faceMargin * 100).toFixed(2)}% 跌破 ${(target * 100).toFixed(0)}% 目标线` +
      `(收费 $${r.chargeUsd.toFixed(4)} / 成本 $${r.cogsUsd.toFixed(4)})`;
    const entry = byTier.get(r.id);
    if (!entry) {
      reds.push(`${head} —— 等 Founder 重定价(T1:不在待裁决名单上,没有停车展期)`);
      continue;
    }
    const blank = ["reason", "rulingRef", "reviewBy"].find((f) => typeof entry[f] !== "string" || !entry[f].trim());
    if (blank) {
      reds.push(`${head},停车登记缺 "${blank}" —— 裸 id 是永久豁免不是展期。等 Founder 重定价(T2)`);
      continue;
    }
    if (!ISO_DATE.test(entry.reviewBy)) {
      reds.push(`${head},reviewBy "${entry.reviewBy}" 不是 YYYY-MM-DD。等 Founder 重定价(T2)`);
      continue;
    }
    // 到期口径与 45% 地板的 R5 逐字同一(reviewBy < today:到期日当天仍绿,次日转红)——
    // 同一张停车登记表,两条线对同一天不许给出两个答案(编排者裁定 2026-09-01)。
    if (entry.reviewBy < today) {
      reds.push(
        `${head},**停车展期已到期**(reviewBy ${entry.reviewBy},今天 ${today})—— ` +
          `等 Founder 重定价(T3)。Ref: ${entry.rulingRef}`,
      );
      continue;
    }
    parked.push({ ...r, faceMargin, entry });
  }
  return { reds, parked, ok: reds.length === 0 };
}

/** Cost sources agree to a tenth of a US cent — tighter than any real price move. */
const COGS_AGREEMENT_EPSILON = 1e-4;

/**
 * PURE: pin this file's hand-transcribed COGS against @fikirtive/core's derived COGS,
 * tier by tier. `handTable` = { [id]: { cogsUsd } }; `derivedRows` = [{ id, cogsUsd }]
 * (core's marginTruthTable()). Returns { problems, ok }.
 *
 * This is the P1 lock: two INDEPENDENT cost sources, plus an equality test, so neither
 * "one edit moves both silently" nor "the two drift apart unnoticed" is reachable.
 * Exported for the red/green self-test.
 */
export function assertCogsAgreement(handTable, derivedRows) {
  const problems = [];
  const derived = new Map(derivedRows.map((r) => [r.id, r.cogsUsd]));
  for (const [id, entry] of Object.entries(handTable)) {
    if (!derived.has(id)) {
      problems.push(`${id}: in the gate's COGS_INPUTS but absent from @fikirtive/core's margin truth table`);
      continue;
    }
    const a = entry.cogsUsd;
    const b = derived.get(id);
    if (Math.abs(a - b) > COGS_AGREEMENT_EPSILON) {
      problems.push(`${id}: gate COGS_INPUTS $${a} ≠ core-derived $${b} — the two cost sources drifted`);
    }
  }
  for (const r of derivedRows) {
    if (!(r.id in handTable)) {
      problems.push(`${r.id}: in @fikirtive/core's margin truth table but absent from the gate's COGS_INPUTS`);
    }
  }
  return { problems, ok: problems.length === 0 };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * PURE: apply every floor exception rule to evaluated rows + BOTH registries.
 * `today` is an ISO date string (injected, so the expiry rule is testable).
 * Returns { hardFails, parked, accepted, ok } — `hardFails` are the reasons CI must go red.
 *
 * TWO registries, two different meanings — never merge them:
 *   `pending`  = nobody has ruled yet. Carries an alarm clock (`reviewBy`) that rings in CI.
 *   `accepted` = the founder HAS ruled, and the ruling was "accept this margin". No alarm to
 *                ring (nothing is waiting), so instead it must name the date and the record.
 *
 * The rules, all of them, in one testable place:
 *   R1 charge ≤ cost                            → hard fail, ALWAYS (no registry covers it)
 *   R2 below floor and in NEITHER registry      → hard fail (a new violation cannot hide)
 *   R3 pending but now clears the floor         → hard fail (the ruling landed; delete the entry)
 *   R4 pending entry missing a required field   → hard fail (a bare id = permanent exemption)
 *   R5 pending entry past its reviewBy date     → hard fail (the alarm clock actually rings)
 *   R6 pending entry naming an unknown tier     → hard fail (the registry cannot rot)
 *   R7 below floor, pending, valid, in-date     → REPORTED, not waived
 *   A1 accepted entry missing a required field  → hard fail (an exemption must say who/when/why)
 *   A2 accepted entry naming an unknown tier    → hard fail (the registry cannot rot)
 *   A3 accepted but now clears the floor        → hard fail (delete the stale exemption)
 *   A4 a tier in BOTH registries                → hard fail (its status must be unambiguous)
 *   A5 below floor, accepted, valid             → REPORTED as 「Founder 已裁」, not silent
 * Exported for the red/green self-test.
 */
export function evaluateFloorDecisions(rows, pending, today, accepted = []) {
  const hardFails = [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parkedIds = new Set();
  const acceptedIds = new Set();

  for (const entry of accepted ?? []) {
    const tier = entry?.tier;
    if (typeof tier !== "string" || !tier.trim()) {
      hardFails.push(`accepted floor exception with no tier id: ${JSON.stringify(entry)} (A1)`);
      continue;
    }
    acceptedIds.add(tier);
    for (const field of ["reason", "ruledOn", "source"]) {
      const v = entry[field];
      if (typeof v !== "string" || !v.trim()) {
        hardFails.push(`${tier}: accepted floor exception is missing "${field}" — an exemption must name who ruled, when, and why (A1)`);
      }
    }
    if (!Array.isArray(entry.ratios) || entry.ratios.length === 0) {
      hardFails.push(`${tier}: accepted floor exception must name the ratio(s) that fall below the floor (A1)`);
    }
    if (typeof entry.ruledOn === "string" && entry.ruledOn.trim() && !ISO_DATE.test(entry.ruledOn)) {
      hardFails.push(`${tier}: ruledOn "${entry.ruledOn}" is not YYYY-MM-DD (A1)`);
    }
    if (!byId.has(tier)) {
      hardFails.push(`${tier}: accepted floor exception names a tier that is not a sellable SKU — stale registry entry (A2)`);
    }
  }

  for (const entry of pending ?? []) {
    const tier = entry?.tier;
    if (typeof tier !== "string" || !tier.trim()) {
      hardFails.push(`pending ruling with no tier id: ${JSON.stringify(entry)} (R4)`);
      continue;
    }
    parkedIds.add(tier);
    for (const field of ["reason", "rulingRef", "reviewBy"]) {
      const v = entry[field];
      if (typeof v !== "string" || !v.trim()) {
        hardFails.push(`${tier}: pending ruling is missing "${field}" — a bare id is a permanent exemption (R4)`);
      }
    }
    if (typeof entry.reviewBy === "string" && entry.reviewBy.trim()) {
      if (!ISO_DATE.test(entry.reviewBy)) {
        hardFails.push(`${tier}: reviewBy "${entry.reviewBy}" is not YYYY-MM-DD (R4)`);
      } else if (entry.reviewBy < today) {
        hardFails.push(
          `${tier}: reviewBy ${entry.reviewBy} has passed (today ${today}) — the founder's pricing ruling is overdue (R5). Ref: ${entry.rulingRef}`,
        );
      }
    }
    if (!byId.has(tier)) {
      hardFails.push(`${tier}: pending ruling names a tier that is not a sellable SKU — stale registry entry (R6)`);
    }
  }

  for (const id of acceptedIds) {
    if (parkedIds.has(id)) {
      hardFails.push(`${id}: appears in BOTH the pending-ruling and the accepted-exception registry — its status must be unambiguous (A4)`);
    }
  }

  for (const r of rows) {
    if (r.chargeUsd <= r.cogsUsd) {
      hardFails.push(`${r.id}: charge $${r.chargeUsd} ≤ cost $${r.cogsUsd} — every sale loses money (R1)`);
      continue;
    }
    if (!r.pass && !parkedIds.has(r.id) && !acceptedIds.has(r.id)) {
      hardFails.push(`${r.id}: margin ${(r.margin * 100).toFixed(1)}% is below the floor and is in neither registry (R2)`);
    }
    if (r.pass && parkedIds.has(r.id)) {
      hardFails.push(`${r.id}: margin ${(r.margin * 100).toFixed(1)}% now clears the floor — remove it from BELOW_FLOOR_PENDING_FOUNDER_RULING (R3)`);
    }
    if (r.pass && acceptedIds.has(r.id)) {
      hardFails.push(`${r.id}: margin ${(r.margin * 100).toFixed(1)}% now clears the floor — remove it from BELOW_FLOOR_FOUNDER_ACCEPTED (A3)`);
    }
  }

  const parked = rows.filter((r) => !r.pass && parkedIds.has(r.id) && r.chargeUsd > r.cogsUsd);
  const acceptedRows = rows.filter((r) => !r.pass && acceptedIds.has(r.id) && r.chargeUsd > r.cogsUsd);
  return { hardFails, parked, accepted: acceptedRows, ok: hardFails.length === 0 };
}

/**
 * Build the LIVE sellable-SKU set: charges from @fikirtive/core, cost from
 * COGS_INPUTS. A sellable combo with no COGS entry is a HARD failure (never
 * silently pass) — that is how a newly-added resolution/model gets caught.
 */
async function buildSellableSkus() {
  const spend = await import(pathToFileURL(path.join(root, "packages/core/dist/spend.js")).href);
  const gen = await import(pathToFileURL(path.join(root, "packages/core/dist/gen.js")).href);
  const refgen = await import(pathToFileURL(path.join(root, "packages/core/dist/refgen.js")).href);
  const { pricedGenCredits, pricedRefgenCredits, CREDITS_PER_USD, FLAT_PRICED_VIDEO_MODELS, SELLABLE_VIDEO_RESOLUTIONS = {} } = spend;
  const { GEN_VIDEO_MODEL_OPTIONS, GEN_MODELS, REFERENCE_VIDEO_MODEL } = gen;
  const { REFGEN_MODELS } = refgen;
  const toUsd = (internal) => internal / CREDITS_PER_USD;

  const skus = [];
  const missing = [];
  const unpinned = [];
  const add = (id, label, chargeUsd, usagePriced = false) => {
    const c = COGS_INPUTS[id];
    if (!c) {
      missing.push(id);
      return;
    }
    skus.push({ id, label, chargeUsd, cogsUsd: c.cogsUsd, cogsSource: c.source, usagePriced });
  };

  // ── MONEY-A2 图片 SKU 结构枚举 ─────────────────────────────────────────────
  // 图片与参考图此前是这里的**两行手写字面量**,而视频档早在 #645 T4 就改成枚举了。
  // 差别不是风格:手写清单里,图片菜单加一个 model 只会让那个 model 安静地不出现在毛利表上
  // —— 一个可售却从没被量过的档,正是这个闸存在的理由。现在清单从 registry 来
  // (`GEN_MODELS` / `REFGEN_MODELS`),成本钉点从 core 的结构映射来,两头都不许手抄。
  //
  // 「新增图片 model 而无对应成本钉点 = 闸红」有两道:core 那边是**编译期**红
  // (`Record<GenModel, CostPinKey>` 少一格就编译不过),这边是**运行期**红 —— 因为 dist 有可能
  // 是旧的,而闸不能因为读了一份旧构建就放行一个没成本的可售档。
  const marginTruth = await import(pathToFileURL(path.join(root, "packages/core/dist/margin-truth.js")).href);
  const { IMAGE_MODEL_COST_PIN = {}, REFGEN_MODEL_COST_PIN = {} } = marginTruth;
  for (const model of GEN_MODELS) {
    if (!IMAGE_MODEL_COST_PIN[model]) unpinned.push(`image:${model}`);
    add(`image:${model}`, `Image (${model} ×1)`, toUsd(pricedGenCredits({ kind: "IMAGE", model, count: 1, videoOptions: null })));
  }
  for (const model of REFGEN_MODELS) {
    if (!REFGEN_MODEL_COST_PIN[model]) unpinned.push(`refgen:${model}`);
    add(`refgen:${model}`, `Reference image (${model} ×1)`, toUsd(pricedRefgenCredits({ model, count: 1 })));
  }

  // Every flat-priced (margin-floored) video model × its REAL sellable
  // durations/resolutions, plus the whole-clip reference-video path (E1-06).
  // Audio is omitted from the key: it changes neither the Seedance charge nor its COGS.
  for (const model of FLAT_PRICED_VIDEO_MODELS) {
    const opts = GEN_VIDEO_MODEL_OPTIONS[model];
    if (!opts) {
      missing.push(`opts:${model}`);
      continue;
    }
    // Creation S2 §8.1①:枚举源从**能力表**换成**已定价白名单**(`SELLABLE_VIDEO_RESOLUTIONS`)。
    // 两个槽位之后,「引擎做得出来」不再等于「我们卖」——高清槽位的 720p/480p 是能力,
    // 却没有属于它的成本钉点。照能力表枚举会给这个闸凭空多出几行拿别档成本冒充的假毛利,
    // 而且与 core 的毛利表(同样按白名单枚举)当场对不上 = assertCogsAgreement 红。
    const resolutions = SELLABLE_VIDEO_RESOLUTIONS[model] ?? [];
    for (const seconds of opts.durations) {
      for (const resolution of resolutions) {
        const charge = pricedGenCredits({ kind: "VIDEO", model, count: 1, videoOptions: { seconds, resolution, audio: true } });
        add(`video:${model}:${seconds}:${resolution}`, `Video ${model} ${seconds}s ${resolution || "(default res)"}`, toUsd(charge));
      }
    }
    // 整段参考视频**只有一台引擎能收**(`REFERENCE_VIDEO_MODEL`,契约闸 genRequest 里那条
    // 「reference video requires …」的 refine 就是它)。此前只有一台在产引擎,所以「每台都加
    // 一行 ref」与「只给那一台加」看不出差别;Creation S2 §8.1① 上架第二台之后,照旧枚举
    // 就会给一条**根本请求不到**的路凭空要一份成本 —— 那不是漏量,是量了一个不存在的档。
    if (model === REFERENCE_VIDEO_MODEL) {
      const refCharge = pricedGenCredits({
        kind: "VIDEO",
        model,
        count: 1,
        referenceVideoGenerationId: "gate",
        videoOptions: { seconds: 5, resolution: resolutions[0] ?? "720p", audio: true },
      });
      add(`video:${model}:ref`, `Reference video ${model} (E1-06)`, toUsd(refCharge));
    }
  }

  // ── MONEY-A9 素材理解三类(2026-09-01)─────────────────────────────────────
  // 理解从「平台自费、商家零触点」改成商家计费面,所以它第一次需要被这个闸量。清单从
  // core 的 registry 来(UNDERSTANDING_KINDS),收费从 core 的定价函数现取 —— 三件套哪天
  // 加第四类,这里当场多一行,而它没有 COGS_INPUTS 就是 missing = 红。
  // 不带 usagePriced 标记:理解**有档位价**(每类一个按件价),所以它和图片档一样吃 65% 目标线。
  const understanding = await import(pathToFileURL(path.join(root, "packages/core/dist/asset-understanding.js")).href);
  const { pricedUnderstandingCredits } = spend;
  for (const kind of understanding.UNDERSTANDING_KINDS ?? []) {
    add(`understanding:${kind}`, `Asset understanding (${kind} ×1)`, toUsd(pricedUnderstandingCredits(kind)));
  }

  // 钱路 M1-c: the usage-priced paid surfaces (chat, research LLM, research search). They are
  // NOT tiered — charge = this run's real provider cost × a multiplier — so the gate prices them
  // per $1 of provider cost, which is exactly how core models them. The multipliers come from
  // core (live constants), so re-pricing chat or search moves this gate on the next run.
  for (const surface of marginTruth.USAGE_PRICED_SURFACES ?? []) {
    add(surface.id, surface.label, marginTruth.USAGE_PRICED_COGS_UNIT_USD * surface.multiplier(), true);
  }

  return { skus, missing, unpinned };
}

/**
 * FX 钉点闸(Founder 2026-08-18 裁决 10)。红 = 退出码 1;黄 = 只 warn,不拦。
 * 规则本体是 @fikirtive/core 的纯函数 evaluateFxPin —— 这里只负责打印与生死。
 * PURE-ish：`today` 注入，所以到期这条在自测里是可测的。
 */
export function reportFxPin(problems) {
  const red = problems.filter((p) => p.level === "red");
  const yellow = problems.filter((p) => p.level === "yellow");
  for (const p of yellow) console.warn(`[margin-floor] FX 黄灯 — ${p.message}`);
  for (const p of red) console.error(`[margin-floor] FX 红灯 — ${p.message}`);
  return { red, yellow, ok: red.length === 0 };
}

/**
 * 成本钉点闸(MONEY-A4,规格 §7.1)。判词样式与红黄分界**逐字照抄** `reportFxPin`:
 * 声明本身坏掉(缺来源 / 数值不是正有限数 / 日期烂了)= 红,退出码 1;
 * 复核到期 = 黄,只提醒不拦 —— 复核供应商牌价是 Founder 的定价动作,不该把发布线钉死。
 * 规则本体是 @fikirtive/core 的纯函数 `evaluateAllCostPins`,这里只负责打印与生死。
 */
export function reportCostPins(problems) {
  const red = problems.filter((p) => p.level === "red");
  const yellow = problems.filter((p) => p.level === "yellow");
  for (const p of yellow) console.warn(`[margin-floor] 成本钉点 黄灯 — ${p.message}`);
  for (const p of red) console.error(`[margin-floor] 成本钉点 红灯 — ${p.message}`);
  return { red, yellow, ok: red.length === 0 };
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

async function main() {
  const { skus, missing, unpinned } = await buildSellableSkus();
  // @fikirtive/core owns BOTH the derived cost table (from the official token formula)
  // and the single pending-ruling registry — so the unit tests and this gate can never
  // disagree about which tiers are parked, and their two cost sources are pinned below.
  const { BELOW_FLOOR_PENDING_FOUNDER_RULING, BELOW_FLOOR_FOUNDER_ACCEPTED, marginTruthTable } = await import(
    pathToFileURL(path.join(root, "packages/core/dist/margin-truth.js")).href
  );
  const { GEN_MARGIN_TARGET } = await import(pathToFileURL(path.join(root, "packages/core/dist/spend.js")).href);
  const { CREDIT_PACKS, packReceiptCoefficient, worstPackReceiptCoefficient, FX_PIN, evaluateFxPin } = await import(
    pathToFileURL(path.join(root, "packages/core/dist/pricing-config.js")).href
  );

  // ── 实收系数(MONEY-A2)──────────────────────────────────────────────────────
  // 45% 宪法地板从**面值口径**改判**最坏实收口径**:商家账面付 $1,我们真收到多少美元。
  // 系数由 core 现算(充值包表 × Stripe 手续费钉点 × 汇率钉点),这边一个数都不抄。
  const worstCoeff = worstPackReceiptCoefficient();
  const { rows } = evaluateMarginFloor(skus, MARGIN_FLOOR, worstCoeff);

  const today = new Date().toISOString().slice(0, 10);
  const parkedIds = new Set((BELOW_FLOOR_PENDING_FOUNDER_RULING ?? []).map((p) => p?.tier));
  const acceptedIds = new Set((BELOW_FLOOR_FOUNDER_ACCEPTED ?? []).map((e) => e?.tier));

  console.log(
    `[margin-floor] 双线闸 · 目标线 ${pct(GEN_MARGIN_TARGET)}(生成侧,面值口径) · ` +
      `宪法 5 地板 ${pct(MARGIN_FLOOR)}(全部付费面,最坏实收口径)`,
  );
  // 实收系数逐包打印:三个数是**算出来的**,印出来是为了让「最坏包是哪个」永远不靠记忆。
  console.log(
    `[margin-floor] 实收系数 · ${CREDIT_PACKS.map((p) => `${p.name.split(" ")[0]} ${packReceiptCoefficient(p).toFixed(4)}`).join(" · ")}` +
      ` → 最坏 ${worstCoeff.toFixed(4)}(面值 × 包折扣 × Stripe 手续费 × 汇率钉点 ${FX_PIN.myrPerUsd})`,
  );
  // ⚠️ 口径身份(§7.0,写在这里免得后人误读):**45% 实收地板是压力测试口径** —— 系数里的
  // 汇率用的是钉点 4.5,也就是假设马币**已经贬到那里**;2026-08-18 的参考现汇是 4.062917,
  // 钉点比它高 10.76% 是刻意的保守缓冲。按参考现汇复算,研究档 2.06× 的实收是 51.00%,
  // 离地板还很远。所以「压力口径破线 ≠ 正在亏钱」—— 缓冲存在的意义就是「哪天真贬到这里,
  // 我们仍然没破线」。把这句话删掉,下一个人看到 45.7% 会以为公司在流血。
  console.log(
    "[margin-floor] 口径身份:实收地板是**压力测试口径**(假设马币已贬至钉点 4.5)—— " +
      `按参考现汇 ${FX_PIN.reference.rate} 复算研究档 2.06× 实收 51.00%,不破线;压力口径破线≠正在亏钱。`,
  );
  for (const r of rows) {
    // RULED = below the floor with the founder's explicit acceptance on record. It is printed
    // as its own word, never as "OK" — an accepted exemption must stay visible every run.
    const flag = r.pass ? "OK " : acceptedIds.has(r.id) ? "RULED" : parkedIds.has(r.id) ? "PENDING" : "RED";
    const faceMargin = (r.chargeUsd - r.cogsUsd) / r.chargeUsd;
    console.log(
      `[margin-floor] ${flag.padEnd(7)} ${r.label.padEnd(34)} charge $${r.chargeUsd.toFixed(3)}  cost $${r.cogsUsd.toFixed(3)}` +
        `  面值 ${pct(faceMargin)}  实收 ${pct(r.margin)}`,
    );
  }

  if (missing.length) {
    console.error(`[margin-floor] MISSING costing input for sellable SKU(s): ${missing.join(", ")}`);
    console.error("[margin-floor] add the provider COGS (with a primary-source citation) to COGS_INPUTS — a sellable combo must never ship without a certified cost.");
    process.exit(1);
  }

  // MONEY-A2 第三判定:可售的图片档必须有对应的成本钉点。core 那边是编译期红,这边是运行期红
  // —— 两道都要,因为 dist 有可能是旧构建,而闸不能因为读了一份旧构建就放行一个没成本的可售档。
  if (unpinned.length) {
    console.error(`[margin-floor] 可售图片档没有对应成本钉点: ${unpinned.join(", ")}`);
    console.error(
      "[margin-floor] 在 @fikirtive/core 的 IMAGE_MODEL_COST_PIN / REFGEN_MODEL_COST_PIN 里给它配一条 cost-pins 的键 —— " +
        "一个说不清成本的 model 不许上架(fail closed,cost-pins.ts 规矩 ②)。",
    );
    process.exit(1);
  }

  // P1: the two INDEPENDENT cost sources must agree tier-by-tier, or this gate is
  // silently grading against a different cost than the product actually records.
  const agreement = assertCogsAgreement(COGS_INPUTS, marginTruthTable());
  if (!agreement.ok) {
    console.error("[margin-floor] COST SOURCES DISAGREE — the gate's hand-transcribed COGS_INPUTS and @fikirtive/core's derived cost have drifted:");
    for (const p of agreement.problems) console.error(`[margin-floor]   ${p}`);
    console.error("[margin-floor] Fix the one that is wrong against the provider's pricing page — do NOT copy one into the other to silence this.");
    process.exit(1);
  }

  const { hardFails, parked, accepted } = evaluateFloorDecisions(
    rows,
    BELOW_FLOOR_PENDING_FOUNDER_RULING,
    today,
    BELOW_FLOOR_FOUNDER_ACCEPTED,
  );
  if (hardFails.length) {
    console.error(`[margin-floor] ${hardFails.length} hard failure(s):`);
    for (const f of hardFails) console.error(`[margin-floor]   ${f}`);
    console.error("[margin-floor] Pricing is B12/founder. Do NOT edit COGS_INPUTS or park a tier to silence this — report to the control plane.");
    process.exit(1);
  }

  if (parked.length) {
    console.warn(`[margin-floor] ${parked.length} SKU(s) BELOW the ${pct(MARGIN_FLOOR)} floor, awaiting the founder's pricing ruling:`);
    for (const r of parked) {
      const entry = BELOW_FLOOR_PENDING_FOUNDER_RULING.find((p) => p.tier === r.id);
      console.warn(`[margin-floor]   ${r.id}: margin ${pct(r.margin)} — cost basis: ${r.cogsSource}`);
      console.warn(`[margin-floor]     why: ${entry.reason}`);
      console.warn(`[margin-floor]     ruling: ${entry.rulingRef} · MUST be decided by ${entry.reviewBy} (this gate goes RED after that date)`);
    }
    console.warn("[margin-floor] These are REPORTED, not waived — the ruling is 调价 or 接受, and it is the founder's to make.");
  }

  if (accepted.length) {
    console.warn(`[margin-floor] ${accepted.length} SKU(s) BELOW the ${pct(MARGIN_FLOOR)} floor with the FOUNDER'S EXPLICIT ACCEPTANCE (Founder 已裁):`);
    for (const r of accepted) {
      const entry = BELOW_FLOOR_FOUNDER_ACCEPTED.find((e) => e.tier === r.id);
      console.warn(`[margin-floor]   ${r.id}: margin ${pct(r.margin)} — cost basis: ${r.cogsSource}`);
      // 「其余比例是过的」只对分比例的视频档成立;按量计价面没有比例这一轴,整档都在地板下。
      // 印一句对一半的话,等于让豁免看起来比实际小 —— 所以这里按条目自己说的话印。
      console.warn(`[margin-floor]     scope below the floor: ${entry.ratios.join(", ")}`);
      console.warn(`[margin-floor]     why: ${entry.reason}`);
      console.warn(`[margin-floor]     Founder 已裁 ${entry.ruledOn} · ${entry.source}`);
    }
    console.warn("[margin-floor] Accepted ≠ invisible: they are printed every run so the exemption can never fade into the background.");
  }
  const clear = rows.length - parked.length - accepted.length;
  console.log(
    `[margin-floor] ${clear}/${rows.length} sellable SKU(s) clear the ${pct(MARGIN_FLOOR)} floor ` +
      `(最坏实收口径,系数 ${worstCoeff.toFixed(4)};${accepted.length} below it by founder ruling).`,
  );

  // ── 65% 目标线(MONEY-A2,规格 §7.2)──────────────────────────────────────────
  // 生成侧 SKU 的价就是 `cogs / (1 − 65%)` 向上取整来的(spend.ts 的 GEN_MARGIN_TARGET),
  // 所以跌破 65% 只有一个意思:**供应商涨价了,价目该重定了**。它不是「代码坏了」,
  // 判词因此逐字写「等 Founder 重定价」。按量计价的三行不吃这条线(各有各的裁决费率)。
  //
  // ⚠️ 图 / 参考图两档今天**恰好压在 65.0000% 上,进位余量 $0.00**($0.035 ÷ 0.35 = $0.10 = 1 显示
  // credit,一分不多)。这是**设计意图,不是 bug**:供应商图价任何上涨都会当场把这条闸打红
  // ——那正是我们想要的行为(等 Founder 重定价),而不是让毛利安静地滑到 64%、63%……
  // 不要为了「留点余量」把这条线调低,也不要给图片档加豁免:余量为零是这一档的报警器。
  const genRows = rows.filter((r) => !r.usagePriced);
  const target = evaluateTargetLine(rows, GEN_MARGIN_TARGET, BELOW_FLOOR_PENDING_FOUNDER_RULING, today);
  if (target.parked.length) {
    console.warn(`[margin-floor] ${target.parked.length} 个生成侧 SKU 跌破 ${pct(GEN_MARGIN_TARGET)} 目标线,停车展期中(黄灯):`);
    for (const r of target.parked) {
      console.warn(`[margin-floor]   ${r.id}: 面值毛利 ${pct(r.faceMargin)} — cost basis: ${r.cogsSource}`);
      console.warn(`[margin-floor]     why: ${r.entry.reason}`);
      console.warn(`[margin-floor]     ruling: ${r.entry.rulingRef} · 复核期 ${r.entry.reviewBy}(到期次日转红,与地板闸 R5 同口径)`);
    }
  }
  if (!target.ok) {
    console.error(`[margin-floor] ${target.reds.length} 个生成侧 SKU 跌破 ${pct(GEN_MARGIN_TARGET)} 目标线:`);
    for (const f of target.reds) console.error(`[margin-floor]   ${f}`);
    console.error("[margin-floor] 目标线破线 = 价目该重定了(定价是 B12/founder)。不要改 COGS_INPUTS、也不要调低目标线来把闸弄绿 —— 等 Founder 重定价。");
    process.exit(1);
  }
  console.log(
    `[margin-floor] ${genRows.length - target.parked.length}/${genRows.length} 个生成侧 SKU 清 ${pct(GEN_MARGIN_TARGET)} 目标线(面值口径)。` +
      "图 / 参考图恰好压在 65.0000%(进位余量 $0.00)= 设计意图:供应商图价一涨即闸红,等 Founder 重定价。",
  );

  // ── FX 钉点(Founder 2026-08-18 裁决 10)────────────────────────────────────────
  // 毛利地板算的是 USD;商家付的是 MYR。中间那个换算此前只活在 2026-06 的设计文档里
  // (写 4.7,已过时),代码一个字都不知道 —— 于是汇率漂移可以一直吃毛利而没有任何东西会响。
  // 现在它是 @fikirtive/core 的一条带闹钟的声明,和上面的毛利地板跑在同一个闸里。
  console.log(
    `[margin-floor] FX 钉点 1 USD = ${FX_PIN.myrPerUsd} MYR · 参考现汇 ${FX_PIN.reference.rate}` +
      `(${FX_PIN.reference.observedOn}) · 下次复核 ${FX_PIN.nextReviewDate}`,
  );
  const fx = reportFxPin(evaluateFxPin(FX_PIN, today));
  if (!fx.ok) {
    console.error("[margin-floor] FX 钉点是定价决定(B12/founder)。不要为了把闸弄绿而改钉点 —— 报到控制面。");
    process.exit(1);
  }

  // ── 成本钉点表(MONEY-A4,规格 §7.1)──────────────────────────────────────────
  // 汇率钉点管「收到的钱值多少」,成本钉点管「付出去的钱是多少」——同一套四要素声明,
  // 同一套红黄分界,所以它们在同一个闸里跑完最后一段。
  const { COST_PINS, evaluateAllCostPins } = await import(pathToFileURL(path.join(root, "packages/core/dist/cost-pins.js")).href);
  console.log(`[margin-floor] 成本钉点表 ${Object.keys(COST_PINS).length} 条 · 复核闹钟与 FX 钉点同日`);
  const pins = reportCostPins(evaluateAllCostPins(today));
  if (!pins.ok) {
    console.error("[margin-floor] 成本钉点坏了就没有推导价可言(没出处的成本不是证据)。修钉点本身 —— 不要为了把闸弄绿而改数值。");
    process.exit(1);
  }
}

// Run as CLI only — importing this module (the self-test) must not execute main().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("[margin-floor] gate crashed:", e?.message ?? e);
    process.exit(1);
  });
}
