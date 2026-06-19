import { describe, expect, it } from "vitest";
import { FOUNDER_OWNER_ID, parseStorageKey, storageKey, keyOwnerMatches } from "./storage-key.js";
import { sha256Bytes } from "./hash.js";
import { newId } from "./ids.js";

const HASH = sha256Bytes(new TextEncoder().encode("artlio"));

describe("storageKey", () => {
  it("round-trips owner/hash/ext", () => {
    const key = storageKey("founder", HASH, "mp4");
    expect(parseStorageKey(key)).toEqual({ ownerId: "founder", contentHash: HASH, ext: "mp4" });
  });

  it("normalizes a leading dot and uppercase in ext", () => {
    expect(storageKey("founder", HASH, ".PNG")).toBe(`u/founder/${HASH}.png`);
  });

  it("normalizes uppercase hex hashes (some client libs emit them)", () => {
    expect(storageKey("founder", HASH.toUpperCase(), "png")).toBe(`u/founder/${HASH}.png`);
  });

  it("rejects bad hashes, owners, and extensions", () => {
    expect(() => storageKey("founder", "deadbeef", "png")).toThrow(/invalid content hash/);
    expect(() => storageKey("a/b", HASH, "png")).toThrow(/invalid owner/);
    expect(() => storageKey("founder", HASH, "p!ng")).toThrow(/invalid extension/);
    expect(() => parseStorageKey("u/founder/nothash.png")).toThrow(/not an artlio storage key/);
  });
});

describe("ids", () => {
  it("generates 26-char sortable ULIDs", () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a).not.toBe(b);
  });
});

describe("sha256", () => {
  it("matches a known vector", () => {
    expect(sha256Bytes(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("FOUNDER_OWNER_ID (R2-orphan guard)", () => {
  // The founder org is seeded (P1) with id === this literal. R2 keys u/founder/<hash>
  // are derived from it; changing this value orphans every existing blob. DO NOT CHANGE.
  it("is exactly the literal 'founder'", () => {
    expect(FOUNDER_OWNER_ID).toBe("founder");
  });
});

describe("keyOwnerMatches (cross-tenant /files guard)", () => {
  const hash = "b".repeat(64);
  it("true when the key's owner equals the caller", () => {
    expect(keyOwnerMatches(`u/founder/${hash}.png`, "founder")).toBe(true);
  });
  it("false when the key belongs to another owner", () => {
    expect(keyOwnerMatches(`u/other/${hash}.png`, "founder")).toBe(false);
  });
  it("false for a malformed / traversal key", () => {
    expect(keyOwnerMatches("../../etc/passwd", "founder")).toBe(false);
    expect(keyOwnerMatches("u/founder/notahash.png", "founder")).toBe(false);
  });
});

// codex review (T4a): traversal/encoding hardening proofs
describe("storageKey hardening", () => {
  it("rejects traversal and separator smuggling", () => {
    expect(() => storageKey("../evil", "a".repeat(64), "png")).toThrow();
    expect(() => storageKey("founder", "a".repeat(64), "png/../../x")).toThrow();
    expect(() => storageKey("founder", "a".repeat(64), "p%2Fg")).toThrow();
    expect(() => parseStorageKey("u/founder/../" + "a".repeat(64) + ".png")).toThrow();
  });
  it("rejects empty and oversized extensions", () => {
    expect(() => storageKey("founder", "a".repeat(64), "")).toThrow();
    expect(() => storageKey("founder", "a".repeat(64), "verylongext")).toThrow();
  });
});
