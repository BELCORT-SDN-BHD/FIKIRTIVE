import { afterEach, describe, expect, it } from "vitest";
import { coworkTurnRequest, coworkBriefRequest, MAX_COWORK_BRIEF, coworkTurnSchema, coworkVisionConfig } from "./cowork.js";
import { buildPlannerMessages, parseCoworkTurn, mockPlannerReply } from "./cowork-planner.js";

// ── coworkTurnRequest: replyToMessageId field ──────────────────────────────

describe("coworkTurnRequest.replyToMessageId", () => {
  const base = { projectId: "proj1", text: "make a video" };

  it("accepts a valid replyToMessageId", () => {
    const r = coworkTurnRequest.safeParse({ ...base, replyToMessageId: "msg_abc123" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.replyToMessageId).toBe("msg_abc123");
  });

  it("is optional — absent is fine", () => {
    const r = coworkTurnRequest.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.replyToMessageId).toBeUndefined();
  });

  it("rejects a replyToMessageId longer than 64 chars (.strict() too-long check)", () => {
    const r = coworkTurnRequest.safeParse({ ...base, replyToMessageId: "x".repeat(65) });
    expect(r.success).toBe(false);
  });

  it("rejects an empty string (min(1))", () => {
    const r = coworkTurnRequest.safeParse({ ...base, replyToMessageId: "" });
    expect(r.success).toBe(false);
  });

  it("rejects extra unknown keys (.strict())", () => {
    const r = coworkTurnRequest.safeParse({ ...base, unknownKey: "surprise" });
    expect(r.success).toBe(false);
  });
});

// ── buildPlannerMessages: quoted injection ─────────────────────────────────

describe("buildPlannerMessages with quoted", () => {
  const baseArgs = {
    userText: "Make a cat video",
    history: [] as { role: "user" | "assistant"; content: string }[],
    availableRefs: [],
    modelSummary: "image: seedream; video: kling",
  };

  it("without quoted, last message content equals userText", () => {
    const msgs = buildPlannerMessages(baseArgs);
    const last = msgs[msgs.length - 1];
    expect(last?.role).toBe("user");
    expect(last?.content).toBe("Make a cat video");
  });

  it("with quoted, injects the quote note into the last user message", () => {
    const msgs = buildPlannerMessages({
      ...baseArgs,
      quoted: { kind: "result", preview: "kling ×2" },
    });
    const last = msgs[msgs.length - 1];
    expect(last?.role).toBe("user");
    expect(last?.content).toContain("[The user is replying to an earlier result message:");
    expect(last?.content).toContain("kling ×2");
    expect(last?.content).toContain("Make a cat video");
  });

  it("with quoted, the quote note is PREPENDED before userText", () => {
    const msgs = buildPlannerMessages({
      ...baseArgs,
      quoted: { kind: "message", preview: "I want a cat" },
    });
    const last = msgs[msgs.length - 1];
    const idx = (last?.content as string).indexOf("[The user is replying");
    const userIdx = (last?.content as string).indexOf("Make a cat video");
    expect(typeof idx).toBe("number");
    expect(typeof userIdx).toBe("number");
    expect((idx as number) < (userIdx as number)).toBe(true);
  });

  it("with quoted, system and history messages are NOT altered", () => {
    const history = [{ role: "user" as const, content: "earlier msg" }, { role: "assistant" as const, content: "ok" }];
    const msgs = buildPlannerMessages({
      ...baseArgs,
      history,
      quoted: { kind: "generate card", preview: "video proposal" },
    });
    // system is first
    expect(msgs[0]?.role).toBe("system");
    expect(msgs[0]?.content).not.toContain("[The user is replying");
    // history entries unchanged
    const historySlice = msgs.slice(1, msgs.length - 1);
    for (const h of historySlice) {
      expect(h.content).not.toContain("[The user is replying");
    }
    // only the last (user) entry has the quote
    const last = msgs[msgs.length - 1];
    expect(last?.content).toContain("[The user is replying");
  });

  it("back-compat: omitting quoted leaves all messages unchanged", () => {
    const withoutQuoted = buildPlannerMessages(baseArgs);
    const withUndefined = buildPlannerMessages({ ...baseArgs, quoted: undefined });
    expect(withoutQuoted).toEqual(withUndefined);
  });
});

// ── coworkBriefRequest schema ──────────────────────────────────────────────

describe("coworkBriefRequest", () => {
  it("accepts a valid brief", () => {
    const r = coworkBriefRequest.safeParse({ projectId: "proj1", brief: "Cinematic noir, always 9:16" });
    expect(r.success).toBe(true);
  });

  it("accepts an empty brief (clear the brief)", () => {
    const r = coworkBriefRequest.safeParse({ projectId: "proj1", brief: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.brief).toBe("");
  });

  it(`rejects brief longer than MAX_COWORK_BRIEF (${MAX_COWORK_BRIEF} chars)`, () => {
    const r = coworkBriefRequest.safeParse({ projectId: "proj1", brief: "x".repeat(MAX_COWORK_BRIEF + 1) });
    expect(r.success).toBe(false);
  });

  it("rejects extra unknown keys (.strict())", () => {
    const r = coworkBriefRequest.safeParse({ projectId: "proj1", brief: "ok", extra: "bad" });
    expect(r.success).toBe(false);
  });
});

// ── buildPlannerMessages: brief injection ──────────────────────────────────

describe("buildPlannerMessages with brief", () => {
  const baseArgs = {
    userText: "Make a cat video",
    history: [] as { role: "user" | "assistant"; content: string }[],
    availableRefs: [],
    modelSummary: "image: seedream; video: kling",
  };

  it("with brief, the system message content includes the brief text", () => {
    const msgs = buildPlannerMessages({ ...baseArgs, brief: "Cinematic noir, always 9:16" });
    const sys = msgs[0];
    expect(sys?.role).toBe("system");
    expect(sys?.content).toContain("Cinematic noir, always 9:16");
    expect(sys?.content).toContain("Project brief");
  });

  it("with brief, history + user entries are unchanged", () => {
    const history = [{ role: "user" as const, content: "earlier" }, { role: "assistant" as const, content: "ok" }];
    const msgs = buildPlannerMessages({ ...baseArgs, history, brief: "noir" });
    const historySlice = msgs.slice(1, msgs.length - 1);
    for (const h of historySlice) expect(h.content).not.toContain("Project brief");
    const last = msgs[msgs.length - 1];
    expect(last?.role).toBe("user");
    expect(last?.content).toBe("Make a cat video");
  });

  it("without brief, the system message has NO brief block (back-compat)", () => {
    const msgs = buildPlannerMessages(baseArgs);
    // The injected block starts with "Project brief (the creative direction…" — distinct
    // from the static prompt's "PROJECT BRIEF" (all-caps) in the briefUpdate instruction.
    expect(msgs[0]?.content).not.toContain("Project brief (the creative direction");
  });

  it("empty-string brief is treated as absent (no brief block)", () => {
    const msgs = buildPlannerMessages({ ...baseArgs, brief: "" });
    expect(msgs[0]?.content).not.toContain("Project brief (the creative direction");
  });

  it("whitespace-only brief is treated as absent (no brief block)", () => {
    const msgs = buildPlannerMessages({ ...baseArgs, brief: "   " });
    expect(msgs[0]?.content).not.toContain("Project brief (the creative direction");
  });
});

// ── coworkTurnSchema / parseCoworkTurn: briefUpdate field ─────────────────

describe("coworkTurnSchema briefUpdate", () => {
  const validBase = JSON.stringify({
    planSteps: ["think", "create"],
    reply: "Here is my proposal.",
    proposal: null,
  });

  it("accepts a turn WITH briefUpdate and truncates it to ≤600 chars", () => {
    const long = "x".repeat(700);
    const raw = JSON.stringify({
      planSteps: ["step1"],
      reply: "reply here",
      briefUpdate: long,
      proposal: null,
    });
    const turn = parseCoworkTurn(raw, []);
    expect(turn.briefUpdate).toBeDefined();
    expect(turn.briefUpdate!.length).toBe(600);
  });

  it("accepts a turn WITHOUT briefUpdate (optional — back-compat)", () => {
    const turn = parseCoworkTurn(validBase, []);
    expect(turn.briefUpdate).toBeUndefined();
  });

  it("mock planner reply parses without briefUpdate (verifies optionality)", () => {
    const raw = mockPlannerReply("make a cinematic cat video");
    const turn = parseCoworkTurn(raw, []);
    expect(turn.briefUpdate).toBeUndefined();
    // other fields are present
    expect(turn.reply).toBeTruthy();
    expect(turn.title).toBeTruthy();
  });

  it("briefUpdate trims whitespace (min(1) + trim)", () => {
    const raw = JSON.stringify({
      planSteps: ["step1"],
      reply: "ok",
      briefUpdate: "  cinematic noir, always 9:16  ",
      proposal: null,
    });
    const turn = parseCoworkTurn(raw, []);
    expect(turn.briefUpdate).toBe("cinematic noir, always 9:16");
  });

  it("rejects briefUpdate that is an empty string after trim (min(1))", () => {
    const result = coworkTurnSchema.safeParse({
      planSteps: [],
      reply: "ok",
      briefUpdate: "   ",
      proposal: null,
    });
    // min(1) after trim → parse failure
    expect(result.success).toBe(false);
  });
});

// ── coworkVisionConfig ────────────────────────────────────────────────────────

describe("coworkVisionConfig", () => {
  afterEach(() => {
    delete process.env.COWORK_VISION_ENABLED;
    delete process.env.COWORK_VISION_MAX_IMAGES;
    delete process.env.COWORK_VISION_MAX_BYTES;
  });

  it("defaults: enabled=false, maxImages=3, maxBytes=4_000_000 when env is unset", () => {
    const cfg = coworkVisionConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.maxImages).toBe(3);
    expect(cfg.maxBytes).toBe(4_000_000);
    expect(cfg.policy).toBe("C");
  });

  it('COWORK_VISION_ENABLED="true" → enabled true', () => {
    process.env.COWORK_VISION_ENABLED = "true";
    expect(coworkVisionConfig().enabled).toBe(true);
  });

  it('COWORK_VISION_ENABLED="1" → enabled true', () => {
    process.env.COWORK_VISION_ENABLED = "1";
    expect(coworkVisionConfig().enabled).toBe(true);
  });

  it('COWORK_VISION_ENABLED="false" → enabled false', () => {
    process.env.COWORK_VISION_ENABLED = "false";
    expect(coworkVisionConfig().enabled).toBe(false);
  });

  it("COWORK_VISION_MAX_IMAGES and COWORK_VISION_MAX_BYTES are respected", () => {
    process.env.COWORK_VISION_MAX_IMAGES = "5";
    process.env.COWORK_VISION_MAX_BYTES = "1000000";
    const cfg = coworkVisionConfig();
    expect(cfg.maxImages).toBe(5);
    expect(cfg.maxBytes).toBe(1_000_000);
  });
});

// ── buildPlannerMessages: images (Phase C vision) ────────────────────────────

describe("buildPlannerMessages with images (Phase C vision)", () => {
  const baseArgs = {
    userText: "Make a cat video",
    history: [] as { role: "user" | "assistant"; content: string }[],
    availableRefs: [],
    modelSummary: "image: seedream; video: kling",
  };

  it("with images: user turn content is an array containing a text part + label + image_url parts", () => {
    const msgs = buildPlannerMessages({
      ...baseArgs,
      images: [{ label: "@Mira (character)", dataUrl: "data:image/png;base64,AAA" }],
    });
    const last = msgs[msgs.length - 1];
    expect(last?.role).toBe("user");
    expect(Array.isArray(last?.content)).toBe(true);
    const parts = last!.content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts[0]).toEqual({ type: "text", text: "Make a cat video" });
    expect(parts[1]).toEqual({ type: "text", text: "[Reference — @Mira (character)]" });
    expect(parts[2]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAA" } });
  });

  it("with images: multiple images each get a label + image_url pair in order", () => {
    const msgs = buildPlannerMessages({
      ...baseArgs,
      images: [
        { label: "@Mira", dataUrl: "data:image/png;base64,AAA" },
        { label: "@Location", dataUrl: "data:image/jpeg;base64,BBB" },
      ],
    });
    const last = msgs[msgs.length - 1];
    const parts = last!.content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts).toHaveLength(5); // text + (label+img) × 2
    expect(parts[3]).toEqual({ type: "text", text: "[Reference — @Location]" });
    expect(parts[4]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,BBB" } });
  });

  it("without images: user turn content is the plain string (back-compat)", () => {
    const msgs = buildPlannerMessages(baseArgs);
    const last = msgs[msgs.length - 1];
    expect(typeof last?.content).toBe("string");
    expect(last?.content).toBe("Make a cat video");
  });

  it("images=[] (empty array): user turn content is the plain string (back-compat)", () => {
    const msgs = buildPlannerMessages({ ...baseArgs, images: [] });
    const last = msgs[msgs.length - 1];
    expect(typeof last?.content).toBe("string");
    expect(last?.content).toBe("Make a cat video");
  });

  it("with images, system and history are NOT altered", () => {
    const history = [{ role: "user" as const, content: "earlier" }, { role: "assistant" as const, content: "ok" }];
    const msgs = buildPlannerMessages({
      ...baseArgs,
      history,
      images: [{ label: "@A", dataUrl: "data:image/png;base64,CCC" }],
    });
    expect(msgs[0]?.role).toBe("system");
    expect(typeof msgs[0]?.content).toBe("string");
    const historySlice = msgs.slice(1, msgs.length - 1);
    for (const h of historySlice) expect(typeof h.content).toBe("string");
  });

  it("with both quoted and images: text part includes the quote prefix", () => {
    const msgs = buildPlannerMessages({
      ...baseArgs,
      quoted: { kind: "result", preview: "a cat" },
      images: [{ label: "@Cat", dataUrl: "data:image/png;base64,DDD" }],
    });
    const last = msgs[msgs.length - 1];
    const parts = last!.content as { type: string; text?: string }[];
    expect(parts[0]?.type).toBe("text");
    expect(parts[0]?.text).toContain("[The user is replying to an earlier result message:");
    expect(parts[0]?.text).toContain("Make a cat video");
  });
});

// ── coworkTurnSchema: refDescriptions field ───────────────────────────────────

describe("coworkTurnSchema refDescriptions", () => {
  const base = {
    planSteps: ["step1"],
    reply: "Here you go.",
    proposal: null,
  };

  it("accepts refDescriptions with a valid @name key", () => {
    const result = coworkTurnSchema.safeParse({
      ...base,
      refDescriptions: { "@Mira": "auburn hair, cream sweater, blue eyes" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refDescriptions?.["@Mira"]).toBe("auburn hair, cream sweater, blue eyes");
    }
  });

  it("truncates a refDescriptions value longer than 600 chars to 600", () => {
    const long = "x".repeat(700);
    const result = coworkTurnSchema.safeParse({
      ...base,
      refDescriptions: { "@Mira": long },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refDescriptions?.["@Mira"]?.length).toBe(600);
    }
  });

  it("accepts a turn WITHOUT refDescriptions (optional — back-compat)", () => {
    const result = coworkTurnSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.refDescriptions).toBeUndefined();
  });

  it("mock planner reply parses without refDescriptions (verifies optionality)", () => {
    const raw = mockPlannerReply("make a cinematic cat video");
    const turn = parseCoworkTurn(raw, []);
    expect(turn.refDescriptions).toBeUndefined();
    expect(turn.reply).toBeTruthy();
  });

  it("accepts multiple refs in one turn", () => {
    const result = coworkTurnSchema.safeParse({
      ...base,
      refDescriptions: {
        "@Mira": "auburn hair, cream sweater",
        "@Location": "neon-lit Tokyo alley",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.refDescriptions ?? {})).toHaveLength(2);
    }
  });
});

// ── buildPlannerMessages: availableRefs with description ─────────────────────

describe("buildPlannerMessages availableRefs with description", () => {
  const baseArgs = {
    userText: "Make a cat video",
    history: [] as { role: "user" | "assistant"; content: string }[],
    modelSummary: "image: seedream; video: kling",
  };

  it("a ref WITH description renders as id=name(type): <desc> in the system message", () => {
    const msgs = buildPlannerMessages({
      ...baseArgs,
      availableRefs: [{ id: "ent_1", name: "Mira", type: "CHARACTER", description: "auburn hair, cream sweater" }],
    });
    const sys = msgs[0];
    expect(sys?.role).toBe("system");
    expect(sys?.content).toContain("ent_1=Mira(CHARACTER): auburn hair, cream sweater");
  });

  it("a ref WITHOUT description renders as id=name(type) (no trailing colon)", () => {
    const msgs = buildPlannerMessages({
      ...baseArgs,
      availableRefs: [{ id: "ent_2", name: "Studio", type: "LOCATION" }],
    });
    const sys = msgs[0];
    expect(sys?.content).toContain("ent_2=Studio(LOCATION)");
    expect(sys?.content).not.toContain("ent_2=Studio(LOCATION):");
  });

  it("mixed refs: one with description, one without", () => {
    const msgs = buildPlannerMessages({
      ...baseArgs,
      availableRefs: [
        { id: "ent_1", name: "Mira", type: "CHARACTER", description: "auburn hair" },
        { id: "ent_2", name: "Studio", type: "LOCATION" },
      ],
    });
    const sys = msgs[0];
    expect(sys?.content).toContain("ent_1=Mira(CHARACTER): auburn hair");
    expect(sys?.content).toContain("ent_2=Studio(LOCATION)");
    // the no-description ref must not have a trailing colon
    expect(sys?.content).not.toMatch(/ent_2=Studio\(LOCATION\):/);
  });
});
