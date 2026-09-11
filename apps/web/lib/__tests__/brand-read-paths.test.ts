/**
 * Brand 产品身份 —— **读路**那一半(规格 `docs/specs/brand-product-identity.md`,票 #1322)。
 *
 * 姊妹文件 `brand-product-identity.test.ts` 证的是「写与身份」(A1 / A3 / A4 / A6 / A9 / A10);
 * 这一份证的是商家**看**到的四个地方读的是不是同一件东西:
 *   · PRODID-A2 —— `@` 菜单与确认卡的谱系指向同一个 `Entity` id;来源标签是「Product」。
 *   · PRODID-A5 —— Library 元素页没有价格 / 卖点 / 分类的编辑入口(那三项只在 Brand 页)。
 *   · PRODID-A7 —— 理解提取的草稿在确认**前**不出现在 Library / @ / Otto;确认后三处一起出现。
 *
 * 硬口径与姊妹文件相同:真数据库、真 Prisma、真 `requireOwner`。只有会话被 mock —— 要证的
 * 正是「ownerId 只来自服务端 principal」,身份那一处必须能换人,别的都不许假。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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

const { requireOwner } = await import("@/lib/auth-guard");
const { saveBrandRecord, listBrandRecords, confirmBrandRecordDraft } = await import("@/lib/brand-record-actions");
const { getLibraryElements } = await import("@/lib/library-elements");
const { loadBrandSections } = await import("@/lib/brand-context-data");
const { searchReferences } = await import("@/lib/reference-search");
const { resolveOwnedReferenceRefs } = await import("@/lib/reference-refs");
const { prisma, createProduct } = await import("@fikirtive/db");
const { executeLookupProducts } = await import("@fikirtive/otto");
const { formatReferenceRef } = await import("@fikirtive/core");

const EMAIL_A = `prodid-read-a-${randomUUID()}@fikirtive.test`;
const EMAIL_B = `prodid-read-b-${randomUUID()}@fikirtive.test`;
let ownerA: string;
let ownerB: string;

async function signInAs(email: string): Promise<string> {
  mockAuth.mockResolvedValue({ user: { email } });
  const gate = await requireOwner();
  if ("error" in gate) throw new Error(gate.error);
  return gate.ownerId;
}

/** Otto 那条读路要的最小上下文 —— 它只读 `orgId`。 */
function ottoCtx(orgId: string) {
  return { context: { orgId } } as unknown as Parameters<typeof executeLookupProducts>[1];
}

beforeAll(async () => {
  process.env.AUTH_ALLOWED_EMAILS = `${EMAIL_A},${EMAIL_B}`;
  for (const email of [EMAIL_A, EMAIL_B]) {
    await prisma.user.upsert({ where: { email }, update: {}, create: { id: `usr_${randomUUID()}`, email } });
  }
  ownerA = await signInAs(EMAIL_A);
  ownerB = await signInAs(EMAIL_B);
  expect(ownerA).not.toBe(ownerB);
}, 120_000);

/**
 * PRODID-A2 —— 「在画布输入 @ 加产品名 ⇒ 菜单出现该产品,来源标签为「Product」;选入确认卡后,
 * 生成结果谱系的 `approvedEntities` 指向同一个 Entity id」。
 *
 * 链条只有一条 id:`@` 菜单那一行的 `id` **就是** `Entity.id`(搜索直接读 `Entity` 表),
 * 选中之后客户端提交的是类型化 ID `product:<那个 id>`,服务端按 owner 解析回同一行,得到
 * `entityIds` —— 卡上带走的就是它,`approvedEntities` 在铸卡那一刻按 `entityIds` 原序冻结
 * (`packages/otto/src/skills/propose.helpers.ts`,同名用例在 `propose.test.ts`)。
 * 这一条把「菜单 → 类型化 ID → 服务端解析出的 entityId」这三段钉在真库上。
 */
describe("PRODID-A2 @ 菜单与确认卡谱系:同一个 Entity id,来源标签「Product」", () => {
  it("PRODID-A2 @ 菜单那一行的 id 就是价签的 entityId,标签是「Product」,选中后解析回同一个 id", async () => {
    await signInAs(EMAIL_A);
    const name = `Kopi tumbler ${randomUUID().slice(0, 8)}`;
    const saved = (await saveBrandRecord({
      kind: "product", data: { name, price: "RM 39" },
    })) as { ok: true; id: string };
    const entityId = (await prisma.brandRecord.findFirstOrThrow({
      where: { id: saved.id, ownerId: ownerA }, select: { entityId: true },
    })).entityId!;

    // ① 菜单:找得到、id 就是身份、来源标签逐字是「Product」——不是「Product · Otto IQ」。
    const menu = await searchReferences(ownerA, { query: name });
    const row = menu.items.find((i) => i.name === name);
    expect(row, "@ 菜单里找不到刚建的产品").toBeTruthy();
    expect(row!.type).toBe("product");
    expect(row!.id).toBe(entityId);
    expect(row!.source).toBe("Product");

    // ② 选中之后客户端提交的那个类型化 ID,服务端按 owner 解析回**同一个** Entity id ——
    //    卡上的 `entityIds` 就是它,`approvedEntities` 照它冻结。
    const wire = formatReferenceRef({ type: "product", id: row!.id });
    const resolved = await resolveOwnedReferenceRefs(ownerA, [wire]);
    expect(resolved.entityIds).toEqual([entityId]);
    expect(resolved.unresolved).toBe(0);
    // 回链那一行读到的也是同一句标签(消息记录里那枚 chip)。
    expect(resolved.links.map((l) => ({ id: l.id, source: l.source }))).toEqual([
      { id: entityId, source: "Product" },
    ]);

    // ③ 双租户:B 在自己的菜单里既找不到这一行,也解析不出这个 id。
    const bMenu = await searchReferences(ownerB, { query: name });
    expect(bMenu.items.some((i) => i.id === entityId || i.name === name)).toBe(false);
    const bResolved = await resolveOwnedReferenceRefs(ownerB, [wire]);
    expect(bResolved.entityIds).toEqual([]);
    expect(bResolved.unresolved).toBe(1);
  }, 60_000);
});

/**
 * PRODID-A5 —— 「在 Library 元素页找价格、卖点、分类的编辑入口 ⇒ 没有;这三项只在 Brand 页可改」。
 *
 * 两半都要:
 *   · 数据那一半 —— Library 的读模型里根本没有这三格,所以元素页**画不出**编辑入口(缺一个
 *     入口和「读到了却没画」是两回事:后者下一个人加一行 JSX 就漏了);
 *   · 界面那一半 —— Library 那两个界面文件的源码里一个字都不提这三格,而 Brand 页的产品表单
 *     三格齐全。源码扫描只能证明它断言的这件事,所以它旁边永远配着上面那半真库断言。
 */
describe("PRODID-A5 Library 元素页不给价格、卖点、分类的编辑入口", () => {
  const MARKETING_FIELDS = ["price", "sellingAngle", "category"] as const;

  it("PRODID-A5 Library 的元素读模型里没有价格、卖点、分类 —— 这三格只在 Brand 页读得到", async () => {
    await signInAs(EMAIL_A);
    const name = `Nasi lemak set ${randomUUID().slice(0, 8)}`;
    const saved = (await saveBrandRecord({
      kind: "product",
      data: { name, price: "RM 12.90", sellingAngle: "Best seller", category: "Rice" },
    })) as { ok: true; id: string };
    const entityId = (await prisma.brandRecord.findFirstOrThrow({
      where: { id: saved.id, ownerId: ownerA }, select: { entityId: true },
    })).entityId!;

    const elements = await getLibraryElements();
    if (!Array.isArray(elements)) throw new Error(elements.error);
    const card = elements.find((e) => e.id === entityId);
    expect(card, "Library 里没有这张产品卡").toBeTruthy();
    // 卡上只有身份那几样。三个营销格一个都读不到 —— 元素页拿不到,自然也画不出编辑入口。
    expect(Object.keys(card!).sort()).toEqual(
      ["capabilities", "coverUrl", "id", "kind", "mediaCount", "name", "origin"],
    );
    for (const field of MARKETING_FIELDS) {
      expect(Object.hasOwn(card as unknown as Record<string, unknown>, field)).toBe(false);
    }

    // 对照组:同一件产品在 Brand 页三格齐全 —— 「没有」不是「哪儿都没有」,是「只在 Brand 页」。
    const brandRow = (await listBrandRecords()).find((r) => r.id === saved.id);
    expect(brandRow?.data).toMatchObject({
      name, price: "RM 12.90", sellingAngle: "Best seller", category: "Rice",
    });
    const sections = await loadBrandSections(ownerA);
    const entry = sections.flatMap((sec) => sec.entries).find((e) => e.id === saved.id);
    expect(entry?.name).toBe(name);
  }, 60_000);

  it("PRODID-A5 Library 那两个界面文件一个字都不提这三格,Brand 页的产品表单三格齐全", () => {
    const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
    const libraryUi = [
      "components/library/LibraryView.tsx",
      "lib/library-elements-model.ts",
    ];
    for (const file of libraryUi) {
      const source = read(file);
      for (const field of MARKETING_FIELDS) {
        expect(source, `${file} 里出现了 ${field} —— Library 元素页不该碰价签字段`).not.toContain(field);
      }
    }
    // 反面:这三格的编辑入口在 Brand 页的产品表单里,而且是真的输入控件。
    const brandForm = read("components/otto/memory/ProductShowcase.tsx");
    for (const field of MARKETING_FIELDS) expect(brandForm).toContain(field);
    expect(brandForm).toContain("<FieldLabel>Price</FieldLabel>");
    expect(brandForm).toContain("<FieldLabel>Selling angle</FieldLabel>");
    expect(brandForm).toContain("<FieldLabel>Category</FieldLabel>");
  });
});

/**
 * PRODID-A7 —— 「对 Otto 说『记下产品 X』⇒ 两边出现;另让网站理解提取一个产品但不确认 ⇒
 * 后者在确认前不出现在 Library 与 @ 菜单」。
 *
 * 三条读路在同一条草稿上一起验:Library、`@` 菜单、Otto 的 `lookupProducts`。分开各 mock 一次
 * 证不出「同一条草稿在三处的结果一致」——而商家碰到的正是这三处。
 */
describe("PRODID-A7 草稿在确认前三条读路都看不到,确认之后三处一起出现", () => {
  it("PRODID-A7 理解提取的草稿:Library / @ 菜单 / Otto lookupProducts 三处都查无此物", async () => {
    await signInAs(EMAIL_A);
    const name = `Roti canai ${randomUUID().slice(0, 8)}`;
    // 理解 worker 那条入口逐字的调用形状(apps/worker/src/jobs/understand.ts)。
    const made = await createProduct({
      ownerId: ownerA, data: { name, price: "RM 3.00" }, source: "otto", contextStatus: "Draft",
    });
    expect(made).toMatchObject({ created: true, entityId: null });

    const elements = await getLibraryElements();
    if (!Array.isArray(elements)) throw new Error(elements.error);
    expect(elements.some((e) => e.name === name)).toBe(false);

    const menu = await searchReferences(ownerA, { query: name });
    expect(menu.items.some((i) => i.name === name)).toBe(false);

    const otto = await executeLookupProducts({ query: name }, ottoCtx(ownerA));
    expect(otto.matches.some((m) => m.name === name)).toBe(false);

    // Brand 页那一面**看得见**它 —— 商家要有地方按下「确认」。这不是矛盾,是 §1.9 的形状:
    // 草稿在等一个人,而 Otto、Library、@ 三处只认已确认的事实。
    const sections = await loadBrandSections(ownerA);
    expect(sections.flatMap((s) => s.entries).some((e) => e.id === (made as { id: string }).id)).toBe(true);
  }, 60_000);

  it("PRODID-A7 商家在 Brand 页确认之后:Library / @ 菜单 / Otto lookupProducts 三处一起出现", async () => {
    await signInAs(EMAIL_A);
    const name = `Cendol jar ${randomUUID().slice(0, 8)}`;
    const made = await createProduct({
      ownerId: ownerA, data: { name, price: "RM 4.50" }, source: "otto", contextStatus: "Draft",
    });
    const recordId = (made as { id: string }).id;

    await expect(confirmBrandRecordDraft({ id: recordId })).resolves.toEqual({ ok: true });

    const entityId = (await prisma.brandRecord.findFirstOrThrow({
      where: { id: recordId, ownerId: ownerA }, select: { entityId: true, contextStatus: true },
    })).entityId!;
    expect(entityId).toBeTruthy();

    const elements = await getLibraryElements();
    if (!Array.isArray(elements)) throw new Error(elements.error);
    expect(elements.filter((e) => e.name === name).map((e) => e.id)).toEqual([entityId]);

    const menu = await searchReferences(ownerA, { query: name });
    const row = menu.items.find((i) => i.name === name);
    expect(row?.id).toBe(entityId);
    expect(row?.source).toBe("Product");

    const otto = await executeLookupProducts({ query: name }, ottoCtx(ownerA));
    expect(otto.matches.map((m) => m.name)).toContain(name);

    // 双租户:确认过的产品同样只在自己店里看得见。
    const bElements = await (async () => {
      await signInAs(EMAIL_B);
      const list = await getLibraryElements();
      if (!Array.isArray(list)) throw new Error(list.error);
      return list;
    })();
    expect(bElements.some((e) => e.id === entityId)).toBe(false);
    const bOtto = await executeLookupProducts({ query: name }, ottoCtx(ownerB));
    expect(bOtto.matches).toEqual([]);
  }, 60_000);
});
