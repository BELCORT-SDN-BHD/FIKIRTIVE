import { describe, expect, it } from "vitest";
import { getOttoNavCollapseAction, getOttoNavCollapseLabel } from "../../components/otto/otto-nav-collapse";

describe("Otto nav collapse control", () => {
  it("closes the mobile drawer instead of toggling desktop collapse", () => {
    expect(getOttoNavCollapseAction(true)).toBe("close-drawer");
    expect(getOttoNavCollapseLabel(true)).toBe("Close menu");
  });

  it("keeps desktop collapse behaviour when the mobile drawer is closed", () => {
    expect(getOttoNavCollapseAction(false)).toBe("collapse-sidebar");
    expect(getOttoNavCollapseLabel(false)).toBe("Collapse sidebar");
  });
});
