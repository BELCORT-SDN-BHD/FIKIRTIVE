import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@fikirtive/db";
import * as customerBroadcastUiActions from "../customer-broadcast-ui-actions";
import { requireOwner } from "../auth-guard";

// C5-M3 (issue #388): the wrapper sits between the client (which cannot import a server-only
// gateway module directly) and the frozen customer-broadcast-gateway.ts. These tests prove it
// stays a pure pass-through — same auth wall, same result shapes — and never exposes the
// hard-disabled REAL send chokepoint (submitBroadcastRun), mirroring customer-inbox-ui-actions.test.ts.
vi.mock("../auth-guard", () => ({
  requireOwner: vi.fn(async () => ({
    email: "c5-m3-ui-owner@example.test",
    ownerId: "c5-m3-ui-test-org-a",
  })),
}));
vi.mock("../better-auth/compat", () => ({
  isImpersonating: vi.fn(async () => false),
}));

const ORG_A = "c5-m3-ui-test-org-a";
const USER_OWNER = "c5-m3-ui-test-user-owner";
const OWNER = "c5-m3-ui-test-owner";
const SCOPE_A = "c5-m3-ui-test-scope-a";
const NOW = new Date("2026-07-21T08:00:00.000Z");

async function cleanup(): Promise<void> {
  await prisma.broadcastAudienceMember.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.broadcastRun.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.channelScope.deleteMany({ where: { ownerId: ORG_A } });
  await prisma.membership.deleteMany({ where: { orgId: ORG_A } });
  await prisma.organization.deleteMany({ where: { id: ORG_A } });
  await prisma.user.deleteMany({ where: { id: USER_OWNER } });
}

async function seed(): Promise<void> {
  await prisma.organization.create({ data: { id: ORG_A } });
  await prisma.user.create({ data: { id: USER_OWNER, email: "c5-m3-ui-owner@example.test" } });
  await prisma.membership.create({ data: { id: OWNER, userId: USER_OWNER, orgId: ORG_A, role: "owner" } });
  await prisma.channelScope.create({ data: { id: SCOPE_A, ownerId: ORG_A, channel: "whatsapp", scopeKey: "waba-a", createdAt: NOW } });
}

beforeEach(async () => {
  await cleanup();
  await seed();
  vi.clearAllMocks();
});

afterAll(cleanup);

describe("customer-broadcast-ui-actions wrapper", () => {
  it("passes a read result through verbatim", async () => {
    const result = await customerBroadcastUiActions.listBroadcastRuns({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.resource).toEqual([]);
  });

  it("passes a successful mutation result through verbatim", async () => {
    const result = await customerBroadcastUiActions.createBroadcastRun({
      channelScopeId: SCOPE_A,
      channel: "whatsapp",
      purpose: "marketing",
      creationIdempotencyKey: "c5-m3-ui-create",
    });
    expect(result).toMatchObject({ ok: true, duplicate: false, resource: { status: "draft" } });
  });

  it("maps a structured RESOURCE_NOT_FOUND failure through verbatim", async () => {
    const result = await customerBroadcastUiActions.getBroadcastRun({ broadcastRunId: "c5-m3-ui-missing" });
    expect(result).toEqual({ ok: false, error: "RESOURCE_NOT_FOUND" });
  });

  it("passes NOT_AUTHORIZED through when there is no session", async () => {
    vi.mocked(requireOwner).mockResolvedValueOnce({ error: "Not authorized." });
    const result = await customerBroadcastUiActions.listBroadcastRuns({});
    expect(result).toEqual({ ok: false, error: "NOT_AUTHORIZED" });
  });

  it("never wraps the hard-disabled REAL send chokepoint (submitBroadcastRun), under any export name", () => {
    // Import-source check: the gateway import(s) in the actual .ts source must not name
    // submitBroadcastRun, aliased or not (a runtime toString() check alone is defeated by an alias).
    const srcPath = path.resolve(__dirname, "../customer-broadcast-ui-actions.ts");
    const src = fs.readFileSync(srcPath, "utf8");
    const gatewayImports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']\.\/customer-broadcast-gateway["']/g)];
    expect(gatewayImports.length, "expected at least one named import from ./customer-broadcast-gateway").toBeGreaterThan(0);
    const importedNames = gatewayImports.flatMap((match) =>
      match[1]!
        .split(",")
        .map((specifier) => specifier.trim())
        .filter(Boolean)
        .map((specifier) => specifier.split(/\s+as\s+/)[0]!.trim()),
    );
    expect(
      importedNames.includes("submitBroadcastRun"),
      `the gateway import(s) must not name "submitBroadcastRun", aliased or not — found: ${importedNames.join(", ")}`,
    ).toBe(false);

    // Export-set check: an explicit allowlist. Any new export must be consciously added here.
    const APPROVED_EXPORTS = [
      "cancelBroadcastRun",
      "confirmBroadcastRun",
      "createBroadcastRun",
      "executeBroadcastRun",
      "freezeAudience",
      "getBroadcastRun",
      "getBroadcastRunLivePreflight",
      "listBroadcastRuns",
      "previewAudienceEligibility",
    ].sort();
    expect(Object.keys(customerBroadcastUiActions).sort()).toEqual(APPROVED_EXPORTS);

    // Body check (defense in depth): no export references the disabled gateway call by name.
    for (const [exportName, exportValue] of Object.entries(customerBroadcastUiActions)) {
      if (typeof exportValue !== "function") continue;
      expect(
        exportValue.toString().includes("submitBroadcastRun"),
        `export "${exportName}" must not reference the disabled gateway call "submitBroadcastRun"`,
      ).toBe(false);
    }
  });
});
