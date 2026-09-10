// @vitest-environment jsdom
/**
 * creation §5 :178(判官 r1 P1-④)—— 卡面上「这一镜挂着哪几张图」的**权威是 payload**。
 *
 * 走查现场(判官钉的时序):商家给一镜挂了 A,关掉标签页再打开 —— 草稿态分镜卡挂载时**不发**
 * sync(`needsRefreshEntrance` 对每格 `absent` 的卡为假),而上一版的清单整个从 sync 回执取,
 * 于是卡面一张都画不出来;他接着挂 B,服务端收到的整份新清单只有 [B],A 无声消失。挂图正是
 * 验收行「进入报价材料」的那份材料,所以这是「批准的东西与付费的东西分家」的形状。
 *
 * 这一份用真组件、真点击,钉两件事:
 *   ① 一次 sync 都没发生时,payload 上挂着的那几张照旧画得出来、也取得下来;
 *   ② 取下一张之后交给服务端的是**payload 那份清单减掉这一张**,不是从回执拼出来的空清单。
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

/** 一镜、挂着两张 Library 图、什么都还没做(每格 `absent` ⇒ 挂载时不发 sync)。 */
function payloadWithImages() {
  return {
    storyboardTitle: "Kaya jar launch",
    continuity: false,
    shots: [
      {
        shotId: SHOT_ID,
        index: 0,
        firstFramePrompt: "",
        videoPrompt: "slow push in",
        entityIds: ["ent-actor"],
        referenceGenerationIds: ["lib-1", "lib-2"],
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

function removeButtons(): HTMLButtonElement[] {
  return [...container!.querySelectorAll<HTMLButtonElement>('button[aria-label="Remove image"]')];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStoryboardVideoOptions.mockResolvedValue({ durations: [5] });
  mocks.searchReferencesAction.mockResolvedValue({ items: [] });
  // 编辑成功之后卡面用返回的那份 payload 更新自己 —— 这里演成「取下了 lib-1」。
  mocks.setShotReferences.mockResolvedValue({
    payload: {
      storyboardTitle: "Kaya jar launch",
      continuity: false,
      shots: [
        {
          shotId: SHOT_ID,
          index: 0,
          firstFramePrompt: "",
          videoPrompt: "slow push in",
          entityIds: ["ent-actor"],
          referenceGenerationIds: ["lib-2"],
        },
      ],
    },
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("creation §5 :178 —— 卡面挂图清单以 payload 为权威", () => {
  it("creation §5 :178: 一次 sync 都没发生,挂着的两张照旧画得出来、取得下来", async () => {
    await renderCard(payloadWithImages());

    // 草稿态分镜卡挂载时不发 sync —— 这一条正是上一版清单为空的原因。
    expect(mocks.syncStoryboardMedia).not.toHaveBeenCalled();
    expect(removeButtons()).toHaveLength(2);
  });

  it("creation §5 :178: 取下一张 ⇒ 交出去的是 payload 那份清单减掉这一张(不是空清单)", async () => {
    await renderCard(payloadWithImages());

    await act(async () => {
      removeButtons()[0]!.click();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.setShotReferences).toHaveBeenCalledTimes(1);
    expect(mocks.setShotReferences.mock.calls[0]![0]).toEqual({
      cardId: CARD_ID,
      index: 0,
      // 服务端收的是整份新清单:剩下的那一张必须在里面,否则它被静默顶掉。
      refs: ["generation:lib-2"],
    });
    // 编辑落地之后卡面跟着 payload 走 —— 只剩一张。
    expect(removeButtons()).toHaveLength(1);
  });
});
