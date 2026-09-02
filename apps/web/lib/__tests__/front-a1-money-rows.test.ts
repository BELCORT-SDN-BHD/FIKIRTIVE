/**
 * FRONT-A1 §7.1① —— 新前端合入主干后,钱引擎那 14 条验收在测试树里**一条都不许丢**。
 *
 * 为什么需要这一条:①段是纯合并段,把一整套新前端压到一棵已经交付过钱引擎的主干上。合并里
 * 最安静的一种损失不是冲突,是**某一条钱的行为测试被整文件带走了**——CI 照样全绿,因为绿的
 * 是剩下的那些。钱引擎 S5 已经由 Founder 逐条勾过(2026-09-02),所以这 14 个编号从此是主干
 * 的资产:合并可以改页面长相,不可以让任何一条失去它的落点。
 *
 * 这份围栏钉的是**编号仍有测试认领**,不是那些测试断言了什么——那些各自有自己的文件。它只
 * 回答一个问题:MONEY-A<n> 今天还有人管吗。
 *
 * 第二段钉的是六条钱旅程(e2e/journeys/02–07)。它们是唯一在真浏览器里证明「商家看到的钱是
 * 真的」的东西,而 e2e 不在单测 CI 的默认跑道上——一条 e2e 被删掉,没有任何一次红会告诉你。
 * 所以文件本身的存在与它自报的旅程编号,由一条单测看着。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

/** 钱引擎规格 docs/specs/money-engine.md 的验收表:A1–A14,Founder 2026-09-02 全部勾过。 */
const MONEY_ROWS = Array.from({ length: 14 }, (_, i) => `MONEY-A${i + 1}`);

/** 测试树:单测(apps/web、packages、apps/worker)加上 e2e 旅程。 */
const TEST_ROOTS = ["apps/web", "packages", "apps/worker", "e2e"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "generated", ".turbo", "coverage"]);

function collectTestFiles(dir: string, out: string[]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectTestFiles(full, out);
    else if (/\.(test|spec)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const TEST_FILES = TEST_ROOTS.flatMap((root) => collectTestFiles(path.join(REPO_ROOT, root), []));
const TEST_SOURCES = TEST_FILES.map((file) => ({ file, text: readFileSync(file, "utf8") }));

/** `MONEY-A1` 不许被 `MONEY-A10` 冒认——后面紧跟数字的不算。 */
function rowPattern(row: string): RegExp {
  return new RegExp(`${row}(?![0-9])`);
}

describe("FRONT-A1 §7.1① — 钱引擎验收表的 14 条在测试树里各有落点", () => {
  it("测试树本身找得到(围栏没有在空集上假绿)", () => {
    expect(TEST_FILES.length).toBeGreaterThan(300);
  });

  it.each(MONEY_ROWS)("%s 仍有测试认领", (row) => {
    const owners = TEST_SOURCES.filter(({ text }) => rowPattern(row).test(text));
    expect(
      owners.map(({ file }) => path.relative(REPO_ROOT, file)),
      `${row} 在整棵测试树里没有任何落点 —— 合并把它的测试带走了`,
    ).not.toEqual([]);
  });
});

/** 六条钱旅程:文件名里的编号,与文件自报的 `Journey <n>`。 */
const MONEY_JOURNEYS = [
  { file: "02-balance-and-hold.spec.ts", journey: 2 },
  { file: "03-charge-is-traceable.spec.ts", journey: 3 },
  { file: "04-refund-exactly-once.spec.ts", journey: 4 },
  { file: "05-topup-shelf-honesty.spec.ts", journey: 5 },
  { file: "06-spend-history-counts-charges.spec.ts", journey: 6 },
  { file: "07-money-surfaces-agree.spec.ts", journey: 7 },
];

describe("FRONT-A1 §7.1① — 六条钱旅程在真浏览器那一侧还在", () => {
  it.each(MONEY_JOURNEYS)("旅程 $journey($file)还在,并且自报的就是这个编号", ({ file, journey }) => {
    const full = path.join(REPO_ROOT, "e2e/journeys", file);
    const text = readFileSync(full, "utf8");
    expect(text, `${file} 自报的旅程编号与文件名对不上`).toContain(`Journey ${journey}`);
    expect(text, `${file} 里一个 test() 都没有`).toMatch(/\btest\(/);
  });

  it("旅程 7 认领 FRONT-A1 —— 换壳后两处钱面仍然说同一个数", () => {
    const text = readFileSync(path.join(REPO_ROOT, "e2e/journeys/07-money-surfaces-agree.spec.ts"), "utf8");
    expect(text).toContain("FRONT-A1");
  });
});
