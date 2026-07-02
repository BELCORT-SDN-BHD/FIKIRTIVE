import { describe, it, expect } from "vitest";
import { buildUserTurn, stripHistoryImages, sanitizeHistory, tryRestoreRunState, type RefImage } from "./run-input.js";
import { otto } from "./otto.js";
import type { AgentInputItem } from "@openai/agents";

describe("buildUserTurn", () => {
  it("no images → plain string content", () => {
    const turn = buildUserTurn("hello") as { role: string; content: unknown };
    expect(turn.role).toBe("user");
    expect(turn.content).toBe("hello");
  });

  it("empty images array → plain string content", () => {
    const turn = buildUserTurn("hi", []) as { content: unknown };
    expect(turn.content).toBe("hi");
  });

  it("with images → [input_text, input_image...] using the agents-SDK shape", () => {
    const images: RefImage[] = [{ label: "reference", dataUrl: "data:image/png;base64,AAAA" }];
    const turn = buildUserTurn("make this pop", images) as {
      role: string;
      content: Array<{ type: string; text?: string; image?: string }>;
    };
    expect(turn.role).toBe("user");
    expect(Array.isArray(turn.content)).toBe(true);
    expect(turn.content[0]).toEqual({ type: "input_text", text: "make this pop" });
    expect(turn.content[1]).toEqual({ type: "input_image", image: "data:image/png;base64,AAAA" });
  });
});

describe("stripHistoryImages", () => {
  it("drops input_image parts from a user turn and collapses a lone input_text to a string", () => {
    const history = [
      { role: "user", content: [
        { type: "input_text", text: "earlier turn" },
        { type: "input_image", image: "data:image/png;base64,BIG" },
      ] },
    ] as unknown as AgentInputItem[];
    const out = stripHistoryImages(history) as unknown as Array<{ content: unknown }>;
    expect(out[0]!.content).toBe("earlier turn");
  });

  it("leaves string-content user turns untouched", () => {
    const history = [{ role: "user", content: "plain" }] as unknown as AgentInputItem[];
    const out = stripHistoryImages(history) as unknown as Array<{ content: unknown }>;
    expect(out[0]!.content).toBe("plain");
  });

  it("leaves non-user items untouched", () => {
    const history = [{ role: "assistant", content: [{ type: "output_text", text: "ok" }] }] as unknown as AgentInputItem[];
    const out = stripHistoryImages(history) as unknown as Array<{ role: string; content: unknown }>;
    expect(out[0]!.role).toBe("assistant");
    expect(Array.isArray(out[0]!.content)).toBe(true);
  });
});

describe("sanitizeHistory (F25)", () => {
  it("drops stale system messages from rehydrated history (a fresh one is prepended each turn)", () => {
    const history = [
      { role: "system", content: "old brand context + refs" },
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "output_text", text: "hello" }] },
    ] as unknown as AgentInputItem[];
    const out = sanitizeHistory(history) as unknown as Array<{ role: string }>;
    expect(out.some((i) => i.role === "system")).toBe(false);
    expect(out.map((i) => i.role)).toEqual(["user", "assistant"]);
  });

  it("also strips input_image parts (worker verdict turn re-sent base64 — F25 leg 3)", () => {
    const history = [
      { role: "user", content: [
        { type: "input_text", text: "look" },
        { type: "input_image", image: "data:image/png;base64,BIG" },
      ] },
    ] as unknown as AgentInputItem[];
    const out = sanitizeHistory(history) as unknown as Array<{ content: unknown }>;
    expect(out[0]!.content).toBe("look");
  });
});

describe("tryRestoreRunState (F24)", () => {
  it("returns null (does NOT throw) on a corrupt/incompatible serialized state", async () => {
    // A schema-version bump in @openai/agents or a corrupt ottoState must not brick the thread.
    const restored = await tryRestoreRunState(otto, "}{ not valid run state json");
    expect(restored).toBeNull();
  });
});
