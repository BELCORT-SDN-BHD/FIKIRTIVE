import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(WEB_ROOT, relative), "utf8");

const spendState = read("components/otto/spend-state.tsx");
const exits = read("components/exits/Exits.tsx");
const research = read("components/otto/ResearchCard.tsx");
const pack = read("components/otto/PackCard.tsx");
const storyboard = read("components/otto/StoryboardCard.tsx");

describe("Otto paid-action design system", () => {
  it("defines one warning confirmation and one spinner-backed progress composition", () => {
    expect(spendState).toContain('export function SpendConfirmation');
    expect(spendState).toContain('<Alert variant="warning" density="compact"');
    expect(spendState).toContain('export function SpendProgress');
    expect(spendState).toContain('<Alert role="status" density="compact"');
    expect(spendState).toContain('<Spinner aria-hidden="true" />');
  });

  it("uses the shared compositions across research, packs, and storyboards", () => {
    for (const source of [research, pack, storyboard]) {
      expect(source).toContain("SpendConfirmation");
      expect(source).toContain("SpendProgress");
    }
  });

  it("renders the shared Billing exit as a destructive shadcn Alert", () => {
    expect(exits).toContain('<Alert role="alert" variant="destructive" density="compact">');
    expect(exits).toContain('<AlertTitle>Not enough credits</AlertTitle>');
    expect(exits).toContain('<ExitLink href={BILLING_HREF}>top up in Billing</ExitLink>');
  });

  it("removes hand-authored loading animations from the migrated research card", () => {
    expect(research).toContain('<Spinner data-icon="inline-start"');
    expect(research).not.toContain("Loader2");
    expect(research).not.toContain("@keyframes spin");
    expect(research).not.toContain('style={{ animation: "spin');
  });
});
