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
 *   ③ 词法钉板:**运行时与源码零残留** —— apps/ 与 packages/ 下**每一个 tracked 文件**全文
 *      都不得再出现这个说法,不分后缀:注释、CSS、JSON、SVG、SQL 迁移、schema.prisma 一律算。
 *      过期概念在样式表注释里和在 .ts 里一样能被下一个人抄进新文案,按后缀挑着扫等于自己
 *      开天窗。豁免两处,都是有意的:docs/ 是历史档案(记录产品当年说过什么,改了就等于毁
 *      审计线索),以及本文件自身(封禁清单必须写得出被禁词)—— 后者按**完整相对路径**豁免,
 *      不按文件名,免得任何同名新文件跟着白拿豁免。断言 ① 封的是行为,③ 封的是「另起一处再写一遍」。
 *   ④ 标点钉板:同一句 "Otto hit a snag" 在三处曾经两种破折号,商家实际读到的是 ASCII "-"。
 *      按仓库惯例归一到 em dash,并锁住三处一致。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { INTERNAL_PER_DISPLAY } from "@fikirtive/core";
import { navLinkByKey } from "@fikirtive/core/navigation";

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
    // #801 — this used to grep global-navigation.tsx for the literal `href="/billing"`.
    // The rail stopped writing paths of its own that ticket (it renders the authoritative
    // tree in packages/core/src/navigation.ts), so the literal is gone and the grep went
    // red on a change that made navigation MORE honest, not less. What #699 actually needs
    // proved is unchanged and now read from the source of truth: Billing is a destination
    // the merchant can reach from the global navigation, and the page behind it sells credits.
    const billingDestination = navLinkByKey("billing");
    expect(billingDestination.href, "Billing is no longer a global navigation destination").toBe("/billing");

    // …and the rail really renders that tree (rather than having quietly forked from it).
    const nav = readFileSync(path.join(WEB_ROOT, "components/global-navigation.tsx"), "utf8");
    expect(nav, "the global navigation no longer reads the authoritative tree").toMatch(
      /from\s+["']@fikirtive\/core\/navigation["']/,
    );

    // …and the page itself exists
    const routePath = path.join(WEB_ROOT, "app", billingDestination.href.replace(/^\//, ""), "page.tsx");
    expect(() => readFileSync(routePath, "utf8")).not.toThrow();
    // …and it is the page that sells credits
    expect(readFileSync(routePath, "utf8"), "the Billing page no longer offers a top-up").toMatch(/Top up/);
  });
});

// ---------------------------------------------------------------------------
// ③ the beta framing is dead in everything that ships
// ---------------------------------------------------------------------------
describe("#699 nothing in apps/ or packages/ calls them beta credits", () => {
  /** The ban covers EVERY tracked file under apps/ and packages/ — not only the ones that look
   *  like source. A retired concept travels just as well in a CSS comment, a JSON fixture, an
   *  SVG label, a SQL migration or schema.prisma as it does in a .ts file, and whatever carries
   *  it is what the next person copies into new copy. So there is no extension allow-list:
   *  everything tracked is read as text, and a binary simply never matches the pattern.
   *
   *  Exactly one exemption, matched on the full repo-relative path — a ban list has to be able
   *  to write down the words it bans. Matching the path rather than the basename means a new
   *  file that happens to share this name is still scanned.
   *
   *  docs/ is out of scope on purpose: those are historical records of what the product once
   *  said, and rewriting them would destroy the audit trail rather than fix anything. */
  const GUARD_ITSELF = "apps/web/lib/__tests__/out-of-credits-copy.test.ts";

  it("no tracked file carries the phrase — code, comment, stylesheet, schema or asset", () => {
    const tracked = execFileSync("git", ["ls-files", "-z", "apps", "packages"], {
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    })
      .toString("utf8")
      .split("\0")
      .filter(Boolean);

    // a scan over an empty list would be vacuously green — pin that it really enumerated.
    expect(tracked.length, "git ls-files returned (almost) nothing — the scan proves nothing")
      .toBeGreaterThan(500);
    expect(tracked, "the guard's own path no longer resolves — the exemption is stale").toContain(GUARD_ITSELF);

    /* What git stores for a tracked path is not always a file's bytes.
     *
     *  · A tracked SYMLINK's blob IS its target path — that string is the whole of what the
     *    repository carries, so that string is what gets scanned. Following the link instead is
     *    wrong twice over: pointed at a directory it throws EISDIR and kills the entire scan
     *    (which is exactly what happened — five directory symlinks under apps/web/ stopped this
     *    guard after 244 of 2069 files, so it asserted nothing at all), and pointed at a file it
     *    merely re-reads bytes git already lists under that file's own real path.
     *  · A path git still names while it is being deleted in the worktree has no bytes at all.
     *    It cannot ship copy, and must not make the guard throw before it inspects what does. */
    const scanned: string[] = [];
    const offenders = tracked
      .filter((relative) => relative !== GUARD_ITSELF)
      .filter((relative) => {
        const absolute = path.join(REPO_ROOT, relative);
        const stat = lstatSync(absolute, { throwIfNoEntry: false });
        if (!stat) return false;
        const content = stat.isSymbolicLink() ? readlinkSync(absolute) : readFileSync(absolute, "utf8");
        scanned.push(relative);
        return /beta[\s_-]*credit/i.test(content);
      });

    // The scan has to reach the end of the list. Reading nothing is as green as reading
    // everything, and that silence is what let a dead guard sit here looking healthy.
    expect(
      scanned.length / tracked.length,
      `the scan covered only ${scanned.length} of ${tracked.length} tracked paths`,
    ).toBeGreaterThan(0.95);

    expect(offenders, `these still say "beta credits":\n${offenders.join("\n")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ④ one sentence, one dash
// ---------------------------------------------------------------------------
/**
 * #1224 判官 P2-3:这条围栏原来盯着**三个**抄写点(`lib/otto-stream-errors.ts`、
 * 路由的 onError 兜底、`OttoChatStream` 的传输级替身),因为同一句话在三处曾经两种破折号。
 * 三份现在收成一份(`lib/otto-stream-bridge.ts` 的 `OTTO_TRANSIENT_FAILURE_SENTENCE`),
 * 所以这里跟着盯那一份 —— 「不许再长出第二份」由
 * `otto-provider-failure-copy.test.ts` 的单源围栏负责,两条各管一件事。
 */
describe("#699 the Otto snag sentence is punctuated the same way everywhere", () => {
  const SNAG_SITES = ["lib/otto-stream-bridge.ts"];

  it.each(SNAG_SITES)("%s uses the em dash", (relative) => {
    const source = readFileSync(path.join(WEB_ROOT, relative), "utf8");
    const dashes = [...source.matchAll(/Otto hit a snag\s*(\S)/g)].map((m) => m[1]);

    expect(dashes.length, `${relative} no longer contains the snag sentence`).toBeGreaterThan(0);
    for (const dash of dashes) {
      expect(dash, `${relative} punctuates the snag sentence with "${dash}" instead of an em dash`).toBe("—");
    }
  });
});
