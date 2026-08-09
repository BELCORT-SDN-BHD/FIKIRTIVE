/**
 * #791-6:白标铁律接到 Otto 正文路径上。
 *
 * 提示词里的一条规则是「说的」;这里钉的是「做的」—— 就算模型说漏嘴,商家也读不到
 * 那个名字。extractText 是每一条会被持久化的 Otto 正文的必经之路(finalizeOttoRun /
 * ottoApprove 都走它),所以洗名放在这里,而不是在三个调用点各抄一遍。
 */
import { describe, it, expect } from "vitest";
import { extractText } from "./run-output.js";
import { ottoInstructions } from "./instructions.js";

const leak = "This clip came out of Seedance 2.0, and the picture was seedream 4.5.";

describe("#791-6 出站洗名接进 Otto 正文", () => {
  it("finalOutput 走的那条路会洗名", () => {
    const text = extractText({ finalOutput: leak });
    expect(text.toLowerCase()).not.toMatch(/seedance|seedream/);
    expect(text).toContain("generation provider");
  });

  it("newItems 走的那条路也会洗名(两条路必须同口径)", () => {
    const text = extractText({
      newItems: [
        {
          type: "message_output_item",
          rawItem: { content: [{ type: "output_text", text: leak }] },
        },
      ],
    });
    expect(text.toLowerCase()).not.toMatch(/seedance|seedream/);
    expect(text).toContain("generation provider");
  });

  it("无关正文一个字不动(洗名不是改写 Otto 的话)", () => {
    const plain = "Your video is ready — want it in 9:16 as well?";
    expect(extractText({ finalOutput: plain })).toBe(plain);
  });
});

describe("#791-6 提示词里的硬规则", () => {
  it("明令不得对商家提及供应商或模型名", () => {
    expect(ottoInstructions).toMatch(/Never tell the user which company, engine, service, or AI model/);
    // 「他说他已经知道了」「他直接问」都不构成例外 —— 这三种情形要写在规则里。
    expect(ottoInstructions).toMatch(/even if the user asks directly/);
    expect(ottoInstructions).toMatch(/confirm a guess/);
    // 有替代说法可用,规则才执行得下去。
    expect(ottoInstructions).toMatch(/our image engine/);
  });
});
