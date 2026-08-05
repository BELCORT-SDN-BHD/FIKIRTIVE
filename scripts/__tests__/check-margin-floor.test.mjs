// Permanent red/green self-test for scripts/check-margin-floor.mjs (B10 · 宪法 5).
// Feeds fixture charge/cost rows to the exported pure evaluateMarginFloor() and
// asserts the floor alarm fires on thin/inverted margins and stays green at/above
// 45% — no real pricing violation ever lands in the repo. Importing the gate does
// NOT run it (main is guarded). Run: node scripts/__tests__/check-margin-floor.test.mjs
import assert from "node:assert/strict";
import { evaluateMarginFloor, MARGIN_FLOOR, COGS_INPUTS } from "../check-margin-floor.mjs";

// ── GREEN cases (margin ≥ 45% floor) ──
{
  // Exactly-45.0% boundary fixture (0.63/1.40 = 0.4499999…) → must pass via epsilon.
  // Historical: this WAS the 720p/10s tier under the 2026-06 resource-pack cost basis;
  // #644 re-based it to list price, so it now survives here only as the epsilon fixture.
  const { rows, ok } = evaluateMarginFloor([{ id: "v10", label: "10s", chargeUsd: 1.4, cogsUsd: 0.77 }]);
  assert.equal(ok, true, "exactly-45% tier passes (IEEE754 epsilon)");
  assert.equal(rows[0].pass, true);
}
{
  // E1-06 whole-clip reference video at present value: 16cr=$1.60 vs $0.78408 → 51.0% → green.
  const { rows, ok } = evaluateMarginFloor([{ id: "ref", label: "E1-06 ref", chargeUsd: 1.6, cogsUsd: 0.78408 }]);
  assert.equal(ok, true, "E1-06 16cr clears the floor at current prices");
  assert.ok(rows[0].margin > 0.50 && rows[0].margin < 0.52);
}

// ── RED cases (margin < 45% floor → alarm fires) ──
{
  // The historical 7cr reference-video inversion: $0.70 charge vs $0.85 cost → negative margin.
  const { rows, ok } = evaluateMarginFloor([{ id: "ref7", label: "stale 7cr ref", chargeUsd: 0.7, cogsUsd: 0.85 }]);
  assert.equal(ok, false, "inverted (cost > price) margin must fail");
  assert.equal(rows[0].pass, false);
  assert.ok(rows[0].margin < 0);
}
{
  // Just under the floor: 44% must fail (proves the boundary is real, not slack).
  const { rows, ok } = evaluateMarginFloor([{ id: "thin", label: "44%", chargeUsd: 1.0, cogsUsd: 0.56 }]);
  assert.equal(ok, false, "44% < 45% floor must fail");
  assert.equal(rows[0].pass, false);
}
{
  // Mixed batch: one red poisons ok, greens still individually pass.
  const { rows, ok } = evaluateMarginFloor([
    { id: "ok", label: "green", chargeUsd: 0.1, cogsUsd: 0.035 },
    { id: "bad", label: "red", chargeUsd: 0.1, cogsUsd: 0.08 },
  ]);
  assert.equal(ok, false, "any single red fails the whole gate");
  assert.equal(rows[0].pass, true);
  assert.equal(rows[1].pass, false);
}

// ── structural sanity: floor constant + E1-06 costing entry present ──
assert.equal(MARGIN_FLOOR, 0.45, "constitutional floor is 45%");
assert.ok(COGS_INPUTS["video:seedance-2-fast:ref"], "E1-06 reference-video COGS input registered");
assert.ok(COGS_INPUTS["image:seedream"] && COGS_INPUTS["video:seedance-2-fast:5:720p"] && COGS_INPUTS["video:seedance-2-fast:10:720p"]);

console.log("✓ check-margin-floor red/green self-test passed");
