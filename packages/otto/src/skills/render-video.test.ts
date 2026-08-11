import { describe, it, expect, vi } from "vitest";
import { executeRenderVideo, renderVideoSkill } from "./render-video.js";
import type { OttoContext } from "../context.js";

// W-B3-B (parity debts 19,20,21,22,23 / B0-13): renderVideo routes EVERY operation through the
// injected ctx.render port — thin closures over the same owner-gated $0 server actions the human
// media-editor uses (startRender / getRenderJobs / startCaption / getCaptionJob / getTranscript).
// $0 by construction: ffmpeg concat + whisper, never a GenJob (a startGen spy that throws proves it).

type RenderPort = NonNullable<OttoContext["render"]>;

function makeCtx(render?: Partial<RenderPort>): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    sourceGenerationId: null,
    startGen: () => {
      throw new Error("$0 skill must never call startGen");
    },
    ...(render ? { render: render as RenderPort } : {}),
  } as unknown as OttoContext;
}

describe("renderVideo registration hygiene", () => {
  it("instructions.ts carries the model-facing 'When to call' entry", async () => {
    const { ottoInstructions } = await import("../instructions.js");
    expect(ottoInstructions).toContain("When to call \`renderVideo\`");
  });
});

describe("renderVideo gate", () => {
  it("free/write/internal → needsApproval false ($0 export/caption, same as the human editor)", () => {
    expect(renderVideoSkill.cost).toBe("free");
    expect(renderVideoSkill.effect).toBe("write");
    expect(renderVideoSkill.reach).toBe("internal");
    expect(renderVideoSkill.needsApproval).toBe(false);
  });
});

describe("executeRenderVideo — port required", () => {
  it("degrades gracefully when ctx.render is not injected", async () => {
    const res = await executeRenderVideo({ action: "export" }, { context: makeCtx() });
    expect(res).toEqual({ ok: false, error: "The editor isn't available right now." });
  });
});

describe("export — renders the SAVED cut", () => {
  it("returns the render job id", async () => {
    const exp = vi.fn(async () => ({ id: "r1" }));
    const res = await executeRenderVideo({ action: "export" }, { context: makeCtx({ export: exp }) });
    expect(res).toEqual({ ok: true, renderJobId: "r1" });
  });
  it("surfaces the 'no saved cut' error honestly", async () => {
    const exp = vi.fn(async () => ({ error: "There's no saved cut to export yet — build one in the editor first." }));
    const res = (await executeRenderVideo({ action: "export" }, { context: makeCtx({ export: exp }) })) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("no saved cut");
  });
});

// #780 — the building half. Otto asks for the same three things a merchant can do by hand
// (join / captions / music), through the same actions; nothing here assembles a cut itself.
describe("desk / join / music — the merchant's own moves, asked for in words", () => {
  const cut = { clips: [{ src: "/files/a.mp4", kind: "video" as const, seconds: 4 }], seconds: 4, captionCount: 0, music: null };

  it("desk reports what they have — by the name the merchant gave it — and what the video holds", async () => {
    const desk = vi.fn(async () => ({
      media: [{ src: "/files/a.mp4", kind: "video" as const, seconds: 4, label: "our new sauce" }],
      cut,
    }));
    const res = (await executeRenderVideo({ action: "desk" }, { context: makeCtx({ desk }) })) as {
      ok: boolean; media: { label: string }[]; cut: unknown;
    };
    expect(res.ok).toBe(true);
    // Otto must be able to SAY which clip it means; a content hash is not a name
    expect(res.media.map((m) => m.label)).toEqual(["our new sauce"]);
    expect(res.cut).toEqual(cut);
  });

  it("join needs the clips, and passes the ORDER through untouched", async () => {
    const join = vi.fn(async () => ({ ok: true as const, cut }));
    const ctx = makeCtx({ join });
    const missing = (await executeRenderVideo({ action: "join" }, { context: ctx })) as { error: string };
    expect(missing.error).toContain("srcs");
    await executeRenderVideo({ action: "join", srcs: ["/files/b.mp4", "/files/a.mp4"] }, { context: ctx });
    expect(join).toHaveBeenCalledWith(["/files/b.mp4", "/files/a.mp4"]);
  });

  it("music and add_captions each name one clip; both have an exit", async () => {
    const music = vi.fn(async () => ({ ok: true as const, cut }));
    const clearMusic = vi.fn(async () => ({ ok: true as const, cut }));
    const addCaptions = vi.fn(async () => ({ ok: true as const, cut }));
    const clearCaptions = vi.fn(async () => ({ ok: true as const, cut }));
    const ctx = makeCtx({ music, clearMusic, addCaptions, clearCaptions });

    expect(((await executeRenderVideo({ action: "music" }, { context: ctx })) as { error: string }).error).toContain("src");
    expect(((await executeRenderVideo({ action: "add_captions" }, { context: ctx })) as { error: string }).error).toContain("src");

    await executeRenderVideo({ action: "music", src: "/files/song.mp3" }, { context: ctx });
    await executeRenderVideo({ action: "clear_music" }, { context: ctx });
    await executeRenderVideo({ action: "add_captions", src: "/files/a.mp4" }, { context: ctx });
    await executeRenderVideo({ action: "clear_captions" }, { context: ctx });
    expect(music).toHaveBeenCalledWith("/files/song.mp3");
    expect(clearMusic).toHaveBeenCalled();
    expect(addCaptions).toHaveBeenCalledWith("/files/a.mp4");
    expect(clearCaptions).toHaveBeenCalled();
  });

  it("a refusal from the action layer reaches the merchant unchanged — never re-worded here", async () => {
    const join = vi.fn(async () => ({ error: "Music goes under the video, not in it — pick videos or images to join, then add music." }));
    const res = (await executeRenderVideo({ action: "join", srcs: ["/files/song.mp3"] }, { context: makeCtx({ join }) })) as {
      ok: boolean; error: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Music goes under the video");
  });
});

describe("jobs / caption / caption_job / transcript", () => {
  it("jobs returns the render strip", async () => {
    const jobs = vi.fn(async () => [
      { id: "r1", status: "DONE", progress: 100, error: null, createdAt: "2026-07-13T00:00:00Z", url: "/files/x.mp4" },
    ]);
    const res = (await executeRenderVideo({ action: "jobs" }, { context: makeCtx({ jobs }) })) as { count: number; jobs: unknown[] };
    expect(res.count).toBe(1);
  });
  it("caption needs a src, then dispatches", async () => {
    const caption = vi.fn(async () => ({ id: "c1" }));
    const ctx = makeCtx({ caption });
    const missing = (await executeRenderVideo({ action: "caption" }, { context: ctx })) as { error: string };
    expect(missing.error).toContain("src");
    const res = await executeRenderVideo({ action: "caption", src: "/files/x.mp4" }, { context: ctx });
    expect(res).toEqual({ ok: true, captionJobId: "c1" });
    expect(caption).toHaveBeenCalledWith("/files/x.mp4");
  });
  it("caption_job polls; not-found is honest", async () => {
    const captionJob = vi.fn(async () => null);
    const res = await executeRenderVideo({ action: "caption_job", jobId: "c1" }, { context: makeCtx({ captionJob }) });
    expect(res).toEqual({ ok: false, error: "Caption job not found." });
  });
  it("transcript returns the cached cues", async () => {
    const transcript = vi.fn(async () => [{ startMs: 0, lengthMs: 1000, text: "hi" }]);
    const res = (await executeRenderVideo({ action: "transcript", src: "/files/x.mp4" }, { context: makeCtx({ transcript }) })) as {
      count: number; cues: unknown[];
    };
    expect(res.count).toBe(1);
    expect(transcript).toHaveBeenCalledWith("/files/x.mp4");
  });
});
