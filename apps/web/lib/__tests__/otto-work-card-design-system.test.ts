import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(WEB_ROOT, relative), "utf8");

const research = read("components/otto/ResearchCard.tsx");
const pack = read("components/otto/PackCard.tsx");
const reference = read("app/design-system/DesignSystemReference.tsx");

describe("Otto work card design system", () => {
  it("uses full shadcn Card composition for research and pack surfaces", () => {
    expect(research).toContain('<Card size="sm" className="gb w-full max-w-[480px]');
    expect(pack).toContain("<Card className={cn(CARD_ROOT_CLASS, CARD_PAD_CLASS");
    expect(pack).toContain('"w-full max-w-[520px] p-0"');

    for (const source of [research, pack]) {
      expect(source).toContain("<CardHeader");
      expect(source).toContain("<CardTitle");
      expect(source).toContain("<CardDescription");
      expect(source).toContain("<CardContent");
      expect(source).toContain("<CardFooter");
    }
  });

  it("uses Badge for tiers, counts, and pack item states", () => {
    expect(research).toContain('<Badge variant="outline">{tierLabel}</Badge>');
    expect(research).toContain('<Badge variant="default">Q{index + 1}</Badge>');
    expect(pack).toContain('<Badge variant="outline">');
    expect(pack).toContain('<Badge variant="success">Started</Badge>');
    expect(pack).toContain('<Badge variant="destructive">Failed</Badge>');
    expect(pack).toContain('<Badge variant="default">Queued</Badge>');
  });

  it("keeps state colors semantic and card sections divided by Separator", () => {
    expect(pack).toContain("<Separator />");
    expect(research).toContain('variant="success"');
    expect(pack).toContain('variant="success"');
    expect(research).not.toContain("text-[var(--success)]");
    expect(pack).not.toContain("text-[var(--success)]");
    expect(pack).not.toContain('className="mt-4 border-t');
  });

  it("uses container-aware layout and never reintroduces viewport breakpoints", () => {
    expect(pack).toContain("CARD_ROOT_CLASS");
    expect(pack).toContain("CARD_LIST_ROW_TRAIL_CLASS");
    expect(pack).not.toMatch(/(^|\s)(sm|md|lg|xl|2xl|max-sm|max-md|max-lg|max-xl):/m);
  });

  it("defers work-card examples until the product-pattern phase", () => {
    expect(reference).toContain('data-scope="foundations-only"');
    expect(reference).not.toContain("Otto work card language");
    expect(reference).not.toContain("<ResearchCard");
    expect(reference).not.toContain("<PackCard");
  });
});
