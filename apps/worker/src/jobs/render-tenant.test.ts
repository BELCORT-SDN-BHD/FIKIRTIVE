/**
 * render-tenant.test.ts — #780 判官 r1 的 P0,最后一环:**worker 取件前的属主校验**。
 *
 * 那个缺陷的完整形状是:`saveProjectEdit` 收下客户端手写的 timeline JSON,契约只校验 src 的
 * **形状**(`/files/u/<owner>/<hash>`)而从不问 owner 段是谁,于是别家租户的 key 能进我的 cut。
 * 而这里是那条链的终点:worker 拿 `RenderJob.editJson` 里的每个 src 去 `storage.ffmpegInput`
 * **真的取文件**,再把结果以 `job.ownerId` 的名义存成资产 —— 别人的素材就这样被复制成了我的成片。
 *
 * 所以这份测试只问一件事,而且是**行为**不是文案:出现外租户 key 时,`ffmpegInput` 有没有被调用过。
 * 那一次调用就是泄露本身;它没发生,泄露就没发生。web 那半(写入口 + startRender,真库双租户)在
 * `apps/web/lib/__tests__/edit-desk-tenant-chain.test.ts`。
 *
 * 与本目录其它 job 测试同规矩:prisma 与子进程是替身,被测物 `handleRender` 与契约是真的。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const renderJobFindUnique = vi.fn();
  const renderJobUpdateMany = vi.fn();
  const renderJobUpdate = vi.fn();
  const assetUpsert = vi.fn();
  const execa = vi.fn();
  const probeFile = vi.fn();
  const ffmpegInput = vi.fn();
  const put = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    renderJob: { findUnique: renderJobFindUnique, updateMany: renderJobUpdateMany, update: renderJobUpdate },
    asset: { upsert: assetUpsert },
  };
  return { prisma, renderJobFindUnique, renderJobUpdateMany, renderJobUpdate, assetUpsert, execa, probeFile, ffmpegInput, put };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma }));
vi.mock("@fikirtive/db/principal", () => ({
  runAsSystem: (_name: string, fn: () => Promise<unknown>) => fn(),
  runAsTenant: (_ownerId: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../storage.js", () => ({ storage: { ffmpegInput: m.ffmpegInput, put: m.put } }));
vi.mock("./ingest.js", () => ({ probeFile: m.probeFile }));
vi.mock("execa", () => ({ execa: m.execa }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  readFile: vi.fn(async () => Buffer.alloc(0)),
  writeFile: vi.fn(async () => undefined),
}));

import { FOREIGN_MEDIA_MESSAGE, RENDER_RETRY_LIMIT, storageKey, storageKeyToSrc } from "@fikirtive/core";
import { handleRender } from "./render.js";

const MINE = "org-mine";
const THEIRS = "org-theirs";

const src = (ownerId: string, seed: string) =>
  storageKeyToSrc(storageKey(ownerId, seed.repeat(64).slice(0, 64), "mp4"));

const MY_CLIP = src(MINE, "a");
const THEIR_CLIP = src(THEIRS, "b");
const THEIR_SONG = storageKeyToSrc(storageKey(THEIRS, "c".repeat(64), "mp3"));

/** A cut that PARSES clean: the contract has no opinion on whose owner segment a src carries. */
function cut(visual: string, music?: string) {
  return {
    timeline: {
      background: "#000000",
      tracks: [
        { clips: [{ asset: { type: "video", src: visual }, start: 0, length: 5 }] },
        ...(music
          ? [{ clips: [{ asset: { type: "audio", src: music }, start: 0, length: 5 }], audioRole: "music" }]
          : []),
      ],
    },
    output: { format: "mp4", resolution: "hd", aspectRatio: "16:9", fps: 25 },
  };
}

/** The job row as the queue hands it over: it names the owner this render is FOR. */
function jobRow(editJson: object) {
  return { id: "rj1", ownerId: MINE, projectId: "prj1", status: "QUEUED", editJson };
}

/** The status/error actually written to the row (what the merchant and admin read). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function persisted(): any {
  const call = m.renderJobUpdate.mock.calls.at(-1);
  expect(call, "expected the job row to have been settled").toBeDefined();
  return (call![0] as { data: unknown }).data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.renderJobUpdateMany.mockResolvedValue({ count: 1 }); // the claim succeeds
  m.renderJobUpdate.mockResolvedValue({});
  m.ffmpegInput.mockResolvedValue("/tmp/in.mp4");
  m.probeFile.mockResolvedValue({ hasAudio: true, durationS: 5 });
  m.execa.mockRejectedValue(new Error("ffmpeg is not run in this test"));
});

describe("the worker refuses to fetch a file that is not this job owner's", () => {
  it("a stored cut naming another tenant's clip never reaches storage at all", async () => {
    m.renderJobFindUnique.mockResolvedValue(jobRow(cut(THEIR_CLIP)));

    await expect(handleRender({ renderJobId: "rj1" })).rejects.toThrow();

    // THE assertion: one call here is the leak. Their bytes were never opened.
    expect(m.ffmpegInput).not.toHaveBeenCalled();
    expect(m.execa).not.toHaveBeenCalled();
    expect(m.assetUpsert).not.toHaveBeenCalled(); // and nothing was copied out under MY name
  });

  it("the same when only the MUSIC bed is theirs — a bed is a file we would have fetched too", async () => {
    m.renderJobFindUnique.mockResolvedValue(jobRow(cut(MY_CLIP, THEIR_SONG)));

    await expect(handleRender({ renderJobId: "rj1" })).rejects.toThrow();

    // not "rendered without the bed": the whole document is refused, so my own clip
    // is not fetched either
    expect(m.ffmpegInput).not.toHaveBeenCalled();
    expect(m.assetUpsert).not.toHaveBeenCalled();
  });

  it("what is written on the row is honest and gives away no address", async () => {
    m.renderJobFindUnique.mockResolvedValue(jobRow(cut(THEIR_CLIP)));

    await expect(handleRender({ renderJobId: "rj1" }, RENDER_RETRY_LIMIT)).rejects.toThrow();

    const data = persisted();
    expect(data.status).toBe("FAILED"); // last delivery → terminal, not an endless retry
    expect(data.error).toBe(FOREIGN_MEDIA_MESSAGE);
    expect(data.error).not.toContain(THEIRS); // the persisted error is merchant-visible
    expect(data.error).not.toContain("/files/");
  });

  it("and the merchant's OWN cut is still fetched — the guard blocks the neighbour, not the work", async () => {
    m.renderJobFindUnique.mockResolvedValue(jobRow(cut(MY_CLIP)));

    // ffmpeg itself is stubbed to blow up: what this pins is that the guard let us get
    // as far as opening my own file, so a guard that refused everything would fail here.
    await expect(handleRender({ renderJobId: "rj1" })).rejects.toThrow();

    expect(m.ffmpegInput).toHaveBeenCalledTimes(1);
    expect(m.ffmpegInput).toHaveBeenCalledWith(`u/${MINE}/${"a".repeat(64)}.mp4`);
    expect(persisted().error).not.toBe(FOREIGN_MEDIA_MESSAGE);
  });
});
