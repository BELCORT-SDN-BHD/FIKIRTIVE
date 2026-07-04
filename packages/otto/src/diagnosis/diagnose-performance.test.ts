import { describe, it, expect } from "vitest";
import { diagnosePerformance } from "./diagnose-performance.js";
import { META_EXPERTISE_KB } from "../knowledge/meta-expertise.js";

const ad = (adId: string, ctr: string | null, spend = "100", roas: string | null = null) =>
  ({ adId, adName: adId, metrics: { ctr, spend, purchaseRoas: roas, reach: "1000", cpc: "0.5" } as Record<string, string | null> });

describe("diagnosePerformance", () => {
  it("needs >=2 comparable ads, else neutral + note", () => {
    const d = diagnosePerformance([ad("a1", "1.0")], META_EXPERTISE_KB);
    expect(d.verdicts[0]!.verdict).toBe("neutral");
    expect(d.note).toMatch(/not enough/i);
  });

  it("winner = metric well above the account average (grounded, no external benchmark)", () => {
    // mean of [3.0, 0.5, 0.5] ≈ 1.33; a1=3.0 > 1.25*mean → winner
    const d = diagnosePerformance([ad("a1", "3.0"), ad("a2", "0.5"), ad("a3", "0.5")], META_EXPERTISE_KB);
    const v = d.verdicts.find((x) => x.adId === "a1")!;
    expect(v.verdict).toBe("winner");
    expect(v.suggestRecreate).toBe(true);
    expect(d.metricUsed).toBe("CTR");
    expect(d.basis).toMatch(/account average/i);
  });

  it("loser gives a GROUNDED creative reason with real KB citations + a non-asserted data-gap hypothesis", () => {
    const d = diagnosePerformance([ad("a1", "3.0"), ad("a2", "0.1"), ad("a3", "3.0")], META_EXPERTISE_KB);
    const v = d.verdicts.find((x) => x.adId === "a2")!;
    expect(v.verdict).toBe("loser");
    const creative = v.reasons.find((r) => r.kind === "creative")!;
    expect(creative.grounded).toBe(true);
    expect(creative.citations.length).toBeGreaterThanOrEqual(1);
    expect(creative.citations[0]!.url).toMatch(/^https?:\/\//);
    const gap = v.reasons.find((r) => r.kind === "data-gap")!;
    expect(gap.grounded).toBe(false);                 // hypothesis, never asserted
    expect(gap.text).toMatch(/can't see|learning phase|audience|budget/i);
  });

  it("uses ROAS only when objective is conversion AND some ad has non-null ROAS; else falls to CTR", () => {
    const withRoas = [ad("a1", "1.0", "100", "4.0"), ad("a2", "1.0", "100", "1.0")];
    expect(diagnosePerformance(withRoas, META_EXPERTISE_KB, { objective: "conversions" }).metricUsed).toBe("ROAS");
    // all ROAS null → never pick ROAS even if objective says conversions
    const noRoas = [ad("a1", "1.0"), ad("a2", "0.5")];
    expect(diagnosePerformance(noRoas, META_EXPERTISE_KB, { objective: "conversions" }).metricUsed).toBe("CTR");
  });

  it("all-zero CTR batch: no fabricated winner from a degenerate zero mean", () => {
    // all ads CTR="0" (real case: impressions but no clicks yet) → mean=0; must NOT trip n >= mean*1.25
    const d = diagnosePerformance([ad("a1", "0"), ad("a2", "0"), ad("a3", "0")], META_EXPERTISE_KB);
    for (const v of d.verdicts) {
      expect(v.verdict).toBe("neutral");
      expect(v.suggestRecreate).toBe(false);
    }
    expect(d.note).toMatch(/not enough|signal/i);
  });

  it("all-tied non-zero CTR batch: neutral (no signal to distinguish them)", () => {
    const d = diagnosePerformance([ad("a1", "1.0"), ad("a2", "1.0"), ad("a3", "1.0")], META_EXPERTISE_KB);
    for (const v of d.verdicts) {
      expect(v.verdict).toBe("neutral");
      expect(v.suggestRecreate).toBe(false);
    }
  });

  it("never fabricates: no verdict/reason cites an external industry benchmark number", () => {
    const d = diagnosePerformance([ad("a1", "3.0"), ad("a2", "0.1"), ad("a3", "3.0")], META_EXPERTISE_KB);
    const allText = d.verdicts.flatMap((v) => v.reasons.map((r) => r.text)).join(" ") + " " + d.basis;
    // grounding is account-relative; must not claim an industry/average-benchmark figure
    expect(allText).not.toMatch(/industry average|benchmark of|typical CTR is|good CTR is/i);
  });
});
