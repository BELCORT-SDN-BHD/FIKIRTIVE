import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Post NextAuth retirement: requireOwner + the files route read the session via
// @/lib/better-auth/compat (auth()) and the allowlist via @/lib/allowlist. Mock both — auth()
// controllable per-test; allowed()/isFounderAdmin() env-driven (inlined, no DB). Same pattern as
// require-owner.test.ts. allowed() unions FOUNDER_ADMIN_EMAILS ∪ AUTH_ALLOWED_EMAILS like the real one.
const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ auth: mockAuth }));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.FOUNDER_ADMIN_EMAILS ?? ""},${process.env.AUTH_ALLOWED_EMAILS ?? ""}`.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin, isAllowedEmail: allowed };
});

const A_EMAIL = `orgA-${randomUUID()}@fikirtive.test`;
const B_EMAIL = `orgB-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test"; // neither A nor B is founder
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const data = await import("@/lib/data");
const gen = await import("@/lib/gen-actions");
const refgen = await import("@/lib/refgen-actions");
const { GET: filesGET } = await import("@/app/files/[...key]/route");
const { storageKey } = await import("@fikirtive/core");
const tenantAdmin = await import("@/lib/tenant-admin");
const mediaLink = await import("@/lib/media-link-actions");
const { verifyMediaToken } = await import("@fikirtive/token-crypto");

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
    expect(await data.getLooseVideoClips(orgB, aProjectId)).toEqual([]);
    expect(await data.getFrameCandidates(orgB, aProjectId)).toEqual([]);
    expect((await data.getMediaPage(orgB, aProjectId)).items).toEqual([]);
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
    const entityOfA = (await prisma.refGenJob.findUnique({ where: { id: aRefGenJobId, ownerId: orgA }, select: { entityId: true } }))!.entityId;
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
    const { keyOwnerMatches } = await import("@fikirtive/core");
    const key = storageKey(orgA, aAssetHash, "png");
    expect(keyOwnerMatches(key, orgA)).toBe(true);
  });
  // 公开链接的铸链口(`Copy link` 背后那一步)。这是本仓库里**唯一**造「免登录也打得开」
  // 地址的地方,所以它的租户闸要有自己的钉子:光靠 `/api/media/pub/<token>` 那道门的
  // `keyOwnerMatches` 不够 —— 铸链时若把签名换成资产自己的 ownerId(看起来像修 bug 的一步),
  // 那道门与这里的闸会同时失效。形状照上面 /files 那一对:先拒绝,再控制组。
  //
  // `getPublicMediaLink` 里那道「资产命名空间再核一次」的二次闸没有单独的钉子,不是漏了:
  // 数据库不让摆出会触发它的行 —— `Generation.asset` 是复合外键 `[assetId, ownerId] →
  // Asset[id, ownerId]`(packages/db/prisma/schema.prisma:161),本轮实测手工造这种行会被
  // `Generation_assetId_ownerId_fkey` 拒掉。二次闸是纯冗余防线,由 schema 兜底。
  describe("FRONT-A12 public media link (getPublicMediaLink)", () => {
    // 钥匙只在这一段里存在:vitest 单线程,整个 apps/web 共用一个进程的 process.env,
    // 留着会漏给别的文件(share-preview 一族有「没有这把钥匙时」的用例)。
    const MEDIA_SECRET = "isolation-test-media-secret";
    let savedSecret: string | undefined;
    beforeAll(() => { savedSecret = process.env.MEDIA_PROXY_SECRET; process.env.MEDIA_PROXY_SECRET = MEDIA_SECRET; });
    afterAll(() => {
      if (savedSecret === undefined) delete process.env.MEDIA_PROXY_SECRET;
      else process.env.MEDIA_PROXY_SECRET = savedSecret;
    });

    it("FRONT-A12 public link: B minting on A's generation id is refused, word-for-word like a nonexistent id", async () => {
      await asUser(B_EMAIL);
      const crossTenant = await mediaLink.getPublicMediaLink(aGenerationId);
      const nonexistent = await mediaLink.getPublicMediaLink(`gen_${randomUUID()}`);
      expect(crossTenant).toEqual({ error: "Not found." });
      // 一字不差 ⇒ 这条回话不能当作「这个 id 存在」的探针
      expect(crossTenant).toEqual(nonexistent);
    });
    it("FRONT-A12 public link: A's own generation mints a token bound to A's namespace (control — not vacuously refusing)", async () => {
      await asUser(A_EMAIL);
      const minted = await mediaLink.getPublicMediaLink(aGenerationId);
      if ("error" in minted) throw new Error(`control minted nothing: ${minted.error}`);
      expect(minted.path.startsWith("/api/media/pub/")).toBe(true);
      expect(minted.expiresInMinutes).toBe(10);
      // 令牌里签着的 owner 与 key 都必须是 A 的 —— 签名换成别处的 ownerId 会在这里红。
      const token = decodeURIComponent(minted.path.slice("/api/media/pub/".length));
      const claims = verifyMediaToken(token, MEDIA_SECRET);
      expect(claims?.ownerId).toBe(orgA);
      expect(claims?.key).toBe(storageKey(orgA, aAssetHash, "png"));
    });
    it("FRONT-A12 public link: no MEDIA_PROXY_SECRET ⇒ fail closed, never a link", async () => {
      await asUser(A_EMAIL);
      delete process.env.MEDIA_PROXY_SECRET;
      try {
        const minted = await mediaLink.getPublicMediaLink(aGenerationId);
        expect(minted).toEqual({ error: "Sharing links aren't configured in this environment yet." });
      } finally {
        process.env.MEDIA_PROXY_SECRET = MEDIA_SECRET;
      }
    });
  });
  it("tenant-admin: getTenantDetail(orgB) returns orgB's own data, not A's", async () => {
    // Seed orgB's credit account so getTenantDetail has real data to return
    await prisma.creditAccount.upsert({
      where: { orgId: orgB },
      update: { balance: 1230, reserved: 0 },
      create: { orgId: orgB, balance: 1230, reserved: 0 },
    });
    const detail = await tenantAdmin.getTenantDetail(orgB);
    expect(detail).not.toBeNull();
    // scoped to orgB — ownerEmail belongs to orgB, not A
    expect(detail!.orgId).toBe(orgB);
    expect(detail!.ownerEmail).toBe(B_EMAIL);
    // balance is orgB's own (1230 internal → 123 displayed), not orgA's
    expect(detail!.balance).toBe(123);
    // genCount is orgB's own generation count (0 — no gens seeded for B)
    expect(detail!.genCount).toBe(0);
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
