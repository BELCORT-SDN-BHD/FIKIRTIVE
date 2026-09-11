// @vitest-environment jsdom
/**
 * creation §5 :178(判官 r2 的两条 P1,同一根因)—— 挂图**入口**在第一手动作上就要在。
 *
 * 走查现场:Otto 刚交出分镜,每一镜都还没花过一分钱(每格 `absent`)。判官在 PR head 上用
 * 真挂载探针实测:这张卡上 `syncStoryboardMedia` 一次都不发,于是「这一镜直不直接出片」
 * 这一格永远是空的,`Add image` 一个都画不出来 —— 商家必须先做一次**与挂图无关**的编辑
 * (Add shot / 改文字)或先花一次钱,入口才会冒出来,而卡面没有一个字提示这件事。
 * 验收口径那句「分镜卡镜头可 @ 选 Library 里的图作参考」在主状态下因此不成立。
 *
 * 根因:「这一镜直接出片吗」要读 `Entity.type`,只有服务端答得出,而卡面**只在媒体需要
 * 重载时**才开口问。这一份钉住修法的三面:
 *   ① @ 到了元素的镜头 ⇒ 挂载就问一次(那一问 $0、只读),答案回来入口就在;
 *   ② 一次编辑之后入口不许闪掉 —— 那份判词不跟着媒体答案一起作废(镜头的 `entityIds`
 *      根本不由卡面编辑改动);
 *   ③ 一个元素都没 @ 的分镜不多问一趟 —— 那张卡的答案不可能是「直接出片」。
 *
 * 纯前端:Server Action 全是替身,这里不预扣、不结算、不调 provider。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncStoryboardMedia: vi.fn(),
  getStoryboardVideoOptions: vi.fn(),
  prepareStoryboardFirstFrames: vi.fn(),
  regenShotFirstFrameCard: vi.fn(),
  prepareStoryboardVideos: vi.fn(),
  regenShotVideoCard: vi.fn(),
  editShotPrompt: vi.fn(),
  addShot: vi.fn(),
  deleteShot: vi.fn(),
  reorderShots: vi.fn(),
  setStoryboardContinuity: vi.fn(),
  setShotReferences: vi.fn(),
  coworkGenerate: vi.fn(),
  searchReferencesAction: vi.fn(),
}));

vi.mock("@/lib/storyboard-gate1-actions", () => ({
  prepareStoryboardFirstFrames: mocks.prepareStoryboardFirstFrames,
  regenShotFirstFrameCard: mocks.regenShotFirstFrameCard,
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
  setStoryboardContinuity: mocks.setStoryboardContinuity,
  setShotReferences: mocks.setShotReferences,
}));
vi.mock("@/lib/cowork-actions", () => ({ coworkGenerate: mocks.coworkGenerate }));
vi.mock("@/lib/reference-search-actions", () => ({ searchReferencesAction: mocks.searchReferencesAction }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { StoryboardCard } = await import("@/components/otto/StoryboardCard");

const CARD_ID = "card-1";
const SHOT_ID = "shot-1";

/** Otto 刚交出的那张卡:一镜、@ 了一名演员、一格媒体都没有、一张图都还没挂。 */
function draftPayload(over: { entityIds?: string[] } = {}) {
  return {
    storyboardTitle: "Kaya jar launch",
    continuity: false,
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

/** 服务端对这张草稿卡的回答:这一镜直接出片(它 @ 到了演员),两格媒体都还没开始。 */
function directAnswer(payload: unknown) {
  return {
    payload,
    shots: [
      {
        shotId: SHOT_ID,
        frame: { status: { kind: "absent" } },
        video: { status: { kind: "absent" } },
        directToVideo: true,
        libraryImages: [],
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

describe("creation §5 :178 —— 草稿分镜卡上的挂图入口", () => {
  it("creation §5 :178: 全新草稿卡(一格媒体都没有)挂载就问一次,@ 选图的入口第一手就在", async () => {
    const payload = draftPayload({ entityIds: ["ent-actor"] });
    mocks.syncStoryboardMedia.mockResolvedValue(directAnswer(payload));

    await renderCard(payload);

    // 那一问 $0、只读 —— 卡面没有它就答不出「这一镜直不直接出片」,而入口正挂在那一格上。
    expect(mocks.syncStoryboardMedia).toHaveBeenCalledTimes(1);
    expect(hasAddImage()).toBe(true);
  });

  it("creation §5 :178: 一次编辑之后入口不闪掉(判词不随媒体答案一起作废)", async () => {
    const payload = draftPayload({ entityIds: ["ent-actor"] });
    mocks.syncStoryboardMedia.mockResolvedValue(directAnswer(payload));
    const editedPayload = {
      storyboardTitle: "Kaya jar launch",
      continuity: false,
      shots: [
        { shotId: SHOT_ID, index: 0, firstFramePrompt: "", videoPrompt: "slow push in", entityIds: ["ent-actor"] },
        { shotId: "shot-2", index: 1, firstFramePrompt: "wide", videoPrompt: "pull out" },
      ],
    };
    mocks.addShot.mockResolvedValue({ payload: editedPayload });

    await renderCard(payload);
    expect(hasAddImage()).toBe(true);

    // 编辑之后那一趟 sync 答不出来(服务端一时不可达)——判词是关于 `entityIds` 的,而
    // `entityIds` 根本不由卡面编辑改动,所以入口不该跟着这一次失败消失。
    mocks.syncStoryboardMedia.mockResolvedValue({ error: "boom" });
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

  it("creation §5 :178: 一个元素都没 @ 的草稿卡不多问一趟(它不可能直接出片)", async () => {
    mocks.syncStoryboardMedia.mockResolvedValue(directAnswer(draftPayload()));

    await renderCard(draftPayload());

    expect(mocks.syncStoryboardMedia).not.toHaveBeenCalled();
    expect(hasAddImage()).toBe(false);
  });
});
