/**
 * #781 — the styling-variant door, and the fence that keeps it open.
 *
 * The bug this closes was not a broken pathway. Every part of "one spokesmodel, several outfits"
 * shipped and worked: the EntityVariant table, five owner-gated server actions, the worker's
 * image-to-image VARIANT branch, the @mention variant picker. What never shipped was a way in.
 * The merchant had no button that reached any of it, and Otto's reference port accepted only
 * BASE and REFSHEET. A feature nobody can start is worth exactly as much as one that was never
 * built — and it costs more, because it looks finished on every report.
 *
 * So the tests here are about REACHABILITY, not about re-testing the pathway:
 *   1. every variant action has a real caller on the merchant's side;
 *   2. Otto reaches the paid variant action through the port, not around it;
 *   3. the element dialog spends through the shared action layer and invents no money rule
 *      of its own (no direct Prisma, no price literal, no second reserve).
 *
 * Source-reading tests, deliberately: what they assert is exactly the property that regressed —
 * "is anything calling this?" — and no runtime test can see an absence of callers.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");
const read = (relative: string) => fs.readFileSync(path.join(WEB_ROOT, relative), "utf8");

const DIALOG = "components/otto/stuff/ElementVariantsDialog.tsx";
const LIBRARY = "components/otto/stuff/StuffLibrary.tsx";
const STUFF = "components/otto/OttoStuff.tsx";
const PORT = "lib/otto-refgen-port.ts";

/** Every variant/base action refgen-actions exports, and the surface that must reach it. */
const VARIANT_ACTIONS = [
  "createVariant",
  "regenerateVariant",
  "renameVariant",
  "deleteVariant",
  "setBaseAsset",
] as const;

describe("#781 — the merchant can actually get in", () => {
  it("the element dialog calls every variant action the merchant needs (none is dark)", () => {
    const src = read(DIALOG);
    // one import from the shared action layer…
    expect(src).toMatch(/from\s+"@\/lib\/refgen-actions"/);
    // …and a real call site for each action, not just an unused import
    for (const action of VARIANT_ACTIONS) {
      expect(src, `${action} has no call site in the element dialog`).toMatch(
        new RegExp(`\\b${action}\\s*\\(`),
      );
    }
  });

  it("the Library hands the element dialog its opener — a saved element tile opens the element", () => {
    const library = read(LIBRARY);
    expect(library).toContain("onOpenEntity");
    // the tile's existing open control serves both destinations; an element tile must reach it
    expect(library).toMatch(/onOpenEntity\?\.\(item\.entityId!\)/);

    const stuff = read(STUFF);
    expect(stuff).toContain("ElementVariantsDialog");
    expect(stuff).toMatch(/onOpenEntity=\{/);
  });

  it("the dialog quotes the central price and never a literal number of credits", () => {
    const src = read(DIALOG);
    expect(src).toContain("pricedRefgenCredits");
    // No hand-written price anywhere in the merchant-facing copy: the one place a variant's
    // price is decided is packages/core, and a second one here would drift the day it changes.
    expect(src).not.toMatch(/\d+\s*credits?\b/i);
  });

  it("the dialog owns no money logic of its own — no Prisma, no reserve, no provider", () => {
    const src = read(DIALOG);
    expect(src).not.toMatch(/@fikirtive\/db/);
    expect(src).not.toMatch(/reserveCredits/);
    expect(src).not.toMatch(/refGenJob\./);
  });

  it("a paid button is guarded synchronously — a double-click cannot become a double charge", () => {
    const src = read(DIALOG);
    // `busy` state lands a render too late to stop the second click; the ref is what actually stops it.
    expect(src).toMatch(/submittingRef\.current/);
  });

  // #781 r2 P1 — what a merchant BUYS with "Make it again" has to become visible. The rules are
  // unit-tested in variant-progress.test.ts; what can only be checked here is that the dialog uses
  // them instead of the two shortcuts that made the paid result invisible.
  it("the tile shows the newest image, never the one the merchant paid to replace", () => {
    const src = read(DIALOG);
    expect(src).toMatch(/latestVariantRef\(/);
    // the regression, stated as source: a re-run APPENDS, so refs[0] is the old picture forever
    expect(src).not.toMatch(/variant\.refs\[0\]/);
  });

  it("a paid re-run is watched until the server says it finished", () => {
    const src = read(DIALOG);
    // "no image yet" is not what makes a variant pending — a running job is (a re-run has an image)
    expect(src).toMatch(/isVariantRunning\(/);
    expect(src).toMatch(/variantsToWatch\(/);
    // and the re-run marks itself running the moment the paid action returns a job
    expect(src).toMatch(/regenerateVariant\([\s\S]{0,400}markRunning\(/);
  });
});

describe("#781 — Otto reaches the same door, through the port", () => {
  it("the refgen port forwards createVariant to the shared action, adding no spend path", () => {
    const src = read(PORT);
    expect(src).toMatch(/createVariant as createVariantAction/);
    expect(src).toMatch(/createVariantAction\(input\.entityId, input\.name, input\.prompt\)/);
    // The port is a forwarder: it must not reserve, price, or create jobs itself. (Calls, not
    // mentions — the header prose names these deliberately, to say where they DO live.)
    expect(src).not.toMatch(/reserveCredits\s*\(/);
    expect(src).not.toMatch(/pricedRefgenCredits\s*\(/);
    expect(src).not.toMatch(/refGenJob\.create\s*\(/);
  });

  it("both surfaces enter through refgen-actions — one action layer, one set of money rules", () => {
    // If either side ever grew its own variant implementation, "what the UI does" and "what Otto
    // does" would be two different promises about the same money. Same import, same actions.
    expect(read(DIALOG)).toMatch(/from\s+"@\/lib\/refgen-actions"/);
    expect(read(PORT)).toMatch(/from\s+"\.\/refgen-actions"/);
  });
});

// ---------------------------------------------------------------------------
// Otto has to be able to SEE the looks, or the door only opens one way.
//
// A variant Otto can create but can never name again is a dead end: it cannot pick it for a
// generation, and it cannot delete it (deleteReferenceVariant needs the exact id and must never
// guess). The element list Otto is given each turn is where that becomes possible.
// ---------------------------------------------------------------------------
describe("#781 — Otto is told which looks an element has", () => {
  it("names each look beside its element, with the id the tools need", async () => {
    const { buildContextSystemMessage } = await import("../otto-actions");
    const message = buildContextSystemMessage({
      orgId: "o1",
      userId: "o1",
      projectId: "p1",
      threadId: "t1",
      disabledModels: [],
      availableRefs: [
        {
          id: "ent-mira",
          name: "Mira",
          type: "CHARACTER",
          variants: [
            { id: "var-red", name: "Red dress" },
            { id: "var-beach", name: "Beach look" },
          ],
        },
        { id: "ent-tin", name: "Tin", type: "PRODUCT", variants: [] },
      ],
    });
    const text = String((message as { content?: unknown } | null)?.content ?? "");

    expect(text).toContain("@Mira");
    expect(text).toContain("Red dress");
    expect(text).toContain("var-red");
    expect(text).toContain("Beach look");
    // how to USE one — otherwise Otto knows the name and still generates the base look
    expect(text).toContain("variantSel");
    // an element with no looks says nothing extra about looks
    expect(text).toContain("@Tin");
  });

  it("says nothing about looks when no element has one (no noise for a shop that never made one)", async () => {
    const { buildContextSystemMessage } = await import("../otto-actions");
    const message = buildContextSystemMessage({
      orgId: "o1",
      userId: "o1",
      projectId: "p1",
      threadId: "t1",
      disabledModels: [],
      availableRefs: [{ id: "ent-tin", name: "Tin", type: "PRODUCT", variants: [] }],
    });
    const text = String((message as { content?: unknown } | null)?.content ?? "");
    expect(text).toContain("@Tin");
    expect(text).not.toContain("variantSel");
  });
});
