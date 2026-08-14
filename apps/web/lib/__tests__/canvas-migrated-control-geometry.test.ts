/**
 * #840 第四车 —— 「组件默认值悄悄落到屏幕上」这一类缺陷的机器闸(判官 r1 P1-1 的一般化)。
 *
 * ── 病是什么 ────────────────────────────────────────────────────────────
 * `@/components/ui` 的 Button / Input / Textarea / SelectTrigger 各自带默认尺寸
 * (`h-11` / `h-11` / `min-h-16` / `data-[size=default]:h-9`,外加 `px-5` 一类内距)。
 * 迁移时,凡是**旧写法没有声明**的属性,组件的默认值就会落到屏幕上 —— 那不是「细微视觉
 * 打磨」,是重排。判官 r1 P1-1 抓到一处(GeneratingBody 的 Check again:27.5px → 44px),
 * 并明说「只抓到这一处不代表只有一处」。逐个自查后确实还有第二处(StoryboardCard 的时长
 * 选择器,约 26px → 36px)。
 *
 * ── 这一闸钉的不是那两处,是那两条判据 ──────────────────────────────────
 * 「每个 Button 都要写高度」是**错的**规矩:普通 CTA 本来就该用默认高度,本车之前
 * StoryboardCard 里就有一堆。真正的不变量只有两条,两条都精确、都不误伤:
 *
 *  ①「几何来自别处」的调用点必须显式压回。判据是它**自己带着**几何来源:一份 inline
 *    `style`,或者一个写死尺寸的旧配方类(`.cv-tb` / `.cv-play` / `.cv-lineage-row`)。
 *    这类调用点的样子由那份来源决定,而来源**没写到**的每一项都会被组件默认值填上 ——
 *    GeneratingBody 那一处正是如此(inline style 没写 height)。
 *
 *  ② SelectTrigger 的高度必须写成 `data-[size=…]:h-…`。它的默认高度藏在
 *    `data-[size=default]:h-9`(类+属性,专有度 0,2,0)后面,而 twMerge 只在**同一组
 *    修饰符**内消解冲突 —— 裸写 `h-auto` 既压不过它、也挤不掉它,看着写了其实没生效。
 *
 * 红→绿演练(逐一实做,做完全部还原):
 *   · 去掉 GeneratingBody 的 `h-auto` ⇒ 第①闸红并点名那一行。
 *   · 把 StoryboardCard 的 `data-[size=default]:h-auto` 改回裸 `h-auto` ⇒ 第②闸红。
 *   · 去掉 `CV_TOOLBAR_BUTTON_CLASS` 的 `p-0` ⇒ 第③闸红。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");
const read = (relative: string) => fs.readFileSync(path.join(WEB_ROOT, relative), "utf8");

/** 第四车迁过的界面文件。清单写死 —— 别的车的文件由别的车自己收账。 */
const CAR4_FILES = [
  "components/canvas/FlowCanvas.tsx",
  "components/canvas/nodes/ImageNode.tsx",
  "components/canvas/nodes/VideoNode.tsx",
  "components/canvas/nodes/TextNode.tsx",
  "components/canvas/nodes/GeneratingBody.tsx",
  "components/canvas/nodes/NodeLineagePanel.tsx",
  "components/canvas/NorthstarCanvasWorkspace.tsx",
  "components/canvas/CanvasLineagePanel.tsx",
  "components/canvas/CanvasComparePanel.tsx",
  "components/canvas/NorthstarHome.tsx",
  "components/otto/StoryboardCard.tsx",
];

const SIZED_CONTROLS = ["Button", "Input", "Textarea", "SelectTrigger"];

/** 写死了尺寸、且专有度高过工具类的三个旧配方类(见 app/globals.css)。 */
const LEGACY_GEOMETRY_CLASSES = ["cv-tb", "cv-play", "cv-lineage-row"];

/** 显式的高度声明(含 `data-[…]:` 修饰形式),或本车两个自带高度的共享常量。 */
const DECLARES_HEIGHT = /\bh-auto\b|\bh-\d|\bh-\[|\bmin-h-|:h-auto\b|:h-\d|NODE_TOOL_BUTTON_CLASS|CV_TOOLBAR_BUTTON_CLASS/;

/** 一个开标签的完整文本(从 `<Name` 到与之配对的 `>`,跳过字符串与花括号里的 `>`)。 */
function openingTags(source: string, name: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  for (const match of source.matchAll(new RegExp(`<${name}[\\s>/]`, "g"))) {
    const from = match.index!;
    let depth = 0;
    let quote: string | null = null;
    let i = from;
    for (; i < source.length; i++) {
      const ch = source[i]!;
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    out.push({ text: source.slice(from, i + 1), line: source.slice(0, from).split("\n").length });
  }
  return out;
}

function car4Controls(): { file: string; control: string; line: number; text: string }[] {
  return CAR4_FILES.flatMap((file) => {
    const source = read(file);
    return SIZED_CONTROLS.flatMap((control) =>
      openingTags(source, control).map((tag) => ({ file, control, line: tag.line, text: tag.text })),
    );
  });
}

describe("#840 车4 — 组件默认尺寸不许悄悄落到屏幕上", () => {
  it("① 几何来自 inline style 或旧配方类的调用点,必须显式压回高度", () => {
    const naked: string[] = [];
    for (const c of car4Controls()) {
      const carriesOwnGeometry =
        c.text.includes("style={{") || LEGACY_GEOMETRY_CLASSES.some((cls) => c.text.includes(cls));
      if (!carriesOwnGeometry) continue; // 普通 CTA:用组件默认高度本来就是对的
      if (DECLARES_HEIGHT.test(c.text) || LEGACY_GEOMETRY_CLASSES.some((cls) => c.text.includes(cls))) continue;
      naked.push(
        `${c.file}:${c.line} <${c.control}> 的样子来自它自己那份 inline style,但没写高度 —— ` +
          `组件默认的 h-11 / min-h-16 会落到屏幕上。显式压回(h-auto 或它原来的高度)。`,
      );
    }
    expect(naked).toEqual([]);
  });

  it("② SelectTrigger 的高度必须写成 data-[size=…] 形式,裸 h-* 压不过它自己的默认值", () => {
    const wrong: string[] = [];
    for (const c of car4Controls()) {
      if (c.control !== "SelectTrigger") continue;
      if (!/\bh-auto\b|\bh-\d|\bh-\[/.test(c.text)) continue; // 没写高度 = 有意用默认值
      if (/data-\[size=[^\]]+\]:h-/.test(c.text)) continue;
      wrong.push(
        `${c.file}:${c.line} SelectTrigger 写了裸 h-*,但它的默认高度是 ` +
          `data-[size=default]:h-9(类+属性 0,2,0),裸写既压不过也挤不掉 —— ` +
          `改成 data-[size=default]:h-… 才真的生效。`,
      );
    }
    expect(wrong).toEqual([]);
  });

  it("③ 两个共享常量各自带着它们该带的那一份", () => {
    // 卡片工具条那一枚:自己写死了几何。
    expect(read("components/canvas/nodes/node-tool-button.ts")).toMatch(/\bh-auto\b/);
    // 板底工具条那一枚:尺寸来自 `.gb .cv-tb`(0,2,0,压得过工具类),所以它要钉的是
    // 旧类还在,外加把 Button 会盖掉、而旧类没声明的那一项(内距)显式压回。
    const constant = read("components/canvas/FlowCanvas.tsx").match(/const CV_TOOLBAR_BUTTON_CLASS = "([^"]+)"/)?.[1] ?? "";
    expect(constant).toContain("cv-tb");
    expect(constant, "旧类没声明内距,Button 的 px-5 会把 36px 的方钮挤爆").toContain("p-0");
    // 海报播放键同理(30px 圆钮)。
    expect(read("components/canvas/nodes/VideoNode.tsx")).toMatch(/cv-play[^"]*\bp-0\b/);
  });

  it("扫描器真的在扫(regex 塌了不许绿)", () => {
    const all = car4Controls();
    // 2026-08-14 实测:本车 11 个文件里共 60+ 个 shadcn 控件调用点。
    expect(all.length).toBeGreaterThanOrEqual(50);
    expect(all.filter((c) => c.text.includes("style={{")).length).toBeGreaterThanOrEqual(3);
    expect(all.filter((c) => c.control === "SelectTrigger").length).toBeGreaterThanOrEqual(1);
    // 判据本身认得出该认的东西。
    expect(DECLARES_HEIGHT.test('<Button className="nodrag nopan">')).toBe(false);
    expect(DECLARES_HEIGHT.test('<Button className="nodrag nopan h-auto">')).toBe(true);
  });
});
