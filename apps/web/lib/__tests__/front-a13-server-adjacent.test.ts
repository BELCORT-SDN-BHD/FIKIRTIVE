/**
 * FRONT-A13 —— 前端基线①段「四处 server 邻接改动」的行为测试
 * (规格 `docs/specs/frontend-baseline.md` §2 验收表 FRONT-A13、§7.1 第 ① 段)。
 *
 * ── 这份文件为什么存在 ────────────────────────────────────────────────────
 * ①段是「纯合并」:绝大多数改动是页面长相。但分支带过来的**不全是**长相 —— 有四处落在
 * server 一侧,商家看不见、typecheck 也不会红,而它们各自都能安静地伤到商家的数据:
 *
 *   ① 会话分页(`lib/data.ts` 的 `getCoworkThreadPage` + `cowork-fetch.ts` 的
 *      `getOlderCoworkThreadMessagesClient` + `dto.ts`/`types.ts` 的 `hasOlderMessages`)
 *      —— 长会话不再整条读。分页写错一格,商家就会**看不见自己说过的话**,或者
 *      「Load older」永远转不完。分页边界(第 take+1 条)与租户边界都必须钉住。
 *   ② 软删除与恢复(`memory-actions.ts` 的 `deleteMemory`/`restoreMemory`、
 *      `brand-record-actions.ts` 的 `deleteBrandRecord`/`restoreBrandRecord`)
 *      —— 分支把两个删除的 `where` 里的 `deletedAt: null` 去掉了,让**重试**一次不确定的
 *      删除仍然成功。这条要证明的不是「删得掉」,是删/恢复之后**内容没有被改写**,
 *      而且别家租户既删不掉也恢复不了。
 *   ③ Library 去重(`stuff-items.ts`)—— 广告本身就是 Generation 行,所以
 *      `getMyAds()` 与 `getRecentGenerationThumbs()` 会读到**同一个 id**。不去重,
 *      同一段素材在素材库里出现两次;去重去错边,它会从 Ads 筛选里消失。
 *   ④ Otto 导航说明(`packages/otto/src/instructions.ts`)—— 说明书里两处地名从
 *      `schedule`/`campaign` 改口。这两个 key 已经**不在** `MERCHANT_NAV` 里了。
 *
 * ── 口径 ────────────────────────────────────────────────────────────────
 * ①②③ 打真库(项目法 Database safety / Tenant isolation:两个真 organization,
 * 断言双向)。③ 连同真的 storage 落盘一起走完整读取链,因为「同一行会被两个读取函数同时
 * 读到」这件事本身就是这段代码存在的理由 —— 用假数据喂纯函数只能证明去重逻辑自洽,
 * 证明不了重复真的会发生。④ 是 golden:说明书里写成路的地名,逐条回到 `navigation.ts`
 * 这唯一权威源核对。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ auth: mockAuth }));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.FOUNDER_ADMIN_EMAILS ?? ""},${process.env.AUTH_ALLOWED_EMAILS ?? ""}`
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin, isAllowedEmail: allowed };
});

const A_EMAIL = `a13OrgA-${randomUUID()}@fikirtive.test`;
const B_EMAIL = `a13OrgB-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { getCoworkThreadPage, getMyAds, getRecentGenerationThumbs } = await import("@/lib/data");
const { addMemory, deleteMemory, restoreMemory, listMemory } = await import("@/lib/memory-actions");
const {
  saveBrandRecord, deleteBrandRecord, restoreBrandRecord, listBrandRecords,
} = await import("@/lib/brand-record-actions");
const { buildStuffItems, filterStuffItems } = await import("@/lib/stuff-items");
const { storage } = await import("@/lib/storage");


function asUser(email: string) { mockAuth.mockResolvedValue({ user: { email } }); }
function ensureUser(email: string) {
  return prisma.user.upsert({ where: { email }, update: {}, create: { id: `usr_${randomUUID()}`, email } });
}

let orgA = "", orgB = "";
let projectA = "";

beforeAll(async () => {
  await ensureUser(A_EMAIL);
  await ensureUser(B_EMAIL);
  asUser(A_EMAIL); const a = await requireOwner(); if ("error" in a) throw new Error(a.error); orgA = a.ownerId;
  asUser(B_EMAIL); const b = await requireOwner(); if ("error" in b) throw new Error(b.error); orgB = b.ownerId;
  expect(orgA).not.toBe(orgB);

  projectA = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectA, ownerId: orgA, name: "A13 project" } });
});

/* ────────────────────────────── ① 会话分页 ────────────────────────────── */

/** `getCoworkThreadPage` 的生产默认页宽 —— 断言必须自己知道这个数,否则「刚好一页」
 *  和「多一条」这两个边界就无从区分。改了产品代码这里会红,那是要的。 */
const PAGE = 60;

async function seedThread(ownerId: string, projectId: string, count: number) {
  const threadId = `thr_${randomUUID()}`;
  await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId, title: "A13" } });
  await prisma.chatMessage.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      id: `msg_${randomUUID()}`,
      threadId,
      ownerId,
      role: (i % 2 === 0 ? "USER" : "AGENT") as "USER" | "AGENT",
      kind: "TEXT" as const,
      seq: i + 1,
      text: `turn ${i + 1}`,
    })),
  });
  return threadId;
}

describe("FRONT-A13 ①:长会话按服务端序号分页,页宽边界与租户边界都不放水", () => {
  let overflowing = "", exact = "", short = "", withDeleted = "";

  beforeAll(async () => {
    overflowing = await seedThread(orgA, projectA, PAGE + 1);
    exact = await seedThread(orgA, projectA, PAGE);
    short = await seedThread(orgA, projectA, 3);
    withDeleted = await seedThread(orgA, projectA, 4);
    await prisma.chatMessage.updateMany({
      where: { threadId: withDeleted, ownerId: orgA, seq: 2 },
      data: { deletedAt: new Date() },
    });
  });

  it("FRONT-A13:超过一页时只回最新一页,按时间正序,并如实说还有更早的", async () => {
    const page = await getCoworkThreadPage(orgA, overflowing);
    expect(page).not.toBeNull();
    expect(page!.messages).toHaveLength(PAGE);
    expect(page!.hasOlderMessages).toBe(true);
    // 存储里是 seq 倒序取的,交回来必须是商家读得下去的正序。
    const seqs = page!.messages.map((m) => m.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    // 最新一页 = 末尾 PAGE 条。61 条时最旧的一条(seq 1)必须被留在下一页。
    expect(seqs[0]).toBe(2);
    expect(seqs.at(-1)).toBe(PAGE + 1);
  });

  it("FRONT-A13:刚好一页时不谎报还有更早的(take+1 探针的边界)", async () => {
    const page = await getCoworkThreadPage(orgA, exact);
    expect(page!.messages).toHaveLength(PAGE);
    // 这一条是这段代码最容易写错的一格:rows.length > take,不是 >=。
    expect(page!.hasOlderMessages).toBe(false);
    expect(page!.messages[0]!.seq).toBe(1);
  });

  it("FRONT-A13:`beforeSeq` 接着往回翻,不重不漏,翻到头就说到头了", async () => {
    const first = await getCoworkThreadPage(orgA, overflowing);
    const oldestSeen = first!.messages[0]!.seq;
    const older = await getCoworkThreadPage(orgA, overflowing, oldestSeen);
    expect(older!.messages.map((m) => m.seq)).toEqual([1]);
    expect(older!.hasOlderMessages).toBe(false);
    // 严格小于:上一页最旧的那条不会在下一页里再出现一次。
    expect(older!.messages.some((m) => m.seq === oldestSeen)).toBe(false);
  });

  it("FRONT-A13:短会话整条回,并且不显示「还有更早」", async () => {
    const page = await getCoworkThreadPage(orgA, short);
    expect(page!.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(page!.hasOlderMessages).toBe(false);
  });

  it("FRONT-A13:软删除的消息不进任何一页", async () => {
    const page = await getCoworkThreadPage(orgA, withDeleted);
    expect(page!.messages.map((m) => m.seq)).toEqual([1, 3, 4]);
  });

  it("FRONT-A13:别家租户拿着同一个 threadId 什么也读不到(首页与翻页两条路都试)", async () => {
    expect(await getCoworkThreadPage(orgB, overflowing)).toBeNull();
    expect(await getCoworkThreadPage(orgB, overflowing, PAGE + 1)).toBeNull();
    // 反向也成立:A 读得到自己的,证明上面的 null 是租户闸的结果,不是 id 写错了。
    expect(await getCoworkThreadPage(orgA, overflowing)).not.toBeNull();
  });
});

/* ──────────────────────── ② 软删除 → 恢复 → 内容完整 ──────────────────── */

describe("FRONT-A13 ②:软删除可重试、可恢复,恢复后内容原样,别家租户两头都碰不到", () => {
  it("FRONT-A13:Memory 删两次都成功,恢复后内容与 id 原样回来", async () => {
    asUser(A_EMAIL);
    const created = await addMemory({ category: "voice", content: "warm, family tone" });
    expect(created).toMatchObject({ ok: true });
    const id = (created as { id: string }).id;
    const before = await prisma.memory.findFirstOrThrow({ where: { id, ownerId: orgA } });

    expect(await deleteMemory({ id })).toEqual({ ok: true });
    // 分支改的就是这一条:`where` 不再要求 deletedAt=null,所以一次不确定的删除可以放心重发。
    expect(await deleteMemory({ id })).toEqual({ ok: true });
    expect((await listMemory()).some((m) => m.id === id)).toBe(false);

    expect(await restoreMemory({ id })).toEqual({ ok: true });
    const after = await prisma.memory.findFirstOrThrow({ where: { id, ownerId: orgA } });
    expect(after.deletedAt).toBeNull();
    // 「内容完整」= 恢复不是重新造一行:id、内容、分类、来源、创建时刻全部原样。
    expect(after.id).toBe(before.id);
    expect(after.content).toBe(before.content);
    expect(after.category).toBe(before.category);
    expect(after.source).toBe(before.source);
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
    expect((await listMemory()).some((m) => m.id === id)).toBe(true);
    // 恢复没有多长出第二行来。
    expect(await prisma.memory.count({ where: { ownerId: orgA, content: before.content } })).toBe(1);
  });

  it("FRONT-A13:别家租户既删不掉也恢复不了 A 的 Memory,行状态一格不动", async () => {
    asUser(A_EMAIL);
    const created = await addMemory({ category: "voice", content: `A only ${randomUUID()}` });
    const id = (created as { id: string }).id;

    asUser(B_EMAIL);
    expect(await deleteMemory({ id })).toEqual({ error: expect.any(String) });
    expect(await prisma.memory.findFirstOrThrow({ where: { id, ownerId: orgA } })).toMatchObject({ deletedAt: null });

    asUser(A_EMAIL);
    await deleteMemory({ id });
    asUser(B_EMAIL);
    expect(await restoreMemory({ id })).toEqual({ error: expect.any(String) });
    expect((await prisma.memory.findFirstOrThrow({ where: { id, ownerId: orgA } })).deletedAt).not.toBeNull();
    expect((await listMemory()).some((m) => m.id === id)).toBe(false); // B 的清单里从来没有过它
  });

  it("FRONT-A13:Brand 记录删两次都成功,恢复后 data 原样,别家租户两头都碰不到", async () => {
    asUser(A_EMAIL);
    const saved = await saveBrandRecord({
      kind: "product",
      data: { name: `Kopi tumbler ${randomUUID()}`, description: "Steel, 500ml" },
    });
    expect(saved).toMatchObject({ ok: true });
    const id = (saved as { id: string }).id;
    const before = await prisma.brandRecord.findFirstOrThrow({ where: { id, ownerId: orgA } });

    expect(await deleteBrandRecord({ id })).toEqual({ ok: true });
    expect(await deleteBrandRecord({ id })).toEqual({ ok: true });
    expect((await listBrandRecords()).some((r) => r.id === id)).toBe(false);

    asUser(B_EMAIL);
    expect(await restoreBrandRecord({ id })).toEqual({ error: expect.any(String) });
    expect((await prisma.brandRecord.findFirstOrThrow({ where: { id, ownerId: orgA } })).deletedAt).not.toBeNull();

    asUser(A_EMAIL);
    expect(await restoreBrandRecord({ id })).toEqual({ ok: true });
    const after = await prisma.brandRecord.findFirstOrThrow({ where: { id, ownerId: orgA } });
    expect(after.deletedAt).toBeNull();
    expect(after.data).toEqual(before.data);
    expect(after.kind).toBe(before.kind);
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
    expect((await listBrandRecords()).some((r) => r.id === id)).toBe(true);
  });
});

/* ─────────────────────── ③ Library 一段素材一张磁贴 ────────────────────── */

describe("FRONT-A13 ③:同一个 Generation 被两个读取函数同时读到时,Library 只画一张磁贴", () => {
  const keys: string[] = [];
  let adGenId = "", plainGenId = "";

  beforeAll(async () => {
    // 两行真的 Generation:一行挂着 threadId(= Otto 造的广告),一行没有。
    // getMyAds 只读前者,getRecentGenerationThumbs 两行都读 —— 重复就是这么来的。
    const threadId = `thr_${randomUUID()}`;
    await prisma.chatThread.create({ data: { id: threadId, ownerId: orgA, projectId: projectA, title: "ads" } });

    for (const [label, withThread] of [["ad", true], ["plain", false]] as const) {
      const put = await storage.put(orgA, new TextEncoder().encode(`a13-${label}-${randomUUID()}`), "png");
      keys.push(put.key);
      const assetId = `ast_${randomUUID()}`;
      await prisma.asset.create({
        data: {
          id: assetId, ownerId: orgA, contentHash: put.contentHash, ext: "png",
          mime: "image/png", sizeBytes: BigInt(32), source: "GENERATED",
        },
      });
      const genId = `gen_${randomUUID()}`;
      await prisma.generation.create({
        data: {
          id: genId, ownerId: orgA, projectId: projectA, assetId, source: "GENERATED",
          promptText: withThread ? "Weekend kopi set poster" : "Shopfront photo",
          entitySnapshot: { entities: [] },
          ...(withThread ? { threadId } : {}),
        },
      });
      if (withThread) adGenId = genId; else plainGenId = genId;
    }
  });

  afterAll(async () => {
    for (const key of keys) await storage.deleteObject(key).catch(() => {});
  });

  it("FRONT-A13:重复是真的会发生 —— 两个读取函数确实回同一个 generation id", async () => {
    const [ads, history] = await Promise.all([getMyAds(orgA), getRecentGenerationThumbs(orgA)]);
    expect(ads.map((a) => a.id)).toContain(adGenId);
    expect(history.map((h) => h.id)).toContain(adGenId);
    expect(history.map((h) => h.id)).toContain(plainGenId);
  });

  it("FRONT-A13:合成素材库后,那段素材只占一张磁贴,而且留下的是广告那一张", async () => {
    const [ads, history] = await Promise.all([getMyAds(orgA), getRecentGenerationThumbs(orgA)]);
    const items = buildStuffItems({ entities: [], history, ads, records: [] });

    const forAdGen = items.filter((i) => i.generationId === adGenId);
    expect(forAdGen).toHaveLength(1);
    expect(forAdGen[0]!.source).toBe("ad");
    // 去重去的是历史那一份,不是把广告本身删了 —— Ads 筛选必须还找得到它。
    expect(filterStuffItems(items, "ads", "").map((i) => i.generationId)).toContain(adGenId);
    // 没挂 thread 的普通生成不受影响,照旧从历史里来。
    const forPlain = items.filter((i) => i.generationId === plainGenId);
    expect(forPlain).toHaveLength(1);
    expect(forPlain[0]!.source).toBe("gen");
  });
});

/* ───────────────────── ④ Otto 导航说明与 navigation.ts 一致 ───────────── */

describe("FRONT-A13 ④:Otto 说明书里的每一条路都回得到 navigation.ts", () => {
  it("FRONT-A13:说明书能被求值出来 —— 被换掉的两处地名已经不在导航权威源里", async () => {
    const nav = await import("@fikirtive/core");
    // 这就是这两行非改不可的原因:key 撤下之后 navPath() 会抛,说明书连构造都构造不出来。
    expect(() => nav.navPath("schedule")).toThrow();
    expect(() => nav.navPath("campaign")).toThrow();
    const { ottoInstructions } = await import("@fikirtive/otto");
    expect(typeof ottoInstructions).toBe("string");
    expect(ottoInstructions.length).toBeGreaterThan(0);
  });

  it("FRONT-A13:说明书里写成路的地名,逐条都在 navPointableNames() 里", async () => {
    const { navPointableNames, NAV_PATH_SEPARATOR } = await import("@fikirtive/core");
    const { ottoInstructions } = await import("@fikirtive/otto");
    const allowed = new Set(navPointableNames());
    // 「A › B」这个形状就是「一条路」。逐条剥出来对名单,而不是用正则去读懂英语。
    const written = [...ottoInstructions.matchAll(
      new RegExp(`[A-Z][A-Za-z0-9&' -]*\\s${NAV_PATH_SEPARATOR}\\s[A-Z][A-Za-z0-9&' -]*`, "g"),
    )].map((m) => m[0].trim());
    expect(written.length).toBeGreaterThan(0);
    for (const path of written) expect(allowed).toContain(path);
  });

  it("FRONT-A13:Beta 地图上没有日历与战役,说明书改成明说「别往那儿指」", async () => {
    const { navPointableNames, merchantNavMap } = await import("@fikirtive/core");
    const { ottoInstructions } = await import("@fikirtive/otto");
    for (const gone of ["Schedule", "Campaign"]) {
      expect(navPointableNames().some((n) => n.includes(gone))).toBe(false);
      expect(merchantNavMap()).not.toContain(gone);
    }
    // 「不提」不是这里要的东西 —— 说明书里 "campaign" 作为业务词照旧出现(计划投放、
    // 改现有 Meta 广告)。要的是**指路的那一段**改口:分支把原来那句「只有一个日历」
    // (它插值 navPath("schedule")/navPath("campaign"),key 撤下之后连构造都不成立)
    // 换成一句明确的禁令。
    expect(ottoInstructions).toContain(
      "Campaigns and scheduling have no place on this Beta map.",
    );
    expect(ottoInstructions).not.toContain("There is ONE calendar");
    // 反向证明这条断言不是空转:地图上真有的入口,说明书里说得出口。
    expect(ottoInstructions).toContain("Settings › Connections");
    expect(ottoInstructions).toContain("Library");
  });
});
