/**
 * out-of-credits-copy.test.ts — #699:积分不足的那一刻,产品必须自己收钱,不能把商家推给人工。
 *
 * 病灶(走查 W2A 实测):商家余额 20,想做一条 33 credits 的视频,产品回的是
 *   "You've used up your beta credits — reply and we'll top you up."
 * 三个毛病叠在一句话里:
 *   ① 挡钱:商家已经想花钱了,却被推去等人工回复;`/billing` 就在侧栏("Billing & credits"),
 *      这句话只字不提。这是 P1 的理由 —— 转化路被自己堵死。
 *   ② 事实错误:产品没有公测(Founder 2026-08-01),积分是卖的;注册页管这 20 个叫
 *      "free starter credits"。同一笔钱两个名字。
 *   ③ 死指针:toast 不是邮件也不是对话,"reply" 回不到任何地方(与 #686 同类)。
 *
 * 这四组钉板为什么承重:
 *   ① 走真实路径(真 Postgres、真 Prisma、真账本)把三个出口逐个跑到余额不足的那一支,
 *      断言商家读到的那句话本身能自助 —— 不对文案常量自问自答,任何一个出口改回
 *      "回个话我们给你加" 都会红。三个出口分别是:画布生成(startGen)、参考图生成
 *      (startRefGen)、变体生成(createVariant → dispatchVariantJob)。
 *   ② 指路必须是活的:文案点名的去处,必须真的挂在全局导航上。这条封的是「换一句好听的
 *      死指针」—— 光把 "reply" 改成 "contact billing support" 一样红。
 *   ③ 词法钉板:**运行时与源码零残留** —— apps/ 与 packages/ 全文(含注释)不得再出现
 *      这个说法。豁免两处,都是有意的:docs/ 是历史档案(记录产品当年说过什么,改了就等于
 *      毁审计线索),以及本文件自身(封禁清单必须写得出被禁词)。注释一并封死,是因为注释
 *      正是过期概念被下一个人抄进新文案的载体。断言 ① 封的是行为,③ 封的是「另起一处再写一遍」。
 *   ④ 标点钉板:同一句 "Otto hit a snag" 在三处曾经两种破折号,商家实际读到的是 ASCII "-"。
 *      按仓库惯例归一到 em dash,并锁住三处一致。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { INTERNAL_PER_DISPLAY } from "@fikirtive/core";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../queue", () => ({
  getBoss: vi.fn(async () => ({
    send: vi.fn(async (_name: string, _data: unknown, options?: { id?: string }) => options?.id ?? null),
  })),
}));
vi.mock("../cowork-guardian", () => ({ checkCast: vi.fn(async () => null) }));
vi.mock("../model-registry", () => ({ resolveDisabledModels: vi.fn(async () => ({ disabled: new Set<string>() })) }));

const { startGen } = await import("../gen-actions");
const { startRefGen, createVariant } = await import("../refgen-actions");
const { prisma } = await import("@fikirtive/db");

const WEB_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");

function asOwner(ownerId: string) {
  mockRequireOwner.mockResolvedValue({ ownerId, userId: `usr_${ownerId}` });
}

/** An org that is one internal credit short of the cheapest possible generation. */
async function seedBrokeOrg(): Promise<string> {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  await prisma.creditAccount.create({ data: { orgId: ownerId, balance: INTERNAL_PER_DISPLAY - 1, reserved: 0 } });
  return ownerId;
}

function errorOf(result: unknown): string {
  expect(result, "the underfunded call did not fail closed").toHaveProperty("error");
  return (result as { error: string }).error;
}

/**
 * The contract every out-of-credits exit owes the merchant. Deliberately expressed as
 * "what the merchant can do next", not as "equals this string" — the point is that the
 * sentence lets them fix it themselves, whatever the wording ends up being.
 */
function expectMerchantCanSelfServe(message: string, exit: string) {
  // ② the product has no beta — the credits are sold.
  expect(message, `${exit}: still calls the credits "beta"`).not.toMatch(/beta/i);

  // ① / ③ never hand the merchant off to a human, and never point at a place a toast
  // cannot reach ("reply", "get in touch", "we'll top you up").
  expect(message, `${exit}: sends the merchant to a human instead of taking their money`)
    .not.toMatch(/\brepl(y|ies)\b|\bcontact\b|get in touch|reach out|email us|we'll top you up/i);

  // the in-product top-up destination, named.
  expect(message, `${exit}: names no in-product place to top up`).toMatch(/\bBilling\b/);

  // and the number the merchant needs in order to decide.
  expect(message, `${exit}: states no amount`).toMatch(/\d+ credits?\b/);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// ① every out-of-credits exit, on the real spend path
// ---------------------------------------------------------------------------
describe("#699 an out-of-credits merchant is told how to pay, not who to ask", () => {
  it("canvas generation (startGen) — the exit the walkthrough hit", async () => {
    const ownerId = await seedBrokeOrg();
    asOwner(ownerId);
    const projectId = `prj_${randomUUID()}`;
    await prisma.project.create({ data: { id: projectId, ownerId, name: "Out of credits" } });

    const res = await startGen({
      projectId,
      prompt: "a bowl of laksa",
      entityIds: [],
      count: 1,
      kind: "image",
      model: "seedream",
      idempotencyKey: `broke-${randomUUID().slice(0, 8)}`,
    });

    expectMerchantCanSelfServe(errorOf(res), "startGen");
  });

  it("reference generation (startRefGen)", async () => {
    const ownerId = await seedBrokeOrg();
    asOwner(ownerId);
    const entityId = `ent_${randomUUID()}`;
    await prisma.entity.create({ data: { id: entityId, ownerId, type: "PRODUCT", name: "Kopi tin" } });

    const res = await startRefGen({
      entityId,
      prompt: "the tin on a rattan mat",
      count: 1,
      model: "seedream",
      mode: "BASE",
    });

    expectMerchantCanSelfServe(errorOf(res), "startRefGen");
  });

  it("variant generation (createVariant → dispatchVariantJob)", async () => {
    const ownerId = await seedBrokeOrg();
    asOwner(ownerId);
    const assetId = `ast_${randomUUID()}`;
    await prisma.asset.create({
      data: {
        id: assetId,
        ownerId,
        contentHash: randomUUID().replace(/-/g, ""),
        ext: "png",
        mime: "image/png",
        sizeBytes: BigInt(1024),
      },
    });
    const entityId = `ent_${randomUUID()}`;
    await prisma.entity.create({
      data: { id: entityId, ownerId, type: "PRODUCT", name: "Kopi tin", baseAssetId: assetId },
    });

    const res = await createVariant(entityId, "Gold lid", "the same tin with a gold lid");

    expectMerchantCanSelfServe(errorOf(res), "createVariant");
  });
});

// ---------------------------------------------------------------------------
// ② the place the copy names is really there
// ---------------------------------------------------------------------------
describe("#699 the top-up destination the copy names is live navigation", () => {
  it("Billing is a real route the merchant can reach from the global navigation", () => {
    const nav = readFileSync(path.join(WEB_ROOT, "components/global-navigation.tsx"), "utf8");

    // the sidebar entry the copy is sending them to
    expect(nav, "global navigation no longer links to /billing").toMatch(/href="\/billing"/);
    // …and the page itself exists
    expect(() => readFileSync(path.join(WEB_ROOT, "app/billing/page.tsx"), "utf8")).not.toThrow();
    // …and it is the page that sells credits
    const billing = readFileSync(path.join(WEB_ROOT, "app/billing/page.tsx"), "utf8");
    expect(billing, "the Billing page no longer offers a top-up").toMatch(/Top up/);
  });
});

// ---------------------------------------------------------------------------
// ③ the beta framing is dead in everything that ships
// ---------------------------------------------------------------------------
describe("#699 nothing in apps/ or packages/ calls them beta credits", () => {
  const SCAN_ROOTS = ["apps", "packages"];
  const SKIP_DIR = /^(node_modules|\.next|dist|generated|coverage|\.turbo)$/;
  /** The ban is on the whole file, comments included: a comment is how a retired concept gets
   *  carried forward into the next person's copy. The one exemption is this file — a ban list
   *  has to be able to write down the words it bans. docs/ is out of scope on purpose: those
   *  are historical records of what the product once said, and rewriting them would destroy
   *  the audit trail rather than fix anything. */
  const SELF = path.basename(__filename);

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isDirectory()) return SKIP_DIR.test(entry.name) ? [] : walk(path.join(dir, entry.name));
      if (entry.name === SELF) return [];
      return /\.(tsx?|jsx?|mjs)$/.test(entry.name) ? [path.join(dir, entry.name)] : [];
    });
  }

  it("no shipped file carries the phrase, in code or in a comment", () => {
    const offenders = SCAN_ROOTS.flatMap((root) => walk(path.join(REPO_ROOT, root)))
      .filter((file) => /beta[\s_-]*credit/i.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(REPO_ROOT, file));

    expect(offenders, `these still say "beta credits":\n${offenders.join("\n")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ④ one sentence, one dash
// ---------------------------------------------------------------------------
describe("#699 the Otto snag sentence is punctuated the same way everywhere", () => {
  const SNAG_SITES = [
    "lib/otto-stream-errors.ts",
    "app/api/otto/stream/route.ts",
    "components/otto/OttoChatStream.tsx",
  ];

  it.each(SNAG_SITES)("%s uses the em dash", (relative) => {
    const source = readFileSync(path.join(WEB_ROOT, relative), "utf8");
    const dashes = [...source.matchAll(/Otto hit a snag\s*(\S)/g)].map((m) => m[1]);

    expect(dashes.length, `${relative} no longer contains the snag sentence`).toBeGreaterThan(0);
    for (const dash of dashes) {
      expect(dash, `${relative} punctuates the snag sentence with "${dash}" instead of an em dash`).toBe("—");
    }
  });
});
