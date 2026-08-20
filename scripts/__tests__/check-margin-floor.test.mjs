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
  reportFxPin,
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
assert.ok(COGS_INPUTS["video:seedance-2-mini:ref"], "E1-06 reference-video COGS input registered");
assert.ok(COGS_INPUTS["image:seedream"] && COGS_INPUTS["video:seedance-2-mini:5:720p"] && COGS_INPUTS["video:seedance-2-mini:10:720p"]);

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
// R2: below floor and in neither registry.
assert.ok(fails([lowRow], []).some((x) => /neither registry \(R2\)/.test(x)), "an unparked violation must fail");
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

// ── #645 T4: the ACCEPTED registry (Founder 已裁接受) — rules A1…A5 ────────────
// Identical structure to the pending self-test above: every alarm is proven to fire, so an
// accepted exemption can never quietly widen into a blanket waiver.
const validAccept = (over = {}) => ({
  tier: "v10",
  ratios: ["4:3", "3:4"],
  margin: 0.4467,
  reason: "the tier's worst ratio lands 0.33pt under the floor; the founder accepted it",
  ruledOn: "2026-08-06",
  source: "https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/645#issuecomment-5202464378",
  ...over,
});
const acceptFails = (rows, accepted, today = TODAY) => evaluateFloorDecisions(rows, [], today, accepted).hardFails;

// A5 GREEN: below floor, properly accepted → reported as accepted, not a failure.
{
  const { ok, accepted, parked, hardFails } = evaluateFloorDecisions([okRow, lowRow], [], TODAY, [validAccept()]);
  assert.equal(ok, true, `a properly accepted tier must not fail: ${hardFails.join("; ")}`);
  assert.deepEqual(accepted.map((r) => r.id), ["v10"], "the accepted tier is still REPORTED");
  assert.deepEqual(parked, [], "an accepted tier is not a pending one");
}
// A1: each required field, missing or blank.
for (const field of ["reason", "ruledOn", "source"]) {
  assert.ok(
    acceptFails([lowRow], [validAccept({ [field]: "  " })]).some((x) => x.includes(`missing "${field}"`)),
    `a blank ${field} must fail (an exemption must say who ruled, when, and why)`,
  );
}
assert.ok(
  acceptFails([lowRow], [validAccept({ ratios: [] })]).some((x) => /must name the ratio\(s\)/.test(x)),
  "an exemption that does not name the offending ratios must fail",
);
assert.ok(
  acceptFails([lowRow], [{ ...validAccept(), tier: "  " }]).some((x) => /accepted floor exception with no tier id/.test(x)),
  "a tier-less accepted entry must fail",
);
assert.ok(
  acceptFails([lowRow], [validAccept({ ruledOn: "6 Aug 2026" })]).some((x) => /not YYYY-MM-DD \(A1\)/.test(x)),
  "a malformed ruledOn must fail",
);
// A2: accepted entry naming a tier that is not sellable.
assert.ok(
  acceptFails([okRow], [validAccept({ tier: "video:ghost:99:8k" })]).some((x) => /not a sellable SKU/.test(x)),
  "an accepted entry pointing at nothing must fail",
);
// A3: accepted but now clears the floor → the exemption went stale and must be deleted.
assert.ok(
  acceptFails([{ ...lowRow, margin: 0.55, pass: true }], [validAccept()])
    .some((x) => /remove it from BELOW_FLOOR_FOUNDER_ACCEPTED \(A3\)/.test(x)),
  "an accepted tier that now clears the floor must fail",
);
// A4: a tier in BOTH registries has an ambiguous status.
assert.ok(
  evaluateFloorDecisions([lowRow], [validPark()], TODAY, [validAccept()]).hardFails
    .some((x) => /appears in BOTH the pending-ruling and the accepted-exception registry/.test(x)),
  "a tier in both registries must fail",
);
// R1 still wins over an acceptance: no ruling licenses selling below cost.
{
  const inverted = { id: "v10", chargeUsd: 0.7, cogsUsd: 0.85, margin: -0.214, pass: false };
  assert.ok(
    acceptFails([inverted], [validAccept()]).some((x) => /every sale loses money \(R1\)/.test(x)),
    "an acceptance never covers selling below cost",
  );
}
// The accepted registry is optional — omitting it keeps the pre-#645 behaviour exactly.
assert.equal(evaluateFloorDecisions([okRow], [], TODAY).ok, true);

// ── structural sanity: the expanded tier table is fully costed (#645 T4) ──
for (const seconds of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  for (const res of ["480p", "720p"]) {
    assert.ok(
      COGS_INPUTS[`video:seedance-2-mini:${seconds}:${res}`],
      `#645: sellable tier ${seconds}s ${res} must carry a certified COGS input`,
    );
  }
}

// ── 钱路 M1-c:按量计价的三个付费面必须带成本输入(否则 gate 的 MISSING 检查会红) ──
for (const id of ["otto:chat", "otto:research:llm", "otto:research:search"]) {
  assert.ok(COGS_INPUTS[id], `钱路 M1-c: 按量计价面 ${id} 必须在 COGS_INPUTS 里`);
  assert.equal(COGS_INPUTS[id].cogsUsd, 1, `${id} 的成本单位是「每 $1 provider 成本」`);
}

// ── 钱路 M1-c:FX 钉点闸的红/黄/绿自测(Founder 2026-08-18 裁决 10) ──────────────
// 规则本体是 @fikirtive/core 的纯函数;这里测的是**闸怎么处置它** —— 红要退出码 1,
// 黄只是提醒。两者混为一谈,汇率复核过期就会把整条发布线停掉,那是没人会容忍的闸,
// 而一个没人容忍的闸最后一定被关掉。
{
  const green = reportFxPin([]);
  assert.equal(green.ok, true, "无问题 → 绿");
  assert.equal(green.red.length, 0);
  assert.equal(green.yellow.length, 0);
}
{
  // 黄:复核到期。ok 必须仍然是 true —— 黄灯不拦 CI。
  const yellow = reportFxPin([{ level: "yellow", message: "复核期到了" }]);
  assert.equal(yellow.ok, true, "黄灯不许把闸判红");
  assert.equal(yellow.yellow.length, 1);
}
{
  // 红:令吉弱过钉点。ok 必须是 false —— 毛利被吃必须停下来问 Founder。
  const red = reportFxPin([{ level: "red", message: "参考现汇已经弱过钉点" }]);
  assert.equal(red.ok, false, "红灯必须判红");
  assert.equal(red.red.length, 1);
}
{
  // 红 + 黄同时出现 → 仍然红(红压过黄)。
  const both = reportFxPin([
    { level: "yellow", message: "复核期到了" },
    { level: "red", message: "弱过钉点" },
  ]);
  assert.equal(both.ok, false, "同时有红有黄时,闸是红的");
}

// 仓库现行的 FX 钉点在今天必须是全绿的 —— 闸自己也不许带着一条已知红线合并。
{
  const { FX_PIN, evaluateFxPin } = await import("../../packages/core/dist/pricing-config.js");
  const today = new Date().toISOString().slice(0, 10);
  const problems = evaluateFxPin(FX_PIN, today);
  assert.equal(
    problems.filter((p) => p.level === "red").length,
    0,
    `现行 FX 钉点有红线:${problems.map((p) => p.message).join("; ")}`,
  );
  // 到期日必须在观察日之后(否则闹钟一上来就在响)。
  assert.ok(FX_PIN.nextReviewDate > FX_PIN.reference.observedOn, "复核到期日必须晚于观察日");
}

console.log("✓ check-margin-floor red/green self-test passed");
