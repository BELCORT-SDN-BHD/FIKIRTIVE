/**
 * #791-6:白标铁律机器化。
 *
 * 「不告诉商家用的是谁家的引擎」以前只是一条写在提示词里的话,加上一条只管
 * job.error 的过滤器。Otto 自己天天跟商家说话、而且知道那些名字(它的提示词技能就叫
 * seedreamPrompt / seedancePrompt)—— 中间什么都没有。这里是那个「什么」。
 */
import { describe, it, expect } from "vitest";
import { redactProviderNames, createProviderNameFilter } from "./provider-secrecy.js";

const SECRETS = [
  "Seedance 2.0 made this clip",
  "generated with seedream 4.5",
  "byteplus returned an error",
  "we call the fal.ai endpoint",
  "即梦 rendered it",
  "I'm running on the claude model",
];

describe("redactProviderNames", () => {
  it("每一种写法都换成 generation provider", () => {
    for (const s of SECRETS) {
      const out = redactProviderNames(s);
      expect(out).toContain("generation provider");
      expect(out.toLowerCase()).not.toMatch(/seedance|seedream|byteplus|bytedance|jimeng|即梦/);
    }
  });

  it("不动无关文字", () => {
    expect(redactProviderNames("Your video is ready — 5 seconds, 9:16.")).toBe(
      "Your video is ready — 5 seconds, 9:16.",
    );
  });
});

describe("createProviderNameFilter — 流式也拦得住", () => {
  /** 把一段文字切成任意大小的块喂进去,拼回来的结果必须和整段洗一次一模一样。 */
  function streamThrough(text: string, chunkSize: number): string {
    const filter = createProviderNameFilter();
    let out = "";
    for (let i = 0; i < text.length; i += chunkSize) {
      out += filter.push(text.slice(i, i + chunkSize));
    }
    return out + filter.flush();
  }

  it("名字被切成两半跨块到达,依然拦得住", () => {
    const text = "This was made with Seedance 2.0 for you.";
    for (const chunkSize of [1, 2, 3, 5, 7, 11, 40]) {
      const out = streamThrough(text, chunkSize);
      expect(out.toLowerCase(), `chunk=${chunkSize}`).not.toContain("seedance");
      expect(out, `chunk=${chunkSize}`).toBe(redactProviderNames(text));
    }
  });

  it("逐字符流式与整段洗名逐字节一致(几段真实回复)", () => {
    const replies = [
      "Done! Your image is ready — want a tighter crop?",
      "I used seedream 4.5 with a 9:16 crop, and the video came from Seedance 2.0.",
      "The generation failed on byteplus, so you were not charged.",
      "claude model here — anything else?",
    ];
    for (const reply of replies) {
      for (const chunkSize of [1, 4, 13]) {
        expect(streamThrough(reply, chunkSize), `${reply} @${chunkSize}`).toBe(
          redactProviderNames(reply),
        );
      }
    }
  });

  it("没有秘密的时候什么也不改", () => {
    const text = "Two options: a warm daylight shot, or a night-market look. Which one?";
    expect(streamThrough(text, 6)).toBe(text);
  });
});
