import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { redactProviderNames, sanitizeUserError } from "../provider-secrecy";

const SECRET_TERMS =
  /seedance|seedream|byteplus|bytedance|jimeng|即梦|\bfal\b|anthropic|claude/iu;


describe("provider secrecy", () => {
  it.each([
    "customer Claude Martin",
    "Claude's Diner Promo",
    "anthropic principle",
    "claude@example.com",
  ])("keeps merchant and customer text intact: %s", (raw) => {
    expect(redactProviderNames(raw)).toBe(raw);
  });

  it("redacts coined provider terms and common names only in technical contexts", () => {
    const unsafe = [
      "claude-sonnet-5",
      "Anthropic API error 529",
      "seedance-2-mini",
      "BytePlusProvider timeout",
      "即梦",
      "fal.ai/model",
    ].join(" | ");

    const safe = sanitizeUserError(unsafe, 1_000);

    expect(safe).not.toMatch(SECRET_TERMS);
    expect(safe).toContain("generation provider");
    expect(safe).toContain("timeout");
  });

  // #791-6: this used to compare the web copy of the pattern with the worker copy, literal
  // for literal — a real guard, but one that only kept TWO copies in step, and Otto's reply
  // path (a third reader, added by #791-6) would not have been covered by it at all. The
  // pattern now lives once in @fikirtive/core and every reader imports it, so the property
  // worth pinning is stronger: no app declares a pattern of its own to drift.
  it("neither app declares its own provider pattern — there is one definition, in core", () => {
    const sources = [
      readFileSync(new URL("../provider-secrecy.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../../../worker/src/redact.ts", import.meta.url), "utf8"),
    ];
    for (const source of sources) {
      expect(source).not.toMatch(/const PROVIDER_NAME_RE\s*=/u);
      expect(source).toMatch(/@fikirtive\/core\/provider-secrecy/u);
    }
  });

  it("the shared definition is the one both apps actually run", async () => {
    const core = await import("@fikirtive/core/provider-secrecy");
    expect(redactProviderNames("seedance-2-mini")).toBe(core.redactProviderNames("seedance-2-mini"));
  });
});
