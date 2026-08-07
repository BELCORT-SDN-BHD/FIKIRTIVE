#!/usr/bin/env node
/**
 * 宪法 5 毛利地板 CI 闸 — every sellable gen SKU keeps (price − cost)/price ≥ 45%.
 * (B10 · MASTERPLAN P0 · money-safety. Constitution 5: docs/BLUEPRINT.md:64 +
 *  docs/research/GRILL-VERDICTS-2026-07-03.md:105.)
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

/** Constitutional margin floor: (price − cost)/price ≥ 45%. */
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
 * Provider COGS, transcribed BY HAND from the provider's own published pricing page —
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
 *   720p 16:9 @24fps = 21,600 tokens/s · $5.60/M without video input · $3.30/M with it
 * Cross-checks against the provider's own finished prices: 720p 5s $0.60, 10s $1.21,
 * with-reference 720p 5s $0.64–1.43. All three reproduce exactly.
 */
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
  // Two published primary sources, both hand-transcribed:
  //   PRICE  docs.byteplus.com/en/docs/ModelArk/1544106 (Last updated 2026-08-01) —
  //          dreamina-seedance-2-0-fast-260128, $5.60/M tokens without video input, SAME
  //          rate for 480p and 720p; tokens = W × H × 24fps × seconds / 1024. The page's own
  //          worked examples (480p 16:9 5s = $0.28, 720p 16:9 5s = $0.60) reproduce exactly.
  //   PIXELS docs.byteplus.com/en/docs/ModelArk/1520757 (Create task, 2026-07-31, Seedance 2.0
  //          series row). Per resolution the six ratios differ in pixel count, so a tier is a
  //          COST RANGE, not a point. The floor is only meaningful against the worst of it:
  //            720p worst = 4:3 / 3:4 at 1112×834 = 927,408 px → 21,736.125 tok/s → $0.1217223/s
  //                         (21:9 at 1470×630 = 926,100 px is a hair cheaper; 16:9 = 921,600 px)
  //            480p worst = 21:9 at 992×432   =   428,544 px → 10,044     tok/s → $0.0562464/s
  // Each entry below is that per-second figure × the tier's seconds. Do NOT "fix" one of these
  // to make a tier pass — the cost is the provider's, not ours.
  "video:seedance-2-fast:4:720p": { cogsUsd: 0.4868892, source: "ModelArk/1544106 + /1520757 — 4s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $5.60/M" },
  "video:seedance-2-fast:5:720p": { cogsUsd: 0.6086115, source: "ModelArk/1544106 + /1520757 — 5s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $5.60/M; 16:9 would be $0.6048, the provider's own quoted $0.60" },
  "video:seedance-2-fast:6:720p": { cogsUsd: 0.7303338, source: "ModelArk/1544106 + /1520757 — 6s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $5.60/M" },
  "video:seedance-2-fast:7:720p": { cogsUsd: 0.8520561, source: "ModelArk/1544106 + /1520757 — 7s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $5.60/M" },
  "video:seedance-2-fast:8:720p": { cogsUsd: 0.9737784, source: "ModelArk/1544106 + /1520757 — 8s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $5.60/M" },
  "video:seedance-2-fast:9:720p": { cogsUsd: 1.0955007, source: "ModelArk/1544106 + /1520757 — 9s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $5.60/M" },
  "video:seedance-2-fast:10:720p": { cogsUsd: 1.217223, source: "ModelArk/1544106 + /1520757 — 10s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $5.60/M; 16:9 would be $1.2096, the provider's own quoted $1.21" },
  "video:seedance-2-fast:11:720p": { cogsUsd: 1.3389453, source: "ModelArk/1544106 + /1520757 — 11s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $5.60/M" },
  "video:seedance-2-fast:12:720p": { cogsUsd: 1.4606676, source: "ModelArk/1544106 + /1520757 — 12s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $5.60/M" },
  "video:seedance-2-fast:13:720p": { cogsUsd: 1.5823899, source: "ModelArk/1544106 + /1520757 — 13s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $5.60/M" },
  "video:seedance-2-fast:14:720p": { cogsUsd: 1.7041122, source: "ModelArk/1544106 + /1520757 — 14s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $5.60/M" },
  "video:seedance-2-fast:15:720p": { cogsUsd: 1.8258345, source: "ModelArk/1544106 + /1520757 — 15s × 21,736.125 tok/s (720p worst ratio 4:3, 927,408px) × $5.60/M" },
  "video:seedance-2-fast:4:480p": { cogsUsd: 0.2249856, source: "ModelArk/1544106 + /1520757 — 4s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $5.60/M" },
  "video:seedance-2-fast:5:480p": { cogsUsd: 0.281232, source: "ModelArk/1544106 + /1520757 — 5s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $5.60/M; 16:9 would be $0.28, the provider's own worked example" },
  "video:seedance-2-fast:6:480p": { cogsUsd: 0.3374784, source: "ModelArk/1544106 + /1520757 — 6s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $5.60/M" },
  "video:seedance-2-fast:7:480p": { cogsUsd: 0.3937248, source: "ModelArk/1544106 + /1520757 — 7s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $5.60/M" },
  "video:seedance-2-fast:8:480p": { cogsUsd: 0.4499712, source: "ModelArk/1544106 + /1520757 — 8s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $5.60/M" },
  "video:seedance-2-fast:9:480p": { cogsUsd: 0.5062176, source: "ModelArk/1544106 + /1520757 — 9s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $5.60/M" },
  "video:seedance-2-fast:10:480p": { cogsUsd: 0.562464, source: "ModelArk/1544106 + /1520757 — 10s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $5.60/M" },
  "video:seedance-2-fast:11:480p": { cogsUsd: 0.6187104, source: "ModelArk/1544106 + /1520757 — 11s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $5.60/M" },
  "video:seedance-2-fast:12:480p": { cogsUsd: 0.6749568, source: "ModelArk/1544106 + /1520757 — 12s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $5.60/M" },
  "video:seedance-2-fast:13:480p": { cogsUsd: 0.7312032, source: "ModelArk/1544106 + /1520757 — 13s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $5.60/M" },
  "video:seedance-2-fast:14:480p": { cogsUsd: 0.7874496, source: "ModelArk/1544106 + /1520757 — 14s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $5.60/M" },
  "video:seedance-2-fast:15:480p": { cogsUsd: 0.843696, source: "ModelArk/1544106 + /1520757 — 15s × 10,044 tok/s (480p worst ratio 21:9, 428,544px) × $5.60/M" },
  "video:seedance-2-fast:ref": {
    cogsUsd: 0.78408,
    source: "docs.byteplus.com/en/docs/ModelArk/Pricing (2026-08-05) — (6s ref cap + 5s output) × 21,600 tok/s × $3.30/M = $0.78408 (with-video-input rate; our window's worst case)",
  },
};

/**
 * PURE: given rows [{ id, label, chargeUsd, cogsUsd, cogsSource }], compute the
 * margin and pass/fail for each against `floor`. Returns { rows, ok }.
 * Exported for the red/green self-test in scripts/__tests__/check-margin-floor.test.mjs.
 */
export function evaluateMarginFloor(rows, floor = MARGIN_FLOOR) {
  const evaluated = rows.map((r) => {
    const margin = (r.chargeUsd - r.cogsUsd) / r.chargeUsd;
    return { ...r, margin, pass: margin >= floor - FLOOR_EPSILON };
  });
  return { rows: evaluated, ok: evaluated.every((r) => r.pass) };
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
  const { pricedGenCredits, pricedRefgenCredits, CREDITS_PER_USD, FLAT_PRICED_VIDEO_MODELS } = spend;
  const { GEN_VIDEO_MODEL_OPTIONS } = gen;
  const toUsd = (internal) => internal / CREDITS_PER_USD;

  const skus = [];
  const missing = [];
  const add = (id, label, chargeUsd) => {
    const c = COGS_INPUTS[id];
    if (!c) {
      missing.push(id);
      return;
    }
    skus.push({ id, label, chargeUsd, cogsUsd: c.cogsUsd, cogsSource: c.source });
  };

  // Image + reference image (seedream, count = 1 displayed credit each).
  add("image:seedream", "Image (seedream ×1)", toUsd(pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null })));
  add("refgen:seedream", "Reference image (refgen ×1)", toUsd(pricedRefgenCredits({ model: "seedream", count: 1 })));

  // Every flat-priced (margin-floored) video model × its REAL sellable
  // durations/resolutions, plus the whole-clip reference-video path (E1-06).
  // Audio is omitted from the key: it changes neither the Seedance charge nor its COGS.
  for (const model of FLAT_PRICED_VIDEO_MODELS) {
    const opts = GEN_VIDEO_MODEL_OPTIONS[model];
    if (!opts) {
      missing.push(`opts:${model}`);
      continue;
    }
    const resolutions = opts.resolutions.length ? opts.resolutions : [""];
    for (const seconds of opts.durations) {
      for (const resolution of resolutions) {
        const charge = pricedGenCredits({ kind: "VIDEO", model, count: 1, videoOptions: { seconds, resolution, audio: true } });
        add(`video:${model}:${seconds}:${resolution}`, `Video ${model} ${seconds}s ${resolution || "(default res)"}`, toUsd(charge));
      }
    }
    const refCharge = pricedGenCredits({
      kind: "VIDEO",
      model,
      count: 1,
      referenceVideoGenerationId: "gate",
      videoOptions: { seconds: 5, resolution: opts.resolutions[0] ?? "720p", audio: true },
    });
    add(`video:${model}:ref`, `Reference video ${model} (E1-06)`, toUsd(refCharge));
  }

  return { skus, missing };
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

async function main() {
  const { skus, missing } = await buildSellableSkus();
  const { rows } = evaluateMarginFloor(skus);
  // @fikirtive/core owns BOTH the derived cost table (from the official token formula)
  // and the single pending-ruling registry — so the unit tests and this gate can never
  // disagree about which tiers are parked, and their two cost sources are pinned below.
  const { BELOW_FLOOR_PENDING_FOUNDER_RULING, BELOW_FLOOR_FOUNDER_ACCEPTED, marginTruthTable } = await import(
    pathToFileURL(path.join(root, "packages/core/dist/margin-truth.js")).href
  );
  const today = new Date().toISOString().slice(0, 10);
  const parkedIds = new Set((BELOW_FLOOR_PENDING_FOUNDER_RULING ?? []).map((p) => p?.tier));
  const acceptedIds = new Set((BELOW_FLOOR_FOUNDER_ACCEPTED ?? []).map((e) => e?.tier));

  console.log(`[margin-floor] 宪法 5 floor = ${pct(MARGIN_FLOOR)} · formula = (price − cost) / price`);
  for (const r of rows) {
    // RULED = below the floor with the founder's explicit acceptance on record. It is printed
    // as its own word, never as "OK" — an accepted exemption must stay visible every run.
    const flag = r.pass ? "OK " : acceptedIds.has(r.id) ? "RULED" : parkedIds.has(r.id) ? "PENDING" : "RED";
    console.log(
      `[margin-floor] ${flag.padEnd(7)} ${r.label.padEnd(34)} charge $${r.chargeUsd.toFixed(3)}  cost $${r.cogsUsd.toFixed(3)}  margin ${pct(r.margin)}`,
    );
  }

  if (missing.length) {
    console.error(`[margin-floor] MISSING costing input for sellable SKU(s): ${missing.join(", ")}`);
    console.error("[margin-floor] add the provider COGS (with a primary-source citation) to COGS_INPUTS — a sellable combo must never ship without a certified cost.");
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
      console.warn(`[margin-floor]     ratios below the floor: ${entry.ratios.join(", ")} (the tier's other ratios clear it)`);
      console.warn(`[margin-floor]     why: ${entry.reason}`);
      console.warn(`[margin-floor]     Founder 已裁 ${entry.ruledOn} · ${entry.source}`);
    }
    console.warn("[margin-floor] Accepted ≠ invisible: they are printed every run so the exemption can never fade into the background.");
  }
  const clear = rows.length - parked.length - accepted.length;
  console.log(`[margin-floor] ${clear}/${rows.length} sellable SKU(s) clear the ${pct(MARGIN_FLOOR)} floor (${accepted.length} below it by founder ruling).`);
}

// Run as CLI only — importing this module (the self-test) must not execute main().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("[margin-floor] gate crashed:", e?.message ?? e);
    process.exit(1);
  });
}
