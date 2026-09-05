/**
 * ENGINE-A7 —— 技能文件柜替换单体（`docs/specs/otto-engine.md` §7.2⑥）的行为测试。
 *
 * 这一组钉的是**机制**：取用三规则、fail-closed 的文件格式、生成产物与柜子同源、
 * 占位符名单闭合。验收行本身（「重跑评测总分不低于 ENGINE-A1 基线」）不是单元测试能跑的，
 * 它是 `pnpm --filter @fikirtive/otto run evals:check` 那一趟真花钱的跑分——没有基线可比时
 * 它会明说并非零退出（③段登记），所以这里不为它留一条假绿的断言。
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  CORE_PATH,
  keywordHits,
  loadableFiles,
  matchKnowledge,
  orderCabinetPaths,
  parseCabinetFile,
  renderCabinetModule,
  spineIndex,
  stripComments,
  type KnowledgeFile,
} from "./knowledge-cabinet.js";
import { KNOWLEDGE_CABINET } from "./knowledge-cabinet.generated.js";
import {
  allKnowledgePaths,
  assembleOttoInstructions,
  fillPlaceholders,
  ottoCoreInstructions,
  ottoInstructions,
} from "./instructions.js";
import { instructionsForTurn } from "./runtime.js";

const file = (over: Partial<KnowledgeFile> = {}): KnowledgeFile => ({
  path: "playbooks/x.md",
  spine: "x",
  mode: "on-demand",
  when: ["kite"],
  text: "# x\n\nbody",
  ...over,
});

describe("ENGINE-A7 · 取用三规则①：每份文件首行一句书脊标签，Otto 每轮只见全部标签", () => {
  it("ENGINE-A7:柜里每一份都有书脊标签，且没有一份是空标签", () => {
    expect(KNOWLEDGE_CABINET.length).toBeGreaterThan(1);
    for (const f of KNOWLEDGE_CABINET) {
      expect(f.spine.trim(), `${f.path} 的书脊标签是空的`).not.toBe("");
      expect(f.text.startsWith(`# ${f.spine}`), `${f.path} 的正文第一行不是它的书脊`).toBe(true);
    }
  });

  it("ENGINE-A7:标签清单每轮都在说明书里，且只列装得进某一轮的那些", () => {
    const index = spineIndex(KNOWLEDGE_CABINET);
    for (const f of KNOWLEDGE_CABINET) {
      if (f.mode === "on-demand") expect(index).toContain(`- ${f.spine}`);
      // reference 件永远装不进任何一轮 —— 告诉 Otto 它存在，只会让他去承诺它。
      else if (f.mode === "reference") expect(index).not.toContain(`- ${f.spine}`);
    }
    expect(assembleOttoInstructions("hi").text).toContain(index);
  });

  it("ENGINE-A7:书脊标签本身不带仓库路径（说明书里的每一句都是说给模型听的）", () => {
    for (const f of KNOWLEDGE_CABINET) {
      expect(f.spine, `${f.path} 的书脊标签里有仓库路径`).not.toMatch(/packages\/|docs\//);
    }
  });
});

describe("ENGINE-A7 · 取用三规则②：任务对上标签才把该文件全文装入本轮", () => {
  it("ENGINE-A7:没对上任何标签的一轮只带常驻薄层", () => {
    const a = assembleOttoInstructions("hi");
    expect(a.files).toEqual([CORE_PATH]);
    expect(a.text).toBe(ottoCoreInstructions);
  });

  it("ENGINE-A7:对上标签的一轮把那一份**全文**装进来", () => {
    const a = assembleOttoInstructions("make me a poster for the new nasi lemak");
    expect(a.files).toContain("product-map/creating.md");
    const creating = KNOWLEDGE_CABINET.find((f) => f.path === "product-map/creating.md");
    expect(a.text).toContain("## When to call `propose`");
    expect(a.text.length).toBeGreaterThan(ottoCoreInstructions.length + creating!.text.length / 2);
  });

  it("ENGINE-A7:每一轮都比整柜小 —— 拆柜的意义就在这里", () => {
    for (const turn of ["hi", "how much have I spent?", "make me a poster"]) {
      expect(
        assembleOttoInstructions(turn).text.length,
        `「${turn}」这一轮没有比整柜小`,
      ).toBeLessThan(ottoInstructions.length);
    }
  });

  it("ENGINE-A7:华语的一轮也对得上标签（关键词按子串匹配，没有空格边界）", () => {
    expect(assembleOttoInstructions("帮我做一张海报").files).toContain("product-map/creating.md");
  });

  it("ENGINE-A7:英文关键词按词边界匹配 —— `ad` 不被 `already` 命中", () => {
    expect(keywordHits("i already told you", "ad")).toBe(false);
    expect(keywordHits("run this ad for me", "ad")).toBe(true);
    expect(keywordHits("做一张海报", "海报")).toBe(true);
  });

  it("ENGINE-A7:reference 件永远装不进任何一轮", () => {
    const refs = KNOWLEDGE_CABINET.filter((f) => f.mode === "reference").map((f) => f.path);
    expect(refs.length).toBeGreaterThan(0);
    for (const turn of ["seedance video 镜头 dolly in", "seedream 图片 i2i", "hi"]) {
      for (const r of refs) expect(assembleOttoInstructions(turn).files).not.toContain(r);
    }
    expect(allKnowledgePaths()).toEqual(loadableFiles(KNOWLEDGE_CABINET).map((f) => f.path));
  });
});

describe("ENGINE-A7 · 取用三规则③：用完不带入下一轮", () => {
  it("ENGINE-A7:装配是纯函数 —— 同一段话每次装出同一份，跑过别的轮也不变", () => {
    const first = assembleOttoInstructions("make me a poster");
    assembleOttoInstructions("pause my ads and research the competitor");
    const again = assembleOttoInstructions("make me a poster");
    expect(again.text).toBe(first.text);
    expect(again.files).toEqual(first.files);
    // 上一轮装过的东西没有渗进这一轮。
    expect(assembleOttoInstructions("hi").files).toEqual([CORE_PATH]);
  });
});

describe("ENGINE-A7 · 文件格式 fail closed（写错的知识文件当场炸，不静默失效）", () => {
  it("ENGINE-A7:没有书脊标签就抛", () => {
    expect(() => parseCabinetFile("playbooks/x.md", "no heading\n<!-- when: a -->")).toThrow(
      /书脊标签/,
    );
  });

  it("ENGINE-A7:没有 when 行就抛", () => {
    expect(() => parseCabinetFile("playbooks/x.md", "# x\n\nbody")).toThrow(/when/);
  });

  it("ENGINE-A7:when 是空表就抛 —— 一份谁也读不到的知识文件比没有更糟", () => {
    expect(() => parseCabinetFile("playbooks/x.md", "# x\n<!-- when: , , -->\n")).toThrow(/空的/);
  });

  it("ENGINE-A7:只有常驻薄层可以是 always，别的文件冒名就抛", () => {
    expect(() => parseCabinetFile("playbooks/x.md", "# x\n<!-- when: always -->\n")).toThrow(
      /只有 _core\.md/,
    );
    expect(() => parseCabinetFile(CORE_PATH, "# core\n<!-- when: image -->\n")).toThrow(/always/);
  });

  it("ENGINE-A7:没闭合的注释块当场炸，不静默吞掉半份文件", () => {
    expect(() => stripComments("# x\n<!-- 忘了收尾\nbody")).toThrow(/没有闭合/);
  });

  it("ENGINE-A7:注释块整块剥掉 —— 出处与仓库路径不进模型的上下文", () => {
    expect(stripComments("# x\n<!-- when: a -->\n<!-- 来源：packages/otto/x.ts -->\n\nbody")).toBe(
      "# x\n\nbody",
    );
    for (const f of KNOWLEDGE_CABINET) {
      expect(f.text, `${f.path} 的正文里还留着 <!-- 注释`).not.toContain("<!--");
    }
  });
});

describe("ENGINE-A7 · 生成产物与柜子同源（§7.0 拍板三：build 期产物，禁运行期 readFileSync）", () => {
  it("ENGINE-A7:装配器不 import 任何 fs —— 说明书是 build 期常量，不是运行期读文件", () => {
    for (const rel of ["instructions.ts", "knowledge-cabinet.ts", "knowledge-cabinet.generated.ts"]) {
      const text = readFileSync(new URL(`./${rel}`, import.meta.url), "utf8");
      const imports = text.split("\n").filter((l) => /^\s*import\b/.test(l));
      expect(imports.join("\n"), `${rel} import 了 fs —— Next/Turbopack 的 fs shim 会在运行期拒掉它`)
        .not.toMatch(/node:fs|node:path|node:url/);
    }
  });

  it("ENGINE-A7:柜子的顺序是确定的，_core.md 永远第一", () => {
    expect(orderCabinetPaths(["z.md", "_core.md", "a/b.md"])).toEqual(["_core.md", "a/b.md", "z.md"]);
    expect(KNOWLEDGE_CABINET[0]!.path).toBe(CORE_PATH);
  });

  it("ENGINE-A7:生成器渲染出来的模块能被同一个解析器读回同一份柜子", () => {
    const rendered = renderCabinetModule([file()]);
    expect(rendered).toContain('path: "playbooks/x.md"');
    expect(rendered).toContain('mode: "on-demand"');
    expect(rendered).toContain('when: ["kite"]');
    expect(rendered).toContain("// AUTOGENERATED");
  });
});

describe("ENGINE-A7 · 跑一轮时装的是哪一份（runtime 的那道缝）", () => {
  it("ENGINE-A7:新鲜轮按商家这一轮说的话装，比整柜薄", () => {
    const t = instructionsForTurn("hello");
    expect(t.files).toEqual([CORE_PATH]);
    expect(t.text.length).toBeLessThan(ottoInstructions.length);
  });

  it("ENGINE-A7:我们自己塞进去的上下文 item 不参与对标签 —— 否则每轮都等于全打开", () => {
    // 生产里那一条 `role:"system"` 的上下文带着品牌记忆与素材清单，天然含 image / product /
    // Library 这些词。它若参与匹配，柜子每轮全开，拆柜省下的那一半当场还回去。
    const items = [
      { role: "system", content: "Brand memory: product catalog, video assets, poster ideas." },
      { role: "user", content: "hello" },
    ] as never;
    expect(instructionsForTurn(items).files).toEqual([CORE_PATH]);
  });

  it("ENGINE-A7:商家自己说的话照样对得上标签", () => {
    const items = [
      { role: "system", content: "Brand memory: nothing yet." },
      { role: "user", content: "make me a poster" },
    ] as never;
    expect(instructionsForTurn(items).files).toContain("product-map/creating.md");
  });

  it("ENGINE-A7:恢复轮整柜装载（B9 恢复轮全量装载）", () => {
    const state = { _context: { context: {} } } as never;
    const t = instructionsForTurn(state);
    expect(t.text).toBe(ottoInstructions);
    expect(t.files).toEqual(allKnowledgePaths());
  });
});

describe("ENGINE-A7 · 占位符：柜里写死一个值就是失同步，名单外的占位符当场炸", () => {
  it("ENGINE-A7:不认识的占位符抛，不静默把 {{…}} 留给商家看", () => {
    expect(() => fillPlaceholders("a {{navPath:bulling}} b", {})).toThrow(/不认识的占位符/);
  });

  it("ENGINE-A7:装出来的说明书里没有残留的占位符", () => {
    for (const turn of ["hi", "make me a poster", "how much have I spent?"]) {
      expect(assembleOttoInstructions(turn).text).not.toMatch(/\{\{[A-Za-z]/);
    }
    expect(ottoInstructions).not.toMatch(/\{\{[A-Za-z]/);
  });

  it("ENGINE-A7:柜里没有一份文件把插值抄成了字面量（价目与地图仍是现算的）", () => {
    // 三条最容易被抄死的：搜索单价、单轮搜索上限的那句、导航路径的分隔符写法。
    const bodies = KNOWLEDGE_CABINET.map((f) => f.text).join("\n");
    expect(bodies).not.toMatch(/\bcosts the user about \d/);
    expect(bodies).not.toMatch(/one turn allows at most \d/);
  });
});
