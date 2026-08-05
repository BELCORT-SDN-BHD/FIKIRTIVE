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
 *   - COST side: an INDEPENDENT, founder-certified COGS input table transcribed
 *     verbatim from the locked costing terminal case
 *     (docs/design/2026-07-03-harmony-04-costing-model.md §二). These are the SAME
 *     provider-cost numbers the 45% margin column was certified against.
 *
 * Why it is NOT redundant with packages/core/src/spend.test.ts: that unit test
 * compares the charge against the code's OWN record-only COGS (genSpentUsd). If
 * someone edited genSpentUsd downward, that test would still pass. This gate pins
 * the live charge against the doc-sourced bill COGS, so BOTH a charge cut AND a
 * costing-input drift turn it red. It also runs in the fast `check` job (not just
 * the `test` job) and carries a red/green self-test proving the alarm still fires.
 *
 * This gate NEVER changes pricing (pricing = B12/founder). It only reports red/green.
 * E1-06 (whole-clip reference video, present value 16cr) is evaluated at current
 * prices and reported honestly; if it ever falls below the floor it lights red for
 * the control plane to adjudicate — the gate does not self-correct it.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Constitutional margin floor: (price − cost)/price ≥ 45%. */
export const MARGIN_FLOOR = 0.45;
/** IEEE754 tolerance: the 720p/10s tier sits EXACTLY at 45.0% — 0.63/1.40 is
 *  0.44999999999999996 in float. Same epsilon the existing spend.test.ts uses. */
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
  "video:seedance-2-fast:5:720p": {
    cogsUsd: 0.6048,
    source: "docs.byteplus.com/en/docs/ModelArk/Pricing (2026-08-05) — 5s × 21,600 tok/s × $5.60/M = $0.6048 (list price; provider quotes $0.60)",
  },
  "video:seedance-2-fast:10:720p": {
    cogsUsd: 1.2096,
    source: "docs.byteplus.com/en/docs/ModelArk/Pricing (2026-08-05) — 10s × 21,600 tok/s × $5.60/M = $1.2096 (list price; provider quotes $1.21)",
  },
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
  // The SINGLE registry of tiers already known to be below the floor and awaiting the
  // founder's pricing ruling (#644). It lives in @fikirtive/core so the unit tests and
  // this gate can never disagree about which tiers are adjudicated.
  const { BELOW_FLOOR_PENDING_FOUNDER_RULING } = await import(
    pathToFileURL(path.join(root, "packages/core/dist/margin-truth.js")).href
  );

  console.log(`[margin-floor] 宪法 5 floor = ${pct(MARGIN_FLOOR)} · formula = (price − cost) / price`);
  for (const r of rows) {
    const flag = r.pass ? "OK " : BELOW_FLOOR_PENDING_FOUNDER_RULING.has(r.id) ? "PENDING" : "RED";
    console.log(
      `[margin-floor] ${flag} ${r.label.padEnd(34)} charge $${r.chargeUsd.toFixed(3)}  cost $${r.cogsUsd.toFixed(3)}  margin ${pct(r.margin)}`,
    );
  }

  if (missing.length) {
    console.error(`[margin-floor] MISSING costing input for sellable SKU(s): ${missing.join(", ")}`);
    console.error("[margin-floor] add the provider COGS (with a primary-source citation) to COGS_INPUTS — a sellable combo must never ship without a certified cost.");
    process.exit(1);
  }

  // Selling below cost is a hard failure for EVERY tier — the pending list never covers it.
  const inverted = rows.filter((r) => r.chargeUsd <= r.cogsUsd);
  // A tier on the pending list that now clears the floor means the ruling landed and the
  // list went stale — red, so the registry can never rot into a permanent exemption.
  const staleRuling = rows.filter((r) => r.pass && BELOW_FLOOR_PENDING_FOUNDER_RULING.has(r.id));
  // Anything else below the floor is a NEW violation.
  const red = rows.filter((r) => !r.pass && !BELOW_FLOOR_PENDING_FOUNDER_RULING.has(r.id));

  if (inverted.length) {
    console.error(`[margin-floor] ${inverted.length} SKU(s) charge AT OR BELOW cost — every sale loses money:`);
    for (const r of inverted) console.error(`[margin-floor]   ${r.id}: charge $${r.chargeUsd} cost $${r.cogsUsd} — cost basis: ${r.cogsSource}`);
    process.exit(1);
  }
  if (red.length) {
    console.error(`[margin-floor] ${red.length} SKU(s) below the ${pct(MARGIN_FLOOR)} floor:`);
    for (const r of red) console.error(`[margin-floor]   ${r.id}: margin ${pct(r.margin)} — cost basis: ${r.cogsSource}`);
    console.error("[margin-floor] This is a pricing violation. Do NOT edit COGS_INPUTS to silence it — report to the control plane (pricing = B12/founder).");
    process.exit(1);
  }
  if (staleRuling.length) {
    console.error(`[margin-floor] ${staleRuling.length} SKU(s) now clear the floor but are still on BELOW_FLOOR_PENDING_FOUNDER_RULING:`);
    for (const r of staleRuling) console.error(`[margin-floor]   ${r.id}: margin ${pct(r.margin)} — remove it from packages/core/src/margin-truth.ts`);
    process.exit(1);
  }

  const pending = rows.filter((r) => !r.pass);
  if (pending.length) {
    console.warn(`[margin-floor] ${pending.length} SKU(s) BELOW the ${pct(MARGIN_FLOOR)} floor, awaiting the founder's pricing ruling (#644):`);
    for (const r of pending) console.warn(`[margin-floor]   ${r.id}: margin ${pct(r.margin)} — cost basis: ${r.cogsSource}`);
    console.warn("[margin-floor] These are REPORTED, not waived — the ruling is 调价 or 接受, and it is the founder's to make.");
  }
  console.log(`[margin-floor] ${rows.length - pending.length}/${rows.length} sellable SKU(s) clear the ${pct(MARGIN_FLOOR)} floor.`);
}

// Run as CLI only — importing this module (the self-test) must not execute main().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("[margin-floor] gate crashed:", e?.message ?? e);
    process.exit(1);
  });
}
