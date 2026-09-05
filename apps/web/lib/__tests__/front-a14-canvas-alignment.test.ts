/**
 * FRONT-A14 — the production canvas, control by control, against the approved design
 * (`docs/specs/frontend-baseline.md` §2 FRONT-A14: 视觉与交互与已批准的设计文档一致).
 *
 * The design authority is `apps/web/design-system/patterns/canvas/` — `CanvasReference.tsx` for the
 * board and its cards, `CreationComposer.tsx` for the composer. `canvas-pattern-reference.test.ts`
 * pins the FIXTURE; this file pins PRODUCTION against it, which is the half FRONT-A14 is about.
 *
 * SOURCE-LEVEL, and deliberately so for most of it. A canvas card only renders inside a React Flow
 * provider with a live board around it, so a DOM assertion here would be a mock of the board rather
 * than the board — and the class of regression this guards is "somebody put the old text button
 * back", which is exactly what source text answers. The one piece that is a plain component
 * (`CanvasNodeFooter`) is rendered for real.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { CanvasNodeFooter } from "@/components/canvas/nodes/CanvasNodeFooter";

const WEB_ROOT = process.cwd();
const codeOf = (rel: string) => readFileSync(path.join(WEB_ROOT, rel), "utf8");

/**
 * The file with its commentary removed.
 *
 * Every negative assertion below reads this rather than the raw source: a comment SAYING "the
 * text button «More like this» is gone" contains the very words the assertion forbids, so a
 * raw-text `not.toContain` would fail on its own explanation and quietly push future authors into
 * writing code they cannot describe. Positive assertions keep reading the raw source — a label
 * that only exists in a comment is caught by the negative half anyway.
 */
const codeOnly = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

const imageNode = codeOf("components/canvas/nodes/ImageNode.tsx");
const videoNode = codeOf("components/canvas/nodes/VideoNode.tsx");
const flowCanvas = codeOf("components/canvas/FlowCanvas.tsx");
const nodeResize = codeOf("components/canvas/nodes/NodeResize.tsx");
const chatStream = codeOf("components/otto/OttoChatStream.tsx");
const globalsCss = codeOf("design-system/foundations/globals.css");
const pattern = codeOf("design-system/patterns/canvas/CanvasReference.tsx");
const patternComposer = codeOf("design-system/patterns/canvas/CreationComposer.tsx");

describe("FRONT-A14 画布节点卡片", () => {
  it("FRONT-A14: a media card is a media well plus the pattern's own named footer", () => {
    // The pattern's card: `h-[calc(100%-42px)]` media + a 42px footer. Production splits the same
    // two boxes and declares the 42 once, in CSS, for both of them to read.
    expect(pattern).toContain("h-[calc(100%-42px)]");
    for (const [name, source] of [["ImageNode", imageNode], ["VideoNode", videoNode]] as const) {
      expect(source, `${name} 的卡不是「媒体井 + 页脚」两块`).toContain("cv-node-frame cv-node-frame-media");
      expect(source, `${name} 的媒体没有自己的井`).toContain('<div className="cv-node-body">');
      expect(source, `${name} 少了页脚`).toContain("<CanvasNodeFooter");
    }
    expect(globalsCss, "42px 没有单点声明").toContain("--cv-node-footer: 42px");
    // One declaration, two readers — a second literal 42 in a component is how they drift apart.
    expect(codeOnly(imageNode)).not.toMatch(/42px/);
    expect(codeOnly(videoNode)).not.toMatch(/42px/);
  });

  it("FRONT-A14: the footer says the card's own name, and says nothing when there is none", () => {
    expect(renderToStaticMarkup(createElement(CanvasNodeFooter, { name: "Merdeka gift box" })))
      .toContain("Merdeka gift box");
    // A card with no prompt (an upload dropped on the board) gets no invented title.
    expect(renderToStaticMarkup(createElement(CanvasNodeFooter, { name: "   " }))).toBe("");
    expect(renderToStaticMarkup(createElement(CanvasNodeFooter, {}))).toBe("");
  });

  it("FRONT-A14: the picked card's own frame is the pattern's ink hairline + halo", () => {
    // Scoped to the CARD'S OWN frame on purpose. It does NOT claim the picked card is a single
    // visual language on screen — it is not, and the two things around it are registered in the
    // PR's difference table (the coral resize handles below, and FlowCanvas's session-colour ring).
    expect(pattern).toContain("ring-2 ring-foreground/15");
    expect(globalsCss).toContain("border-color: var(--foreground);");
    expect(codeOnly(globalsCss), "选中态还是旧的 2px primary 边框")
      .not.toContain("border: 2px solid var(--primary)");
  });

  it("FRONT-A14: the coral resize handles are a registered divergence, not alignment", () => {
    // The pattern's picked card carries ONE ink hairline and nothing else — no size handles.
    expect(codeOnly(pattern), "夹具里出现了调整尺寸控件，这条断言的基准错了")
      .not.toContain("NodeResizer");
    // Production shows eight coral handles around it (NodeResize.tsx, untouched by this round).
    // Pinned so the registration and the screen cannot drift apart in silence: change either side
    // and this fails, which is the cue to update the PR's "已登记的形状差异" table.
    expect(nodeResize, "调整尺寸框的颜色变了 —— 先更新差异登记表再改这条")
      .toContain('color="#EC5828"');
  });

  it("FRONT-A14: the letterbox behind a picture is card chrome, not near-black", () => {
    // The pattern's media well is `bg-muted`; `var(--foreground)` read as part of the picture.
    expect(globalsCss).toMatch(/\.cv-node-media \{[^}]*background: var\(--muted\);/);
  });
});

describe("FRONT-A14 节点操作条", () => {
  /** The five the pattern puts on a picked artifact, by the name a screen reader reads. */
  const PATTERN_ACTIONS = ["Edit with Otto", "Create variations", "Animate", "Download"] as const;

  it("FRONT-A14: the picked card offers the pattern's five controls, in its order", () => {
    for (const label of PATTERN_ACTIONS) {
      expect(pattern, `设计里没有「${label}」,这条断言的基准错了`).toContain(label);
    }
    for (const label of ["Edit with Otto", "Create variations", "Animate", "Download"]) {
      expect(imageNode, `图片卡少了「${label}」`).toContain(`label="${label}"`);
    }
    // A video card is already the animation, so it has four of the five.
    for (const label of ["Edit with Otto", "Create variations", "Download"]) {
      expect(videoNode, `视频卡少了「${label}」`).toContain(`label="${label}"`);
    }
    expect(codeOnly(videoNode), "视频卡不该有 Animate").not.toContain('label="Animate"');
    // …and the fifth is the pattern's own `⋯`, with Remove from canvas inside it.
    for (const [name, source] of [["ImageNode", imageNode], ["VideoNode", videoNode]] as const) {
      expect(source, `${name} 少了 ⋯ 菜单`).toContain("<CanvasNodeMoreMenu");
      expect(source, `${name} 的 ⋯ 里没有「Remove from canvas」`).toContain("Remove from canvas");
    }
    expect(pattern).toContain("Remove from canvas");
  });

  it("FRONT-A14: the trunk's own extra buttons are gone from the bar, not merely renamed", () => {
    // Eight mixed icon-and-text buttons was accretion, not a design. Nothing is lost: Info,
    // Lineage and Detail moved into the ⋯ menu the pattern already puts there.
    for (const [name, raw] of [["ImageNode", imageNode], ["VideoNode", videoNode]] as const) {
      const source = codeOnly(raw);
      expect(source, `${name} 的操作条还留着文字按钮「More like this」`).not.toContain("More like this");
      expect(source, `${name} 的操作条还留着文字按钮「Make video」`).not.toContain("Make video");
      expect(source, `${name} 还把「Send to Otto」当成一颗独立按钮`).not.toContain('visibleLabel="Send to Otto"');
      expect(source, `${name} 还把 Delete 留在可见操作条上`).not.toContain('visibleLabel="Delete"');
      expect(source, `${name} 的 Info 没有收进 ⋯ 菜单`).not.toContain('visibleLabel="Info"');
      expect(source, `${name} 的 Lineage 没有收进 ⋯ 菜单`).not.toContain('visibleLabel="Lineage"');
      expect(source, `${name} 的 Detail 没有收进 ⋯ 菜单`).not.toContain('visibleLabel="Detail"');
    }
  });

  it("FRONT-A14: Download reuses the board's own `<a download>`, it does not grow a second one", () => {
    // 不新造业务层: one card's save is the "N selected" bar's save with a one-item list, named by
    // the same rule (`canvasDownloadFileName`), so a file saved alone and in a batch match.
    expect(flowCanvas).toContain("canvasDownloadFileName");
    expect(flowCanvas).toContain("getOnDownload");
    expect(flowCanvas).toMatch(/getOnDownload[\s\S]{0,900}downloadSelection\(\[\{/);
    // Exactly one anchor-driven save path in the whole board.
    expect(flowCanvas.match(/link\.download = /g) ?? []).toHaveLength(1);
    for (const [name, source] of [["ImageNode", imageNode], ["VideoNode", videoNode]] as const) {
      expect(codeOnly(source), `${name} 自己造了下载路径`).not.toContain("document.createElement");
      expect(source, `${name} 的 Download 没有接板子的现成动作`).toContain("d.onDownload?.()");
    }
  });

  it("FRONT-A14: no second input bar under a picked card (Founder 2026-09-03 裁决①)", () => {
    // 裁决①: the composer that floated under a picked card ("Evolve" — rewrite the prompt and
    // make another one) is removed; rewriting goes through "Edit with Otto" on the card's own
    // bar. The approved pattern puts exactly one input on the board, and it is the creation
    // band's — never a second one hanging off a card.
    expect(existsSync(path.join(WEB_ROOT, "components/canvas/nodes/NodeRemakeComposer.tsx"))).toBe(false);
    for (const [name, raw] of [["ImageNode", imageNode], ["VideoNode", videoNode]] as const) {
      const source = codeOnly(raw);
      expect(source, `${name} 还挂着卡下方那条改写输入条`).not.toContain("NodeRemakeComposer");
      expect(source, `${name} 还留着那条输入条的容器`).not.toContain("cv-node-remake-toolbar");
      expect(source, `${name} 还留着那条输入条的输入框`).not.toContain("prompt and make a new");
    }
    // 板子那一头也没有留给它的接线，样式表里也没有留给它的规则。
    expect(codeOnly(flowCanvas), "板子还在给卡挂 onEvolve").not.toContain("onEvolve");
    expect(globalsCss, "样式表里还留着那条输入条的规则").not.toContain("cv-node-remake");
    // 能力没丢：改写走的是操作条上这颗键。
    expect(imageNode).toContain('label="Edit with Otto"');
    expect(videoNode).toContain('label="Edit with Otto"');
  });

  it("FRONT-A14: Share and Duplicate are NOT rendered — there is no contract behind them", () => {
    // 设计有、后端没有契约的控件不渲染 (Founder 2026-09-03 rule ①). The pattern's ⋯ carries
    // "Share selected output" and "Duplicate"; the only share link in the repo is bound to a
    // ScheduledPost (`sharePostPreview`), and nothing copies a canvas node.
    expect(pattern).toContain("Share selected output");
    expect(pattern).toContain("Duplicate");
    for (const [name, raw] of [["ImageNode", imageNode], ["VideoNode", videoNode]] as const) {
      const source = codeOnly(raw);
      expect(source, `${name} 渲染了没有契约的 Share`).not.toContain("Share selected output");
      expect(source, `${name} 渲染了没有契约的 Duplicate`).not.toContain("Duplicate");
    }
  });
});

describe("FRONT-A14 Otto 侧栏 composer 与对话历史", () => {
  it("FRONT-A14: the composer offers the pattern's Add context menu, wired to real capabilities", () => {
    expect(patternComposer).toContain("Add context");
    expect(patternComposer).toContain("Add a reference");
    expect(chatStream, "输入框还是一颗光秃的附件图标").toContain('aria-label="Add a reference"');
    expect(chatStream).toContain("Add context");
    expect(chatStream, "上传那一项没接现成的文件选择器").toContain("fileInputRef.current?.click()");
    expect(chatStream, "素材库那一项没接现成的能力").toContain("Choose from Library");
    expect(chatStream).toContain("CanvasLibraryPicker");
  });

  it("FRONT-A14: Add URL is NOT rendered — no server action a composer can call", () => {
    // The pattern's third item. The only URL import is `ctx.mediaImport.fromUrl`, a tool Otto
    // calls inside its own turn (`lib/otto-media-port.ts`); a button here would do nothing.
    expect(patternComposer).toContain("Add URL");
    expect(codeOnly(chatStream), "渲染了没有契约的 Add URL").not.toContain("Add URL");
  });

  it("FRONT-A14: the Library picker reads the owner-gated Library action and the board's own mapping", () => {
    const picker = codeOf("components/canvas/CanvasLibraryPicker.tsx");
    // 租户红线: the client never names an owner; `getGenerationHistory` calls `requireOwner()`.
    expect(picker).toContain("getGenerationHistory");
    expect(codeOnly(picker), "选素材的路径自己碰了数据库").not.toContain("prisma");
    expect(codeOnly(picker), "客户端提交了 ownerId/orgId").not.toMatch(/ownerId|orgId/);
    // One mapping from "a generation" to "a composer reference", shared with the board.
    expect(picker).toContain("canvasComposerReferenceForNode");
  });

  it("FRONT-A14: the conversation dock is the pattern's 280px and clears the creation band", () => {
    // The pattern's Conversation surface is `w-[280px]` with a `max-h-[260px]` list, and the
    // creation band beside it starts at `left-[300px]`. 380px + the 16px inset reached 396px and
    // sat across the board's own tool column; 280 + 16 = 296 clears it at every width.
    expect(pattern).toContain('CanvasSurface className="pointer-events-auto w-[280px]"');
    expect(pattern).toContain("left-[300px]");
    expect(codeOnly(chatStream), "对话历史还是 380px").not.toContain("w-[380px]");
    expect(chatStream).toMatch(/canvasHistoryOpen \? "flex" : "hidden"[^`]*w-\[280px\]/);
    expect(globalsCss).toMatch(/\.gb \.cv-bottom-stack,\s*\.gb \.cv-creation-band \{\s*left: 300px;/);
  });
});

describe("FRONT-A14 设计有、生产暂不显示", () => {
  it("FRONT-A14: Frame select, Undo and Redo stay unrendered (Founder 2026-09-03 裁决)", () => {
    // All three exist in the pattern; none has anything to wire to, and a control that only
    // apologises is worse than no control.
    expect(pattern).toContain("Frame select");
    expect(pattern).toContain('aria-label="Undo"');
    expect(pattern).toContain('aria-label="Redo"');
    const board = codeOnly(flowCanvas);
    expect(board, "生产渲染了 Frame select").not.toContain('aria-label="Frame select"');
    expect(board, "生产渲染了 Undo").not.toMatch(/label="Undo"/);
    expect(board, "生产渲染了 Redo").not.toMatch(/label="Redo"/);
  });
});

describe("FRONT-A14 钱披露不因对齐设计而缩水", () => {
  it("FRONT-A14: both composer cost disclosures are still mounted, unchanged and side by side", () => {
    // Founder 2026-09-02 (钱引擎 §7.4 / MONEY-A10): 聊天输入框下**常驻**一行价目小字;
    // MONEY-A9 §7.3: the understanding price is on screen while the file picker is still closed.
    // Aligning the composer to the design may not quietly turn either into an on-request line.
    // ENGINE-A3(otto-engine.md §7.4/§7.6 处置一)之后是**三**行:第三行说这一轮对话本身
    // 也按用量计费 —— ⑦段把画布上那条直出的出图路撤了,同一张图从此必须先经过至少一轮对话。
    // 「常驻、不许改成按需披露」这条纪律对三行同样有效(裁决十三,frontend-baseline.md §5)。
    expect(chatStream).toContain("<UnderstandingCostHint />");
    expect(chatStream).toContain("<SearchCostHint />");
    expect(chatStream).toContain("<ConversationCostHint />");
    const understandingAt = chatStream.indexOf("<UnderstandingCostHint />");
    const conversationAt = chatStream.indexOf("<ConversationCostHint />");
    expect(conversationAt - understandingAt, "几行披露被拆散了").toBeLessThan(200);
    // None is behind a menu, a hover or a press: no conditional between them and the composer.
    expect(chatStream).toMatch(
      /<div className="mb-2 flex flex-col gap-0\.5">\s*<UnderstandingCostHint \/>\s*<SearchCostHint \/>\s*<ConversationCostHint \/>\s*<\/div>/,
    );
  });
});

/**
 * 出片弹窗（t2v / Animate）里打的字看不见 —— 矩阵走查 P1-a。
 *
 * The prompt editor (`MentionInput`) is one component mounted on several surfaces. It used to
 * paint the Vapor dark-shell ink (`--fg-1`, #f6f7f9), so every LIGHT surface had to hand the ink
 * back with its own rule; the dialogs mount the editor bare inside `DialogContent`, got no such
 * rule, and rendered near-white text on the white popover (~1.05:1 — the merchant types and sees
 * nothing). The fix is the component reading the SEMANTIC ink token, so the assertions below are
 * a chain: (1) the one rule declares a semantic token, (2) that token really is readable on the
 * dialog's own surface in both themes, (3) nothing re-states it per surface again.
 */
const CSS = codeOnly(globalsCss);

/** A block at column 0, comments already stripped. Token roots and these rules have no nesting. */
function block(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `globals.css 里找不到 \`${selector}\``).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf("\n}", start));
}

/** The `color:` declaration's custom property — `background-color` must not answer for it. */
function inkTokenOf(rule: string): string | undefined {
  return /(?:^|[;{])\s*color:\s*var\((--[\w-]+)\)/m.exec(rule)?.[1];
}

/** A token's literal, read from one root, falling back to the Vapor `:root` it may still live in. */
function tokenValue(root: string, name: string): string {
  const read = (where: string) => new RegExp(`[\\s;{]${name}:\\s*([^;]+);`).exec(where)?.[1]?.trim();
  const value = read(root) ?? read(block(":root"));
  expect(value, `没有任何 token 根声明 ${name}`).toBeTruthy();
  return value as string;
}

/** `#rgb` / `#rrggbb` / `rgba(…)`, the last composited over `over` — 55% white on white is invisible. */
function rgb(color: string, over: [number, number, number]): [number, number, number] {
  const fn = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/.exec(color);
  if (fn) {
    const [r, g, b] = [fn[1], fn[2], fn[3]].map(Number) as [number, number, number];
    const a = fn[4] === undefined ? 1 : Number(fn[4]);
    return [r, g, b].map((c, i) => a * c + (1 - a) * over[i]) as [number, number, number];
  }
  const hex = color.replace("#", "");
  const wide = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  expect(wide, `看不懂的颜色字面量 ${color}`).toMatch(/^[0-9a-fA-F]{6}$/);
  return [0, 2, 4].map((i) => parseInt(wide.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.1 contrast ratio. */
function contrast(fg: string, bg: string): number {
  const surface = rgb(bg, [255, 255, 255]);
  const luminance = (c: [number, number, number]) =>
    c.map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : (((v / 255) + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + [0.2126, 0.7152, 0.0722][i] * v, 0);
  const [a, b] = [luminance(rgb(fg, surface)), luminance(surface)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

describe("FRONT-A14 出片弹窗的提示词框", () => {
  const LIGHT = block(".gb");
  const DARK = block('.gb.dark, .gb[data-theme="dark"], .dark .gb');

  it("FRONT-A14: the @ prompt editor takes the semantic ink token, not the dark bar's own", () => {
    expect(inkTokenOf(block(".mention-input .tiptap")), "打的字不是语义前景 token")
      .toBe("--foreground");
    expect(inkTokenOf(block(".mention-input .tiptap p.is-editor-empty:first-child::before")), "提示语不是语义 muted token")
      .toBe("--muted-foreground");
  });

  it("FRONT-A14: what the merchant types in the t2v/Animate dialog clears AA on the popover", () => {
    // The dialogs put the editor straight on `DialogContent` — `bg-popover` and nothing else
    // between it and the rule above, which is why the rule alone has to be right.
    expect(codeOf("design-system/primitives/dialog.tsx"), "弹窗底不再是 popover 面，这条断言的基准错了")
      .toContain("bg-popover");
    const ink = inkTokenOf(block(".mention-input .tiptap")) as string;
    const hint = inkTokenOf(block(".mention-input .tiptap p.is-editor-empty:first-child::before")) as string;
    for (const [theme, root] of [["浅色", LIGHT], ["深色", DARK]] as const) {
      const popover = tokenValue(root, "--popover");
      expect(contrast(tokenValue(root, ink), popover), `${theme}弹窗里打的字看不见`)
        .toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokenValue(root, hint), popover), `${theme}弹窗里的提示语看不见`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it("FRONT-A14: no surface hands the editor its ink back one patch at a time", () => {
    // `.gb .al-promptbar .tiptap { color: … }` and `.gb .cv-detail .tiptap { color: … }` were
    // exactly that, and the surface with no patch is the defect. One source, or none.
    expect(CSS, "又出现按 surface 重写 .tiptap 字色的补丁 —— 单一源头是 .mention-input")
      .not.toMatch(/\.gb\s+\.[\w-]+\s+\.tiptap[^{}]*\{[^{}]*?[\s;{]color:/);
  });
});

/**
 * FRONT-A14 —— 空画板上的那一句引导(2026-09-05 走查 P2④)。
 *
 * 从前板上没有卡的时候屏幕中央只有一块点阵底纹:商家看不出这里会长出东西,也看不出该从哪里
 * 开口。左上角那张状态卡说的是 Otto 此刻在不在,不是这块板是干什么的。
 *
 * 与本文件其余各条同一个理由走源码级:一张画布卡只在 React Flow provider 与一块活的板里才画
 * 得出来,在这里做 DOM 断言等于把板本身也 mock 掉。这里钉的三件都是源码看得见的结构:
 * 走的是共用空态组件、只在**读成功且真的零张卡**时出现、以及它不是一层挡住画板的纸。
 */
describe("FRONT-A14 空画板的引导", () => {
  const code = codeOnly(flowCanvas);

  it("FRONT-A14: the empty board says what it is for, through the shared empty-state component", () => {
    expect(flowCanvas, "空画板引导没走共用空态组件").toContain('from "@/components/ui/empty"');
    expect(code).toContain("Nothing on this canvas yet");
    expect(code).toContain("Ask Otto in the box below, and what it makes will appear here.");
  });

  it("FRONT-A14: the guidance appears only on a board that really loaded and really has no cards", () => {
    // 「读不出来」有自己的 Alert、「还在读」有自己的 Badge;把那两种说成「这里还什么都没有」
    // 是假话,所以这一句的条件里必须同时有 ready 与零张卡。
    expect(code).toMatch(/boardStatus === "ready" && nodesOnBoard\.length === 0/);
  });

  it("FRONT-A14: the guidance is a sentence, not a sheet over the board", () => {
    // 拖动、框选、滚轮缩放都要照旧穿过去 —— 与 `.cv-dropzone` 不同,这一层永远不接事件。
    const guidance = /nodesOnBoard\.length === 0 && \(\s*<div className="([^"]*)"/.exec(code);
    expect(guidance, "找不到空画板引导那一层的类名").not.toBeNull();
    expect(guidance![1]).toContain("pointer-events-none");
  });
});
