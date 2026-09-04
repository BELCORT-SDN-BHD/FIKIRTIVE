/**
 * FRONT-A15 —— Canvas 与 Create 两面「渲染出的控件集合与设计夹具逐控件一致」。
 *
 * 与 `front-a14-canvas-alignment.test.ts` 的分工:那份逐条问「这个控件在不在」,是**点名**;
 * 这份把两边的控件**整套读出来再比集合**,所以它对「多画一个」和「少画一个」同样敏感 ——
 * 生产多长一颗按钮,即使没人想到要为它写断言,集合也对不上,当场红。派工书要求的变异判据
 * (多画一个图标／少一个 ⇒ 红)就是这条。
 *
 * 权威(只读,不得改夹具迁就实现 —— §7.4 裁决九):
 *   · `design-system/patterns/canvas/CanvasReference.tsx` —— 画布、卡片、节点操作条
 *   · `design-system/patterns/canvas/CreationComposer.tsx` —— composer 与「+ Add context」
 *
 * 已登记的两处「设计有、生产不显示」,按 Founder 2026-09-03 rule ①「无契约的控件不出现」:
 *   · 节点 ⋯ 菜单里的 Share selected output / Duplicate
 *   · composer 的 Add URL
 * 以及裁决六点名的 Frame select 与 撤销／重做。这四件在下面都是**断言的一部分**,不是遗漏。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { CanvasNodeFooter, canvasCardVersion } from "@/components/canvas/nodes/CanvasNodeFooter";
import { canvasMediaNodeSize } from "@/lib/canvas-node-size";

const WEB_ROOT = process.cwd();
const codeOf = (rel: string) => readFileSync(path.join(WEB_ROOT, rel), "utf8");

/** 去掉注释:注释里写着「Add URL 不渲染」这类说明,原文含有被禁的字串。 */
const codeOnly = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

const pattern = codeOf("design-system/patterns/canvas/CanvasReference.tsx");
const patternComposer = codeOf("design-system/patterns/canvas/CreationComposer.tsx");
const imageNode = codeOf("components/canvas/nodes/ImageNode.tsx");
const videoNode = codeOf("components/canvas/nodes/VideoNode.tsx");
const flowCanvas = codeOf("components/canvas/FlowCanvas.tsx");
const chatStream = codeOf("components/otto/OttoChatStream.tsx");
const startSomething = codeOf("components/start-something/StartSomething.tsx");

/** 源码里从 `start` 到其后第一个 `end` 的那一段 —— 用来把「一条操作条」从整份文件里圈出来。 */
function region(source: string, start: string, end: string, label: string): string {
  const from = source.indexOf(start);
  expect(from, `${label}: 找不到起点 \`${start}\``).toBeGreaterThan(-1);
  const to = source.indexOf(end, from + start.length);
  expect(to, `${label}: 找不到终点 \`${end}\``).toBeGreaterThan(-1);
  return source.slice(from, to);
}

const unique = (values: string[]) => [...new Set(values)];
const matchAll = (source: string, re: RegExp) => unique([...source.matchAll(re)].map((m) => m[1]!.trim()));

/** 夹具用 `aria-label` 命名每一颗键;生产的 `NodeToolbarIconButton` / `CanvasNodeMoreMenu` 用
 *  `label`(它自己再挂到 aria-label 上)。`visibleLabel=` 与 `aria-label=` 不算,只取裸 `label=`。 */
const ARIA_LABELS = /aria-label="([^"]+)"/g;
const PROP_LABELS = /(?<![-A-Za-z])label="([^"]+)"/g;
/**
 * 一段区域里每条下拉项的**字面**可见文字。
 *
 * 不用一条整体正则:`<DropdownMenuItem onSelect={() => …}>` 的属性里就带着 `>`(箭头函数),
 * 任何 `[^>]*>` 都会在那儿早退、一条也匹配不到。改成按标签切段,再在每段里取「图标之后的
 * 那截裸文本」。文案本身是表达式(例如 `{open ? "收起" : "展开"}`)的项没有字面文字,取不到
 * 就不算 —— 用到它的断言问的都是「某个字面文案在不在」,表达式项本来就不该当字面文案比。
 */
function menuItemTexts(source: string): string[] {
  return unique(
    source
      .split("<DropdownMenuItem")
      .slice(1)
      .map((chunk) => /<\w*Icon[^>]*\/>\s*(?:\{[\s\S]*?\}\s*)?([^<{]+)</.exec(chunk)?.[1]?.trim() ?? "")
      .filter(Boolean),
  );
}

// ── 夹具侧:设计给一张选中卡片的那一条操作条 ────────────────────────────────
const FIXTURE_TOOLBAR = region(
  pattern,
  '{selected && artifact.status === "ready" &&',
  "</div>}",
  "夹具节点操作条",
);
const FIXTURE_TOOLBAR_CONTROLS = matchAll(FIXTURE_TOOLBAR, ARIA_LABELS);
const FIXTURE_MORE_ITEMS = menuItemTexts(FIXTURE_TOOLBAR);

// ── 生产侧:两种媒体卡各自那一条 ────────────────────────────────────────────
const imageToolbar = region(codeOnly(imageNode), "<NodeToolbar", "</NodeToolbar>", "生产图片卡操作条");
const videoToolbar = region(codeOnly(videoNode), "<NodeToolbar", "</NodeToolbar>", "生产视频卡操作条");
const IMAGE_CONTROLS = matchAll(imageToolbar, PROP_LABELS);
const VIDEO_CONTROLS = matchAll(videoToolbar, PROP_LABELS);
const IMAGE_MORE_ITEMS = menuItemTexts(
  region(imageToolbar, "<CanvasNodeMoreMenu", "</CanvasNodeMoreMenu>", "生产图片卡 ⋯ 菜单"),
);

// ── composer 的「+ Add context」两边各有哪几项 ──────────────────────────────
const menuItemsOf = (source: string, label: string) =>
  menuItemTexts(
    region(source, "<DropdownMenuLabel>Add a reference</DropdownMenuLabel>", "</DropdownMenuGroup>", label),
  );
const FIXTURE_ADD_CONTEXT = menuItemsOf(patternComposer, "夹具 Add context 菜单");
const PRODUCTION_ADD_CONTEXT = menuItemsOf(codeOnly(chatStream), "生产 Add context 菜单");

describe("FRONT-A15 节点操作条:整套控件与夹具比集合", () => {
  it("FRONT-A15: 夹具那一条就是设计的五颗键 —— 比对的基准先立住", () => {
    // 基准本身错了,下面每一条都白比。夹具变了要先改设计,不是改这条。
    expect(FIXTURE_TOOLBAR_CONTROLS).toEqual([
      "Edit with Otto",
      "Create variations",
      "Animate",
      "Download",
      "More actions",
    ]);
  });

  it("FRONT-A15: 图片卡渲染出的控件集合与夹具逐控件一致,不多不少", () => {
    // 集合相等 —— 多画一颗(第六颗键)或少画一颗都在这里红,不需要有人事先想到那一颗。
    expect(IMAGE_CONTROLS).toEqual(FIXTURE_TOOLBAR_CONTROLS);
  });

  it("FRONT-A15: 视频卡是同一套,只少 Animate —— 一段视频不用再动画一次", () => {
    expect(VIDEO_CONTROLS).toEqual(FIXTURE_TOOLBAR_CONTROLS.filter((label) => label !== "Animate"));
    expect(VIDEO_CONTROLS, "视频卡长出了 Animate").not.toContain("Animate");
  });

  it("FRONT-A15: ⋯ 菜单里 Share selected output 与 Duplicate 不出现(rule ①:无契约的控件不出现)", () => {
    // 夹具三项;生产只保留有真实动作的那一项,另外两项没有可调用的服务端动作。
    expect(FIXTURE_MORE_ITEMS).toContain("Share selected output");
    expect(FIXTURE_MORE_ITEMS).toContain("Duplicate");
    expect(IMAGE_MORE_ITEMS, "渲染了没有契约的 Share selected output").not.toContain("Share selected output");
    expect(IMAGE_MORE_ITEMS, "渲染了没有契约的 Duplicate").not.toContain("Duplicate");
    // 夹具与生产都保留的那一项仍在:菜单不是空的。
    expect(FIXTURE_MORE_ITEMS).toContain("Remove from canvas");
    expect(IMAGE_MORE_ITEMS).toContain("Remove from canvas");
  });
});

describe("FRONT-A15 composer 的「+ Add context」:两项,并说明第三项为什么不在", () => {
  it("FRONT-A15: 夹具是三项 —— 比对的基准先立住", () => {
    expect(FIXTURE_ADD_CONTEXT).toEqual(["Upload image", "Choose from Library", "Add URL"]);
  });

  it("FRONT-A15: 生产恰好两项,Add URL 不出现", () => {
    expect(PRODUCTION_ADD_CONTEXT).toHaveLength(2);
    // 上传那一项的文案比夹具长半句:这个选择器真的也收视频,写「Upload image」是半句真话。
    expect(PRODUCTION_ADD_CONTEXT[0]).toBe("Upload image or video");
    expect(PRODUCTION_ADD_CONTEXT[1]).toBe("Choose from Library");
    expect(PRODUCTION_ADD_CONTEXT, "渲染了没有契约的 Add URL").not.toContain("Add URL");
  });

  it("FRONT-A15: 两项都接在既有能力上,不是摆设", () => {
    expect(chatStream, "上传那一项没接现成的文件选择器").toContain("fileInputRef.current?.click()");
    expect(chatStream, "素材库那一项没接现成的挑选器").toContain("CanvasLibraryPicker");
  });

  it("FRONT-A15: Add URL 缺席的理由写在代码里,不只写在 PR 里", () => {
    // 下一个人读到这段菜单时,必须当场看见「为什么少一项」,否则半年后会有人把它补回来。
    expect(chatStream).toMatch(/Add URL[\s\S]{0,400}otto-media-port/);
  });

  it("FRONT-A15: 起步页那一份 composer 仍不渲染 Add context —— 引用带不进画布(契约待下一刀)", () => {
    // `createCanvasConversation` 的 handoff 只落 `{prompt, threadId}`;在契约补上之前,
    // 起步页画一颗「加参考」等于让商家选一件navigation 之后就消失的东西。
    // 登记:`docs/specs/frontend-baseline.md` §7.3「⑨ 下一刀 · 起步页参考契约」。
    expect(codeOnly(startSomething), "起步页渲染了带不进画布的 Add context").not.toContain("Add a reference");
    expect(codeOnly(startSomething)).not.toContain("Add context");
  });
});

describe("FRONT-A15 卡片:4:5 的井 + 名称／版本页脚", () => {
  it("FRONT-A15: 夹具的卡是「媒体井 + 42px 页脚」,井按 4:5 —— 基准先立住", () => {
    expect(pattern).toContain("h-[calc(100%-42px)]");
    expect(pattern).toContain("aspect-[4/5]");
    // 夹具页脚两栏:左名称、右 v{版本}。
    expect(pattern).toMatch(/<footer className="flex h-\[42px\][^>]*>[\s\S]{0,200}\{artifact\.name\}/);
    expect(pattern).toContain("v{artifact.version}");
  });

  it("FRONT-A15: 生产卡的外形来自这张图自己的比例 —— 4:5 的出片就落在 4:5 的井里", () => {
    // 卡不是钉死的 4:5 方框,而是按真实媒体比例收 —— 一张 4:5 的出片因此正好是夹具那个形状,
    // 一段 16:9 的视频也不会被硬塞进竖版。这两条一起是「按设计比例」在生产上的真身。
    expect(canvasMediaNodeSize({ width: 1024, height: 1280 }, { w: 320, h: 320 })).toEqual({ w: 256, h: 320 });
    expect(256 / 320).toBeCloseTo(4 / 5, 5);
    expect(canvasMediaNodeSize({ width: 1920, height: 1080 }, { w: 320, h: 320 })).toEqual({ w: 320, h: 180 });
  });

  it("FRONT-A15: 页脚两栏都填上了 —— 名称在左,版本在右", () => {
    const markup = renderToStaticMarkup(
      createElement(CanvasNodeFooter, {
        name: "Merdeka gift box",
        facts: { genJobId: "job_1", batchIndex: 1, batchSize: 4 },
      }),
    );
    expect(markup).toContain("Merdeka gift box");
    expect(markup).toContain("v2");
  });

  it("FRONT-A15: 名称走单一命名源,长提示词按词边界断,完整名留在 title=", () => {
    const long =
      "A warm editorial hero of the Merdeka gift box on a teal batik table with gold thread and soft window light";
    const markup = renderToStaticMarkup(
      createElement(CanvasNodeFooter, { name: long, facts: { batchIndex: 0, batchSize: 1 } }),
    );
    // 单一命名源 `@/lib/canvas-title` 的口径:56 字上限、按词边界断、加省略号。
    const visible = />([^<]*…)<\/span>/.exec(markup)?.[1];
    expect(visible, "页脚没有截断").toBeTruthy();
    const cut = visible!.slice(0, -1);
    // 「按词边界断」的真判据:截出来的是原文的前缀,而且原文在断点上的下一个字符是空格 ——
    // 只看「省略号前是个字母」不算,任何劈词的截断都能过。
    expect(long.startsWith(cut), "截出来的不是原名的前缀").toBe(true);
    expect(long.charAt(cut.length), `名字在「${cut}」处被从词中间劈开`).toBe(" ");
    expect(markup, "完整名没有留在 title=").toContain(`title="${long}"`);
  });

  it("FRONT-A15: 版本是服务器记下的批次序号,不是板上数出来的", () => {
    // 记下来了才有:第 1 张 = v1,第 2 张 = v2。
    expect(canvasCardVersion({ batchIndex: 0, batchSize: 4 })).toBe(1);
    expect(canvasCardVersion({ batchIndex: 3, batchSize: 4 })).toBe(4);
    // 没记下来的一律没有 —— 排队中的卡、越界的位置、坏数字,都不猜。
    expect(canvasCardVersion({})).toBeNull();
    expect(canvasCardVersion({ batchIndex: 2, batchSize: null })).toBeNull();
    expect(canvasCardVersion({ batchIndex: null, batchSize: 4 })).toBeNull();
    expect(canvasCardVersion({ batchIndex: 4, batchSize: 4 })).toBeNull();
    expect(canvasCardVersion({ batchIndex: 1.5, batchSize: 4 })).toBeNull();
    // 删掉同批的另一张不会让这张改号:序号只读记录,不数板上的卡。
    expect(canvasCardVersion({ batchIndex: 3, batchSize: 4 })).toBe(4);
  });

  it("FRONT-A15: 没有版本时页脚只有名称,没有 v?,也没有空栏占位", () => {
    const markup = renderToStaticMarkup(
      createElement(CanvasNodeFooter, { name: "Merdeka gift box", facts: {} }),
    );
    expect(markup).toContain("Merdeka gift box");
    expect(markup).not.toContain("v?");
    expect(markup).not.toMatch(/>v\d/);
  });

  it("FRONT-A15: 两种媒体卡都把记录下来的批次交给页脚,没有一边漏接", () => {
    for (const [name, source] of [["ImageNode", imageNode], ["VideoNode", videoNode]] as const) {
      expect(codeOnly(source), `${name} 的页脚没拿到批次记录`).toContain("<CanvasNodeFooter name={originalPrompt} facts={recorded} />");
      expect(codeOnly(source), `${name} 读了两遍批次记录 —— 徽章与页脚会各说各话`)
        .toContain("const recorded = canvasRecordedFacts(d);");
    }
  });
});

describe("FRONT-A15 裁决六:Frame select 与撤销／重做两边都不出现", () => {
  it("FRONT-A15: 三颗键在夹具里都在 —— 基准先立住", () => {
    expect(pattern).toContain("Frame select");
    expect(pattern).toContain('aria-label="Undo"');
    expect(pattern).toContain('aria-label="Redo"');
  });

  it("FRONT-A15: 画布不渲染这三颗 —— 点了没反应的假按钮不如没有", () => {
    const board = codeOnly(flowCanvas);
    expect(board, "生产渲染了 Frame select").not.toContain("Frame select");
    expect(board, "生产渲染了 Undo").not.toMatch(/label="Undo"/);
    expect(board, "生产渲染了 Redo").not.toMatch(/label="Redo"/);
  });

  it("FRONT-A15: 起步页也没有这三颗(它本来就没有画板,这条守的是别人顺手搬过去)", () => {
    const entry = codeOnly(startSomething);
    expect(entry).not.toContain("Frame select");
    expect(entry).not.toMatch(/label="Undo"/);
    expect(entry).not.toMatch(/label="Redo"/);
  });
});
