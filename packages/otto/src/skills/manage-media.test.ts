import { describe, it, expect, vi } from "vitest";
import { executeManageMedia, manageMediaSkill, MEDIA_LIST_CAP } from "./manage-media.js";
import { executeImportMedia } from "./import-media.js";
import { executeRenderVideo } from "./render-video.js";
import type { OttoContext, EditorMediaClip } from "../context.js";

// W-B3-B (parity debts 16,17,18,24,25,26,39 / B0-12 + B0-14): manageMedia routes EVERY operation
// through the injected ctx.media port — thin closures over the same owner-gated $0 server actions
// the human asset-viewer / library UI uses. Tests mock the port and assert the skill's orchestration:
// routing, missing-param naming, the cancel-job "already started" honesty, and (with import + render
// ports) the M1 $0 sub-journey — all $0 by construction (a startGen spy that throws proves it).

type MediaPort = NonNullable<OttoContext["media"]>;

function makeCtx(over?: {
  media?: Partial<MediaPort>;
  mediaImport?: NonNullable<OttoContext["mediaImport"]>;
  render?: NonNullable<OttoContext["render"]>;
}): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    sourceGenerationId: null,
    // $0 tripwire: any skill in this file that reaches for spend fails the test loudly.
    startGen: () => {
      throw new Error("$0 skill must never call startGen");
    },
    ...(over?.media ? { media: over.media as MediaPort } : {}),
    ...(over?.mediaImport ? { mediaImport: over.mediaImport } : {}),
    ...(over?.render ? { render: over.render } : {}),
  } as unknown as OttoContext;
}

function clip(over: Partial<EditorMediaClip> = {}): EditorMediaClip {
  return { id: "c-1", src: "/files/h.mp4", kind: "video", seconds: 5, ...over };
}

describe("manageMedia registration hygiene", () => {
  it("instructions.ts carries the model-facing 'When to call' entry (REVIEWER-PLAYBOOK:107)", async () => {
    const { ottoInstructions } = await import("../instructions.js");
    expect(ottoInstructions).toContain("When to call \`manageMedia\`");
  });
});

describe("manageMedia gate", () => {
  it("free/write/internal → needsApproval false ($0 library surface, same as the human UI)", () => {
    expect(manageMediaSkill.cost).toBe("free");
    expect(manageMediaSkill.effect).toBe("write");
    expect(manageMediaSkill.reach).toBe("internal");
    expect(manageMediaSkill.needsApproval).toBe(false);
  });
});

describe("executeManageMedia — port required", () => {
  it("degrades gracefully when ctx.media is not injected", async () => {
    const res = await executeManageMedia({ action: "list" }, { context: makeCtx() });
    expect(res).toEqual({ ok: false, error: "The media library isn't available right now." });
  });
});

describe("list / load_more", () => {
  it("list returns clips and caps a busy project", async () => {
    const many = Array.from({ length: MEDIA_LIST_CAP + 3 }, (_, i) => clip({ id: `c-${i}` }));
    const list = vi.fn(async () => many);
    const res = (await executeManageMedia({ action: "list" }, { context: makeCtx({ media: { list } }) })) as {
      count: number; truncated: boolean; clips: unknown[];
    };
    expect(res.count).toBe(MEDIA_LIST_CAP + 3);
    expect(res.truncated).toBe(true);
    expect(res.clips).toHaveLength(MEDIA_LIST_CAP);
  });
  it("load_more passes the cursor and surfaces the page", async () => {
    const loadMore = vi.fn(async () => ({ items: [], nextCursor: "cur2", hasMore: true }));
    const res = await executeManageMedia({ action: "load_more", cursor: "cur1" }, { context: makeCtx({ media: { loadMore } }) });
    expect(loadMore).toHaveBeenCalledWith("cur1");
    expect(res).toEqual({ ok: true, items: [], nextCursor: "cur2", hasMore: true });
  });
  it("load_more surfaces port errors", async () => {
    const loadMore = vi.fn(async () => ({ error: "Invalid request." }));
    const res = await executeManageMedia({ action: "load_more" }, { context: makeCtx({ media: { loadMore } }) });
    expect(res).toEqual({ ok: false, error: "Invalid request." });
  });
});

describe("attach / detach / delete / discard — route to the shared actions", () => {
  it("attach needs both ids, then routes them", async () => {
    const attach = vi.fn(async () => ({ ok: true as const }));
    const ctx = makeCtx({ media: { attach } });
    const missing = (await executeManageMedia({ action: "attach", generationId: "g1" }, { context: ctx })) as { error: string };
    expect(missing.error).toContain("shotId");
    expect(await executeManageMedia({ action: "attach", generationId: "g1", shotId: "s1" }, { context: ctx })).toEqual({ ok: true });
    expect(attach).toHaveBeenCalledWith("g1", "s1");
  });
  it("detach routes the generation id + surfaces errors", async () => {
    const detach = vi.fn(async () => ({ error: "Generation is not attached." }));
    const res = await executeManageMedia({ action: "detach", generationId: "g1" }, { context: makeCtx({ media: { detach } }) });
    expect(res).toEqual({ ok: false, error: "Generation is not attached." });
    expect(detach).toHaveBeenCalledWith("g1");
  });
  it("delete (library soft-delete) routes the generation id", async () => {
    const remove = vi.fn(async () => ({ ok: true as const }));
    expect(await executeManageMedia({ action: "delete", generationId: "g1" }, { context: makeCtx({ media: { remove } }) })).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith("g1");
  });
  it("discard (candidate-zone hide) routes the generation id", async () => {
    const discard = vi.fn(async () => ({ ok: true as const }));
    expect(await executeManageMedia({ action: "discard", generationId: "g1" }, { context: makeCtx({ media: { discard } }) })).toEqual({ ok: true });
    expect(discard).toHaveBeenCalledWith("g1");
  });
  it("delete names the missing id", async () => {
    const res = (await executeManageMedia({ action: "delete" }, { context: makeCtx({ media: {} }) })) as { error: string };
    expect(res.error).toContain("generationId");
  });
});

describe("cancel_job — refund honesty (debt-39)", () => {
  it("reports a refund on a still-QUEUED job", async () => {
    const cancelJob = vi.fn(async () => ({ refunded: true as const }));
    const res = await executeManageMedia({ action: "cancel_job", jobId: "j1" }, { context: makeCtx({ media: { cancelJob } }) });
    expect(res).toEqual({ ok: true, refunded: true });
    expect(cancelJob).toHaveBeenCalledWith("j1");
  });
  it("reports 'already started' honestly (no refund, job runs on) — not an error", async () => {
    const cancelJob = vi.fn(async () => ({ alreadyStarted: true as const }));
    const res = await executeManageMedia({ action: "cancel_job", jobId: "j1" }, { context: makeCtx({ media: { cancelJob } }) });
    expect(res).toEqual({ ok: true, refunded: false, alreadyStarted: true });
  });
  it("surfaces a cancel error", async () => {
    const cancelJob = vi.fn(async () => ({ error: "That job isn't in this project." }));
    const res = await executeManageMedia({ action: "cancel_job", jobId: "j1" }, { context: makeCtx({ media: { cancelJob } }) });
    expect(res).toEqual({ ok: false, error: "That job isn't in this project." });
  });
});

// 锚 M1 $0 子旅程（组件级证据，Otto 执行器路径）：从 URL 引入一帧作图片参考（存新版本）→ 在库中可见
// → $0 导出。trim/crop 本身是 VISUAL 客户端操作（其 mock 已改 $0，见 media-editor-page.tsx），
// 服务端真值由既有 upload/render 动作测试承载；这里证明 Otto 执行器全程走 port、零 spend。
describe("M1 $0 sub-journey: import a frame → new version lands → visible → $0 export (Otto path)", () => {
  it("walks the media journey through the ports only — no startGen anywhere", async () => {
    const store: EditorMediaClip[] = [];
    let seq = 0;
    const mediaImport: NonNullable<OttoContext["mediaImport"]> = {
      fromUrl: async () => {
        const id = `gen-${++seq}`;
        store.push({ id, src: `/files/${id}.png`, kind: "image", seconds: 3 });
        return { ok: true, generationId: id };
      },
    };
    const media: MediaPort = {
      list: async () => [...store],
      loadMore: async () => ({ items: [], nextCursor: null, hasMore: false }),
      attach: async () => ({ ok: true }),
      detach: async () => ({ ok: true }),
      remove: async () => ({ ok: true }),
      discard: async (id) => {
        const i = store.findIndex((c) => c.id === id);
        if (i < 0) return { error: "Node not found." };
        store.splice(i, 1);
        return { ok: true };
      },
      cancelJob: async () => ({ refunded: true }),
    };
    const emptyCut = { clips: [], seconds: 0, captionCount: 0, music: null };
    const render: NonNullable<OttoContext["render"]> = {
      desk: async () => ({ media: [], cut: emptyCut, unreadable: false }),
      join: async () => ({ ok: true, cut: emptyCut }),
      music: async () => ({ ok: true, cut: emptyCut }),
      clearMusic: async () => ({ ok: true, cut: emptyCut }),
      addCaptions: async () => ({ ok: true, cut: emptyCut }),
      clearCaptions: async () => ({ ok: true, cut: emptyCut }),
      export: async () => ({ id: "render-1" }),
      jobs: async () => [],
      caption: async () => ({ id: "cap-1" }),
      captionJob: async () => null,
      transcript: async () => [],
    };
    const ctx = makeCtx({ media, mediaImport, render });

    // 1. 存新版本：import a frame from a URL → lands as an UPLOAD generation.
    const imported = (await executeImportMedia({ url: "https://cdn.example.com/frame.png" }, { context: ctx })) as {
      ok: boolean; generationId: string;
    };
    expect(imported.ok).toBe(true);

    // 2. 可见：the new version shows up in the project media.
    const listed = (await executeManageMedia({ action: "list" }, { context: ctx })) as { count: number; clips: EditorMediaClip[] };
    expect(listed.count).toBe(1);
    expect(listed.clips[0]?.id).toBe(imported.generationId);

    // 3. $0 导出：export the saved cut (ffmpeg concat — free).
    const exported = (await executeRenderVideo({ action: "export" }, { context: ctx })) as { ok: boolean; renderJobId: string };
    expect(exported).toEqual({ ok: true, renderJobId: "render-1" });

    // 4. discard the version — the library empties again.
    await executeManageMedia({ action: "discard", generationId: imported.generationId }, { context: ctx });
    const after = (await executeManageMedia({ action: "list" }, { context: ctx })) as { count: number };
    expect(after.count).toBe(0);
  });
});
