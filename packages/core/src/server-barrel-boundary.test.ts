/**
 * server-barrel-boundary.test.ts — #124/#125: the main `@fikirtive/core` barrel must stay browser-safe.
 *
 * url-safety.ts statically imports `node:dns/promises`, and fetch-extract.ts performs server-side
 * network I/O. If either leaks back into the main barrel (packages/core/src/index.ts), any client
 * component importing "@fikirtive/core" (e.g. ProductShowcase.tsx for category/product helpers) drags
 * node:dns into the browser/Turbopack graph → /otto dev 500 / build error. Those symbols live behind
 * "@fikirtive/core/server" instead. The pure product-page parser (extractProductDraft) has no
 * node/network deps and stays in the main barrel. This pins the boundary so a refactor can't move it.
 */
import { describe, it, expect } from "vitest";

// Symbols that MUST NOT be reachable from the main barrel (server-only). fetchRawHtml is the P1-01
// raw-HTML fetch added in this PR — it rides the same node:dns SSRF envelope and must stay server-only.
const SERVER_ONLY = [
  "fetchAndExtract",
  "fetchRawHtml",
  "assertPublicHttpUrl",
  "assertPublicHttpUrlResolved",
] as const;

describe("@fikirtive/core barrel boundary (#124/#125)", () => {
  it("main barrel does NOT export server-only fetch / URL-safety symbols", async () => {
    const barrel = await import("./index.js");
    for (const name of SERVER_ONLY) {
      expect(
        Object.prototype.hasOwnProperty.call(barrel, name),
        `"${name}" must not be exported from @fikirtive/core (server-only — use @fikirtive/core/server)`,
      ).toBe(false);
    }
  });

  it("main barrel DOES export the pure product-page parser (no node/network deps)", async () => {
    const barrel = await import("./index.js");
    expect(barrel).toHaveProperty("extractProductDraft");
  });

  it("@fikirtive/core/server exposes the server-only fetch / URL-safety symbols", async () => {
    const server = await import("./server.js");
    expect(server).toHaveProperty("fetchAndExtract");
    expect(server).toHaveProperty("fetchRawHtml");
    expect(server).toHaveProperty("assertPublicHttpUrl");
    expect(server).toHaveProperty("assertPublicHttpUrlResolved");
    expect(server).toHaveProperty("MAX_BODY");
  });
});
