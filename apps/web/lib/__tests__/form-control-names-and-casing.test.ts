/**
 * #739 — 无障碍四处小账里的两类根因,按类立围栏,不按页面补例。
 *
 * 类一「表单控件没有可访问的名字」:placeholder 不是名字 —— 商家一打字它就消失,读屏
 * 用户此时听到的是一个没有名字的框。走查抓到的是 Otto 主输入框和画布文本节点;这里把
 * app/ + components/ 下所有单行输入、多行输入与下拉(<input>、<textarea>、<select>、
 * 设计系统的 <Input>、<Textarea>)一次扫完,任何一个既没有 aria-label / aria-labelledby、
 * 又没有 label 包裹或 htmlFor 关联的,直接红。扫描自身也要被证明还在扫东西(population
 * floor),否则空 offenders 等于什么都没查。
 *
 * #813(#812 自报的票外残余):第一版只扫 textarea/select 族,单行 <input>/<Input> 整族
 * 在围栏外 —— 商家最常打字的那一族反而没被查。把 input 族纳入扫描后,同一套规则在未修的
 * 树上报出 9 个无名控件(kitchensink 演示输入、profile 名字输入*、admin 审计流筛选、
 * campaign 开场白、画布自定义运镜、Otto 附件 file input、产品库搜索与链接输入、设置页
 * 只读文本行)。*profile 那一个其实是**扫描器**的漏洞:它的 label 用 `htmlFor={inputId}`
 * 表达式关联,而第一版只认字符串字面量的 htmlFor —— 表达式关联一并补上,否则纳入 input
 * 族的代价是逼着已经正确的字段再挂一个多余的 aria-label。
 *
 * 类二「大小写写在样式里」:CSS `text-transform: capitalize` 让眼睛看到 Chat、读屏听到
 * chat —— 看到的和读到的不是同一句话,也违反仓库自己的 English sentence case 规矩。
 * 大小写属于文案,不属于样式。
 *
 * Red on main(修复前):sweep 报 14 个无名控件 —— 票面点名的 Otto 两个 composer 与画布
 * 文本节点,加上同根扫出的画布 t2v prompt、Otto front door、广播详情的 audience segment、
 * Otto memory composer、两处便签编辑、事实新增、campaign proposal brief、两处 admin;
 * 两个 switcher 带 `capitalize` 且 DOM 文字是小写 key。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");

/**
 * The design-system primitives in components/ui are pure forwarders — `<Textarea>` renders
 * whatever aria-* its caller passes and cannot know its own name. They are excluded here
 * precisely because the sweep polices their CALL SITES instead.
 */
const PRIMITIVES = "components/ui/";

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

function sourceFiles(): string[] {
  return [...walk(path.join(WEB_ROOT, "app")), ...walk(path.join(WEB_ROOT, "components"))];
}

function source(relativeToWebRoot: string): string {
  return fs.readFileSync(path.join(WEB_ROOT, relativeToWebRoot), "utf8");
}

/**
 * Read one JSX opening tag starting at `start` (the `<`). A tag cannot simply be read to
 * the next `>`: `onChange={(e) => …}` puts one inside an expression. Track brace depth and
 * quotes and stop at the first `>` outside both.
 */
function readOpeningTag(text: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (char === "{") { depth += 1; continue; }
    if (char === "}") { depth -= 1; continue; }
    if (char === ">" && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/**
 * Wrappers that give whatever they contain an accessible name.
 *  - `label`: the platform's own wrapper association.
 *  - `Field`: OttoSchedule's local wrapper — it renders exactly one `label` element around
 *    its children with its `label` prop as the visible text.
 * If either stops rendering a real label element, this list is the thing to fix.
 */
const LABELLING_TAGS = ["label", "Field"] as const;

/**
 * Every control the merchant types into or picks from. #739 filed the multi-line and dropdown
 * families; #813 added the single-line input family — the one the merchant meets most often.
 */
const CONTROL_TAGS = ["textarea", "select", "Textarea", "input", "Input"] as const;

/** `foo="bar"` or `foo={expr}` — an id association can be written either way. */
function attributeValue(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\s${name}=(?:["']([^"']+)["']|\\{([^{}]+)\\})`));
  return match ? (match[1] ?? match[2]).trim() : undefined;
}

function labellingRanges(text: string): [number, number][] {
  const token = new RegExp(`<(/?)(${LABELLING_TAGS.join("|")})[\\s>/]`, "g");
  const ranges: [number, number][] = [];
  const open: number[] = [];
  for (const match of text.matchAll(token)) {
    const index = match.index ?? 0;
    if (match[1] === "/") {
      const start = open.pop();
      if (start !== undefined) ranges.push([start, index]);
      continue;
    }
    // A self-closing `<Field … />` wraps nothing; skip it.
    if (readOpeningTag(text, index).endsWith("/>")) continue;
    open.push(index);
  }
  return ranges;
}

type Control = { file: string; line: number; tag: string };

function sweepControls(): { all: Control[]; unnamed: string[] } {
  const control = new RegExp(`<(${CONTROL_TAGS.join("|")})[\\s>]`, "g");
  const all: Control[] = [];
  const unnamed: string[] = [];

  for (const file of sourceFiles()) {
    const relative = path.relative(WEB_ROOT, file);
    if (relative.startsWith(PRIMITIVES)) continue;

    const text = fs.readFileSync(file, "utf8");
    const ranges = labellingRanges(text);
    const explicitFor = new Set(
      [...text.matchAll(/htmlFor=(?:["']([^"']+)["']|\{([^{}]+)\})/g)].map((match) =>
        (match[1] ?? match[2]).trim(),
      ),
    );

    for (const match of text.matchAll(control)) {
      const index = match.index ?? 0;
      const tag = readOpeningTag(text, index);
      const line = text.slice(0, index).split("\n").length;
      all.push({ file: relative, line, tag: match[0] });

      const hasAriaName = /\saria-label(?:ledby)?[=\s]/.test(tag);
      const boundId = attributeValue(tag, "id");
      const wrapped = ranges.some(([from, to]) => index > from && index < to);
      if (hasAriaName || wrapped || (boundId && explicitFor.has(boundId))) continue;

      unnamed.push(`${relative}:${line}`);
    }
  }

  return { all, unnamed };
}

describe("#739 — every form control carries a name, not just a placeholder", () => {
  it("leaves no input, multi-line input or dropdown without an accessible name", () => {
    expect(sweepControls().unnamed).toEqual([]);
  });

  // An empty offenders list is equally the answer for "everything is named" and for "the
  // scanner stopped matching anything". These three keep the sweep honest.
  it("still finds the whole population it is supposed to police", () => {
    // 164 controls across app/ + components/ once the input family joined the sweep (#813;
    // 53 before it). The floor exists to catch the population COLLAPSING, not to freeze it.
    expect(sweepControls().all.length).toBeGreaterThanOrEqual(140);
  });

  it("still finds the input family the sweep was widened to cover (#813)", () => {
    // 111 single-line inputs at the time of writing. Dropping `input`/`Input` out of
    // CONTROL_TAGS would leave every other assertion here green — this one goes red.
    const inputs = sweepControls().all.filter((control) => /^<(input|Input)[\s>]/.test(control.tag));
    expect(inputs.length).toBeGreaterThanOrEqual(90);
  });

  it("still covers the controls the walkthrough actually caught", () => {
    const byFile = new Map<string, number>();
    for (const control of sweepControls().all) {
      byFile.set(control.file, (byFile.get(control.file) ?? 0) + 1);
    }
    // Named on purpose: the Otto composer and the canvas text node from the ticket,
    // plus the surfaces the family sweep turned up on the same root. A rewrite that drops
    // any of these out of the sweep goes red here rather than passing quietly.
    for (const file of [
      "components/otto/OttoChatStream.tsx",
      "components/otto/OttoFrontDoor.tsx",
      "components/otto/OttoMemory.tsx",
      "components/canvas/nodes/TextNode.tsx",
      "components/canvas/FlowCanvas.tsx",
      "components/crm/broadcasts/broadcast-detail-page.tsx",
    ]) {
      expect(byFile.get(file) ?? 0, file).toBeGreaterThanOrEqual(1);
    }
  });

  it("names the product's main input the same way the merchant sees it", () => {
    for (const file of ["components/otto/OttoChatStream.tsx"]) {
      // #840 — the composer renders the design-system <Textarea>, not a bare
      // <textarea>; match either spelling, same union the sweep itself polices.
      const composer = source(file).match(/<[Tt]extarea[\s\S]*?id="otto-composer"[\s\S]*?\/>/)?.[0];
      expect(composer, file).toBeDefined();
      expect(composer, file).toContain('aria-label="Reply to Otto"');
    }
    expect(source("components/canvas/nodes/TextNode.tsx")).toContain('aria-label="Text note"');
  });

  // /crm/contacts (#739 item 2): both lifecycle dropdowns are Radix comboboxes and both
  // already carry a name on the trigger — the element a screen reader lands on. The two
  // nameless dropdowns the audit measured are Radix's own form-bubble inputs, rendered
  // aria-hidden and tabIndex -1 purely so a form submit carries the value
  // (@radix-ui/react-select SelectBubbleInput). This pins the part that is ours.
  it("names both lifecycle dropdowns on the contacts page", () => {
    const contacts = source("components/crm/contacts-page.tsx");
    expect(contacts).toContain('<SelectTrigger aria-label="Filter lifecycle">');
    expect(contacts).toContain('<SelectTrigger aria-label="Lifecycle stage">');
  });

  // #813 — the single-line boxes the widened sweep caught (one of the original eight,
  // app/kitchensink/page.tsx, was throwaway and deleted in #952). Pinned by name so a
  // rewrite that drops the label goes red on the sentence, not only on the sweep.
  it("names every single-line box the widened sweep caught (#813)", () => {
    const named: Array<[string, string]> = [
      ["components/admin/AdminDashboardV2.tsx", 'aria-label="Filter audit events"'],
      ["components/campaign/campaign-detail-page.tsx", 'aria-label="Proposal opening hook"'],
      ["components/canvas/FlowCanvas.tsx", 'aria-label="Custom camera motion"'],
      ["components/otto/OttoChatStream.tsx", 'aria-label="Attach a file"'],
      ["components/otto/memory/ProductShowcase.tsx", 'aria-label="Search products"'],
      ["components/otto/memory/ProductShowcase.tsx", 'aria-label="Product page link"'],
      ["components/otto/settings/SettingsPage.tsx", "aria-label={f.label}"],
    ];
    for (const [file, name] of named) expect(source(file), `${file} — ${name}`).toContain(name);
  });
});

describe("#739 — capitalisation lives in the copy, not in text-transform", () => {
  it("leaves no `capitalize` utility anywhere in the product's markup", () => {
    const offenders = sourceFiles()
      .filter((file) => /\bcapitalize\b/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(WEB_ROOT, file));
    // The product ships zero `capitalize`; holding the assertion at zero is what stops the
    // next switcher from re-opening the split between what is seen and what is read.
    expect(offenders).toEqual([]);
  });

  /**
   * ── 退役立碑:画布侧边页签那半条(Founder 2026-08-25 授权的旧架构归位)──
   *
   * 原文钉的是 `NorthstarCanvasWorkspace.tsx` 里的两条字面量
   * `{ id: "chat", label: "Chat" }` 与 `{ id: "projects", label: "Projects" }` ——
   * 它证明的是「大小写写在文案里,不靠 CSS text-transform 变出来」(#739)。
   *
   * 那两个页签**在生产里已经不存在**:R22 画布(Founder 08-24 检查点亲选 direction 2)
   * 把侧边页签换成了一枚 Conversation 折叠面板(`R22CanvasSurface.tsx` 的
   * `data-r22-canvas-conversation`),`NorthstarCanvasWorkspace.tsx` 只剩一层纯转发壳。
   * 断言的对象没了,断言就不该靠改写字面量硬留下来 —— 它保护的规则本身由同一 describe
   * 里那条「全仓零 `capitalize`」继续钉着(那一条扫的是整棵源码树,画布也在内)。
   *
   * 日历那半条照旧有效,`OttoSchedule.tsx` 一个字没变。
   */
  it("ships the calendar granularity as written labels", () => {
    const schedule = source("components/otto/OttoSchedule.tsx");
    expect(schedule).toContain('{ id: "month", label: "Month" }');
    expect(schedule).toContain('{ id: "week", label: "Week" }');
    expect(schedule).toContain('{ id: "day", label: "Day" }');
  });
});

describe("sweep mechanics", () => {
  it("reads a JSX opening tag past a `>` that lives inside an expression", () => {
    const text = `<select onChange={(e) => setX(e.target.value)} aria-label="Pick">`;
    expect(readOpeningTag(text, 0)).toBe(text);
  });

  it("treats a self-closing labelling tag as wrapping nothing", () => {
    expect(labellingRanges(`<Field label="a" /><select /><label>x</label>`)).toEqual([[29, 37]]);
  });

  it("knows which wrappers it accepts as a name source and which controls it polices", () => {
    expect([...LABELLING_TAGS]).toEqual(["label", "Field"]);
    expect([...CONTROL_TAGS]).toEqual(["textarea", "select", "Textarea", "input", "Input"]);
  });

  // #813 — an id association written as an expression is still an association. Without
  // this, ProfileNames' correctly-labelled field reads as nameless and the only way to
  // green the sweep would be to bolt a redundant aria-label onto it.
  it("reads an id association written as an expression, not only as a string", () => {
    expect(attributeValue(`<Input id={inputId} />`, "id")).toBe("inputId");
    expect(attributeValue(`<Input id="plain" />`, "id")).toBe("plain");
    expect(attributeValue(`<Input value={x} />`, "id")).toBeUndefined();
  });
});
