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
const { UPLOAD_EXTS, mimeOf } = await import("@fikirtive/core/upload");

/** 从 core **枚举**,不手抄:服务端会落 audio/* 的那些扩展名,和其余全部。
 *  有人往守卫白名单里加一个 mp4,下面的拒绝用例会直接红。 */
const AUDIO_EXTS = UPLOAD_EXTS.filter((ext) => mimeOf(ext).startsWith("audio/"));
const NON_AUDIO_EXTS = UPLOAD_EXTS.filter((ext) => !mimeOf(ext).startsWith("audio/"));
const { finalizeCandidateUploads } = await import("@/lib/upload-actions");
const { uploadFilesDirect } = await import("@/lib/direct-upload");

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

/**
 * MONEY-A9 §7.3 —— 配乐入口的类型守卫。
 *
 * 这个入口按规格「现仅收 audio」被单列**豁免**:它不挂那行价目小字。整条豁免立在
 * 「这里进不来会被计费的 image/video」之上,而在这之前那句话只靠选择器上的 accept="audio/*"
 * 撑着 —— accept 是文件选择框的过滤**建议**,不是校验。商家把系统弹窗的筛选改成「所有文件」
 * 选了一张图,它就会以 UPLOAD image 素材落盘、被自动理解计费:一笔他在任何屏幕上都没见过
 * 价目的钱。所以这里钉的是**行为**:非音频根本走不到 finalize。
 */
describe("MONEY-A9 配乐入口只收音频 —— 豁免的前提必须自己成立", () => {
  /** 直接驱动那个隐藏的 type="file" 输入框,和商家在选择框里点确定是同一条路。 */
  async function pick(name: string, type: string) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error(`no file input — screen says: ${container.textContent}`);
    const file = new File([new Uint8Array([1, 2, 3])], name, { type });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: { 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) },
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
  }

  beforeEach(() => {
    mocks.getEditDesk.mockResolvedValue({ media: MEDIA, cut: ONE_CLIP_CUT, unreadable: false });
  });

  it("选了一张图:不上传、不结算,屏幕上说清为什么", async () => {
    await open();
    await pick("poster.png", "image/png");

    expect(vi.mocked(uploadFilesDirect), "非音频文件仍然被送去上传了").not.toHaveBeenCalled();
    expect(
      vi.mocked(finalizeCandidateUploads),
      "非音频文件仍然走到了 finalize —— 那就会落一条会被理解计费的 UPLOAD 素材",
    ).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Only audio files can be added here.");
  });

  it("扩展名是硬条件:内容是图、名字是 .png、而浏览器报 audio/mpeg —— 必须拒", async () => {
    // 这是真能走通的一条绕过:只看 MIME 就放行,服务端对**图片扩展名**才读字节,
    // 于是它被判成 image/png 落盘、被建收费理解行,而这个入口按豁免是不披露的。
    await open();
    await pick("poster.png", "audio/mpeg");

    expect(vi.mocked(uploadFilesDirect), "谎报 audio/mpeg 的 .png 被放行了").not.toHaveBeenCalled();
    expect(
      vi.mocked(finalizeCandidateUploads),
      "谎报 audio/mpeg 的 .png 走到了 finalize —— 它会落成 image 素材并被计费",
    ).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Only audio files can be added here.");
  });

  // ── 拒绝面:从 core 枚举出的**每一个非音频扩展名** × 三种 MIME 说法 ──────────────
  // 三种说法都要拒,因为扩展名才是硬条件:服务端对非图片扩展名不读字节、直接按扩展名落
  // MIME,所以只要扩展名不是音频,这个文件到了服务端就会变成 image/* 或 video/*,
  // 被建成收费理解行 —— 而这个入口按豁免是不挂披露的。
  const REJECTION_CASES = NON_AUDIO_EXTS.flatMap((ext) => [
    [`clip.${ext}`, "", `${ext}:浏览器不给 MIME`] as const,
    [`clip.${ext}`, mimeOf(ext), `${ext}:老实报的 ${mimeOf(ext)}`] as const,
    [`clip.${ext}`, "audio/mpeg", `${ext}:谎报成 audio/mpeg`] as const,
  ]);

  it.each(REJECTION_CASES)("非音频必须拒:%s(type=%s,%s)", async (name, type) => {
    await open();
    await pick(name, type);

    expect(vi.mocked(uploadFilesDirect), `${name} 被放行了`).not.toHaveBeenCalled();
    expect(
      vi.mocked(finalizeCandidateUploads),
      `${name} 走到了 finalize —— 它会落成会被理解计费的素材,而这个入口不挂披露`,
    ).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Only audio files can be added here.");
  });

  // ── 放行面:从 core 枚举出的**每一个音频扩展名** ────────────────────────────────
  it.each(AUDIO_EXTS)("真音频不该被误拦:track.%s(浏览器不给 MIME)", async (ext) => {
    vi.mocked(uploadFilesDirect).mockResolvedValue({ files: [], failures: [] } as never);
    vi.mocked(finalizeCandidateUploads).mockResolvedValue({ error: "stop here" } as never);
    await open();
    await pick(`track.${ext}`, "");

    expect(vi.mocked(uploadFilesDirect), `track.${ext} 被误拦了`).toHaveBeenCalled();
    expect(container.textContent).not.toContain("Only audio files can be added here.");
  });

  // ── 已知容器误报:这几条不在 core 里,是浏览器的脾气,只能人写 ──────────────────
  it.each([
    ["theme.m4a", "video/mp4", "m4a 装在 MP4 容器里"],
    ["theme.aac", "video/mp4", "aac 同上"],
    ["track.flac", "application/octet-stream", "浏览器没意见"],
    ["track.wav", "audio/wav", "老实报的"],
  ])("真音频不该被误拦:%s(type=%s,%s)", async (name, type) => {
    vi.mocked(uploadFilesDirect).mockResolvedValue({ files: [], failures: [] } as never);
    vi.mocked(finalizeCandidateUploads).mockResolvedValue({ error: "stop here" } as never);
    await open();
    await pick(name, type);

    expect(vi.mocked(uploadFilesDirect), `${name} 被误拦了`).toHaveBeenCalled();
    expect(container.textContent).not.toContain("Only audio files can be added here.");
  });

  it("枚举面本身不许塌掉:音频与非音频两组都得有东西", () => {
    expect(AUDIO_EXTS.length, "core 里一个音频扩展名都没枚举到 —— 上面的放行用例会全部空跑").toBeGreaterThan(0);
    expect(NON_AUDIO_EXTS.length, "core 里一个非音频扩展名都没枚举到 —— 拒绝用例会全部空跑").toBeGreaterThan(0);
  });
});
