/**
 * 规格 §1.6(b) 的**豁免收窄**：整表豁免 → per-(model, uniqueKey)（#1403，Founder 2026-09-15
 * 裁定「本版修，与翻闸票 #1403 同批」，见 docs/specs/tenant-isolation.md §5 该日第一行）。
 *
 * 在这个文件出现之前，`Transcript` 整张表在 `TENANT_GUARD_EXEMPT` 里：守卫对它**所有**操作
 * 都不做值比对，而规格 §1.6 的原文是「今天只有 `Transcript × contentHash_model` 一条……
 * 不得退化成整模型豁免」。现在这张表 GUARDED，只有 `contentHash_model` 这一把键**独自**出现在
 * `where` 里时才跳过租户比对。
 *
 * 这个文件钉的就是那条细线的两侧：
 *  · 键的这一侧：全局内容寻址缓存照旧 —— 同一段字节、同一个模型，另一个租户读得到、$0 复用；
 *  · 键的另一侧：同一张表的任何**别的**读写，从今天起照常值比对、照常注入、无帧照常拒。
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index.js";
import { runAsUser, runAsTenant, type UserPrincipal } from "./principal.js";
import { TENANT_MODELS, TENANT_GUARD_EXEMPT, PER_UNIQUE_KEY_EXEMPT } from "./tenant-guard.js";
import { seedOrg } from "../test/setup.js";

const ORG_A = "org_transcript_a";
const ORG_B = "org_transcript_b";
const MODEL = "whisper-large-v3";

function merchant(orgId: string): UserPrincipal {
  return {
    kind: "user",
    subjectUserId: `usr_${orgId}`,
    subjectEmail: `${orgId}@example.com`,
    ownerId: orgId,
    orgRole: "owner",
    membershipId: `mem_${orgId}`,
    impersonating: false,
    impersonatedByBaUserId: null,
  };
}

/** 同一段音频的内容哈希 —— 两个租户手里的是**同一串字节**，这正是全局缓存的前提。 */
let contentHash: string;

beforeEach(async () => {
  await seedOrg(ORG_A, 1000);
  await seedOrg(ORG_B, 2000);
  contentHash = randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64);
});

afterEach(async () => {
  await runAsTenant(ORG_A, () => prisma.transcript.deleteMany({ where: { ownerId: ORG_A } }));
  await runAsTenant(ORG_B, () => prisma.transcript.deleteMany({ where: { ownerId: ORG_B } }));
});

describe("规格 §1.6(b)：豁免是 per-(model, uniqueKey)，不是整张表", () => {
  it("登记本身：Transcript 在守卫里（不在整表豁免名单），而且只登记了 contentHash_model 这一把键", () => {
    expect(TENANT_MODELS.has("Transcript")).toBe(true);
    expect("Transcript" in TENANT_GUARD_EXEMPT).toBe(false);
    expect(PER_UNIQUE_KEY_EXEMPT).toEqual({ Transcript: "contentHash_model" });
  });

  it("键的这一侧：A 家跑出来的转写，B 家按同一把键读得到（全局内容寻址缓存 $0 复用，A9 那条路）", async () => {
    await runAsUser(merchant(ORG_A), () =>
      prisma.transcript.upsert({
        where: { contentHash_model: { contentHash, model: MODEL } },
        update: { cuesJson: [{ startMs: 0, lengthMs: 480, text: "Selamat" }] },
        create: {
          id: randomUUID(),
          ownerId: ORG_A,
          contentHash,
          model: MODEL,
          cuesJson: [{ startMs: 0, lengthMs: 480, text: "Selamat" }],
        },
      }),
    );

    const hit = await runAsUser(merchant(ORG_B), () =>
      prisma.transcript.findUnique({ where: { contentHash_model: { contentHash, model: MODEL } } }),
    );
    expect(hit?.cuesJson).toEqual([{ startMs: 0, lengthMs: 480, text: "Selamat" }]);
    // 归属没变：缓存行仍然记在**真的跑了这次转写**的那一家名下，没给 B 复制出第二行。
    expect(hit?.ownerId).toBe(ORG_A);
    expect(await runAsTenant(ORG_A, () => prisma.transcript.count({ where: { ownerId: ORG_A } }))).toBe(1);
    expect(await runAsTenant(ORG_B, () => prisma.transcript.count({ where: { ownerId: ORG_B } }))).toBe(0);
  });

  it("键的另一侧（收窄之前整张表都不查）：A 家帧里点名 B 家的 Transcript，读和写都被拒", async () => {
    await runAsUser(merchant(ORG_B), () =>
      prisma.transcript.create({
        data: { id: randomUUID(), ownerId: ORG_B, contentHash, model: MODEL, cuesJson: [] },
      }),
    );

    await expect(
      runAsUser(merchant(ORG_A), () => prisma.transcript.findMany({ where: { ownerId: ORG_B } })),
    ).rejects.toThrow(/tenant-guard.*outside the active tenant/);
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.transcript.updateMany({ where: { ownerId: ORG_B }, data: { cuesJson: [] } }),
      ),
    ).rejects.toThrow(/tenant-guard.*outside the active tenant/);
    // B 那一行一个字没变。
    const row = await runAsTenant(ORG_B, () => prisma.transcript.findFirstOrThrow({ where: { ownerId: ORG_B } }));
    expect(row.cuesJson).toEqual([]);
  });

  it("键的另一侧：一次**无帧**的转写读被拒（收窄之前它连看都不看）", async () => {
    await expect(prisma.transcript.findMany({ where: { model: MODEL } })).rejects.toThrow(
      /tenant-guard.*no ownerId filter/,
    );
  });

  it("豁免只认「where 里只有这一把键」：多带一个键就不再是缓存查询，照常落闸", async () => {
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.transcript.findUnique({
          where: { contentHash_model: { contentHash, model: MODEL }, ownerId: ORG_B },
        }),
      ),
    ).rejects.toThrow(/tenant-guard.*outside the active tenant/);
  });

  it("create 半边不豁免：帧里建的行归当前租户，冒名写别家当场拒", async () => {
    await expect(
      runAsUser(merchant(ORG_A), () =>
        prisma.transcript.create({
          data: { id: randomUUID(), ownerId: ORG_B, contentHash, model: MODEL, cuesJson: [] },
        }),
      ),
    ).rejects.toThrow(/tenant-guard.*another tenant/);

    // upsert 落空时建的那一行同理：写上的是**帧里**那一家，不是调用方自己填的任何值。
    await runAsUser(merchant(ORG_A), () =>
      prisma.transcript.upsert({
        where: { contentHash_model: { contentHash, model: MODEL } },
        update: {},
        create: { id: randomUUID(), ownerId: ORG_A, contentHash, model: MODEL, cuesJson: [] },
      }),
    );
    const created = await runAsTenant(ORG_A, () =>
      prisma.transcript.findFirstOrThrow({ where: { contentHash, model: MODEL } }),
    );
    expect(created.ownerId).toBe(ORG_A);
  });
});
