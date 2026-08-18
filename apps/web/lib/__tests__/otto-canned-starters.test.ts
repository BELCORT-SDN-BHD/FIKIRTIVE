/**
 * otto-canned-starters — #979:商家的画布不许被**我们自己的文案**命名。
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
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  BRAND_MEMORY_STARTERS,
  FRONT_DOOR_GOAL_LABELS,
  UNTITLED_CHAT_TITLE,
  isCannedStarter,
  newThreadTitle,
} from "../otto-canned-starters";

const WEB_ROOT = path.resolve(__dirname, "../..");

describe("#979 命名守卫认得产品自己写的开场白", () => {
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

  // 前门四个目标格子:点一下发出去的就是标签本身,画布于是叫「Sell a product」。
  // 与 Brand memory 的 chip 是同一个病的第二组样本。
  it.each(Object.entries(FRONT_DOOR_GOAL_LABELS))(
    "目标格子「%s」→「%s」不会成为标题",
    (_key, label) => {
      expect(isCannedStarter(label)).toBe(true);
      expect(newThreadTitle(label)).toBe(UNTITLED_CHAT_TITLE);
    },
  );
});

// ---------------------------------------------------------------------------
// 守卫不许伤到商家自己的话 —— 短标签只能按全等认,绝不能按前缀
//
// 判官的原话:拿「Sell a product」做前缀,商家真打的「Sell a product bundle for Raya」
// 会被压成 Untitled。那是把一个诚实性修复变成一个新的伤害 —— 商家写的字被产品吃掉,
// 比画布叫错名字更糟。
// ---------------------------------------------------------------------------
describe("#979 以目标格子标签开头、但明显是商家自己写的那句话不许被吃掉", () => {
  it.each([
    "Sell a product bundle for Raya",
    "Announce a sale for my bakery this weekend",
    "Get more followers on TikTok for my kedai",
    "Make a video about our new kaya puffs",
  ])("「%s」原样成为标题", (text) => {
    expect(isCannedStarter(text)).toBe(false);
    expect(newThreadTitle(text)).toBe(text);
  });
});

describe("#979 商家自己的话照旧成为标题", () => {
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
describe("#979 起手 chip 只有一处作者", () => {
  it("Brand memory 不再自己抄一份 chip 文案", () => {
    const source = readFileSync(path.join(WEB_ROOT, "components/otto/OttoMemory.tsx"), "utf8");
    expect(
      source,
      "OttoMemory 又手写了一份 chip 文案 —— 守卫认得的和界面发出的会先后漂移",
    ).not.toContain("Let me describe my brand to you");
    expect(source).toContain("BRAND_MEMORY_STARTERS");
  });

  it("前门的目标格子标签不再自己写一份", () => {
    const source = readFileSync(path.join(WEB_ROOT, "components/otto/OttoFrontDoor.tsx"), "utf8");
    for (const label of Object.values(FRONT_DOOR_GOAL_LABELS)) {
      expect(
        source,
        `OttoFrontDoor 又手写了标签「${label}」—— 守卫认得的和格子发出的会先后漂移`,
      ).not.toContain(`"${label}"`);
    }
    expect(source).toContain("FRONT_DOOR_GOAL_LABELS");
  });
});

// ---------------------------------------------------------------------------
// 守卫完整性 —— 枚举**全部**建对话的门,不是手写几条已知路径
//
// 第一版这条测试写死了两个文件、并断言它们不含 `title: text.slice(0, 80)`。判官一枪打穿:
// 同一个文件里 `createEmptyCoworkThread` 写的是 `title.slice(0, 80)`(变量名不同),
// 于是那扇门没有守卫、测试照样绿 —— 而它正是前门真正走的那一扇。
//
// 所以判据换成结构的:扫全仓找出每一处 `chatThread.create`,逐个看它给 `title` 的是什么。
// 只有两种形状算安全:走 `newThreadTitle(...)`,或者写死默认名。将来任何人加第四扇门,
// 这条测试在他写下 `.slice(0, 80)` 的那一刻就红。
// ---------------------------------------------------------------------------
describe("#979 每一扇建对话的门都有命名守卫", () => {
  /** 递归收集 apps/web 下的源码文件(跳过测试、构建产物与依赖)。 */
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "__tests__") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) sourceFiles(full, out);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) out.push(full);
    }
    return out;
  }

  /** 每一处 `chatThread.create` 之后那段里给 `title` 的表达式。 */
  function threadCreateTitles(): { where: string; expression: string }[] {
    const found: { where: string; expression: string }[] = [];
    for (const file of sourceFiles(WEB_ROOT)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!line.includes("chatThread.create(")) return;
        // 建对话的 data 很短:同一行(单行写法)或紧接着的几行里一定有 title。
        const window = lines.slice(i, i + 10).join("\n");
        const m = /title:\s*([^,}\n]+)/.exec(window);
        found.push({
          where: `${path.relative(WEB_ROOT, file)}:${i + 1}`,
          expression: (m?.[1] ?? "<没有 title 字段>").trim(),
        });
      });
    }
    return found;
  }

  it("扫得到全部三扇门(枚举本身不许悄悄变空)", () => {
    const sites = threadCreateTitles();
    expect(sites.length, "建对话的门一扇都没扫到 —— 这条测试正在空转").toBeGreaterThanOrEqual(3);
  });

  it("每一处 chatThread.create 的标题要么走 newThreadTitle,要么是写死的默认名", () => {
    for (const site of threadCreateTitles()) {
      const safe =
        site.expression.startsWith("newThreadTitle(") ||
        /^"[^"]*"$/.test(site.expression); // 写死的默认名(如 "Untitled")
      expect(
        safe,
        `${site.where} 的标题是 \`${site.expression}\` —— 没走命名守卫,` +
          `我们自己的罐头文案会从这扇门变成商家的对话名与画布名`,
      ).toBe(true);
    }
  });
});
