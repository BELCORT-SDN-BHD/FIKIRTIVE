/**
 * actor-library-seed.test.ts —— **演员库真的站在每个商家的 Library 里**,以及
 * **真人脸那条拦截给出的出路是真的**(规格 `docs/specs/creation-engine.md`:CREATE-A9、CREATE-A10)。
 *
 * 这两条验收互为对方的前提,所以放在一个文件里证:
 *   · A9 说「Real human faces aren't supported yet. Pick a cast member from your Library instead.」
 *     —— 这句话只有在他的 Library 里**已经**有人的时候才不是空话;
 *   · A10 说演员能连续出片、引用落盘 —— 而商家会走到演员这条路上,正是因为 A9 把他送过来。
 *
 * 硬口径(与 canvas-terminal-reason-durable / gen-ledger 同一方言):
 *   · **真数据库、真 Prisma、真 server action、真账本**。只有 session、队列、模型注册表被 mock。
 *   · **真的 `requireOwner`**。org 引导那一步不是被模拟出来的 —— 下面每个 org 都是真的
 *     走了一遍 `bootstrapPersonalOrg`,所以「引导时会播种」是被跑出来的,不是被断言出来的。
 *   · **零供应商调用、零真实花费**。worker 的终局用它自己调的那两个账本函数复现。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({
  auth: mockAuth,
  isImpersonating: vi.fn(async () => false),
}));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.AUTH_ALLOWED_EMAILS ?? ""}`.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin: () => false, isAllowedEmail: allowed };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../queue", () => ({
  getBoss: vi.fn(async () => ({
    send: vi.fn(async (_name: string, _data: unknown, options: { id?: string }) => options.id ?? null),
  })),
}));
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => ({ disabled: new Set<string>() })) }));

const { requireOwner } = await import("@/lib/auth-guard");
const { seedActorLibrary } = await import("@/lib/actor-library-seed");
const { prisma, refundReservation } = await import("@fikirtive/db");
const { startCoworkGen } = await import("@/lib/gen-actions");
const { storage } = await import("@/lib/storage");
const {
  ACTOR_LIBRARY,
  ACTOR_LIBRARY_ASSET_DIR,
  displayCredits,
  pricedGenCredits,
  storageKey,
} = await import("@fikirtive/core");
const { REFERENCE_IMAGE_PERSON_REJECTED, merchantGenFailureMessage, merchantGenFailureReason, referenceImagePersonRejected } =
  await import("@fikirtive/core/gen-failure");

/** 仓库根 —— apps/web 的 cwd 往上两层,与 `lib/storage.ts` 的 LOCAL_ROOT 同一个算法。 */
const REPO_ROOT = path.join(process.cwd(), "..", "..");

const EMAIL_A = `actor-a-${randomUUID()}@fikirtive.test`;
const EMAIL_B = `actor-b-${randomUUID()}@fikirtive.test`;
let ownerA: string;
let ownerB: string;

/** 让下一次 `requireOwner()` 以这个人的身份跑。真守卫、真引导、真播种。 */
async function signInAs(email: string): Promise<string> {
  mockAuth.mockResolvedValue({ user: { email } });
  const gate = await requireOwner();
  if ("error" in gate) throw new Error(gate.error);
  return gate.ownerId;
}

beforeAll(async () => {
  process.env.AUTH_ALLOWED_EMAILS = `${EMAIL_A},${EMAIL_B}`;
  for (const email of [EMAIL_A, EMAIL_B]) {
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { id: `usr_${randomUUID()}`, email },
    });
  }
  ownerA = await signInAs(EMAIL_A);
  ownerB = await signInAs(EMAIL_B);
}, 60_000);

afterAll(async () => {
  // 这两个 org 的定妆图字节各占几 MB,跑完就清掉自己那两个命名空间(内容寻址,
  // 键在 u/<ownerId>/ 底下,所以清得干净且不会碰到别人的)。
  for (const ownerId of [ownerA, ownerB]) {
    if (!ownerId) continue;
    rmSync(path.join(REPO_ROOT, ".data", "storage", "u", ownerId), { recursive: true, force: true });
  }
});

async function libraryOf(ownerId: string) {
  return prisma.entity.findMany({
    where: { ownerId, catalogKey: { not: null }, deletedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, type: true, catalogKey: true, baseAssetId: true, descriptionJson: true,
      referenceImages: {
        where: { deletedAt: null },
        orderBy: { position: "asc" },
        select: { viewTag: true, position: true, asset: { select: { id: true, ownerId: true, contentHash: true, ext: true, mime: true } } },
      },
    },
  });
}

function repoSha256(file: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(REPO_ROOT, ACTOR_LIBRARY_ASSET_DIR, file)))
    .digest("hex");
}

describe("CREATE-A10 —— 演员库五人在每个商家自己的 Library 里", () => {
  it("CREATE-A10: 两个 org 各自播种后各 5 名,且互不可见", async () => {
    const a = await libraryOf(ownerA);
    const b = await libraryOf(ownerB);

    // ① 各 5 名,名字就是那五位(创始五名即全量)。
    expect(a).toHaveLength(5);
    expect(b).toHaveLength(5);
    const roster = [...ACTOR_LIBRARY].map((actor) => actor.name).sort();
    expect(a.map((e) => e.name).sort()).toEqual(roster);
    expect(b.map((e) => e.name).sort()).toEqual(roster);

    // ② 互不可见 —— 不是「id 不同」这种弱判定:拿 A 的每一个实体 id 去 B 的租户里查,
    //    必须一行都查不到(反之亦然)。这是商家真正会走的那种带 ownerId 的查询。
    for (const [ownerId, theirs] of [[ownerA, b], [ownerB, a]] as const) {
      const leaked = await prisma.entity.findMany({
        where: { ownerId, id: { in: theirs.map((e) => e.id) } },
        select: { id: true },
      });
      expect(leaked, "一个 org 的演员实体在另一个 org 的租户查询里出现了").toEqual([]);
    }
    // 同一位演员在两个 org 里是**两行**,连 Asset 行都各归各的 —— catalogKey 只是标记,
    // 不是一条跨租户的共享指针(Founder 2026-09-02「每租户播种」)。
    const idsA = new Set(a.map((e) => e.id));
    expect(b.some((e) => idsA.has(e.id))).toBe(false);
    for (const [byKeyA, byKeyB] of a.map((e, i) => [e, b[i]!] as const)) {
      expect(byKeyA.catalogKey).toBe(byKeyB.catalogKey);
      expect(byKeyA.referenceImages[0]!.asset.id).not.toBe(byKeyB.referenceImages[0]!.asset.id);
      expect(byKeyA.referenceImages[0]!.asset.ownerId).toBe(ownerA);
      expect(byKeyB.referenceImages[0]!.asset.ownerId).toBe(ownerB);
    }
  });

  it("CREATE-A10: 每位演员是一个 CHARACTER,带特写+全身两张参考图与定锚图", async () => {
    for (const entity of await libraryOf(ownerA)) {
      expect(entity.type).toBe("CHARACTER");
      expect(entity.referenceImages.map((r) => r.viewTag)).toEqual(["closeup", "fullbody"]);
      // 特写是定锚图 —— 与商家自己建元素时「第一张即 base」的不变量同一条。
      expect(entity.baseAssetId).toBe(entity.referenceImages[0]!.asset.id);
      // 一卡三用:Otto 与 UI 从实体行直接读得到目录版本与九套造型,不必 import core。
      const description = entity.descriptionJson as { catalog?: string; presets?: Record<string, string> };
      expect(description.catalog).toBe("v1");
      expect(Object.keys(description.presets ?? {})).toHaveLength(9);
      expect(description.presets!.plain!.length).toBeGreaterThan(0);
    }
  });

  it("CREATE-A10: 再播一次全部跳过 —— 幂等,商家的库里不会出现十个人", async () => {
    const again = await seedActorLibrary(ownerA);
    expect(again.seeded).toEqual([]);
    expect(again.failed).toEqual([]);
    expect(again.skipped).toHaveLength(5);
    expect(await libraryOf(ownerA)).toHaveLength(5);
  });
});

describe("CREATE-A10 —— 像素完整性:入库的就是仓库里那串字节", () => {
  it("CREATE-A10: storage 里该资产字节的 sha256 = 仓库原件的 sha256", async () => {
    const library = await libraryOf(ownerA);
    for (const actor of ACTOR_LIBRARY) {
      const entity = library.find((e) => e.catalogKey === actor.catalogKey)!;
      for (const [image, ref] of [
        [actor.closeup, entity.referenceImages[0]!],
        [actor.fullbody, entity.referenceImages[1]!],
      ] as const) {
        const fromRepo = repoSha256(image.file);
        // ① 人物卡上的钉子 = 仓库原件(core 那边也钉了一遍,这里是链条的同一环)。
        expect(image.sha256).toBe(fromRepo);
        // ② Asset 行的内容哈希 = 仓库原件 —— 中间没有任何一步碰过像素。
        expect(ref.asset.contentHash, `${actor.name}/${image.viewTag}`).toBe(fromRepo);
        // ③ 真的把字节从存储里读回来再算一次 —— ②只证明我们记下的哈希对,
        //    这一条才证明**存进去的东西**对。
        const key = storageKey(ref.asset.ownerId, ref.asset.contentHash, ref.asset.ext);
        const stored = await storage.get(key);
        expect(createHash("sha256").update(stored).digest("hex")).toBe(fromRepo);
        // ④ mime 由字节决定(工单 F):`.bin` 的字节是 JPEG,所以存的是 image/jpeg。
        expect(ref.asset.mime).toBe("image/jpeg");
      }
    }
  });

  it("CREATE-A10: worker 送供应商的 URL 指向同一个 key —— 内容寻址键里就是那串 sha256", async () => {
    const library = await libraryOf(ownerA);
    const entity = library.find((e) => e.catalogKey === ACTOR_LIBRARY[0]!.catalogKey)!;
    const asset = entity.referenceImages[0]!.asset;

    // worker 在 `apps/worker/src/jobs/gen.ts` 里签的就是**这个表达式**算出来的键
    // (下一条断言把那行源码钉住)。键里的那 64 位十六进制就是原件的 sha256,
    // 所以「送去供应商的那张图」与「仓库里的原件」在字符串层面就是同一个东西。
    const key = storageKey(asset.ownerId, asset.contentHash, asset.ext);
    expect(key).toBe(`u/${ownerA}/${repoSha256(ACTOR_LIBRARY[0]!.closeup.file)}.jpg`);
    // 本地盘驱动不发预签名(走 /files 路由),所以这里断言的是**键**而不是一串 URL:
    // 预签名 URL 是这个键的函数,键对了 URL 就指向同一个对象。
    expect(await storage.presignedGet(key)).toBeNull();

    const genSource = readFileSync(path.join(REPO_ROOT, "apps/worker/src/jobs/gen.ts"), "utf8");
    expect(
      genSource,
      "worker 不再按资产自己的内容寻址键签名 —— 中间多出的任何一步都可能改到像素",
    ).toContain("storage.presignedGet(storageKey(ref.asset.ownerId, ref.asset.contentHash, ref.asset.ext)");
  });

  it("CREATE-A10: 播种模块里那两条静态候选路径,与 core 的目录常量说的是同一个目录", () => {
    // `actor-library-seed.ts` 必须把目录**字面**写出来(Turbopack 的文件追踪见到完全动态
    // 拼出来的根,就会把整个工程拖进产物清单 —— 2026-09-02 `next build` 实跑撞到)。
    // 字面量因此是刻意的第二份抄写,这一条就是它的双证人:常量改了、字面量没跟上,当场红。
    expect(ACTOR_LIBRARY_ASSET_DIR).toBe("assets/actor-library/v1");
    const seedSource = readFileSync(path.join(REPO_ROOT, "apps/web/lib/actor-library-seed.ts"), "utf8");
    expect(seedSource).toContain('path.join(process.cwd(), "assets", "actor-library", "v1")');
    expect(seedSource).toContain('path.join(process.cwd(), "..", "..", "assets", "actor-library", "v1")');
  });

  it("CREATE-A10: 生成路径上一个图像处理库都没有 —— 缩放/裁剪/转格式未验先禁", () => {
    // 像素完整性铁律的机械形态。裁剪过的图 2026-08-30 实测被拒「may contain real person」,
    // 所以这条链上不许出现任何能改像素的东西:引入 sharp/jimp/canvas 就是把那条路重新打开。
    const targets = [
      ...readdirSync(path.join(REPO_ROOT, "packages/generation/src"), { recursive: true })
        .map((f) => path.join("packages/generation/src", String(f)))
        .filter((f) => f.endsWith(".ts") && statSync(path.join(REPO_ROOT, f)).isFile()),
      "apps/worker/src/jobs/gen.ts",
      "apps/web/lib/actions.ts",
      "apps/web/lib/actor-library-seed.ts",
    ];
    // 只抓 import / require,不抓注释与散文 —— 上面那段解释里就写着这三个名字。
    const imageLib = /(?:^|\n)\s*(?:import[^\n]*from\s*["'](?:sharp|jimp|canvas)["']|import\s+["'](?:sharp|jimp|canvas)["']|(?:const|let|var)[^\n]*=\s*require\(["'](?:sharp|jimp|canvas)["']\))/;
    for (const file of targets) {
      expect(readFileSync(path.join(REPO_ROOT, file), "utf8"), `${file} 引入了图像处理库`).not.toMatch(imageLib);
    }
    expect(targets.length).toBeGreaterThan(3); // 目录真的被走到了,不是空集合空过
  });
});

describe("CREATE-A10 —— 演员进 approvedEntities、出片、引用落盘", () => {
  it("CREATE-A10: 演员实体经卡片入口进 approvedEntities 建 GenJob,引用落在任务行上", async () => {
    mockAuth.mockResolvedValue({ user: { email: EMAIL_A } });
    const actor = (await libraryOf(ownerA)).find((e) => e.catalogKey === "actor-v1-aisyah")!;

    const projectId = `prj_${randomUUID()}`;
    await prisma.project.create({ data: { id: projectId, ownerId: ownerA, name: "Actor library test" } });
    const threadId = `thr_${randomUUID()}`;
    const cardId = `msg_${randomUUID()}`;
    await prisma.chatThread.create({ data: { id: threadId, ownerId: ownerA, projectId, title: "Otto" } });

    const quote = pricedGenCredits({
      kind: "VIDEO", model: "seedance-2-mini", count: 1,
      referenceVideoGenerationId: null, videoOptions: { seconds: 5, resolution: "720p" },
    });
    // 商家批准的那张卡:审批身份只能从这张服务端读出来的卡进任务行(#774)。
    await prisma.chatMessage.create({
      data: {
        id: cardId, threadId, ownerId: ownerA, role: "AGENT", kind: "GEN_CARD", seq: 1, text: "",
        payload: {
          kind: "video", model: "seedance-2-mini",
          estimatedCredits: displayCredits(quote),
          approvedEntities: [{ id: actor.id, type: "CHARACTER", name: actor.name }],
        },
      },
    });

    const res = await startCoworkGen({
      projectId, threadId, prompt: "she introduces the new menu at the counter", count: 1,
      kind: "video", model: "seedance-2-mini", durationSeconds: 5, resolution: "720p",
      entityIds: [actor.id],
      idempotencyKey: `cowork:${cardId}`,
    });
    if ("error" in res) throw new Error(`startCoworkGen refused the cast member: ${res.error}`);

    const job = await prisma.genJob.findFirstOrThrow({
      where: { id: res.id, ownerId: ownerA },
      select: { entityIds: true, approvedEntities: true, kind: true },
    });
    // ① 演员真的挂在这一单上(真 guardian 查得到这行、也查得到它的 base 参考图 ——
    //    查不到 startCoworkGen 会当场 error,上面那句 throw 就是这条前提的执行形态)。
    expect(job.entityIds).toEqual([actor.id]);
    // ② 审批身份冻进了任务行 —— 「引用落盘」的那一格。
    expect(job.approvedEntities).toEqual([{ id: actor.id, type: "CHARACTER", name: actor.name }]);
    expect(job.kind).toBe("VIDEO");
    // ③ 引用得到的图还在,而且就是那两张定妆图 —— worker 会照 position 顺序把它们送去。
    const refs = await prisma.referenceImage.findMany({
      where: { entityId: actor.id, ownerId: ownerA, variantId: null, deletedAt: null },
      orderBy: { position: "asc" },
      select: { viewTag: true, asset: { select: { contentHash: true } } },
    });
    expect(refs.map((r) => r.viewTag)).toEqual(["closeup", "fullbody"]);
    expect(refs[0]!.asset.contentHash).toBe(ACTOR_LIBRARY[0]!.closeup.sha256);

    // 不留在飞的作业:按 worker 的终局路径退款收干净(下一条验收还要读这个 org 的账本)。
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ownerA, refId: res.id }));
    await prisma.genJob.update({
      where: { id: res.id, ownerId: ownerA },
      data: { status: "FAILED", error: "test teardown", finishedAt: new Date() },
    });
  }, 60_000);
});

describe("CREATE-A9 —— 真人脸:诚实拦截、出路指向演员库、余额净变化为 0", () => {
  it("CREATE-A9: 供应商那句实测拒收被认出来,并翻成新口径的人话", () => {
    // 2026-08-08 实测下来的机器形状(4/4 拒),原样喂给分类器。
    const measured = JSON.stringify({
      error: {
        code: "InputImageSensitiveContentDetected.PrivacyInformation",
        message: "The request failed because the input image 'content[1]' may contain real person. Request id: 021788096448297c",
        param: "content[1]",
        type: "BadRequest",
      },
    });
    expect(referenceImagePersonRejected(measured)).toBe(true);

    // 白名单机制一个字都没改:落盘的那串还是原样比对回同一个 reason 与同一句话。
    expect(merchantGenFailureReason(REFERENCE_IMAGE_PERSON_REJECTED)).toBe("referenceImagePerson");
    expect(merchantGenFailureMessage(REFERENCE_IMAGE_PERSON_REJECTED)).toBe(REFERENCE_IMAGE_PERSON_REJECTED);
    // 新口径逐字。
    expect(REFERENCE_IMAGE_PERSON_REJECTED).toContain(
      "Real human faces aren't supported yet. Pick a cast member from your Library instead.",
    );
    // 旧口径(教商家把脸拍到看不见)必须消失 —— 13 拒零过,拒的是这是谁的脸。
    expect(REFERENCE_IMAGE_PERSON_REJECTED).not.toContain("Try one where the face isn't visible");
  });

  it("CREATE-A9: 那句出路不是空话 —— 说这句话的时候,商家的 Library 里真的站着五个人", async () => {
    expect(await libraryOf(ownerA)).toHaveLength(5);
    expect(await libraryOf(ownerB)).toHaveLength(5);
  });

  it("CREATE-A9: 被拒的那一单账本上 reserve/refund 成对、无 SETTLE,余额净变化为 0", async () => {
    mockAuth.mockResolvedValue({ user: { email: EMAIL_B } });
    const projectId = `prj_${randomUUID()}`;
    await prisma.project.create({ data: { id: projectId, ownerId: ownerB, name: "Face refusal" } });

    const before = await prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ownerB } });

    const { startGen } = await import("@/lib/gen-actions");
    const res = await startGen({
      projectId, prompt: "my own photo, talking to camera", entityIds: [], count: 1,
      kind: "video", model: "seedance-2-mini", durationSeconds: 5, resolution: "720p",
      idempotencyKey: `a9-${randomUUID().slice(0, 8)}`,
    });
    if ("error" in res) throw new Error(res.error);

    // 供应商在**建任务那一刻**就拒了(HTTP 4xx,引擎根本没跑),worker 的终局路径因此
    // 退款并且一个字的花费都不记 —— 这里用 worker 自己调的那个账本函数复现同一步。
    await prisma.$transaction((tx) => refundReservation(tx, { orgId: ownerB, refId: res.id }));
    await prisma.genJob.update({
      where: { id: res.id, ownerId: ownerB },
      data: { status: "FAILED", error: REFERENCE_IMAGE_PERSON_REJECTED, finishedAt: new Date() },
    });

    const rows = await prisma.creditLedger.findMany({
      where: { orgId: ownerB, refId: res.id },
      orderBy: { createdAt: "asc" },
      select: { kind: true, balanceDelta: true, reservedDelta: true, idempotencyKey: true },
    });
    // 恰好两行,成对:reserve:<refId> 与 refund:<refId>。
    expect(rows.map((r) => r.kind)).toEqual(["RESERVE", "REFUND"]);
    expect(rows.map((r) => r.idempotencyKey)).toEqual([`reserve:${res.id}`, `refund:${res.id}`]);
    // 无 SETTLE —— 一条都不许有,那是「我们收了钱」的唯一形状。
    expect(rows.some((r) => r.kind === "SETTLE")).toBe(false);
    // 两行的钱正好抵消,余额与预扣都回到拒收之前。
    expect(rows[0]!.balanceDelta + rows[1]!.balanceDelta).toBe(0);
    expect(rows[0]!.reservedDelta + rows[1]!.reservedDelta).toBe(0);
    const after = await prisma.creditAccount.findUniqueOrThrow({ where: { orgId: ownerB } });
    expect(after.balance).toBe(before.balance);
    expect(after.reserved).toBe(before.reserved);

    // 商家读到的,就是白名单里的那一句(而不是任何内部错误串)。
    const job = await prisma.genJob.findFirstOrThrow({ where: { id: res.id, ownerId: ownerB }, select: { error: true } });
    expect(merchantGenFailureMessage(job.error)).toBe(REFERENCE_IMAGE_PERSON_REJECTED);
  }, 60_000);
});
