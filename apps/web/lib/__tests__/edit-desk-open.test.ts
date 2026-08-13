// @vitest-environment jsdom
/**
 * #780 判官 r1 → r2:剪辑台**打开的那一刻**,真组件真状态机。
 *
 * 这份文件补的是「双面围栏读源码、动作测试 mock 掉一切」留下的洞:下面三条缺陷,源码 `toContain`
 * 一条也看不见,因为它们全都发生在**组件自己的状态机**里 ——
 *   ① server action **reject**(数据库/网络断)时,原来没有 `catch/finally`,页面永远停在
 *      "Opening your video…";商家看到的是一个永不结束的承诺,连重试的门都没有。
 *   ② 存着但**读不出来**的 cut,原来被折叠成 null,屏幕上写 "Nothing in it yet" —— 拿未知
 *      冒充空,再点一次拼接就把读不出来的那份 JSON 覆盖掉。
 *   ③ 导出**活得比这个页面久**:Otto 发起的导出、关页后跑完的导出,重开剪辑台一概看不见。
 *
 * 所以这里被测的是组件本身:只有它调用的 server actions 是假件(浏览器里本来也只有这层),
 * React、按钮、状态、effect 全是真的。断言全部落在**商家眼睛看得到的东西**上。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEditDesk: vi.fn(),
  joinClipsIntoCut: vi.fn(),
  setCutMusic: vi.fn(),
  clearCutMusic: vi.fn(),
  addCaptionsToClip: vi.fn(),
  clearCutCaptions: vi.fn(),
  exportSavedCut: vi.fn(),
  startCaption: vi.fn(),
  getCaptionJob: vi.fn(),
  getRenderJobs: vi.fn(),
}));

vi.mock("@/lib/edit-desk-actions", () => ({
  getEditDesk: mocks.getEditDesk,
  joinClipsIntoCut: mocks.joinClipsIntoCut,
  setCutMusic: mocks.setCutMusic,
  clearCutMusic: mocks.clearCutMusic,
  addCaptionsToClip: mocks.addCaptionsToClip,
  clearCutCaptions: mocks.clearCutCaptions,
  exportSavedCut: mocks.exportSavedCut,
}));
vi.mock("@/lib/actions", () => ({
  startCaption: mocks.startCaption,
  getCaptionJob: mocks.getCaptionJob,
  getRenderJobs: mocks.getRenderJobs,
}));
vi.mock("@/lib/direct-upload", () => ({ uploadFilesDirect: vi.fn() }));
vi.mock("@/lib/upload-actions", () => ({ finalizeCandidateUploads: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { EditDesk } = await import("@/components/otto/edit/EditDesk");

const OWNER = "org_a";
const hash = (n: number) => String(n).repeat(64).slice(0, 64);
const src = (n: number, ext = "mp4") => `/files/u/${OWNER}/${hash(n)}.${ext}`;

const EMPTY_CUT = { clips: [], seconds: 0, captionCount: 0, music: null };
const ONE_CLIP_CUT = {
  clips: [{ src: src(1), kind: "video" as const, seconds: 6 }],
  seconds: 6,
  captionCount: 0,
  music: null,
};
const MEDIA = [{ src: src(1), kind: "video" as const, seconds: 6, label: "our new chilli sauce" }];

let container: HTMLDivElement;
let root: Root;

/** Mount the real desk and let its deferred first load settle. */
async function open() {
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(EditDesk, { projectId: "prj_1" }));
  });
  await settle();
}

/** Let queueMicrotask + the awaited actions inside it run to completion. */
async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`no button reading "${label}" — screen says: ${container.textContent}`);
  return found as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRenderJobs.mockResolvedValue([]);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("the first load can fail, and the desk has to survive it", () => {
  it("a rejected load ends the wait, says so, and offers the way back", async () => {
    mocks.getEditDesk.mockRejectedValueOnce(new Error("connection lost"));
    await open();

    // the defect: setLoading(false) sat after the await, so a rejection never reached it
    expect(container.textContent).not.toContain("Opening your video");
    expect(container.textContent).toContain("couldn't open your video");
    // and nothing is claimed about their work while we can't read it
    expect(container.textContent).toContain("Nothing has been changed");
  });

  it("Try again really re-opens it — the failure is not a dead end", async () => {
    mocks.getEditDesk
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce({ media: MEDIA, cut: ONE_CLIP_CUT, unreadable: false });
    await open();

    await act(async () => { button("Try again").click(); });
    await settle();

    expect(mocks.getEditDesk).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("our new chilli sauce");
    expect(container.textContent).not.toContain("couldn't open your video");
  });

  it("a refusal from the server is shown as itself, and still ends the wait", async () => {
    mocks.getEditDesk.mockResolvedValueOnce({ error: "Project not found." });
    await open();
    expect(container.textContent).not.toContain("Opening your video");
    expect(container.textContent).toContain("Project not found.");
  });
});

describe("a cut we can't read is shown as unknown, never as empty", () => {
  beforeEach(async () => {
    mocks.getEditDesk.mockResolvedValue({ media: MEDIA, cut: EMPTY_CUT, unreadable: true });
    await open();
  });

  it("says it can't be read instead of 'Nothing in it yet'", () => {
    expect(container.textContent).toContain("can't read what's saved here");
    expect(container.textContent).not.toContain("Nothing in it yet");
    expect(container.textContent).toContain("nothing has been thrown away");
  });

  it("every button that would WRITE over it is off", () => {
    expect(button("Join into one video").disabled).toBe(true);
    expect(button("Export video").disabled).toBe(true);
  });
});

describe("an export outlives the page, so the desk picks it back up", () => {
  it("a finished export from before is offered without pressing Export again", async () => {
    mocks.getEditDesk.mockResolvedValue({ media: MEDIA, cut: ONE_CLIP_CUT, unreadable: false });
    mocks.getRenderJobs.mockResolvedValue([
      { id: "rj_9", status: "DONE", progress: 100, error: null, createdAt: "2026-08-12T00:00:00.000Z", url: src(2) },
    ]);
    await open();

    expect(container.textContent).toContain("Ready");
    const link = container.querySelector(`a[href="${src(2)}"]`);
    expect(link, "a finished export had nowhere to be opened from").not.toBeNull();
    // it was restored, not started: pressing Export again would have been refused anyway
    expect(mocks.exportSavedCut).not.toHaveBeenCalled();
  });

  it("an export still running shows its progress on open", async () => {
    mocks.getEditDesk.mockResolvedValue({ media: MEDIA, cut: ONE_CLIP_CUT, unreadable: false });
    mocks.getRenderJobs.mockResolvedValue([
      { id: "rj_10", status: "RENDERING", progress: 42, error: null, createdAt: "2026-08-12T00:00:00.000Z", url: null },
    ]);
    await open();

    expect(container.textContent).toContain("rendering");
    expect(container.textContent).toContain("42%");
  });

  it("no export yet means no export strip — nothing is invented", async () => {
    mocks.getEditDesk.mockResolvedValue({ media: MEDIA, cut: ONE_CLIP_CUT, unreadable: false });
    await open();
    expect(container.textContent).not.toContain("Ready");
    expect(container.querySelector("a")).toBeNull();
  });

  it("an export strip we can't read doesn't take the whole desk down with it", async () => {
    mocks.getEditDesk.mockResolvedValue({ media: MEDIA, cut: ONE_CLIP_CUT, unreadable: false });
    mocks.getRenderJobs.mockRejectedValue(new Error("jobs unavailable"));
    await open();
    // the desk still opened, and it did not claim an export state it never read
    expect(container.textContent).toContain("our new chilli sauce");
    expect(container.textContent).not.toContain("Ready");
  });
});
