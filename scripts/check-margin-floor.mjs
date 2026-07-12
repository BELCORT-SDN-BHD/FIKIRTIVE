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
 * Founder-certified provider COGS, verbatim from the locked costing terminal case
 * (docs/design/2026-07-03-harmony-04-costing-model.md §二). Keyed by sellable-SKU id
 * (see buildSellableSkus). Do NOT edit these to make the gate pass — a change here is
 * a costing decision (B12/founder), and drift is exactly what this gate should catch.
 *
 * Conservative note (image): §二 bills images per-image at $0.035; the code's
 * record-only basis is $0.04 (gen.ts:90) and the token-推算 upper bound is ≈$0.054
 * (costing-inputs §1a). All three clear the floor (65% / 60% / 46%); we pin the
 * §二 certified value.
 */
export const COGS_INPUTS = {
  "image:seedream": {
    cogsUsd: 0.035,
    source: "harmony-04-costing-model.md:22 — BytePlus bill 3003327224, $0.035/img (per-image billing)",
  },
  "refgen:seedream": {
    cogsUsd: 0.035,
    source: "harmony-04-costing-model.md:22 — refgen shares the image bill basis",
  },
  "video:seedance-2-fast:5:720p": {
    cogsUsd: 0.39,
    source: "harmony-04-costing-model.md:23 — 5s/720p ≈ $0.39 (0.077/s × 5s, bill-backed)",
  },
  "video:seedance-2-fast:10:720p": {
    cogsUsd: 0.77,
    source: "harmony-04-costing-model.md:24 — 10s/720p ≈ $0.77 (0.077/s × 10s)",
  },
  "video:seedance-2-fast:ref": {
    cogsUsd: 0.85,
    source: "harmony-04-costing-model.md:25 — whole-clip ref, 6s input + 5s output ≈ $0.85 (E1-06 present value)",
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
  const { rows, ok } = evaluateMarginFloor(skus);

  console.log(`[margin-floor] 宪法 5 floor = ${pct(MARGIN_FLOOR)} · formula = (price − cost) / price`);
  for (const r of rows) {
    const flag = r.pass ? "OK " : "RED";
    console.log(
      `[margin-floor] ${flag} ${r.label.padEnd(34)} charge $${r.chargeUsd.toFixed(3)}  cost $${r.cogsUsd.toFixed(3)}  margin ${pct(r.margin)}`,
    );
  }

  if (missing.length) {
    console.error(`[margin-floor] MISSING costing input for sellable SKU(s): ${missing.join(", ")}`);
    console.error("[margin-floor] add the provider COGS (with a harmony-04 source) to COGS_INPUTS — a sellable combo must never ship without a certified cost.");
    process.exit(1);
  }
  if (!ok) {
    const red = rows.filter((r) => !r.pass);
    console.error(`[margin-floor] ${red.length} SKU(s) below the ${pct(MARGIN_FLOOR)} floor:`);
    for (const r of red) console.error(`[margin-floor]   ${r.id}: margin ${pct(r.margin)} — cost basis: ${r.cogsSource}`);
    console.error("[margin-floor] This is a pricing violation. Do NOT edit COGS_INPUTS to silence it — report to the control plane (pricing = B12/founder).");
    process.exit(1);
  }
  console.log(`[margin-floor] all ${rows.length} sellable SKU(s) clear the ${pct(MARGIN_FLOOR)} floor.`);
}

// Run as CLI only — importing this module (the self-test) must not execute main().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("[margin-floor] gate crashed:", e?.message ?? e);
    process.exit(1);
  });
}
