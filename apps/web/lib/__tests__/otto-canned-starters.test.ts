/**
 * otto-canned-starters — #971:商家的画布不许被**我们自己的文案**命名。
 *
 * beta 录像 01:28:一块画布在侧栏里叫
 * 「Let me describe my brand to you — ask me what you need to know.」。那不是商家写的字 ——
 * 那是 Brand memory 起手 chip 里我们自己写好的一句话。他点了一下,它作为消息发出去,
 * 新对话拿第一条消息当标题,画布再拿对话标题当名字。
 *
 * 三条钉板:
 *   ① 守卫认得界面上真正发出去的那几句(两边读同一份常量,不是各抄一份);
 *   ② 商家自己的话照旧原样成为标题 —— 这条守卫不许顺手把正常命名也吃掉;
 *   ③ chip 那几句退回默认名,让对话与画布之后被真正的内容命名。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BRAND_MEMORY_STARTERS,
  UNTITLED_CHAT_TITLE,
  isCannedStarter,
  newThreadTitle,
} from "../otto-canned-starters";

const WEB_ROOT = path.resolve(__dirname, "../..");

describe("#971 命名守卫认得产品自己写的开场白", () => {
  it.each(BRAND_MEMORY_STARTERS.map((c) => [c.label, c.prompt] as const))(
    "chip「%s」发出的那句话不会成为标题",
    (_label, prompt) => {
      expect(isCannedStarter(prompt)).toBe(true);
      expect(newThreadTitle(prompt)).toBe(UNTITLED_CHAT_TITLE);
    },
  );

  it("录像里那一句,逐字", () => {
    const greeting = "Let me describe my brand to you — ask me what you need to know.";
    expect(newThreadTitle(greeting)).toBe(UNTITLED_CHAT_TITLE);
  });

  it("以 chip 开头、后面补上自己内容的那一句同样不算商家的命名", () => {
    // 「Research my site」那句 chip 本身就是个开头(商家在「My URL: 」后补网址)。
    const withUrl = `${BRAND_MEMORY_STARTERS[3]!.prompt}https://kedai.example`;
    expect(isCannedStarter(withUrl)).toBe(true);
    expect(newThreadTitle(withUrl)).toBe(UNTITLED_CHAT_TITLE);
  });

  it("多一个空格 / 大小写不同也认得 —— 守卫不靠逐字节相等", () => {
    expect(isCannedStarter("Help me  pin down my BRAND voice.")).toBe(true);
  });
});

describe("#971 商家自己的话照旧成为标题", () => {
  it.each([
    "Make a Raya poster for my kedai",
    "帮我做一支开斋节的短片",
    "Describe",                       // chip 标签的头一个词,但不是那整句
    "I want to describe my brand",    // 像,但不是我们写的那一句
  ])("「%s」原样成为标题", (text) => {
    expect(isCannedStarter(text)).toBe(false);
    expect(newThreadTitle(text)).toBe(text);
  });

  it("长消息照旧截到 80", () => {
    const long = "a".repeat(200);
    expect(newThreadTitle(long)).toHaveLength(80);
  });

  it("空白消息退回默认名而不是一个空标题", () => {
    expect(newThreadTitle("   ")).toBe(UNTITLED_CHAT_TITLE);
  });
});

// ---------------------------------------------------------------------------
// 一句话,一处作者 —— 界面渲染的和守卫认得的必须是同一份
// ---------------------------------------------------------------------------
describe("#971 起手 chip 只有一处作者", () => {
  it("Brand memory 不再自己抄一份 chip 文案", () => {
    const source = readFileSync(path.join(WEB_ROOT, "components/otto/OttoMemory.tsx"), "utf8");
    expect(
      source,
      "OttoMemory 又手写了一份 chip 文案 —— 守卫认得的和界面发出的会先后漂移",
    ).not.toContain("Let me describe my brand to you");
    expect(source).toContain("BRAND_MEMORY_STARTERS");
  });

  it("两个建对话的门都走同一个 newThreadTitle", () => {
    for (const relative of ["lib/otto-actions.ts", "app/api/otto/stream/route.ts"]) {
      const source = readFileSync(path.join(WEB_ROOT, relative), "utf8");
      expect(source, `${relative} 建对话时没走命名守卫`).toContain("title: newThreadTitle(text)");
      expect(
        source,
        `${relative} 还留着旧的 text.slice(0, 80) 标题 —— 只在一个门上装守卫等于没装`,
      ).not.toContain("title: text.slice(0, 80)");
    }
  });
});
