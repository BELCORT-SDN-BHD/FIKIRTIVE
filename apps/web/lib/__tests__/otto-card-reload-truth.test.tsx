// @vitest-environment jsdom
/**
 * otto-card-reload-truth —— 刷新之后,确认卡上「选中的」必须等于「要收的钱」。
 *
 * 规格 docs/specs/frontend-baseline.md(验收 FRONT-A14 那一面走查);卡上那三格本身的判词
 * 沿用既有编号 ENGINE-A3。
 *
 * ── 病(终检 r5,#1230 G3 走查实证)────────────────────────────────────────────
 * 商家在卡上把张数改成 2、形状改成 4:3、精修打开,然后**重新打开画布 URL**。同一张卡上:
 *   卡头「1 image」、Images 下拉＝1、Shape 下拉＝1:1,
 *   而规格条写「2304 × 1728 · 4:3 · 2 images · Fine detail」、按钮写「Generate · 4 credits」。
 * 也就是说:他看到的「选中的」和他将要被收的那笔钱,说的是两件事。
 *
 * ── 根因 ────────────────────────────────────────────────────────────────────
 * 不在卡上,在**读路**:`lib/dto.ts` 的 GEN_CARD 那一支从前把整个 `params` 连同 `model`
 * `reason` 一起剥掉(剥后两个是对的 —— 它们带引擎名)。于是刷新之后:
 *   · 卡头与两个下拉读 `payload.params`  ⇒ 落回默认值(`count ?? 1`、空串 ⇒ 浏览器选第一格);
 *   · 规格条读 `specChips`、价读 `estimatedCredits`、精修读 `fineDetail` ⇒ 全都还在。
 * 改完还没刷新时两边一致,是因为那一刻卡面读的是 `ottoUpdateGenCardOptions` 直接交回来的
 * **完整** payload。所以这个病只在刷新之后现身 —— 恰恰是商家离开又回来准备付钱的那一刻。
 *
 * ── 这份文件钉的事 ──────────────────────────────────────────────────────────
 *   ① 真库:铸卡 → 走生产那个 $0 动作改三格 → 走**生产的重读路**
 *      (`getCoworkThreadClient` → `getCoworkThreadPage` + `toChatThreadDTO`,也就是刷新时
 *      画布真正调的那一条) → 卡头、两个下拉、规格条、价四者说同一件事;
 *   ② 两处确认位都过:画布左上那张 `OttoTurnCard` 与 Conversation 抽屉里那张 `OttoPlanCard`;
 *   ③ **变异**:把重读回来的 payload 退回修复前的形状(`params` 被剥掉),四者当场分家 ——
 *      这一条证明上面那些断言不是空转。
 *
 * 零花费:没有 reserve、没有 GenJob、没有 provider 调用;改档那个动作本身就是 $0。
 */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildProposeCard, type CardPayload, type OttoContext } from "@fikirtive/otto";
import type { OttoPlanCardPayload } from "@/components/otto/plan-card-contract";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockRequireOwner = vi.fn();
const mockResolveUserPrincipal = vi.fn();
vi.mock("@/lib/auth-guard", () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: (...args: unknown[]) => mockResolveUserPrincipal(...args),
}));
const { stubResolveUserPrincipal } = await import("@/lib/__tests__/__stubs__/resolve-user-principal");
vi.mock("@/lib/better-auth/compat", () => ({ isImpersonating: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/create/canvas",
  useSearchParams: () => new URLSearchParams(),
}));
// 卡上那三格在这份文件里一次都不点 —— 要证的是**刷新之后卡面的初值**,改档走真服务端动作。
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: vi.fn(),
  ottoTurn: vi.fn(),
  ottoUpdateGenCardOptions: vi.fn(),
  createEmptyCoworkThread: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));
vi.mock("@/lib/cowork-actions", () => ({
  coworkGenerate: vi.fn(),
  coworkVaryCard: vi.fn(),
  cancelGenJob: vi.fn(),
}));

const { ottoUpdateGenCardOptions } = await import("@/lib/otto-actions");
const { getCoworkThreadClient } = await import("@/lib/cowork-fetch");
const { prisma } = await import("@fikirtive/db");
const { creditsLabel } = await import("@/lib/credit-format");
const { OttoPlanCard } = await import("@/components/otto/OttoPlanCard");
const { OttoTurnCard } = await import("@/components/otto/OttoTurnCard");

const PROMPT = "A pandan kaya jar on a marble counter";
/** 走查那一次改的三格,逐字照抄(#1230 G3)。 */
const WANT_COUNT = 2;
const WANT_SHAPE = "4:3";

async function seedWorld() {
  const ownerId = `org_${randomUUID()}`;
  await prisma.organization.create({ data: { id: ownerId } });
  const projectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectId, ownerId, name: "Card reload truth" } });
  const threadId = `thr_${randomUUID()}`;
  await prisma.chatThread.create({ data: { id: threadId, ownerId, projectId, title: "Otto" } });
  mockRequireOwner.mockResolvedValue({ ownerId, email: `${ownerId}@fikirtive.test` });
  return { ownerId, projectId, threadId };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

async function mintImageCard(world: World): Promise<string> {
  const { cardPayload } = buildProposeCard(
    { kind: "image", structuredPrompt: PROMPT, entityIds: [], variantSel: {} },
    {
      orgId: world.ownerId,
      userId: "user-test",
      projectId: world.projectId,
      threadId: world.threadId,
      disabledModels: [],
      sourceGenerationId: null,
    } as OttoContext,
    [],
  );
  const cardId = `msg_${randomUUID()}`;
  await prisma.chatMessage.create({
    data: {
      id: cardId,
      threadId: world.threadId,
      ownerId: world.ownerId,
      role: "AGENT",
      kind: "GEN_CARD",
      seq: 1,
      text: "",
      payload: cardPayload as unknown as object,
    },
  });
  return cardId;
}

/** 走生产那个 $0 动作改一格;被拒就当场炸(拒绝在这份文件里是环境不对,不是被测行为)。 */
async function edit(world: World, cardId: string, patch: Record<string, unknown>): Promise<CardPayload> {
  const res = await ottoUpdateGenCardOptions({ threadId: world.threadId, cardId, ...patch });
  if ("error" in res) throw new Error(`改档被拒:${res.error}`);
  return res.payload;
}

/**
 * 刷新。走的是画布重新挂载时真正调的那一条读路 —— 不是直接读 prisma:
 * 病就长在那条路的 DTO 上,绕过它这份测试会永远绿。
 */
async function reloadCardPayload(world: World, cardId: string): Promise<OttoPlanCardPayload> {
  const dto = await getCoworkThreadClient(world.threadId);
  const message = dto?.messages.find((m) => m.id === cardId);
  if (!message) throw new Error("刷新之后线程里找不到这张卡");
  return message.payload as OttoPlanCardPayload;
}

const roots: Array<[Root, HTMLElement]> = [];
afterEach(() => {
  for (const [root, host] of roots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

/** 两处确认位同挂 —— 画布左上那张与抽屉里那张读的是同一份 payload。 */
function BothCards({ cardId, threadId, payload }: { cardId: string; threadId: string; payload: unknown }) {
  const [current, setCurrent] = useState<unknown>(payload);
  const onOptionsChanged = (_cardId: string, next: unknown) => setCurrent(next);
  return createElement("div", null, [
    createElement(
      "div",
      { key: "canvas", "data-testid": "canvas-card" },
      createElement(OttoTurnCard, {
        status: {
          phase: "needs-confirmation",
          label: "Waiting for you",
          dot: "bg-brand",
          detail: null,
          busy: false,
        } as const,
        text: "Here's what I'll make.",
        streaming: false,
        confirmCards: [{ cardId, threadId, payload: current, pendingApproval: true }],
        onApproved: vi.fn(),
        onChangeSomething: vi.fn(),
        onOptionsChanged,
      }),
    ),
    createElement(
      "div",
      { key: "drawer", "data-testid": "drawer-card" },
      createElement(OttoPlanCard, {
        cardId,
        payload: current,
        entities: [],
        threadId,
        projectId: "proj_1",
        genJobId: null,
        cardState: "idle" as const,
        pendingApproval: true,
        onApproved: vi.fn(),
        onChangeSomething: vi.fn(),
        onOptionsChanged,
      }),
    ),
  ]);
}

function mountBoth(cardId: string, threadId: string, payload: unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push([root, host]);
  act(() => root.render(createElement(BothCards, { cardId, threadId, payload })));
  return host;
}

function scope(host: HTMLElement, which: "canvas-card" | "drawer-card"): HTMLElement {
  const node = host.querySelector(`[data-testid="${which}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`${which} 没渲染出来`);
  return node;
}

function selectByLabel(root: HTMLElement, label: string): HTMLSelectElement {
  const found = [...root.querySelectorAll("select")].find((s) => s.getAttribute("aria-label") === label);
  if (!found) throw new Error(`找不到下拉:${label}`);
  return found;
}

/** 商家在这一处读到的整段字(卡头、规格条、按钮上的价都在里面)。 */
const textOf = (root: HTMLElement): string => root.textContent ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveUserPrincipal.mockImplementation(stubResolveUserPrincipal as never);
});

describe("ENGINE-A3 刷新之后:确认卡上「选中的」==「要收的钱」(终检 r5 / #1230 G3)", () => {
  it("ENGINE-A3 改过三格再刷新,卡头、两个下拉、规格条、价说的是同一件事(画布左上那张卡)", async () => {
    const world = await seedWorld();
    const cardId = await mintImageCard(world);
    await edit(world, cardId, { count: WANT_COUNT });
    await edit(world, cardId, { aspectRatio: WANT_SHAPE });
    const persisted = await edit(world, cardId, { fineDetail: true });

    // 前提先立住:库里那张卡真的记下了这三格,否则下面比的是两份都错的东西。
    expect(persisted.params.count).toBe(WANT_COUNT);
    expect(persisted.params.aspectRatio).toBe(WANT_SHAPE);
    expect(persisted.fineDetail).toBe(true);

    const reloaded = await reloadCardPayload(world, cardId);
    const host = mountBoth(cardId, world.threadId, reloaded);
    const canvas = scope(host, "canvas-card");

    // ① 卡头 ——「N image(s)」
    expect(textOf(canvas), "卡头说的张数不是商家选的那个").toContain(`${WANT_COUNT} images`);
    // ② 两个下拉的初值
    expect(selectByLabel(canvas, "How many images").value).toBe(String(WANT_COUNT));
    expect(selectByLabel(canvas, "Shape of the image").value).toBe(WANT_SHAPE);
    // ③ 规格条(服务端那一份,精修那一格补在末尾)
    expect(textOf(canvas)).toContain(WANT_SHAPE);
    expect(textOf(canvas)).toContain("Fine detail");
    // ④ 要收的钱 —— 卡上那个数只有服务端一个作者
    expect(textOf(canvas)).toContain(`Generate · ${creditsLabel(persisted.estimatedCredits)}`);
    // 精修那一格的开关也停在打开
    expect(canvas.querySelector('[aria-label="Fine detail"]')?.getAttribute("aria-checked")).toBe("true");
  });

  it("ENGINE-A3 抽屉里那张卡刷新之后同样对齐 —— 两处确认位不说两件事", async () => {
    const world = await seedWorld();
    const cardId = await mintImageCard(world);
    await edit(world, cardId, { count: WANT_COUNT });
    const persisted = await edit(world, cardId, { aspectRatio: WANT_SHAPE });

    const reloaded = await reloadCardPayload(world, cardId);
    const host = mountBoth(cardId, world.threadId, reloaded);
    const drawer = scope(host, "drawer-card");

    expect(selectByLabel(drawer, "How many images").value).toBe(String(WANT_COUNT));
    expect(selectByLabel(drawer, "Shape of the image").value).toBe(WANT_SHAPE);
    expect(textOf(drawer)).toContain(`${WANT_COUNT} images`);
    expect(textOf(drawer)).toContain(WANT_SHAPE);
    expect(textOf(drawer)).toContain(`Generate · ${creditsLabel(persisted.estimatedCredits)}`);
  });

  it("ENGINE-A3 刷新读回来的那份 payload 自己就带着商家选的那几格(读路不许再剥掉 params)", async () => {
    const world = await seedWorld();
    const cardId = await mintImageCard(world);
    await edit(world, cardId, { count: WANT_COUNT });
    await edit(world, cardId, { aspectRatio: WANT_SHAPE });

    const reloaded = await reloadCardPayload(world, cardId);
    expect(reloaded.params?.count, "读路把张数丢了").toBe(WANT_COUNT);
    expect(reloaded.params?.aspectRatio, "读路把形状丢了").toBe(WANT_SHAPE);
    // 引擎名照旧不上路(Founder 常令:供应商保密)。规格条与价来自服务端,不需要它们。
    expect(reloaded.model, "引擎名跟着 params 一起漏到了浏览器").toBeUndefined();
    expect((reloaded as { reason?: unknown }).reason, "路由说明漏到了浏览器").toBeUndefined();
  });

  it("ENGINE-A3 变异:把 params 退回修复前那样被剥掉,卡上四者当场分家(证明上面不是空转)", async () => {
    const world = await seedWorld();
    const cardId = await mintImageCard(world);
    await edit(world, cardId, { count: WANT_COUNT });
    const persisted = await edit(world, cardId, { aspectRatio: WANT_SHAPE });

    const reloaded = await reloadCardPayload(world, cardId);
    // 修复前那条读路交给浏览器的,正是这个形状。
    const { params: _stripped, ...withoutParams } = reloaded;
    const host = mountBoth(cardId, world.threadId, withoutParams);
    const canvas = scope(host, "canvas-card");

    // 规格条与价照旧说 2 张 4:3 —— 而卡头与两个下拉退回默认值。这就是走查看到的那一幕。
    expect(textOf(canvas)).toContain(`${WANT_COUNT} images`);
    expect(textOf(canvas)).toContain(`Generate · ${creditsLabel(persisted.estimatedCredits)}`);
    expect(selectByLabel(canvas, "How many images").value).toBe("1");
    expect(selectByLabel(canvas, "Shape of the image").value).not.toBe(WANT_SHAPE);
  });
});
