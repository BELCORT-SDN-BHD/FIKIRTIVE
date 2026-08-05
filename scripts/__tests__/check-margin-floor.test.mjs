// Permanent red/green self-test for scripts/check-margin-floor.mjs (B10 · 宪法 5).
// Feeds fixture charge/cost rows to the exported pure evaluateMarginFloor() and
// asserts the floor alarm fires on thin/inverted margins and stays green at/above
// 45% — no real pricing violation ever lands in the repo. Importing the gate does
// NOT run it (main is guarded). Run: node scripts/__tests__/check-margin-floor.test.mjs
import assert from "node:assert/strict";
import {
  evaluateMarginFloor,
  evaluateFloorDecisions,
  assertCogsAgreement,
  MARGIN_FLOOR,
  COGS_INPUTS,
} from "../check-margin-floor.mjs";

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

// ── P1: the two independent cost sources are pinned to each other ──
const TODAY = "2026-08-06";
{
  // GREEN: hand-transcribed table agrees with the core-derived table.
  const { ok, problems } = assertCogsAgreement(
    { a: { cogsUsd: 0.6048 }, b: { cogsUsd: 0.035 } },
    [{ id: "a", cogsUsd: 0.6048 }, { id: "b", cogsUsd: 0.035 }],
  );
  assert.equal(ok, true, `agreeing cost sources pass: ${problems.join("; ")}`);
}
{
  // RED: a rate correction applied to ONE side only — the exact recurrence channel #644 closes.
  const { ok, problems } = assertCogsAgreement(
    { a: { cogsUsd: 0.077 } },              // gate still on the stale resource-pack rate
    [{ id: "a", cogsUsd: 0.12096 }],        // core moved to list price
  );
  assert.equal(ok, false, "a one-sided COGS edit must fail the agreement check");
  assert.match(problems[0], /drifted/);
}
{
  // RED both ways: a tier present on only one side is coverage rot, not agreement.
  assert.equal(assertCogsAgreement({ a: { cogsUsd: 1 } }, []).ok, false, "gate-only tier fails");
  assert.equal(assertCogsAgreement({}, [{ id: "a", cogsUsd: 1 }]).ok, false, "core-only tier fails");
}

// ── P2: every floor exception rule, one case each ──
const okRow = { id: "img", chargeUsd: 0.1, cogsUsd: 0.035, margin: 0.65, pass: true };
const lowRow = { id: "v10", chargeUsd: 1.4, cogsUsd: 1.2096, margin: 0.136, pass: false };
const validPark = (over = {}) => ({
  tier: "v10",
  reason: "牌价成本 $1.2096 对上 14cr = $1.40",
  rulingRef: "https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/655",
  reviewBy: "2026-08-20",
  ...over,
});
const fails = (rows, pending, today = TODAY) => evaluateFloorDecisions(rows, pending, today).hardFails;

// R7 GREEN: below floor, properly parked, in date → reported, not a failure.
{
  const { ok, parked, hardFails } = evaluateFloorDecisions([okRow, lowRow], [validPark()], TODAY);
  assert.equal(ok, true, `properly parked tier must not fail: ${hardFails.join("; ")}`);
  assert.deepEqual(parked.map((r) => r.id), ["v10"], "the parked tier is still REPORTED");
}
// R1: charge ≤ cost is a hard failure even when parked.
{
  const inverted = { id: "v10", chargeUsd: 0.7, cogsUsd: 0.85, margin: -0.214, pass: false };
  const f = fails([inverted], [validPark()]);
  assert.ok(f.some((x) => /every sale loses money \(R1\)/.test(x)), "parking never covers selling below cost");
}
// R2: below floor and not parked at all.
assert.ok(fails([lowRow], []).some((x) => /not parked \(R2\)/.test(x)), "an unparked violation must fail");
// R3: parked but now clears the floor → the registry went stale.
assert.ok(
  fails([{ ...lowRow, margin: 0.55, pass: true }], [validPark()]).some((x) => /remove it from BELOW_FLOOR/.test(x)),
  "a parked tier that now clears the floor must fail",
);
// R4: each required field, missing or blank.
for (const field of ["reason", "rulingRef", "reviewBy"]) {
  assert.ok(
    fails([lowRow], [validPark({ [field]: "  " })]).some((x) => x.includes(`missing "${field}"`)),
    `a blank ${field} must fail (a bare id is a permanent exemption)`,
  );
}
assert.ok(fails([lowRow], [{ reason: "x", rulingRef: "y", reviewBy: "2026-08-20" }]).some((x) => /no tier id/.test(x)), "a tier-less entry must fail");
assert.ok(fails([lowRow], [validPark({ reviewBy: "20 Aug 2026" })]).some((x) => /not YYYY-MM-DD/.test(x)), "a malformed reviewBy must fail");
// R5: the alarm clock actually rings.
{
  const f = fails([lowRow], [validPark()], "2026-08-21");
  assert.ok(f.some((x) => /overdue \(R5\)/.test(x)), "a past reviewBy must fail");
  assert.equal(evaluateFloorDecisions([lowRow], [validPark()], "2026-08-20").ok, true, "reviewBy is inclusive of its own day");
}
// R6: parked entry naming a tier that is not sellable.
assert.ok(
  fails([okRow], [validPark({ tier: "video:ghost:99:8k" })]).some((x) => /not a sellable SKU/.test(x)),
  "a registry entry pointing at nothing must fail",
);
// An empty/absent registry is fine as long as nothing is below the floor.
assert.equal(evaluateFloorDecisions([okRow], [], TODAY).ok, true);
assert.equal(evaluateFloorDecisions([okRow], undefined, TODAY).ok, true);

console.log("✓ check-margin-floor red/green self-test passed");
