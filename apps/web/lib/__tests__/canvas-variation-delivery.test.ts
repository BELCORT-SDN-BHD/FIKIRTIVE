/**
 * canvas-variation-delivery —— **variation 真的交付了一张商家能打开、能下载的图**。
 *
 * 规格：`docs/specs/creation-engine.md`（已冻结 · v2）§5 第 177 行 —— staging E2E Round 1
 * 门槛 A3「variation 至少一次真实可用交付」当时 FAIL（`docs/audits/fullstack-staging-2026-09-08/
 * report-round1.md:391`、同目录 `coverage-matrix.md:28` FL-04）。Founder 2026-09-10 裁（#1307）：
 * 进 v0.1.1，先复现再修；**验收口径 = 对一张已生成图做 variation，产出可打开、可下载、账本
 * 只有一次收费**。验收编号沿用 **CREATE-A1**（2026-09-04 裁决把变体这条路判进 A1，不发明新号）。
 *
 * ── 走查那天到底断在哪一格（复现记录）────────────────────────────────────────────
 * job `01M1ZRF0D1JWSCZGHN8EX6YCNJ`：`05:39:42.124Z` 创建、`05:40:42.828Z` FAILED，
 * 错误 `generation provider returned only 0/1 usable images`，spent=true、spentUsd=USD0.035、
 * billedUnits=null（`backend-evidence.md:110`）。**60.704 秒**，而那条路上只有一个 60 秒的钟：
 * `/images/generations` 这个**同步渲染**端点当时用的是控制面尺寸 `ARK_CONTROL_TIMEOUT_MS`。
 * 根因与修法钉在 `packages/generation/src/byteplus.test.ts`（`ARK_IMAGE_TIMEOUT_MS`）。
 * 账本那一头当天是对的（一条 RESERVE + 一条 REFUND、hold 清零），本文件把它连同交付一起钉住，
 * 免得下一次「修好了生成、账本却多收一次」没人发现。
 *
 * ── 这一份不隔任何一段 ────────────────────────────────────────────────────────
 *   确认卡按下 `Generate · N credits` 的那份材料
 *     → 真 `startCanvasGen`（真 Postgres、真预扣、真 GenJob 落库）
 *     → 真 `handleGen`（真解析 sourceGenerationId、真落 Asset/Generation、真结算）
 *     → 真 `/files/<key>?download=1` 路由（真库的租户闸）把**worker 存进去的那几个字节**流回来。
 *
 * 只有两样是假的，而且都必须假：**付费引擎**（绝不真调用、绝不真花钱）与**对象存储**
 * （不需要真 R2）。假存储是一个内存 map：worker 用 `put` 写进去，下载路由用 `readStream`
 * 读出来 —— 所以「下载 200」不是「我 mock 了 200」，是「worker 写的那把 key 上真有字节」。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { displayCredits, pricedGenCredits, storageKey } from "@fikirtive/core";

// ── web 侧管线（与 canvas-variation-confirm-ledger.test.ts 同一套）──────────────
const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@/lib/better-auth/compat", () => ({
  isImpersonating: vi.fn(async () => false),
  auth: vi.fn(async () => ({ user: { email: "variation@fikirtive.test" } })),
}));
vi.mock("@/lib/allowlist", () => ({ allowed: vi.fn(async () => true) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../queue", () => ({
  getBoss: vi.fn(async () => ({ send: vi.fn(async (_n: string, _d: unknown, o: { id?: string }) => o.id ?? null) })),
}));
vi.mock("../cowork-guardian", () => ({ checkCast: vi.fn(async () => null) }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => ({ disabled: new Set<string>() })) }));

// ── 一个内存桶：worker 往里写，下载路由从里读。两边看的是同一份字节。────────────
const bucket = new Map<string, Uint8Array>();

const w = vi.hoisted(() => ({ generateImages: vi.fn(), generateVideo: vi.fn() }));
vi.mock("../../../worker/src/generation.js", () => ({
  provider: { name: "byteplus", generate: w.generateImages, generateVideo: w.generateVideo },
}));
vi.mock("../../../worker/src/model-registry.js", () => ({ workerDisabledModels: vi.fn(async () => new Set()) }));
vi.mock("../../../worker/src/storage.js", async () => {
  const { storageKey: key } = await import("@fikirtive/core");
  return {
    storage: {
      // 真驱动的形状：内容寻址，返回 sha256。
      put: vi.fn(async (ownerId: string, bytes: Uint8Array, ext: string) => {
        const contentHash = createHash("sha256").update(bytes).digest("hex");
        bucket.set(key(ownerId, contentHash, ext), bytes);
        return { contentHash };
      }),
      presignedGet: vi.fn(async (k: string) => (bucket.has(k) ? `https://bucket.test/${k}?sig=x` : "")),
      get: vi.fn(async (k: string) => bucket.get(k)),
    },
  };
});

// 下载路由那一半的存储：只读，读的仍是上面那个桶。
vi.mock("@/lib/storage", () => ({
  storage: {
    presignedGet: vi.fn(async () => null), // 走同源转发那条路，不重定向去桶
    get: vi.fn(async (k: string) => bucket.get(k)),
    readStream: vi.fn(async (k: string) => {
      const bytes = bucket.get(k);
      if (!bytes) throw new Error(`no object at ${k}`);
      return (async function* () { yield bytes; })();
    }),
  },
  mimeOf: () => "image/png",
  kindOf: () => "image",
}));

const { startCanvasGen } = await import("../gen-actions");
const { handleGen } = await import("../../../worker/src/jobs/gen.js");
const { GET } = await import("@/app/files/[...key]/route");
const { prisma } = await import("@fikirtive/db");

const CASE_TIMEOUT_MS = 60_000;
const PROMPT = "a cup steaming on a rattan mat";
/** 产出的那张图的字节 —— 用它算出的 sha256 就是落库的 contentHash。 */
const OUT_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const OUT_HASH = createHash("sha256").update(OUT_BYTES).digest("hex");

/** 单一价目源现算的那个数（内部 credits）。零字面量。 */
const QUOTE = pricedGenCredits({
  kind: "IMAGE", model: "seedream", count: 1, referenceVideoGenerationId: null, videoOptions: null,
});
const DISPLAY_QUOTE = displayCredits(QUOTE);

const dbName = (process.env.DATABASE_URL ?? "").split("/").at(-1)?.split("?")[0] ?? "";
if (!dbName.endsWith("_test")) {
  throw new Error(`refusing to run against a non-*_test database — got "${dbName}"`);
}

async function seedOrg(balance: number): Promise<string> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance, reserved: 0 } });
  return ownerId;
}
async function seedProject(ownerId: string): Promise<string> {
  const id = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id, ownerId, name: "variation delivery" } });
  return id;
}

/** 「一张已生成图」—— 商家画布上那张卡背后真实的 Generation + Asset + 桶里的字节。 */
async function seedSourceImage(ownerId: string, projectId: string): Promise<string> {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const assetId = `ast_${randomUUID()}`;
  await prisma.asset.create({
    data: {
      id: assetId, ownerId, contentHash, ext: "png", mime: "image/png",
      sizeBytes: BigInt(bytes.byteLength), source: "GENERATED",
    },
  });
  bucket.set(storageKey(ownerId, contentHash, "png"), bytes);
  const genId = `gen_${randomUUID()}`;
  await prisma.generation.create({
    data: {
      id: genId, ownerId, projectId, assetId, source: "GENERATED",
      promptText: PROMPT, modelRef: "seedream", entitySnapshot: { entities: [] },
    },
  });
  return genId;
}

/** 变体确认卡按下 `Generate · N credits` 那一刻真正发出去的东西（照抄 `runImageEvolve`）。 */
function confirmPress(over: { projectId: string; actionId: string; sourceGenerationId: string }) {
  return {
    actionId: over.actionId,
    expectedCredits: DISPLAY_QUOTE,
    projectId: over.projectId,
    prompt: PROMPT,
    entityIds: [],
    count: 1,
    kind: "image" as const,
    model: "seedream" as const,
    aspectRatio: "3:4",
    sourceGenerationId: over.sourceGenerationId,
  };
}

function idOf(res: Awaited<ReturnType<typeof startCanvasGen>>): { id: string; disposition?: string } {
  if ("error" in res) throw new Error(res.error);
  return res;
}

async function ledger(ownerId: string) {
  return prisma.creditLedger.findMany({ where: { orgId: ownerId }, orderBy: { createdAt: "asc" } });
}

/** 真下载路由：`/files/<key>?download=1`。返回状态码与流回来的字节。 */
async function download(key: string): Promise<{ status: number; bytes: Uint8Array }> {
  const req = {
    headers: { get: () => null },
    url: `http://x/files/${key}?download=1`,
  } as unknown as Parameters<typeof GET>[0];
  const res = await GET(req, { params: Promise.resolve({ key: key.split("/") }) });
  const body: unknown = (res as unknown as { body: unknown }).body;
  if (!(body instanceof ReadableStream)) return { status: res.status, bytes: new Uint8Array() };
  const chunks: number[] = [];
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(...value);
  }
  return { status: res.status, bytes: Uint8Array.from(chunks) };
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
}, CASE_TIMEOUT_MS);

beforeEach(() => {
  vi.clearAllMocks();
  bucket.clear();
  w.generateImages.mockResolvedValue([{ bytes: OUT_BYTES, ext: "png" }]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("creation §5 :177 variation 真实交付（门槛 A3 / FL-04）", () => {
  it(
    "creation §5 :177 variation 对一张已生成图做变体 ⇒ 产出可打开、可下载，账本恰一次 SETTLE、无重复预扣（CREATE-A1）",
    async () => {
      const ownerId = await seedOrg(1000);
      mockRequireOwner.mockResolvedValue({ ownerId, email: "variation@fikirtive.test" });
      const projectId = await seedProject(ownerId);
      const sourceGenerationId = await seedSourceImage(ownerId, projectId);

      // ① 确认卡按下 Generate ⇒ 预扣一次。
      const started = idOf(await startCanvasGen(confirmPress({
        projectId, actionId: `canvas-action-${randomUUID()}`, sourceGenerationId,
      })));
      expect(started.disposition).toBe("fresh");

      // ② worker 跑完整条 handleGen。
      await handleGen({ genJobId: started.id }, 0);

      const job = await prisma.genJob.findFirstOrThrow({ where: { id: started.id, ownerId } });
      expect(job.status).toBe("DONE");
      expect(job.generationIds).toHaveLength(1);

      // ③ 产出可打开：Generation 行在库里，指着一件真 Asset，源图身份没丢。
      const produced = await prisma.generation.findFirstOrThrow({
        where: { id: job.generationIds[0]!, ownerId }, include: { asset: true },
      });
      expect(produced.ownerId).toBe(ownerId);
      expect(produced.assetId).not.toBe(null);
      expect(produced.asset!.contentHash).toBe(OUT_HASH);
      expect(job.sourceGenerationId).toBe(sourceGenerationId);
      // 引擎收到的确实是那张源图（不是一张无条件的新图）。
      const sent = w.generateImages.mock.calls[0]![0] as { inputImageUrls: string[] };
      expect(sent.inputImageUrls).toHaveLength(1);
      expect(sent.inputImageUrls[0]).toContain(
        storageKey(ownerId, createHash("sha256").update(new Uint8Array([1, 2, 3, 4, 5])).digest("hex"), "png"),
      );

      // ④ storage key 存在：worker 写的那把 key 上真的有字节。
      const key = storageKey(ownerId, produced.asset!.contentHash, produced.asset!.ext);
      expect(bucket.has(key)).toBe(true);

      // ⑤ 可下载：真路由 200，而且流回来的就是 worker 存进去的那几个字节。
      const res = await download(key);
      expect(res.status).toBe(200);
      expect([...res.bytes]).toEqual([...OUT_BYTES]);

      // ⑥ 账本只有一次收费：恰一条 RESERVE + 恰一条 SETTLE、零 REFUND，hold 清零。
      const rows = await ledger(ownerId);
      expect(rows.filter((r) => r.kind === "RESERVE")).toHaveLength(1);
      expect(rows.filter((r) => r.kind === "SETTLE")).toHaveLength(1);
      expect(rows.filter((r) => r.kind === "REFUND")).toHaveLength(0);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.refId).toBe(started.id);
      expect(rows[1]!.refId).toBe(started.id);
      expect(rows[0]!.reservedDelta).toBe(QUOTE);
      expect(Math.abs(rows[1]!.reservedDelta)).toBe(QUOTE);
      const acct = await prisma.creditAccount.findFirstOrThrow({ where: { orgId: ownerId } });
      expect(acct.balance).toBe(1000 - QUOTE);
      expect(acct.reserved).toBe(0);
      // 无重复预扣：整条路上只有这一单 job。
      expect(await prisma.genJob.count({ where: { ownerId, projectId } })).toBe(1);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "creation §5 :177 variation 别的租户拿着同一把 key 也下载不到（CREATE-A1）",
    async () => {
      // 交付这件事只有在「交付给对的人」时才成立。少了这一条，上面那个 200 也可能是一条
      // 谁都能拖的链接 —— 那不是交付，那是泄露。
      const ownerId = await seedOrg(1000);
      mockRequireOwner.mockResolvedValue({ ownerId, email: "variation@fikirtive.test" });
      const projectId = await seedProject(ownerId);
      const sourceGenerationId = await seedSourceImage(ownerId, projectId);
      const started = idOf(await startCanvasGen(confirmPress({
        projectId, actionId: `canvas-action-${randomUUID()}`, sourceGenerationId,
      })));
      await handleGen({ genJobId: started.id }, 0);
      const key = storageKey(ownerId, OUT_HASH, "png");
      expect((await download(key)).status).toBe(200);

      const otherId = await seedOrg(1000);
      mockRequireOwner.mockResolvedValue({ ownerId: otherId, email: "other@fikirtive.test" });
      expect((await download(key)).status).toBe(404);
    },
    CASE_TIMEOUT_MS,
  );
});
