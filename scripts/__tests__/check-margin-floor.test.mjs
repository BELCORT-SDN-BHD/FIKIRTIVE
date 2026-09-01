// Permanent red/green self-test for scripts/check-margin-floor.mjs (B10 · 宪法 5).
// Feeds fixture charge/cost rows to the exported pure evaluateMarginFloor() and
// asserts the floor alarm fires on thin/inverted margins and stays green at/above
// 45% — no real pricing violation ever lands in the repo. Importing the gate does
// NOT run it (main is guarded). Run: node scripts/__tests__/check-margin-floor.test.mjs
import assert from "node:assert/strict";
import {
  evaluateMarginFloor,
  evaluateFloorDecisions,
  evaluateTargetLine,
  assertCogsAgreement,
  reportFxPin,
  reportCostPins,
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

// ── MONEY-A2:65% 目标线的红/黄/绿自测(规格 §7.2,全新的第二条线) ────────────────
// 这条线判的是「价目该不该重定」,不是「是不是在亏钱」,所以它的红判词必须逐字带
// 「等 Founder 重定价」—— 一条说不清该找谁的闸,最后会被当成噪音关掉。
const TARGET = 0.65;
const genRow = (over = {}) => ({ id: "image:seedream", chargeUsd: 0.1, cogsUsd: 0.035, ...over });
const usageRow = (over = {}) => ({ id: "otto:chat", chargeUsd: 1.05, cogsUsd: 1, usagePriced: true, ...over });
const parkAt = (over = {}) => ({
  tier: "image:seedream",
  reason: "供应商图价上涨 20%,价目待重定",
  rulingRef: "https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1113",
  reviewBy: "2026-09-30",
  ...over,
});
{
  // GREEN:恰好压在 65.0000% 上必须过(图 / 参考图今天就是这个形状,进位余量 $0.00)。
  const t = evaluateTargetLine([genRow()], TARGET, [], TODAY);
  assert.equal(t.ok, true, `恰好 65.0% 必须过(IEEE754 容差):${t.reds.join("; ")}`);
  assert.equal(t.parked.length, 0);
}
{
  // MONEY-A2 RED:供应商图价涨到 $0.04 → 面值毛利 60%,破 65% 目标线,判词点名「等 Founder 重定价」。
  const t = evaluateTargetLine([genRow({ cogsUsd: 0.04 })], TARGET, [], TODAY);
  assert.equal(t.ok, false, "MONEY-A2: 跌破 65% 目标线必须红");
  assert.match(t.reds[0], /等 Founder 重定价/, "MONEY-A2: 目标线红判词必须逐字含「等 Founder 重定价」");
  assert.match(t.reds[0], /65% 目标线/);
}
{
  // YELLOW:同一条破线,进了带登记与复核期的待裁决名单 → 降黄,不拦。
  const t = evaluateTargetLine([genRow({ cogsUsd: 0.04 })], TARGET, [parkAt()], TODAY);
  assert.equal(t.ok, true, `合规停车必须降黄不红:${t.reds.join("; ")}`);
  assert.deepEqual(t.parked.map((r) => r.id), ["image:seedream"], "停车的档仍然被 REPORTED");
}
{
  // RED:停车展期过期自动转红,判词点名到期。到期口径与地板闸 R5 逐字同一
  // (reviewBy 当天含在展期内,次日转红)—— 同一张登记表,两条线不许对同一天给两个答案。
  const t = evaluateTargetLine([genRow({ cogsUsd: 0.04 })], TARGET, [parkAt()], "2026-10-01");
  assert.equal(t.ok, false, "到期次日必须转红");
  assert.match(t.reds[0], /停车展期已到期/);
  assert.match(t.reds[0], /reviewBy 2026-09-30/);
  assert.match(t.reds[0], /等 Founder 重定价/);
  // 到期当天仍是黄的 —— 与地板闸 "reviewBy is inclusive of its own day" 同口径。
  assert.equal(evaluateTargetLine([genRow({ cogsUsd: 0.04 })], TARGET, [parkAt()], "2026-09-30").ok, true);
  // 到期前一天仍是黄的 —— 闹钟不许提前响。
  assert.equal(evaluateTargetLine([genRow({ cogsUsd: 0.04 })], TARGET, [parkAt()], "2026-09-29").ok, true);
}
for (const field of ["reason", "rulingRef", "reviewBy"]) {
  // RED:裸 id 不是展期,是永久豁免 —— 与地板闸 R4 同一条纪律。
  const t = evaluateTargetLine([genRow({ cogsUsd: 0.04 })], TARGET, [parkAt({ [field]: "  " })], TODAY);
  assert.equal(t.ok, false, `停车登记缺 ${field} 必须红`);
  assert.match(t.reds[0], new RegExp(`缺 "${field}"`));
  assert.match(t.reds[0], /等 Founder 重定价/);
}
{
  // 按量计价的三行**不吃** 65% 目标线:聊天 4.76%、深研 51.46% 都不该被这条线判。
  const t = evaluateTargetLine([usageRow(), usageRow({ id: "otto:research:llm", chargeUsd: 2.06 })], TARGET, [], TODAY);
  assert.equal(t.ok, true, "按量计价面不进 65% 目标线(各有各的裁决费率)");
  assert.equal(t.parked.length, 0);
}

// ── MONEY-A2:45% 地板改按最坏实收口径 ───────────────────────────────────────────
{
  // 默认系数 1 = 面值口径,与本函数的历史行为逐字相同(上面所有旧用例靠的就是这条)。
  const face = evaluateMarginFloor([{ id: "x", chargeUsd: 1.0, cogsUsd: 0.5 }]);
  assert.equal(face.rows[0].margin, 0.5);
  assert.equal(face.rows[0].receiptChargeUsd, 1.0);
}
{
  // MONEY-A2 RED:面值 50% 是过的,按最坏实收系数 0.8944 复判只剩 44.1% → 破地板。
  // 这正是研究档旧费率 2.0× 的形状,也是这次把它抬到 2.06 的全部理由。
  const WORST = 0.894444444;
  const facePass = evaluateMarginFloor([{ id: "otto:research:llm", chargeUsd: 2.0, cogsUsd: 1 }]);
  assert.equal(facePass.ok, true, "面值口径下 2.0× 是过的 —— 这就是旧闸看不见的那件事");
  const receipt = evaluateMarginFloor([{ id: "otto:research:llm", chargeUsd: 2.0, cogsUsd: 1 }], MARGIN_FLOOR, WORST);
  assert.equal(receipt.ok, false, "MONEY-A2: 最坏实收口径下 2.0× 破 45% 地板");
  assert.ok(receipt.rows[0].margin < 0.45 && receipt.rows[0].margin > 0.44);
  // 而裁决值 2.06 在同一口径下清线(45.73%)。
  const ruled = evaluateMarginFloor([{ id: "otto:research:llm", chargeUsd: 2.06, cogsUsd: 1 }], MARGIN_FLOOR, WORST);
  assert.equal(ruled.ok, true, "2.06× 在最坏实收口径下清 45% 地板");
  assert.ok(ruled.rows[0].margin > 0.457 && ruled.rows[0].margin < 0.458);
}
{
  // 口径分工:实收算进 margin,**chargeUsd 保持面值** —— 否则聊天 1.05×(实收 0.939 < 成本 1)
  // 会触发 R1「收费 ≤ 成本恒红」,而 Founder 从没裁过那件事。这一条把那个假红钉死。
  const WORST = 0.894444444;
  const { rows } = evaluateMarginFloor([{ id: "otto:chat", chargeUsd: 1.05, cogsUsd: 1 }], MARGIN_FLOOR, WORST);
  assert.equal(rows[0].chargeUsd, 1.05, "chargeUsd 必须仍是面值");
  assert.ok(rows[0].margin < 0, "实收毛利是负的(已知、已注记)");
  const f = evaluateFloorDecisions(rows, [], TODAY, [{ ...validAccept(), tier: "otto:chat" }]).hardFails;
  assert.ok(!f.some((x) => /R1/.test(x)), "面值口径的 R1 不许被实收口径误触发");
}

// ── MONEY-A2 第三判定:图片档从 registry 枚举,新增 model 而无成本钉点 = 闸红 ──────
{
  const marginTruth = await import("../../packages/core/dist/margin-truth.js");
  const { GEN_MODELS } = await import("../../packages/core/dist/gen.js");
  const { REFGEN_MODELS } = await import("../../packages/core/dist/refgen.js");
  // 现役每一个图片 / 参考图 model 都必须有钉点键,且键必须真的在钉点表里。
  const { COST_PINS } = await import("../../packages/core/dist/cost-pins.js");
  for (const model of GEN_MODELS) {
    const key = marginTruth.IMAGE_MODEL_COST_PIN[model];
    assert.ok(key, `MONEY-A2: 图片 model ${model} 没有成本钉点 = 闸红`);
    assert.ok(COST_PINS[key], `MONEY-A2: 图片 model ${model} 的钉点键 ${key} 不在钉点表里`);
  }
  for (const model of REFGEN_MODELS) {
    const key = marginTruth.REFGEN_MODEL_COST_PIN[model];
    assert.ok(key, `MONEY-A2: 参考图 model ${model} 没有成本钉点 = 闸红`);
    assert.ok(COST_PINS[key], `MONEY-A2: 参考图 model ${model} 的钉点键 ${key} 不在钉点表里`);
  }
  // 枚举出来的 SKU id 与手抄 COGS_INPUTS 逐字对齐(双证人机制靠的就是这个对齐)。
  for (const model of GEN_MODELS) assert.ok(COGS_INPUTS[`image:${model}`], `image:${model} 必须在 COGS_INPUTS 里`);
  for (const model of REFGEN_MODELS) assert.ok(COGS_INPUTS[`refgen:${model}`], `refgen:${model} 必须在 COGS_INPUTS 里`);
  // 缺钉点的形状是可判的:模拟一个只上了菜单没配钉点的 model。
  const pinMap = { ...marginTruth.IMAGE_MODEL_COST_PIN };
  assert.equal(pinMap["seedream-pro"], undefined, "未上架的 model 本来就没有钉点 —— 这正是闸要红的那一刻");
}

// ── MONEY-A4:成本钉点闸的红/黄/绿自测(判词样式与 FX 钉点一致) ────────────────────
{
  const green = reportCostPins([]);
  assert.equal(green.ok, true, "无问题 → 绿");
}
{
  // 黄:复核到期。ok 仍是 true —— 复核牌价是 Founder 的定价动作,不该拦发布。
  const yellow = reportCostPins([{ level: "yellow", pin: "image:seedream-lite:per-image", message: "复核期到了 (C4)" }]);
  assert.equal(yellow.ok, true, "成本钉点黄灯不许把闸判红");
  assert.equal(yellow.yellow.length, 1);
}
{
  // 红:缺来源。ok 必须是 false —— 没出处的成本不是证据。
  const red = reportCostPins([{ level: "red", pin: "x", message: "缺 source (C3)" }]);
  assert.equal(red.ok, false, "成本钉点红灯必须判红");
  assert.equal(red.red.length, 1);
}
{
  // 红压过黄。
  const both = reportCostPins([
    { level: "yellow", pin: "a", message: "复核期到了" },
    { level: "red", pin: "b", message: "缺 source" },
  ]);
  assert.equal(both.ok, false, "同时有红有黄时,闸是红的");
}
// 仓库现行的成本钉点表在今天必须全绿 —— 闸自己也不许带着一条已知红线合并。
{
  const { COST_PINS, evaluateAllCostPins } = await import("../../packages/core/dist/cost-pins.js");
  const today = new Date().toISOString().slice(0, 10);
  const problems = evaluateAllCostPins(today);
  assert.equal(
    problems.filter((p) => p.level === "red").length,
    0,
    `现行成本钉点有红线:${problems.map((p) => p.message).join("; ")}`,
  );
  assert.ok(Object.keys(COST_PINS).length >= 15, "首批钉点 15 条");
}

// ── MONEY-A2:实收系数由 core 现算,三包的数逐个钉住(不许手抄 0.8944) ──────────────
{
  const { CREDIT_PACKS, packReceiptCoefficient, worstPackReceiptCoefficient } = await import(
    "../../packages/core/dist/pricing-config.js"
  );
  const coeffs = CREDIT_PACKS.map((p) => packReceiptCoefficient(p));
  const near = (a, b) => Math.abs(a - b) < 5e-5;
  assert.ok(near(coeffs[0], 1.0333), `Starter 系数 ${coeffs[0]} ≠ 1.0333`);
  assert.ok(near(coeffs[1], 0.9697), `Standard 系数 ${coeffs[1]} ≠ 0.9697`);
  assert.ok(near(coeffs[2], 0.8944), `Pro 系数 ${coeffs[2]} ≠ 0.8944`);
  // 最坏包是**算出来的**(min),不是「最深折扣包」这条公理。
  assert.equal(worstPackReceiptCoefficient(), Math.min(...coeffs), "最坏系数 = min,不是记住的那个包");
  assert.ok(coeffs[0] > 1, "小包是溢价卖的 —— 「买得越多我们收得越少」是算术不是直觉");
}

// ── MONEY-A9:素材理解三类必须在闸里,而且两条线都清 ────────────────────────────────
// 理解 2026-09-01 之前是**平台自费**,于是它从来没被这个闸量过 —— 一个开始收钱却没人量过
// 的面,正是这个闸存在的理由。三行必须:① 在手抄成本表里(缺 = buildSellableSkus 的
// MISSING 判红);② 成本来源写明它是**推导来的**(token 上限 × 钉点),不是随手一个数;
// ③ 面值清 65% 目标线(它是按件档,不吃按量计价的豁免),最坏实收清 45% 宪法地板。
{
  const { UNDERSTANDING_KINDS } = await import("../../packages/core/dist/asset-understanding.js");
  const { pricedUnderstandingCredits, CREDITS_PER_USD, GEN_MARGIN_TARGET } = await import(
    "../../packages/core/dist/spend.js"
  );
  const { worstPackReceiptCoefficient } = await import("../../packages/core/dist/pricing-config.js");
  const worst = worstPackReceiptCoefficient();

  assert.equal(UNDERSTANDING_KINDS.length, 3, "MONEY-A9: 理解三件套");
  for (const kind of UNDERSTANDING_KINDS) {
    const id = `understanding:${kind}`;
    assert.ok(COGS_INPUTS[id], `MONEY-A9: ${id} 必须在 COGS_INPUTS 里(缺 = 闸判 MISSING)`);
    assert.ok(
      COGS_INPUTS[id].source.includes("UNDERSTANDING_CAPS"),
      `MONEY-A9: ${id} 的成本来源必须写明是 token 上限 × 钉点推出来的`,
    );

    const chargeUsd = pricedUnderstandingCredits(kind) / CREDITS_PER_USD;
    const cogsUsd = COGS_INPUTS[id].cogsUsd;
    assert.ok(chargeUsd > cogsUsd, `MONEY-A9: ${id} 收费 $${chargeUsd} 必须高于成本 $${cogsUsd}(R1)`);

    // 面值口径 → 65% 目标线(生成侧那条线,理解按件档同吃)。
    const face = (chargeUsd - cogsUsd) / chargeUsd;
    assert.ok(
      face >= GEN_MARGIN_TARGET - 1e-9,
      `MONEY-A9: ${id} 面值毛利率 ${(face * 100).toFixed(1)}% 跌破 ${(GEN_MARGIN_TARGET * 100).toFixed(0)}% 目标线`,
    );

    // 最坏实收口径 → 45% 宪法地板(与 main() 里同一条算式、同一个系数)。
    const receiptCharge = chargeUsd * worst;
    const receipt = (receiptCharge - cogsUsd) / receiptCharge;
    assert.ok(
      receipt >= MARGIN_FLOOR - 1e-9,
      `MONEY-A9: ${id} 最坏实收毛利率 ${(receipt * 100).toFixed(1)}% 跌破 ${(MARGIN_FLOOR * 100).toFixed(0)}% 地板`,
    );
  }

  // 三类各 1 internal credit = $0.01/件(现值锚;改 token 上限或改钉点会把它顶走,那正是要红的)。
  for (const kind of UNDERSTANDING_KINDS) {
    assert.equal(pricedUnderstandingCredits(kind), 1, `MONEY-A9: ${kind} 现值 1 internal credit/件`);
  }
}

console.log("✓ check-margin-floor red/green self-test passed");
