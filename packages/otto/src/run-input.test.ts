import { describe, it, expect } from "vitest";
import { buildUserTurn, stripHistoryImages, type RefImage } from "./run-input.js";
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
