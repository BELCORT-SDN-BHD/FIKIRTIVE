import { describe, expect, it, vi } from "vitest";
import AdminError from "../error";

function collectText(node: unknown): string[] {
  if (node == null || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(collectText);
  if (typeof node === "object" && "props" in node) {
    return collectText((node as { props?: { children?: unknown } }).props?.children);
  }
  return [];
}

describe("admin error boundary", () => {
  it("gives founder-actionable ops diagnostics instead of the global workbench copy", () => {
    const tree = AdminError({
      error: Object.assign(new Error("database unavailable"), { digest: "NEXT_DIGEST" }),
      reset: vi.fn(),
    });

    const text = collectText(tree).join(" ");
    expect(text).toContain("Admin data failed to load");
    expect(text).toContain("database query failure");
    expect(text).toContain("stale client bundle after deploy");
    expect(text).toContain("Railway web and worker logs");
    expect(text).toContain("System Health");
    expect(text).toContain("Audit");
    expect(text).toContain("NEXT_DIGEST");
    expect(text).not.toContain("Reload workbench");
  });
});
