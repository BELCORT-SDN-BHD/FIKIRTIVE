import { describe, expect, it } from "vitest";
import {
  contactStatusBadge,
  reportedOptOutLine,
  segmentCountsLine,
} from "../segment-preview-copy";

const counts = {
  matchedCount: 5,
  contactableCount: 4,
  knownOptOutCount: 1,
  assertedOptOutCount: 2,
};

describe("segment preview copy (#496)", () => {
  it("labels the exclusion count as verified so a reported opt-out can never hide inside it", () => {
    expect(segmentCountsLine(counts)).toBe(
      "5 matched · 4 contactable · 1 verified opt-out excluded",
    );
  });

  it("always shows reported opt-outs as unverified and still included, even at zero", () => {
    expect(reportedOptOutLine(counts)).toBe("2 reported opt-out (unverified, still included)");
    expect(reportedOptOutLine({ ...counts, assertedOptOutCount: 0 })).toBe(
      "0 reported opt-out (unverified, still included)",
    );
  });

  it("annotates an included row that carries a merchant-reported opt-out", () => {
    expect(contactStatusBadge({ contactable: true, assertedOptOut: true })).toEqual({
      label: "Included · reported opt-out (unverified)",
      variant: "warning",
    });
  });

  it("keeps plain included and verified-excluded rows unchanged in meaning", () => {
    expect(contactStatusBadge({ contactable: true, assertedOptOut: false })).toEqual({
      label: "Included",
      variant: "success",
    });
    expect(contactStatusBadge({ contactable: false, assertedOptOut: false })).toEqual({
      label: "Verified opt-out excluded",
      variant: "warning",
    });
  });

  it("lets the verified exclusion label win over any stray asserted flag", () => {
    expect(contactStatusBadge({ contactable: false, assertedOptOut: true })).toEqual({
      label: "Verified opt-out excluded",
      variant: "warning",
    });
  });
});
