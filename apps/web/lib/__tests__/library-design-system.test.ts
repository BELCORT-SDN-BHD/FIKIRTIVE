// 本面自 PR #1152 起无路由挂载(/library 改画 components/library/LibraryView.tsx),围栏仅护组件本身；tidy 待登记。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "components/otto/stuff/StuffLibrary.tsx"),
  "utf8",
);

describe("Library design-system language", () => {
  it("uses the shadcn action menu instead of exposing a destructive icon strip", () => {
    expect(source).toContain("<DropdownMenu>");
    expect(source).toContain("<DropdownMenuItem");
    expect(source).toContain('variant="destructive"');
    expect(source).toContain("Remove from Library");
    expect(source).not.toContain("<TooltipButton");
  });

  it("gives every asset stable type and origin metadata outside the artwork", () => {
    expect(source).toContain("itemTypeLabel(item)");
    expect(source).toContain("itemOriginLabel(item)");
    expect(source).toContain("Made with Otto");
    expect(source).toContain("Reusable asset");
  });

  it("keeps search, category filters, and the responsive asset grid as one workspace", () => {
    expect(source).toContain('aria-label="Filter library"');
    expect(source).toContain('aria-label="Search library"');
    expect(source).toContain("13.5rem");
  });
});
