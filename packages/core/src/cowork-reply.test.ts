import { describe, expect, it } from "vitest";
import { coworkTurnRequest } from "./cowork.js";
import { buildPlannerMessages } from "./cowork-planner.js";

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
    const idx = last?.content.indexOf("[The user is replying");
    const userIdx = last?.content.indexOf("Make a cat video");
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
