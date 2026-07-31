/**
 * #542 (F-07) — the Otto greeting: fallback chain, read-failure survival, and the rendered
 * sentence.
 *
 * THE INVARIANT THIS FILE EXISTS FOR: no path may greet a merchant with an email address or
 * any part of one. That was the original defect — `User.name` was empty, so the greeting fell
 * back to `email.split("@")[0]` and said "Hi tools". Fixing only the happy path would leave
 * every legacy account (User.name empty) exactly as broken as before, which is why the chain
 * itself, not just the success case, is pinned here.
 *
 * WHY THERE IS NO SENTENCE TEMPLATE IN THIS FILE (round-2 review P2). An earlier version of
 * these tests re-typed `Hi ${…} — what should we make today?` locally. That made them assert
 * against their own copy: production could regress to the email fallback and the suite would
 * stay green. The template now lives once, in `ottoGreeting`, and every case below composes
 * the SAME exports production composes. Two further seams are pinned rather than assumed:
 *   - `renders the greeting into the real front door` renders the actual OttoFrontDoor and
 *     looks for the sentence in its markup, so the component→lib wiring is covered;
 *   - `the Otto page wires the resolver` reads apps/web/app/otto/page.tsx and fails if the
 *     email fallback comes back. (Source assertion, the convention already used by
 *     crm-ux-batch.test.ts — an async server component with ~12 awaited data sources cannot be
 *     invoked here, and an unguarded seam would be worse than an explicit source pin.)
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: vi.fn(), ottoTurn: vi.fn(), createEmptyCoworkThread: vi.fn(), setAdsAutonomy: vi.fn(),
}));
vi.mock("@/lib/cowork-actions", () => ({
  coworkGenerate: vi.fn(), coworkVaryCard: vi.fn(), cancelGenJob: vi.fn(),
}));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/otto",
  useSearchParams: () => new URLSearchParams(),
}));

import {
  ottoGreetingName,
  ottoGreeting,
  resolveOttoGreetingName,
  ottoGreetingNameFromProfile,
  OTTO_GENERIC_GREETING_NAME,
  type ProfileNamesRead,
} from "@/lib/otto-greeting";
import { OttoFrontDoor } from "@/components/otto/OttoFrontDoor";

/** Exactly what the front door renders for a given profile read — production's own two steps
 *  (`ottoGreetingNameFromProfile` in the page, `ottoGreeting` in the component), no local copy
 *  of either. Async because the page's step owns the read and its `.catch`. */
async function renderedGreeting(read: () => Promise<ProfileNamesRead>): Promise<string> {
  return ottoGreeting(await ottoGreetingNameFromProfile(read));
}
const reads = (names: ProfileNamesRead) => () => Promise.resolve(names);

/** The real component, rendered the way otto-turn-cost.test.ts renders it. */
function renderFrontDoor(userName: string): string {
  return renderToStaticMarkup(
    createElement(OttoFrontDoor, {
      projectId: "proj_1",
      entities: [],
      userName,
      onThreadStarted: vi.fn(),
      ottoStreamEnabled: true,
      onStreamStart: vi.fn(),
    }),
  );
}

const EMAIL = "tools@belcort.com";
const LOCAL_PART = "tools";
const GENERIC_SENTENCE = ottoGreeting(OTTO_GENERIC_GREETING_NAME);

describe("#542 greeting fallback — display name first", () => {
  it("uses the merchant's own display name when they have set one", async () => {
    expect(resolveOttoGreetingName({ displayName: "Aisha Rahman", workspaceName: "Kopi Corner" })).toBe("Aisha Rahman");
    expect(await renderedGreeting(reads({ displayName: "Aisha Rahman", workspaceName: "Kopi Corner" }))).toBe(
      "Hi Aisha — what should we make today?",
    );
  });

  it("trims, and treats a whitespace-only display name as unset", () => {
    expect(resolveOttoGreetingName({ displayName: "  Aisha  ", workspaceName: "Kopi Corner" })).toBe("Aisha");
    expect(resolveOttoGreetingName({ displayName: "   \n\t ", workspaceName: "Kopi Corner" })).toBe("Kopi Corner");
  });
});

describe("#542 greeting fallback ① — User.name empty falls through to the shop name", () => {
  // The legacy-account shape the ticket is about: nobody ever set User.name, but the merchant
  // does have a real workspace name (either from #543's signup field or their own rename).
  it.each([
    ["", "Kopi Corner", "Kopi Corner"],
    [null, "Kopi Corner", "Kopi Corner"],
    [undefined, "Warung Sedap", "Warung Sedap"],
  ])("display name %p + workspace %p → greets by %p", (displayName, workspaceName, expected) => {
    expect(resolveOttoGreetingName({ displayName, workspaceName })).toBe(expected);
  });

  it("renders the shop name in the greeting, never the email", async () => {
    expect(await renderedGreeting(reads({ displayName: "", workspaceName: "Kopi Corner" }))).toBe(
      "Hi Kopi — what should we make today?",
    );
  });
});

describe("#542 greeting fallback ② — nothing usable falls through to a generic greeting", () => {
  // A pre-#543 Organization.name IS the merchant's full email address (bootstrapPersonalOrg
  // falls back to `email` when no shop name was collected). Using it would print
  // "Hi tools@belcort.com", and letting it reach ottoGreetingName would print "Hi tools" —
  // both worse than saying nothing, so an "@" candidate is refused outright.
  it.each<[string, ProfileNamesRead]>([
    ["both names empty", { displayName: "", workspaceName: "" }],
    ["both names missing", {}],
    ["workspace name is a raw email (legacy org)", { displayName: "", workspaceName: EMAIL }],
    ["display name is a raw email too", { displayName: EMAIL, workspaceName: EMAIL }],
    ["whitespace only", { displayName: "   ", workspaceName: "  " }],
  ])("%s → the generic greeting", async (_label, names) => {
    expect(resolveOttoGreetingName(names)).toBe(OTTO_GENERIC_GREETING_NAME);
    expect(await renderedGreeting(reads(names))).toBe(GENERIC_SENTENCE);
  });
});

describe("#542 greeting fallback ③ — a failed read is a miss, not a guess", () => {
  it.each<[string, ProfileNamesRead]>([
    ["the refusal value {error} (no session / unresolvable owner)", { error: "Not authorized." }],
    ["null", null],
    ["undefined", undefined],
  ])("%s → the generic greeting", async (_label, names) => {
    expect(resolveOttoGreetingName(names)).toBe(OTTO_GENERIC_GREETING_NAME);
    expect(await renderedGreeting(reads(names))).toBe(GENERIC_SENTENCE);
  });

  // Round-2 review P2: the cases above only cover a read that RETURNS. A Prisma or connection
  // fault REJECTS instead, and before `ottoGreetingNameFromProfile` owned the `.catch` that
  // rejection propagated out of the page's Promise.all and took the whole page down — so
  // "a failed read shows Hi there" was NOT true for the failure that actually happens in
  // production. This drives the real catch.
  it("a REJECTED read still greets, and does not throw", async () => {
    const rejects = vi.fn(() => Promise.reject(new Error("connection terminated unexpectedly")));
    await expect(ottoGreetingNameFromProfile(rejects)).resolves.toBe(OTTO_GENERIC_GREETING_NAME);
    expect(await renderedGreeting(rejects)).toBe(GENERIC_SENTENCE);
    expect(rejects).toHaveBeenCalledTimes(2); // once per call above — the stub really ran
  });

  it("a reader that throws synchronously is NOT swallowed", async () => {
    // Scope honesty: `.catch` covers a rejected promise, not a synchronous throw before the
    // promise exists. Nothing in the read path throws synchronously today, and silently
    // absorbing one would hide a programming error rather than a data fault — so this pins
    // the boundary instead of pretending it is covered.
    const throwsSync = () => { throw new Error("bug, not a data fault"); };
    await expect(ottoGreetingNameFromProfile(throwsSync)).rejects.toThrow("bug, not a data fault");
  });
});

describe("#542 greeting invariant — no rendered greeting ever contains an email or its local part", () => {
  // The regression oracle. Every shape the two columns can really hold, including the ones
  // that produced the original "Hi tools", asserted against the STRING THE MERCHANT SEES.
  const shapes: ProfileNamesRead[] = [
    null,
    undefined,
    {},
    { error: "Not authorized." },
    { displayName: "", workspaceName: "" },
    { displayName: null, workspaceName: null },
    { displayName: "", workspaceName: EMAIL },
    { displayName: EMAIL, workspaceName: EMAIL },
    { displayName: EMAIL, workspaceName: "Kopi Corner" },
    { displayName: `  ${EMAIL}  `, workspaceName: "" },
    { displayName: "", workspaceName: "  " },
    { displayName: "Aisha Rahman", workspaceName: EMAIL },
  ];

  it.each(shapes.map((shape, i) => [i, shape] as const))("shape %i never leaks the address", async (_i, shape) => {
    const rendered = await renderedGreeting(reads(shape));
    expect(rendered).not.toContain("@");
    expect(rendered).not.toContain(EMAIL);
    // The local part is the specific historical failure ("Hi tools"), so match the whole
    // greeting-name slot rather than a substring — "tools" must not be what Otto calls anyone.
    expect(resolveOttoGreetingName(shape)).not.toBe(LOCAL_PART);
    // …and it is always a real greeting, never "Hi  — …" with an empty name.
    expect(resolveOttoGreetingName(shape).trim()).not.toBe("");
  });

  it("[control] ottoGreetingName really would leak the local part if an address reached it", () => {
    // Without this, the assertions above could be green because the leak is impossible for
    // some unrelated reason. It is not: the shortener's email branch is live and returns
    // "tools" — the resolver refusing to emit an "@" is the only thing standing in front of it.
    expect(ottoGreetingName(EMAIL)).toBe(LOCAL_PART);
    expect(ottoGreeting(EMAIL)).toBe("Hi tools — what should we make today?");
  });
});

describe("#542 greeting wiring — the sentence and the chain are pinned to production", () => {
  it("renders the greeting into the real front door", async () => {
    // Component-level seam (round-2 review P2). Renders the actual OttoFrontDoor and looks for
    // the exact sentence `ottoGreeting` produced — if the component re-inlines its own
    // template, or stops greeting at all, this goes red.
    const userName = await ottoGreetingNameFromProfile(reads({ displayName: "", workspaceName: "Kopi Corner" }));
    const markup = renderFrontDoor(userName);
    expect(markup).toContain(ottoGreeting(userName));
    expect(markup).toContain("Hi Kopi — what should we make today?");
    expect(markup).not.toContain(EMAIL);
  });

  it("renders the generic greeting into the real front door when the read REJECTED", async () => {
    const rejects = () => Promise.reject(new Error("connection terminated unexpectedly"));
    const userName = await ottoGreetingNameFromProfile(rejects);
    expect(renderFrontDoor(userName)).toContain(GENERIC_SENTENCE);
  });

  it("the Otto page wires the resolver, and the email fallback is gone for good", () => {
    // Page-level seam. The page is an async server component with ~12 awaited data sources, so
    // it cannot be invoked here; this pins its source instead of leaving the seam unguarded.
    const source = readFileSync(path.join(__dirname, "..", "..", "app", "otto", "page.tsx"), "utf8");
    expect(source).toContain("ottoGreetingNameFromProfile(getMyProfileNames)");
    // The exact regression this ticket is about: reviving ANY email-derived greeting fails here.
    expect(source).not.toContain('split("@")');
    expect(source).not.toMatch(/userName\s*=\s*[^;]*email/);
  });
});
