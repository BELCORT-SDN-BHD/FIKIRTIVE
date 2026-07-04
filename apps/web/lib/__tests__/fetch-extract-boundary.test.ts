/**
 * fetch-extract-boundary.test.ts — F16: fetchAndExtract must live in a `server-only` module,
 * NOT a `"use server"` one. In a `"use server"` module every export is a public Server Action
 * endpoint; fetchAndExtract has no auth guard (its caller, the metered researchWeb skill, is the
 * authority), so exposing it that way let any authenticated user POST an SSRF-guarded fetch +
 * metered extraction cross-tenant. This pins the module boundary so a refactor can't reintroduce it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

describe("fetchAndExtract module boundary (F16)", () => {
  it("fetch-extract.ts is server-only, not a Server Action module", () => {
    const src = read("../fetch-extract.ts");
    expect(src).toMatch(/^import "server-only";/m);
    expect(src).not.toMatch(/^\s*["']use server["'];/m);
    // research-prep + #124/#125: the logic moved to @fikirtive/core, now behind the server-only
    // "@fikirtive/core/server" subpath (the main barrel stays browser-safe / node:dns-free). This
    // web module is a server-only re-export shim: it must re-export fetchAndExtract from that subpath
    // and keep the guards above.
    expect(src).toMatch(/export \{[^}]*\bfetchAndExtract\b[^}]*\} from "@fikirtive\/core\/server"/);
  });

  it("brand-research.ts no longer defines/exports fetchAndExtract", () => {
    const src = read("../brand-research.ts");
    expect(src).not.toMatch(/export async function fetchAndExtract/);
  });
});

describe("meta-build-actions module boundary (F12)", () => {
  it("is NOT a 'use server' module (runAdBuild/maybeAutoBuild must not be public Server Actions)", () => {
    // A "use server" directive here would make runAdBuild(ownerId,…)/maybeAutoBuild(ownerId,…) —
    // which take a trusted, un-re-authenticated ownerId — POSTable by any authenticated user with
    // another org's ownerId. The gated actions reach the client via otto-client-actions.ts instead.
    const src = read("../meta-build-actions.ts");
    expect(src).not.toMatch(/^\s*["']use server["'];/m);
  });
});
