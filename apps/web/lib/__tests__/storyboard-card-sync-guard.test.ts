// @vitest-environment jsdom
/**
 * #926 (判官 r18 钉的时序) — StoryboardCard 的 sync 轮询在**成功**答复上守着 seq/epoch
 * （resolveSyncAnswer，一份过期请求的答案不许被采纳、也不许拿来下结论），但**失败**答复
 * 完全绕过了这道门：runSyncOnce 里 `if ("error" in res) return false;` 与 `catch { return
 * false; }` 都是无条件的，不管这份失败是不是对着一个早就作废的问题。
 *
 * 判官钉出的可复现时序：
 *   1. S1（挂载时自动发出的 sync）先发，卡在网络上没回来。
 *   2. S2（商家点「Check for updates」手动发出）后发先回——服务端说还有活作业在跑，
 *      于是卡面设 generating=true、syncPhase="fast"，轮询定时器启动。
 *   3. S1 终于回来了，但是失败（网络错误 / 服务端 { error }）。这份答案对着的问题早就
 *      被 S2 取代了（syncSeqRef 已经往前走了一格），却仍然被当真：StoryboardCard.tsx 的
 *      `reconcileOnce` 在 stillPending=false 时只把 `syncPhase` 设回 "off"，不清
 *      `generating`（约 :427 `else setSyncPhase("off");`）。
 *   4. `syncPhase` 从 "fast" 变成 "off" 触发轮询 useEffect 的清理，S2 刚启动的定时器被
 *      clearInterval 掉；`generating` 留在 true 上，再也没有谁会把它改回 false —— 编辑被
 *      `editLocked = generating` 锁住（:230），刷新按钮被 `disabled={busy || generating}`
 *      锁住（:1127附近），商家只剩整页重载一条路。
 *
 * 两条用例：
 *   ①（红先行）复现判官时序——过期请求（S1）的失败必须被当作「不知道，别下结论」，不许
 *      把一个活着的轮询关掉。
 *   ② 镜像时序——只有「最新、没有过期」的那一份失败,才允许真的把 phase 降级,而且降级
 *      必须**同步**清掉 generating,商家才真的拿回操作权,不是嘴上说不轮询了但界面仍锁死。
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
  coworkGenerate: vi.fn(),
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
}));
vi.mock("@/lib/cowork-actions", () => ({ coworkGenerate: mocks.coworkGenerate }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { StoryboardCard } = await import("@/components/otto/StoryboardCard");

const CARD_ID = "card-1";
const SHOT_ID = "shot-1";

/** One shot with a prepared-but-unfinished first frame (`firstFrameCardId` set, no
 *  `firstFrameGenerationId` yet) — the shape `openingState` reads as "in-progress", which is
 *  exactly what makes `needsRefreshEntrance` true at mount and fires the automatic S1 sync. */
function payload() {
  return {
    storyboardTitle: "Test storyboard",
    continuity: false,
    shots: [
      {
        shotId: SHOT_ID,
        index: 0,
        firstFramePrompt: "opening frame",
        videoPrompt: "camera pans across the room",
        firstFrameCardId: "child-frame-1",
      },
    ],
  };
}

/** A live job the server is still working on — the only shape that keeps the watch open. */
function stillGeneratingReport() {
  return {
    payload: payload(),
    shots: [
      {
        shotId: SHOT_ID,
        frame: { status: { kind: "generating" } },
        video: { status: { kind: "absent" } },
      },
    ],
  };
}

function deferredPromise<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderCard(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(StoryboardCard, { cardId: CARD_ID, payload: payload(), balanceUsd: 100 }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function findButton(text: string): HTMLButtonElement | undefined {
  return [...container!.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent?.includes(text),
  );
}

function editButton(): HTMLButtonElement {
  const el = container!.querySelector<HTMLButtonElement>('button[aria-label="Edit shot"]');
  expect(el, "the per-shot Edit button must be present").not.toBeNull();
  return el!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStoryboardVideoOptions.mockResolvedValue({ durations: [5] });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("#926 — a sync failure must clear the same seq/epoch bar a sync success clears", () => {
  it(
    "does not lock the card (generating=true, phase=off, timer dead) when a STALE mount " +
      "sync fails AFTER a newer manual refresh already found live work",
    async () => {
      vi.useFakeTimers();
      const mountDeferred = deferredPromise<unknown>();
      const manualDeferred = deferredPromise<unknown>();
      let calls = 0;
      mocks.syncStoryboardMedia.mockImplementation(() => {
        calls += 1;
        if (calls === 1) return mountDeferred.promise; // S1 — mount, blocked
        if (calls === 2) return manualDeferred.promise; // S2 — manual, answers first
        return Promise.resolve(stillGeneratingReport()); // any poll tick after that
      });

      await renderCard();
      expect(mocks.syncStoryboardMedia, "mount must fire S1 automatically").toHaveBeenCalledTimes(1);

      // S2: the merchant's own "Check for updates", fired while S1 is still in the air.
      const refresh = findButton("Check for updates");
      expect(refresh, "a refresh entrance must be offered before either sync answers").toBeDefined();
      await act(async () => {
        refresh!.click();
      });
      expect(mocks.syncStoryboardMedia).toHaveBeenCalledTimes(2);

      // S2 resolves FIRST — live work is pending, so the card starts watching.
      await act(async () => {
        manualDeferred.resolve(stillGeneratingReport());
        await manualDeferred.promise;
        await Promise.resolve();
      });
      expect(container!.textContent, "S2 must have opened the watch").toContain("Working");

      // S1 (the STALE mount request) now fails.
      await act(async () => {
        mountDeferred.resolve({ error: "boom" });
        await mountDeferred.promise.catch(() => undefined);
        await Promise.resolve();
      });

      // The stale failure must not have concluded anything: the watch S2 opened must still be
      // alive. Prove it structurally (not just "still says Working") — advance past one poll
      // interval and confirm the timer actually fires another request. On the unfixed code the
      // stale failure flips syncPhase to "off", which tears the timer down; this assertion is
      // the one that goes RED there (call count never grows) and GREEN after the fix.
      const callsBeforeTick = mocks.syncStoryboardMedia.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });
      expect(
        mocks.syncStoryboardMedia.mock.calls.length,
        "the poll timer must not be dead — a stale failure may not conclude anything",
      ).toBeGreaterThan(callsBeforeTick);
    },
  );
});

describe("#926 — only the LATEST request's failure may give up, and giving up must fully unlock the card", () => {
  it("clears both generating and syncPhase when the newest (non-stale) request is the one that fails", async () => {
    const mountDeferred = deferredPromise<unknown>();
    const manualDeferred = deferredPromise<unknown>();
    let calls = 0;
    mocks.syncStoryboardMedia.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return mountDeferred.promise; // S1 — mount, blocked
      if (calls === 2) return manualDeferred.promise; // S2 — manual, blocked too
      return Promise.reject(new Error("no third sync expected in this test"));
    });

    await renderCard();
    const refresh = findButton("Check for updates");
    expect(refresh, "a refresh entrance must be offered").toBeDefined();
    // S2 fires while generating is still false (S1 hasn't answered yet — refreshNow's own
    // guard would block it otherwise).
    await act(async () => {
      refresh!.click();
    });
    expect(mocks.syncStoryboardMedia).toHaveBeenCalledTimes(2);

    // S1 (older) answers first — stale relative to S2 by request number, so (already-correct,
    // pre-#926 rule) it may not conclude anything either way, but a "still pending" verdict is
    // harmless to apply either way and this is what starts the watch here.
    await act(async () => {
      mountDeferred.resolve(stillGeneratingReport());
      await mountDeferred.promise;
      await Promise.resolve();
    });
    expect(container!.textContent, "generating must be true once a live job is reported").toContain(
      "Working",
    );
    expect(editButton().disabled, "editing must be locked while generating").toBe(true);

    // S2 — the LATEST request, nothing was issued after it — now fails for real.
    await act(async () => {
      manualDeferred.resolve({ error: "boom" });
      await manualDeferred.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(
      container!.textContent,
      "the latest request's own failure must clear the generating claim",
    ).not.toContain("Working");
    expect(editButton().disabled, "editing must unlock once the latest request gives up").toBe(false);
    const refreshAfter = findButton("Check for updates");
    expect(refreshAfter, "a manual retry entrance must still be offered").toBeDefined();
    expect(refreshAfter!.disabled, "the refresh button itself must not stay disabled").toBe(false);
  });
});
