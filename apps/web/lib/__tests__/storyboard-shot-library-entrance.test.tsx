// @vitest-environment jsdom
/**
 * PR #1417 判官 P1-B —— 挂图入口不再等服务端确认「这一镜直不直接出片」。
 *
 * 旧版判据(creation §5 :178,判官 r2 的两条 P1)靠挂载时多问一趟 `syncStoryboardMedia` 才
 * 敢让 Add image 入口出现,而那一问只在「至少一镜 @ 了元素」时才发
 * (`needsDirectToVideoAnswer`)。判官在这一轮(PR #1417 P1-B)钉出的反例:全镜头零 @ 的
 * 分镜(纯文字脚本)挂载时两个「要不要问」判据都是假,sync 从不触发,`directShotIds`
 * 永远是空集,导致 Add image 入口——连同时长下拉/VideoSlot/Remake——全部不渲染,而卡级
 * Make all videos 照常收钱,商家在无法选时长的情况下付钱。
 *
 * FSE-208 之后「这一镜直接出片」对每一镜都恒为真,是卡面一眼就知道的编译期常量,不必再
 * 读 `Entity.type` 才能确认。这一份钉的是修法:入口第一手就在,不必等、也不必多问一趟。
 *
 * 纯前端:Server Action 全是替身,这里不预扣、不结算、不调 provider。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncStoryboardMedia: vi.fn(),
  getStoryboardVideoOptions: vi.fn(),
  prepareStoryboardVideos: vi.fn(),
  regenShotVideoCard: vi.fn(),
  editShotPrompt: vi.fn(),
  addShot: vi.fn(),
  deleteShot: vi.fn(),
  reorderShots: vi.fn(),
  setShotReferences: vi.fn(),
  coworkGenerate: vi.fn(),
  searchReferencesAction: vi.fn(),
}));

vi.mock("@/lib/storyboard-gate1-actions", () => ({
  prepareStoryboardVideos: mocks.prepareStoryboardVideos,
  regenShotVideoCard: mocks.regenShotVideoCard,
  getStoryboardVideoOptions: mocks.getStoryboardVideoOptions,
  syncStoryboardMedia: mocks.syncStoryboardMedia,
}));
vi.mock("@/lib/storyboard-actions", () => ({
  editShotPrompt: mocks.editShotPrompt,
  addShot: mocks.addShot,
  deleteShot: mocks.deleteShot,
  reorderShots: mocks.reorderShots,
  setShotReferences: mocks.setShotReferences,
}));
vi.mock("@/lib/cowork-actions", () => ({ coworkGenerate: mocks.coworkGenerate }));
vi.mock("@/lib/reference-search-actions", () => ({ searchReferencesAction: mocks.searchReferencesAction }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { StoryboardCard } = await import("@/components/otto/StoryboardCard");

const CARD_ID = "card-1";
const SHOT_ID = "shot-1";

/** Otto 刚交出的那张卡:一镜、一格媒体都没有、一张图都还没挂。entityIds 可选(判官的
 *  反例正是「一个元素都没 @」的那张卡)。 */
function draftPayload(over: { entityIds?: string[] } = {}) {
  return {
    storyboardTitle: "Kaya jar launch",
    shots: [
      {
        shotId: SHOT_ID,
        index: 0,
        firstFramePrompt: "",
        videoPrompt: "slow push in",
        ...(over.entityIds ? { entityIds: over.entityIds } : {}),
      },
    ],
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderCard(payload: unknown): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(StoryboardCard, { cardId: CARD_ID, payload, balanceUsd: 100 }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function buttonLabels(): string[] {
  return [...container!.querySelectorAll<HTMLButtonElement>("button")].map((b) => b.textContent ?? "");
}

function hasAddImage(): boolean {
  return buttonLabels().some((t) => t.includes("Add image"));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStoryboardVideoOptions.mockResolvedValue({ durations: [5] });
  mocks.searchReferencesAction.mockResolvedValue({ items: [] });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("creation §5 :178 / PR #1417 判官 P1-B —— 草稿分镜卡上的挂图入口第一手就在", () => {
  it("全新草稿卡(一个元素都没 @,一格媒体都没有)挂载不发 sync,入口第一手就在", async () => {
    const payload = draftPayload();

    await renderCard(payload);

    // 判官反例的核心:入口不必等服务端确认「这一镜直不直接出片」——它现在是一个恒真的
    // 编译期常量,挂载不必为它多问一趟。
    expect(mocks.syncStoryboardMedia).not.toHaveBeenCalled();
    expect(hasAddImage()).toBe(true);
  });

  it("@ 了元素的草稿卡同样不必等 sync,入口一样第一手就在", async () => {
    const payload = draftPayload({ entityIds: ["ent-actor"] });

    await renderCard(payload);

    expect(mocks.syncStoryboardMedia).not.toHaveBeenCalled();
    expect(hasAddImage()).toBe(true);
  });

  it("一次编辑之后入口不闪掉(它本来就不依赖任何媒体答案)", async () => {
    const payload = draftPayload({ entityIds: ["ent-actor"] });
    const editedPayload = {
      storyboardTitle: "Kaya jar launch",
      shots: [
        { shotId: SHOT_ID, index: 0, firstFramePrompt: "", videoPrompt: "slow push in", entityIds: ["ent-actor"] },
        { shotId: "shot-2", index: 1, firstFramePrompt: "wide", videoPrompt: "pull out" },
      ],
    };
    mocks.addShot.mockResolvedValue({ payload: editedPayload });

    await renderCard(payload);
    expect(hasAddImage()).toBe(true);

    const addShotButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      (b.textContent ?? "").includes("Add shot"),
    )!;
    await act(async () => {
      addShotButton.click();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.addShot).toHaveBeenCalledTimes(1);
    expect(hasAddImage()).toBe(true);
  });
});
