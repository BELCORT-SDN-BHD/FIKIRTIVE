import { describe, expect, expectTypeOf, it } from "vitest";
import { broadcastPurposeFromTemplateClassification } from "../customer-broadcast-purpose";

describe("broadcast template classification purpose mapping", () => {
  it("maps only the real marketing proactive tuple", () => {
    const purpose = broadcastPurposeFromTemplateClassification({
      category: "marketing",
      purposeClass: "proactive_non_transactional",
    });
    expect(purpose).toBe("marketing");
    expectTypeOf(purpose).toEqualTypeOf<"marketing" | null>();
  });

  it.each([
    { category: "marketing", purposeClass: "transactional" },
    { category: "utility", purposeClass: "proactive_non_transactional" },
    { category: "review_request", purposeClass: "proactive_non_transactional" },
    { category: "", purposeClass: "" },
  ])("fails closed for the unknown tuple $category/$purposeClass", (classification) => {
    expect(broadcastPurposeFromTemplateClassification(classification)).toBeNull();
  });
});
