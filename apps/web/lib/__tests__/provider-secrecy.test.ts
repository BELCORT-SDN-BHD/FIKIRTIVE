import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { redactProviderNames, sanitizeUserError } from "../provider-secrecy";

const SECRET_TERMS =
  /seedance|seedream|byteplus|bytedance|jimeng|即梦|\bfal\b|anthropic|claude/iu;

function providerPatternLiteral(source: string): string {
  const match = source.match(/const PROVIDER_NAME_RE\s*=\s*\n?\s*(\/[^\n]+\/[a-z]+);/u);
  expect(match?.[1]).toBeDefined();
  return match?.[1] ?? "";
}

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
      "seedance-2-fast",
      "BytePlusProvider timeout",
      "即梦",
      "fal.ai/model",
    ].join(" | ");

    const safe = sanitizeUserError(unsafe, 1_000);

    expect(safe).not.toMatch(SECRET_TERMS);
    expect(safe).toContain("generation provider");
    expect(safe).toContain("timeout");
  });

  it("keeps the worker and web provider patterns byte-identical", () => {
    const webSource = readFileSync(new URL("../provider-secrecy.ts", import.meta.url), "utf8");
    const workerSource = readFileSync(
      new URL("../../../worker/src/redact.ts", import.meta.url),
      "utf8",
    );

    expect(providerPatternLiteral(webSource)).toBe(providerPatternLiteral(workerSource));
  });
});
