import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Mock only auth() (the session). allowed()/isFounderAdmin() are inlined (byte-identical to
// auth.ts) because importOriginal can't load next-auth under vitest (it imports `next/server`
// without .js, which only resolves under the Next.js bundler). Same pattern as require-owner.test.ts.
const mockAuth = vi.fn();
vi.mock("@/auth", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.AUTH_ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { auth: mockAuth, allowed, isFounderAdmin };
});

const A_EMAIL = `orgA-${randomUUID()}@artlio.test`;
const B_EMAIL = `orgB-${randomUUID()}@artlio.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@artlio.test"; // neither A nor B is founder
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@artlio/db");
const data = await import("@/lib/data");
const gen = await import("@/lib/gen-actions");
const refgen = await import("@/lib/refgen-actions");
const { GET: filesGET } = await import("@/app/files/[...key]/route");
const { storageKey } = await import("@artlio/core");

async function asUser(email: string) { mockAuth.mockResolvedValue({ user: { email } }); }
async function ensureUser(email: string) {
  return prisma.user.upsert({ where: { email }, update: {}, create: { id: `usr_${randomUUID()}`, email } });
}

let orgA: string, orgB: string;
let aProjectId: string, aGenJobId: string, aGenerationId: string, aAssetHash: string, aThreadId: string, aRefGenJobId: string;

beforeAll(async () => {
  await ensureUser(A_EMAIL); await ensureUser(B_EMAIL);
  await asUser(A_EMAIL); const a = await requireOwner(); if ("error" in a) throw new Error(a.error); orgA = a.ownerId;
  await asUser(B_EMAIL); const b = await requireOwner(); if ("error" in b) throw new Error(b.error); orgB = b.ownerId;
  expect(orgA).not.toBe(orgB);

  // seed org A's data directly (bypass actions for setup speed; assertions use the real read path)
  aProjectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: aProjectId, ownerId: orgA, name: "A project" } });
  aAssetHash = "a".repeat(64);
  const asset = await prisma.asset.create({ data: { id: `ast_${randomUUID()}`, ownerId: orgA, contentHash: aAssetHash, ext: "png", mime: "image/png", sizeBytes: BigInt(10), source: "UPLOAD" } });
  // Generation: real required cols are source(enum) + entitySnapshot(jsonb); promptText/modelRef/version default.
  const generation = await prisma.generation.create({ data: { id: `gen_${randomUUID()}`, ownerId: orgA, projectId: aProjectId, assetId: asset.id, source: "GENERATED", entitySnapshot: {} } });
  aGenerationId = generation.id;
  aGenJobId = `gj_${randomUUID()}`;
  await prisma.genJob.create({ data: { id: aGenJobId, ownerId: orgA, projectId: aProjectId, prompt: "x", model: "seedream", kind: "IMAGE", count: 1, status: "DONE", generationIds: [aGenerationId], spentUsd: 0.04, finishedAt: new Date() } });
  const thread = await prisma.chatThread.create({ data: { id: `ct_${randomUUID()}`, ownerId: orgA, projectId: aProjectId, title: "A thread" } });
  aThreadId = thread.id;
  aRefGenJobId = `rg_${randomUUID()}`;
  const entity = await prisma.entity.create({ data: { id: `ent_${randomUUID()}`, ownerId: orgA, name: "A", type: "CHARACTER" } });
  await prisma.refGenJob.create({ data: { id: aRefGenJobId, ownerId: orgA, entityId: entity.id, prompt: "x", model: "seedream", mode: "BASE", count: 1, status: "DONE" } });
});

describe("2-org isolation — org B can never read org A", () => {
  it("projects: B's getProjects excludes A's project", async () => {
    const projects = await data.getProjects(orgB);
    expect(projects.some((p) => p.id === aProjectId)).toBe(false);
  });
  it("shots: B's getShots on A's project id returns []", async () => {
    expect(await data.getShots(orgB, aProjectId)).toEqual([]);
  });
  it("candidates/media: B's reads on A's project return []", async () => {
    expect(await data.getCandidates(orgB, aProjectId)).toEqual([]);
    expect(await data.getProjectMedia(orgB, aProjectId)).toEqual([]);
  });
  it("threads: B's getCoworkThread on A's thread id is null", async () => {
    expect(await data.getCoworkThread(orgB, aThreadId)).toBeNull();
  });
  it("cost visibility: B's resolveCoworkResultUrls cannot read A's spentUsd", async () => {
    const fakeThreads = [{ messages: [{ kind: "GEN_RESULT", genJobId: aGenJobId }] }];
    const map = await data.resolveCoworkResultUrls(orgB, fakeThreads);
    expect(map.has(aGenJobId)).toBe(false); // A's job (with its spentUsd) is invisible to B
  });
  it("gen second-hop: B's getGenJob on A's job id is null", async () => {
    await asUser(B_EMAIL);
    expect(await gen.getGenJob(aGenJobId)).toBeNull();
  });
  it("gen second-hop: B's getRecentGenResults on A's project is []", async () => {
    await asUser(B_EMAIL);
    expect(await gen.getRecentGenResults(aProjectId)).toEqual([]);
  });
  it("refgen: B's getRefGenJobs cannot see A's refgen job", async () => {
    await asUser(B_EMAIL);
    const entityOfA = (await prisma.refGenJob.findUnique({ where: { id: aRefGenJobId }, select: { entityId: true } }))!.entityId;
    const jobs = await refgen.getRefGenJobs(entityOfA);
    expect(Array.isArray(jobs) ? jobs.some((j: { id: string }) => j.id === aRefGenJobId) : false).toBe(false);
  });
  it("credits: B's account is its own beta grant, not A's", async () => {
    const acctA = await prisma.creditAccount.findUnique({ where: { orgId: orgA } });
    const acctB = await prisma.creditAccount.findUnique({ where: { orgId: orgB } });
    expect(acctA?.orgId).toBe(orgA);
    expect(acctB?.orgId).toBe(orgB);
    expect(acctA?.orgId).not.toBe(acctB?.orgId);
  });
  it("/files: B cannot fetch A's blob by key (404)", async () => {
    await asUser(B_EMAIL);
    const key = storageKey(orgA, aAssetHash, "png").split("/"); // ["u", orgA, "<hash>.png"]
    const res = await filesGET({ headers: { get: () => null }, url: "http://x/files" } as never, { params: Promise.resolve({ key }) });
    expect(res.status).toBe(404);
  });
  it("/files: A's own key passes the owner guard (control — not vacuously 404ing)", async () => {
    const { keyOwnerMatches } = await import("@artlio/core");
    const key = storageKey(orgA, aAssetHash, "png");
    expect(keyOwnerMatches(key, orgA)).toBe(true);
  });
});

afterAll(async () => {
  // best-effort cleanup of the seeded org-A rows (ON DELETE RESTRICT means order matters)
  await prisma.genJob.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
  await prisma.refGenJob.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
  await prisma.generation.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
  await prisma.chatThread.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
  await prisma.referenceImage.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
  await prisma.entity.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
  await prisma.asset.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
  await prisma.project.deleteMany({ where: { ownerId: orgA } }).catch(() => {});
});
