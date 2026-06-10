import { describe, expect, it } from "vitest";
import { parseStorageKey, storageKey } from "./storage-key.js";
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
