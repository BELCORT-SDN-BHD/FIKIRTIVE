// @vitest-environment jsdom
/**
 * 批量收藏的**回话**(前端基线 `docs/specs/frontend-baseline.md` §7.3② 段②;验收 FRONT-A5)。
 *
 * 为什么单独一份:这两条主张只有在**真的把组件挂起来**之后才成立或不成立 —— 它们说的
 * 不是「代码里写了这句话」,而是「这句话最后有没有出现在商家眼前」。第一版就是在源码里
 * 写全了那句「N 件没能保存」,同一次渲染里又把承载它的选择条卸掉,于是一次部分失败对
 * 商家来说完全无声:他以为 N 件全进了收藏。读源码看不出这件事,挂起来一眼就看得出。
 *
 * 第二条(全成功才退出选择模式)同时是 e2e 那一条的地基:旅程里
 * `await expect(page.getByText("2 selected")).toBeHidden()` 之所以能当成「两次写都落地了」
 * 的信号,靠的就是这里钉住的这个语义。
 */
import fs from "node:fs";
import path from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  getProjects: vi.fn(),
  getGenerationHistory: vi.fn(),
  getLibraryElements: vi.fn(),
  softDeleteEntity: vi.fn(),
  setLibraryFavorite: vi.fn(),
  listLibraryFavorites: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/data", () => ({ getProjects: mocks.getProjects }));
vi.mock("@/lib/library-actions", () => ({ getGenerationHistory: mocks.getGenerationHistory }));
vi.mock("@/lib/library-elements", () => ({ getLibraryElements: mocks.getLibraryElements }));
vi.mock("@/lib/actions", () => ({ softDeleteEntity: mocks.softDeleteEntity }));
vi.mock("@/lib/library-favorites", () => ({
  setLibraryFavorite: mocks.setLibraryFavorite,
  listLibraryFavorites: mocks.listLibraryFavorites,
}));
// 详情面会把整条花费路径拖进来,这份围栏不测它(与 library-baseline-seg2a 同一个理由)。
vi.mock("@/components/asset/DetailPanel", () => ({ default: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: LibraryPage } = await import("@/app/library/page");

function item(id: string, prompt: string) {
  return {
    id,
    projectId: "prj_1",
    assetId: `ast_${id}`,
    url: `/files/u/own_1/${id}.png`,
    kind: "image" as const,
    source: "generated" as const,
    prompt,
    filename: "",
    width: 1024,
    height: 1024,
    durationS: null,
    favorite: false,
    createdAt: new Date("2026-09-01T00:00:00.000Z").toISOString(),
  };
}

const HISTORY_PAGE = {
  items: [item("gen_1", "Raya cookie tin on marble"), item("gen_2", "Kopi tumbler on wood")],
  nextCursor: null,
  hasMore: false,
};

const mounted: { root: Root; container: HTMLDivElement }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwner.mockResolvedValue({ email: "shop@test.my", ownerId: "own_1" });
  mocks.getProjects.mockResolvedValue([{ id: "prj_1", name: "Hari Raya gifting" }]);
  mocks.getGenerationHistory.mockResolvedValue(HISTORY_PAGE);
  mocks.getLibraryElements.mockResolvedValue([]);
  mocks.listLibraryFavorites.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
  mocks.setLibraryFavorite.mockResolvedValue({ favorite: true });
});

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  document.body.replaceChildren();
});

async function mount(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));
  await settle();
  return document.body;
}

async function settle() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function byLabel(label: string): HTMLElement {
  const found = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`没有这个控件:${label}`);
  return found;
}

function byText(label: string): HTMLElement {
  const found = [...document.body.querySelectorAll<HTMLElement>("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!found) throw new Error(`没有这颗键:${label}`);
  return found;
}

async function click(node: HTMLElement) {
  await act(async () => {
    node.click();
  });
  await settle();
}

/** 进入选择模式并勾上两件。 */
async function selectTwo() {
  await click(byText("Select"));
  await click(byLabel("Select Raya cookie tin on marble"));
  await click(byLabel("Select Kopi tumbler on wood"));
  expect(document.body.textContent).toContain("2 selected");
}

describe("FRONT-A5 批量收藏的回话", () => {
  it("FRONT-A5 一件没成:那句「N 件没能保存」留在屏幕上,选择条不跟着消失", async () => {
    mocks.setLibraryFavorite
      .mockResolvedValueOnce({ favorite: true })
      .mockResolvedValueOnce({ error: "Not found." });

    await mount(await LibraryPage({ searchParams: Promise.resolve({}) }));
    await selectTwo();
    await click(byText("Favorite"));

    // 这才是这条围栏的全部:消息在**文档里**,不只在某个 state 里。
    expect(document.body.textContent).toContain("1 of 2 saved to Favorites.");
    expect(document.body.textContent).toContain("1 couldn’t be saved.");
    // 承载它的容器还在 —— 卸掉容器等于把消息一起卸掉,那正是第一版的病。
    expect(document.body.textContent).toContain("2 selected");
  });

  it("FRONT-A5 全成功:选择条退场,没有一句多余的成功提示", async () => {
    mocks.setLibraryFavorite.mockResolvedValue({ favorite: true });

    await mount(await LibraryPage({ searchParams: Promise.resolve({}) }));
    await selectTwo();
    await click(byText("Favorite"));

    expect(mocks.setLibraryFavorite).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain("2 selected");
    expect(document.body.textContent).not.toContain("saved to Favorites");
  });
});

/* ── 收藏页的第一页:effect 里不许同步 setState ──────────────────────────────── */

describe("FRONT-A5 收藏页第一页的取数不在 effect 里同步 setState", () => {
  const source = fs.readFileSync(
    path.join(path.resolve(__dirname, "../.."), "components/library/LibraryView.tsx"),
    "utf8",
  );

  it("FRONT-A5 loadFavorites 的第一句是 await —— effect 直接调它才不会触发 set-state-in-effect", () => {
    const body = source.slice(source.indexOf("const loadFavorites = React.useCallback"));
    const firstStatement = body.slice(body.indexOf("{", body.indexOf("=>")) + 1).trimStart();
    expect(
      firstStatement.startsWith("const result = await listLibraryFavorites"),
      "loadFavorites 在第一次 await 之前又开始 setState 了:那条 effect 会当场变红",
    ).toBe(true);
  });

  it("FRONT-A5 「还没取到第一页」用 favorites === null 表达,不靠 loading 旗子", () => {
    expect(source).toContain("React.useState<LibraryFavoriteItem[] | null>(null)");
    expect(source).toContain("favorites === null ? (");
  });
});
