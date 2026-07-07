import { describe, it, expect } from "vitest";
import { extractText } from "./run-output.js";

describe("extractText", () => {
  it("prefers finalOutput when present (stringified)", () => {
    expect(extractText({ finalOutput: "done", newItems: [] })).toBe("done");
    expect(extractText({ finalOutput: 42 })).toBe("42");
  });

  it("concatenates output_text chunks from message_output_item entries", () => {
    const r = {
      finalOutput: null,
      newItems: [
        { type: "message_output_item", rawItem: { content: [{ type: "output_text", text: "Hello " }, { type: "output_text", text: "world" }] } },
        { type: "tool_call_item", rawItem: { content: [{ type: "output_text", text: "IGNORED" }] } },
        { type: "message_output_item", rawItem: { content: [{ type: "refusal", text: "nope" }, { type: "output_text", text: "!" }] } },
      ],
    };
    expect(extractText(r)).toBe("Hello world!");
  });

  it("returns empty string for missing/non-array newItems and malformed items", () => {
    expect(extractText({ finalOutput: null })).toBe("");
    expect(extractText({ finalOutput: undefined, newItems: "nope" })).toBe("");
    expect(extractText({ newItems: [{ type: "message_output_item" }] })).toBe("");
  });
});
