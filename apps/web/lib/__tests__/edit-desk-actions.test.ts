/**
 * #780 — the shared action layer behind the edit desk and Otto.
 *
 * What these assertions are for, in order of what would hurt most if it broke:
 *  · a clip is named by a URL the browser sends, so the ONLY thing standing between a forged
 *    src and someone else's footage is the owner check here — asserted as "the database was
 *    never even asked", not as "an error came back";
 *  · what gets PERSISTED is the contract's own document (the worker re-parses it), so the
 *    tests read the row that would be written, not the return value;
 *  · two writers on one video (a second tab, or Otto while the merchant clicks) must not
 *    silently overwrite each other — the write is pinned to the updatedAt it read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockOwner,
  mockProjectFindFirst,
  mockProjectUpdateMany,
  mockGenFindFirst,
  mockGenFindMany,
  mockEventCreate,
  mockGetTranscript,
  mockStartRender,
} = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockProjectFindFirst: vi.fn(),
  mockProjectUpdateMany: vi.fn(),
  mockGenFindFirst: vi.fn(),
  mockGenFindMany: vi.fn(),
  mockEventCreate: vi.fn(),
  mockGetTranscript: vi.fn(),
  mockStartRender: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../auth-guard", () => ({
  requireOwner: mockOwner,
  resolveUserPrincipal: async (gate: { email: string; ownerId: string }) => ({
    kind: "user" as const,
    subjectUserId: null,
    subjectEmail: gate.email,
    ownerId: gate.ownerId,
    orgRole: null,
    membershipId: null,
    impersonating: false,
    impersonatedByBaUserId: null,
  }),
}));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: mockProjectFindFirst, updateMany: mockProjectUpdateMany },
    generation: { findFirst: mockGenFindFirst, findMany: mockGenFindMany },
    actionEvent: { create: mockEventCreate },
  },
}));
vi.mock("@fikirtive/db/principal", () => ({ runAsUser: <T,>(_p: unknown, fn: () => T) => fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../actions", () => ({ getTranscript: mockGetTranscript, startRender: mockStartRender }));

const {
  getEditDesk,
  joinClipsIntoCut,
  setCutMusic,
  clearCutMusic,
  addCaptionsToClip,
  exportSavedCut,
} = await import("../edit-desk-actions");

const OWNER = "org_a";
const NEIGHBOUR = "org_b";
const PROJECT = "prj_1";
const hash = (n: number) => String(n).repeat(64).slice(0, 64);
const src = (n: number, ext = "mp4", owner = OWNER) => `/files/u/${owner}/${hash(n)}.${ext}`;

/** An owned generation row as the actions read it. */
function gen(n: number, ext = "mp4", durationS: number | null = 5, promptText = "") {
  return { id: `gen_${n}`, promptText, asset: { ownerId: OWNER, contentHash: hash(n), ext, durationS } };
}

/** The saved cut on the project row, as Prisma hands it back (plain JSON). */
function savedCut(clips: { n: number; ext?: string; start: number; length: number }[]) {
  return {
    timeline: {
      background: "#000000",
      tracks: [
        {
          clips: clips.map((c) => ({
            asset: { type: (c.ext ?? "mp4") === "mp4" ? "video" : "image", src: src(c.n, c.ext ?? "mp4") },
            start: c.start,
            length: c.length,
          })),
        },
      ],
    },
    output: { format: "mp4", resolution: "hd", aspectRatio: "16:9", fps: 25 },
  };
}

/** The editJson the action actually wrote. */
function written(call = 0) {
  return mockProjectUpdateMany.mock.calls[call]![0].data.editJson;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOwner.mockResolvedValue({ email: "shop@example.com", ownerId: OWNER });
  mockProjectFindFirst.mockResolvedValue({ id: PROJECT, updatedAt: new Date("2026-08-12T00:00:00Z"), editJson: null });
  mockProjectUpdateMany.mockResolvedValue({ count: 1 });
  mockEventCreate.mockResolvedValue({});
});

describe("a signed-out or refused caller never reaches the video", () => {
  it("passes the guard's refusal straight back", async () => {
    mockOwner.mockResolvedValue({ error: "Not signed in." });
    expect(await joinClipsIntoCut(PROJECT, [src(1)])).toEqual({ error: "Not signed in." });
    expect(mockProjectFindFirst).not.toHaveBeenCalled();
  });
});

describe("joinClipsIntoCut", () => {
  it("writes a gapless cut in the picked order, pinned to the row it read", async () => {
    mockGenFindFirst.mockImplementation(async ({ where }: { where: { asset: { contentHash: string } } }) => {
      const n = where.asset.contentHash === hash(1) ? 1 : 2;
      return gen(n, "mp4", n === 1 ? 4 : 6);
    });

    const res = await joinClipsIntoCut(PROJECT, [src(1), src(2)]);
    expect(res).toEqual({ ok: true, cut: expect.objectContaining({ seconds: 10 }) });

    const edit = written();
    expect(edit.timeline.tracks[0].clips.map((c: { start: number }) => c.start)).toEqual([0, 4]);
    expect(edit.timeline.tracks[0].clips.map((c: { asset: { src: string } }) => c.asset.src)).toEqual([src(1), src(2)]);

    // the write is owner-scoped AND pinned to the updatedAt it read (no silent overwrite)
    const where = mockProjectUpdateMany.mock.calls[0]![0].where;
    expect(where.ownerId).toBe(OWNER);
    expect(where.updatedAt).toEqual(new Date("2026-08-12T00:00:00Z"));

    // every merchant action leaves a trace
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerId: OWNER, projectId: PROJECT, type: "edit.join" }) }),
    );
  });

  it("a src naming another workspace is refused BEFORE any lookup", async () => {
    const res = await joinClipsIntoCut(PROJECT, [src(1, "mp4", NEIGHBOUR)]);
    expect(res).toEqual({ error: "That clip isn't in your media." });
    expect(mockGenFindFirst).not.toHaveBeenCalled();
    expect(mockProjectUpdateMany).not.toHaveBeenCalled();
  });

  it("a clip that isn't in THIS project is refused, and the lookup was owner+project scoped", async () => {
    mockGenFindFirst.mockResolvedValue(null);
    const res = await joinClipsIntoCut(PROJECT, [src(1)]);
    expect(res).toEqual({ error: expect.stringContaining("isn't in this project") });
    expect(mockGenFindFirst.mock.calls[0]![0].where).toMatchObject({ ownerId: OWNER, projectId: PROJECT, deletedAt: null });
    expect(mockProjectUpdateMany).not.toHaveBeenCalled();
  });

  it("loses to a concurrent save rather than overwriting it", async () => {
    mockGenFindFirst.mockResolvedValue(gen(1));
    mockProjectUpdateMany.mockResolvedValue({ count: 0 }); // someone else's write landed first, every time
    const res = (await joinClipsIntoCut(PROJECT, [src(1)])) as { error: string };
    expect(res.error).toContain("changed while you were working");
    expect(mockEventCreate).not.toHaveBeenCalled();
  });

  it("re-reads before each retry, so a retry builds on the OTHER writer's cut", async () => {
    mockGenFindFirst.mockResolvedValue(gen(1));
    mockProjectUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    mockProjectFindFirst
      .mockResolvedValueOnce({ id: PROJECT, updatedAt: new Date("2026-08-12T00:00:00Z"), editJson: null })
      .mockResolvedValueOnce({ id: PROJECT, updatedAt: new Date("2026-08-12T00:05:00Z"), editJson: null });
    const res = await joinClipsIntoCut(PROJECT, [src(1)]);
    expect("ok" in res).toBe(true);
    expect(mockProjectUpdateMany.mock.calls[1]![0].where.updatedAt).toEqual(new Date("2026-08-12T00:05:00Z"));
  });
});

describe("music", () => {
  it("lays a bed marked for ducking under the saved video", async () => {
    mockGenFindFirst.mockResolvedValue(gen(9, "mp3", 90));
    mockProjectFindFirst.mockResolvedValue({
      id: PROJECT,
      updatedAt: new Date("2026-08-12T00:00:00Z"),
      editJson: savedCut([{ n: 1, start: 0, length: 12 }]),
    });

    const res = await setCutMusic(PROJECT, src(9, "mp3"));
    expect(res).toEqual({ ok: true, cut: expect.objectContaining({ music: src(9, "mp3") }) });

    const bed = written().timeline.tracks.find((t: { audioRole?: string }) => t.audioRole === "music");
    expect(bed).toBeDefined();
    expect(bed.clips[0].length).toBe(12); // trimmed to the video, never longer
  });

  it("refuses music before there is a video, and writes nothing", async () => {
    mockGenFindFirst.mockResolvedValue(gen(9, "mp3", 90));
    const res = (await setCutMusic(PROJECT, src(9, "mp3"))) as { error: string };
    expect(res.error).toContain("Join your clips");
    expect(mockProjectUpdateMany).not.toHaveBeenCalled();
  });

  it("takes the bed back off", async () => {
    mockProjectFindFirst.mockResolvedValue({
      id: PROJECT,
      updatedAt: new Date("2026-08-12T00:00:00Z"),
      editJson: {
        ...savedCut([{ n: 1, start: 0, length: 12 }]),
        timeline: {
          ...savedCut([{ n: 1, start: 0, length: 12 }]).timeline,
          tracks: [
            ...savedCut([{ n: 1, start: 0, length: 12 }]).timeline.tracks,
            { clips: [{ asset: { type: "audio", src: src(9, "mp3") }, start: 0, length: 12 }], audioRole: "music" },
          ],
        },
      },
    });
    const res = await clearCutMusic(PROJECT);
    expect(res).toEqual({ ok: true, cut: expect.objectContaining({ music: null }) });
    expect(written().timeline.tracks).toHaveLength(1);
  });
});

describe("captions", () => {
  it("puts a clip's words on screen at the time that clip plays", async () => {
    mockProjectFindFirst.mockResolvedValue({
      id: PROJECT,
      updatedAt: new Date("2026-08-12T00:00:00Z"),
      editJson: savedCut([
        { n: 1, start: 0, length: 10 },
        { n: 2, start: 10, length: 10 },
      ]),
    });
    mockGetTranscript.mockResolvedValue([{ startMs: 0, lengthMs: 1500, text: "free delivery today" }]);

    const res = await addCaptionsToClip(PROJECT, src(2));
    expect(res).toEqual({ ok: true, cut: expect.objectContaining({ captionCount: 1 }) });
    expect(written().timeline.captions).toEqual([{ startMs: 10_000, lengthMs: 1500, text: "free delivery today" }]);
    expect(mockGetTranscript).toHaveBeenCalledWith(PROJECT, src(2));
  });

  it("says so plainly when the words aren't ready, instead of writing empty captions", async () => {
    mockGetTranscript.mockResolvedValue([]);
    const res = (await addCaptionsToClip(PROJECT, src(2))) as { error: string };
    expect(res.error).toContain("no words for that clip yet");
    expect(mockProjectUpdateMany).not.toHaveBeenCalled();
  });
});

describe("exportSavedCut — one cut, two surfaces, one render", () => {
  it("renders the SAVED cut, read server-side", async () => {
    const cut = savedCut([{ n: 1, start: 0, length: 5 }]);
    mockProjectFindFirst.mockResolvedValue({ editJson: cut });
    mockStartRender.mockResolvedValue({ id: "rj_1" });
    expect(await exportSavedCut(PROJECT)).toEqual({ id: "rj_1" });
    expect(mockStartRender).toHaveBeenCalledWith(PROJECT, JSON.stringify(cut));
  });

  it("refuses honestly when there's nothing saved yet", async () => {
    mockProjectFindFirst.mockResolvedValue({ editJson: null });
    const res = (await exportSavedCut(PROJECT)) as { error: string };
    expect(res.error).toContain("no saved cut");
    expect(mockStartRender).not.toHaveBeenCalled();
  });
});

describe("getEditDesk — what the desk opens with", () => {
  it("offers this owner's media in this project, and the cut as it stands", async () => {
    mockProjectFindFirst.mockResolvedValue({
      id: PROJECT,
      updatedAt: new Date("2026-08-12T00:00:00Z"),
      editJson: savedCut([{ n: 1, start: 0, length: 5 }]),
    });
    mockGenFindMany.mockResolvedValue([
      gen(1, "mp4", 5, "  our new  chilli sauce, close up  "),
      gen(9, "mp3", 90),
      { id: "gen_x", promptText: "", asset: { ownerId: OWNER, contentHash: hash(3), ext: "pdf", durationS: null } },
    ]);

    const res = await getEditDesk(PROJECT);
    expect("error" in res).toBe(false);
    if ("error" in res) return;
    expect(res.media.map((m) => m.kind)).toEqual(["video", "audio"]); // the pdf can't be in a video
    // a merchant picking clips reads what they asked for, never a content hash
    expect(res.media.map((m) => m.label)).toEqual(["our new chilli sauce, close up", "Music"]);
    expect(res.cut.clips).toHaveLength(1);
    expect(mockGenFindMany.mock.calls[0]![0].where).toMatchObject({ ownerId: OWNER, projectId: PROJECT, deletedAt: null });
  });

  it("a project that isn't this owner's is simply not found", async () => {
    mockProjectFindFirst.mockResolvedValue(null);
    expect(await getEditDesk(PROJECT)).toEqual({ error: "Project not found." });
  });
});
