import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");
const storyboard = readFileSync(
  path.join(WEB_ROOT, "components/otto/StoryboardCard.tsx"),
  "utf8",
);

describe("Storyboard design system", () => {
  it("uses full shadcn Card composition for the storyboard and shot surfaces", () => {
    expect(storyboard).toContain('<Card size="sm" className="gb w-full max-w-[480px]');
    expect(storyboard).toContain("<CardHeader>");
    expect(storyboard).toContain("<CardTitle");
    expect(storyboard).toContain("<CardDescription>");
    expect(storyboard).toContain('<CardContent className="flex flex-col gap-4">');
    expect(storyboard).toContain('<CardFooter className="flex-col items-stretch">');
    expect(storyboard).toContain('<Card key={shot.shotId} size="sm"');
    expect(storyboard).toContain('<Badge variant="default">');
  });

  it("composes shot prompts and duration from accessible Field primitives", () => {
    expect(storyboard).toContain('<FieldLabel htmlFor={`frame-prompt-${shot.shotId}`}>');
    expect(storyboard).toContain('<FieldLabel htmlFor={`video-prompt-${shot.shotId}`}>');
    expect(storyboard).toContain('<FieldLabel htmlFor={`duration-${shot.shotId}`}>');
    expect(storyboard).toContain("<FieldGroup");
    expect(storyboard).toContain("<SelectGroup>");
    expect(storyboard).not.toContain("<label");
  });

  it("uses Spinner and explicit status copy instead of hand-authored spin animations", () => {
    expect(storyboard).toContain("<Spinner");
    expect(storyboard).toContain("<SpendProgress");
    expect(storyboard).toContain("Preparing first frames…");
    expect(storyboard).toContain("Preparing videos…");
    expect(storyboard).not.toContain("Loader2");
    expect(storyboard).not.toContain("@keyframes spin");
    expect(storyboard).not.toContain('style={{ animation: "spin');
  });

  it("uses shadcn button sizes and icon placement without nested icon wrappers", () => {
    expect(storyboard).toContain('size="icon-xs" aria-label="Move up"');
    expect(storyboard).toContain('<RotateCw data-icon="inline-start"');
    expect(storyboard).toContain('<Plus data-icon="inline-start"');
    expect(storyboard).not.toContain('<span className="flex items-center gap-1">');
  });
});
