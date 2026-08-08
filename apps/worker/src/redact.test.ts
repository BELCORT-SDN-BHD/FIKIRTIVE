import { describe, expect, it } from "vitest";
import { redactProviderNames, sanitizeError } from "./redact.js";

const SECRET_TERMS =
  /seedance|seedream|byteplus|bytedance|jimeng|即梦|\bfal\b|anthropic|claude/iu;

describe("sanitizeError provider secrecy", () => {
  it.each([
    "customer Claude Martin",
    "Claude's Diner Promo",
    "anthropic principle",
    "claude@example.com",
  ])("keeps merchant and customer text intact: %s", (raw) => {
    expect(redactProviderNames(raw)).toBe(raw);
  });

  it("redacts provider names, model references, and signed URLs before persistence", () => {
    const raw = [
      "Seedance 2.0 Fast",
      "seedance-2-mini",
      "seedream-5-0",
      "BYTEPLUS",
      "ByteDance",
      "jimeng",
      "即梦",
      "fal.ai/model",
      "Anthropic API error 529",
      "claude-sonnet-5",
      "BytePlusProvider",
      "AnthropicError",
      "ClaudeAsProvider",
      "https://media.example.test/file.mp4?X-Amz-Signature=secret",
    ].join(" | ");

    const safe = sanitizeError(new Error(raw), 1_000);

    expect(safe).not.toMatch(SECRET_TERMS);
    expect(safe).not.toContain("X-Amz-Signature");
    expect(safe).toContain("generation provider");
    expect(safe).toContain("<redacted-url>");
  });

  it("keeps the existing subprocess summary behavior provider-free", () => {
    const safe = sanitizeError({
      exitCode: 1,
      message: "fal https://media.example.test/private",
    });

    expect(safe).toBe("media subprocess failed (exit code 1)");
    expect(safe).not.toMatch(SECRET_TERMS);
  });
});
