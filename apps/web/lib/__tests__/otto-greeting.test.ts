/**
 * #542 (F-07) — the Otto greeting's fallback chain.
 *
 * THE INVARIANT THIS FILE EXISTS FOR: no path may greet a merchant with an email address or
 * any part of one. That was the original defect — `User.name` was empty, so the greeting fell
 * back to `email.split("@")[0]` and said "Hi tools". Fixing only the happy path would leave
 * every legacy account (User.name empty) exactly as broken as before, which is why the chain
 * itself, not just the success case, is pinned here.
 *
 * The cases run the resolver's output through `ottoGreetingName` — the shortener the front
 * door really applies (OttoFrontDoor.tsx: `Hi ${ottoGreetingName(userName)} — …`) — so what is
 * asserted is the string a merchant actually reads, not an intermediate value. That matters:
 * `ottoGreetingName` has an email branch that returns the LOCAL PART, so "the resolver never
 * emits an @" is what keeps that branch unreachable.
 */
import { describe, it, expect } from "vitest";
import {
  ottoGreetingName,
  resolveOttoGreetingName,
  OTTO_GENERIC_GREETING_NAME,
} from "@/lib/otto-greeting";

/** What the front door actually renders, for the given profile names. */
function greeting(names: Parameters<typeof resolveOttoGreetingName>[0]): string {
  return `Hi ${ottoGreetingName(resolveOttoGreetingName(names))} — what should we make today?`;
}

describe("#542 greeting fallback — display name first", () => {
  it("uses the merchant's own display name when they have set one", () => {
    expect(resolveOttoGreetingName({ displayName: "Aisha Rahman", workspaceName: "Kopi Corner" })).toBe("Aisha Rahman");
    expect(greeting({ displayName: "Aisha Rahman", workspaceName: "Kopi Corner" })).toBe(
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

  it("renders the shop name in the greeting, never the email", () => {
    expect(greeting({ displayName: "", workspaceName: "Kopi Corner" })).toBe(
      "Hi Kopi — what should we make today?",
    );
  });
});

describe("#542 greeting fallback ② — nothing usable falls through to a generic greeting", () => {
  // A pre-#543 Organization.name IS the merchant's full email address (bootstrapPersonalOrg
  // falls back to `email` when no shop name was collected). Using it would print
  // "Hi tools@belcort.com", and letting it reach ottoGreetingName would print "Hi tools" —
  // both worse than saying nothing, so an "@" candidate is refused outright.
  it.each([
    ["both names empty", { displayName: "", workspaceName: "" }],
    ["both names missing", {}],
    ["workspace name is a raw email (legacy org)", { displayName: "", workspaceName: "tools@belcort.com" }],
    ["display name is a raw email too", { displayName: "tools@belcort.com", workspaceName: "tools@belcort.com" }],
    ["whitespace only", { displayName: "   ", workspaceName: "  " }],
  ])("%s → the generic greeting", (_label, names) => {
    expect(resolveOttoGreetingName(names)).toBe(OTTO_GENERIC_GREETING_NAME);
    expect(greeting(names)).toBe("Hi there — what should we make today?");
  });
});

describe("#542 greeting fallback ③ — a failed profile read is a miss, not a guess", () => {
  it.each([
    ["null (read returned {error})", null],
    ["undefined", undefined],
  ])("%s → the generic greeting", (_label, names) => {
    expect(resolveOttoGreetingName(names)).toBe(OTTO_GENERIC_GREETING_NAME);
    expect(greeting(names)).toBe("Hi there — what should we make today?");
  });
});

describe("#542 greeting invariant — no rendered greeting ever contains an email or its local part", () => {
  // The regression oracle. Every shape the two columns can really hold, including the ones
  // that produced the original "Hi tools", asserted against the STRING THE MERCHANT SEES.
  const EMAIL = "tools@belcort.com";
  const LOCAL_PART = "tools";
  const shapes: Parameters<typeof resolveOttoGreetingName>[0][] = [
    null,
    undefined,
    {},
    { displayName: "", workspaceName: "" },
    { displayName: null, workspaceName: null },
    { displayName: "", workspaceName: EMAIL },
    { displayName: EMAIL, workspaceName: EMAIL },
    { displayName: EMAIL, workspaceName: "Kopi Corner" },
    { displayName: `  ${EMAIL}  `, workspaceName: "" },
    { displayName: "", workspaceName: "  " },
    { displayName: "Aisha Rahman", workspaceName: EMAIL },
  ];

  it.each(shapes.map((shape, i) => [i, shape] as const))("shape %i never leaks the address", (_i, shape) => {
    const rendered = greeting(shape);
    expect(rendered).not.toContain("@");
    expect(rendered).not.toContain(EMAIL);
    // The local part is the specific historical failure ("Hi tools"), so match the whole
    // greeting-name slot rather than a substring — "tools" must not be what Otto calls anyone.
    expect(ottoGreetingName(resolveOttoGreetingName(shape))).not.toBe(LOCAL_PART);
    // …and it is always a real greeting, never "Hi  — …" with an empty name.
    expect(resolveOttoGreetingName(shape).trim()).not.toBe("");
  });

  it("[control] ottoGreetingName really would leak the local part if an address reached it", () => {
    // Without this, the assertions above could be green because the leak is impossible for
    // some unrelated reason. It is not: the shortener's email branch is live and returns
    // "tools" — the resolver refusing to emit an "@" is the only thing standing in front of it.
    expect(ottoGreetingName(EMAIL)).toBe(LOCAL_PART);
  });
});
