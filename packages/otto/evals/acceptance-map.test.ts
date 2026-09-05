/**
 * Otto 引擎验收表 ↔ 测试的**映射表**（机器闸 M3 的登记处）。
 *
 * 规格 `docs/specs/otto-engine.md` 的验收表有 7 行，而 S2 §7.0 把它们按依赖切成七段三批。
 * 本段（③ 评测基线骨架）只交付其中一条。
 *
 * 这个文件的用处是**把没交付的那几条说出口**，而不是让它们从测试树上消失
 * （体例照 `packages/core/src/creation-acceptance-map.test.ts` 的先例）：
 *   · 已交付的编号写明它的真身在哪个文件；
 *   · 未交付的编号是 `it.todo`，即「登记在册、尚未实现」—— M3 认这个形状，
 *     而它对人的意思是一句诚实话：这条验收今天**没有**证据，别把闸绿当成它过了。
 *
 * 今天有真身的是 ENGINE-A1（钉基线档案本身；骨架的行为测试在 `./evals.test.ts`）与 ENGINE-A7
 * （钉文件柜之后那一趟对照 `evals:check` 真的跑过：账本里有它、规格 §5 里有它的结论）。
 * 其余各行仍是 `it.todo`——七段的**全表**登记处在 `packages/otto/src/otto-acceptance-map.test.ts`，
 * 各段落地时以那一份为准；这一份只管本段（③ 评测基线骨架）说得出口的那部分。
 *
 * **它为什么住在 `evals/` 而不是 `src/`**：§7.5 表 A 给本段划的写集是
 * `packages/otto/evals/`、`packages/otto/knowledge/craft/`、`packages/otto/package.json`、
 * `scripts/ci/quality.sh` —— 往 `src/` 放一个七段共用的文件会越写集，
 * 也会让四路并行的批 I 在同一个文件上撞车。后续各段把自己那一行的 `it.todo` 换成真身即可。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("Otto 验收表 ↔ 测试映射(S2 §7.0 七段三批)", () => {
  // ── 本段交付（骨架的真身在 ./evals.test.ts）────────────────────────────────
  // 骨架早就有真身了，可这一行到今天还是 `it.todo`，读的人只看得到「登记在册、尚未实现」
  // （判官 2026-09-05 #1221 P2-4）。这一条钉的是**基线档案本身**：「不低于基线」要成立，
  // 先得真有一个比较对象；档案不在或缺字段，就等于这一行今天还没有证据。
  it("ENGINE-A1 基线档案已入档：baselines/engine.json 带日期、commit、被测型号、总分、真实花费", () => {
    const archivePath = join(HERE, "baselines", "engine.json");
    expect(existsSync(archivePath)).toBe(true);
    const archive = JSON.parse(readFileSync(archivePath, "utf8")) as Record<string, unknown>;
    expect(typeof archive.date).toBe("string");
    expect(Number.isNaN(Date.parse(String(archive.date)))).toBe(false);
    expect(String(archive.commit)).toMatch(/^[0-9a-f]{40}$/);
    expect(String(archive.subjectModel).length).toBeGreaterThan(0);
    expect(typeof archive.total).toBe("number");
    expect(archive.total as number).toBeGreaterThan(0);
    expect(archive.total as number).toBeLessThanOrEqual(1);
    expect(typeof archive.costUsd).toBe("number");
    expect(archive.costUsd as number).toBeGreaterThan(0);
  });

  // ── 批 I 的其余三段，不在本段写集 ─────────────────────────────────────────
  it.todo("ENGINE-A5 见 packages/core/src/llm-prices.test.ts 与 env-contract.test.ts（①段已交付并合入主干：价目查不到即抛、开机拒绝）");
  it.todo("ENGINE-A2 每轮调试档案：装了哪些技能文件、走了几步、调了哪些动作，零商家内容明文 —— 批 I §7.2②");
  it.todo("ENGINE-A6 见 packages/otto/src/runtime-history-budget.test.ts 与 src/history-budget.test.ts（④段已交付：成对感知裁剪、旧轮折进 rollingSummary、第 N+1 轮实结不随历史上涨）");

  // ── 批 II（依赖批 I）──────────────────────────────────────────────────────
  it.todo("ENGINE-A4 见 apps/web/lib/__tests__/engine-a4-truncated-turn-refund.test.ts（真库账本 reserve/refund 成对 + 消费历史退款行）与 packages/otto/src/runtime.test.ts（零交付判词三态）—— ⑤段已交付");
  // ⑥段的**机制**（柜子、生成器、装配器、新鲜度闸、单体退役）真身在
  // packages/otto/src/knowledge-cabinet.test.ts 与 instructions.test.ts 的两道 golden。
  // 但这一行的判定是「重跑评测**总分不低于基线**」，所以它要的是**对照那一趟**本身：
  // 一次真的 `evals:check`，以及它在账本与规格 §5 里留下的那两笔记录（#1231）。
  // 机制测试绿不等于这一行过了——那正是这份映射表存在的意义的反面。
  it("ENGINE-A7 文件柜之后的对照那一趟真的跑过：账本有那一行 --check，§5 有它的登记", () => {
    // #1231：main 9a1f5292 上跑的 evals:check，62.5% 对基线 65%，差 -2.5 个百分点、
    // 落在 ±5 容差内 ⇒ 不回退。这里钉的是「那一趟真花过钱、真留了痕」，不是再跑一次。
    const ledger = readFileSync(join(HERE, "baselines", "spend.jsonl"), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const checkRun = ledger.find((e) => String(e.commit).startsWith("9a1f5292"));
    expect(checkRun).toBeDefined();
    expect(checkRun!.line).toBe("engine");
    expect(checkRun!.costUsd).toBeCloseTo(0.301413, 6);
    // 对照那一趟排在基线那一趟之后：账本只追加，顺序就是先后。
    expect(ledger.indexOf(checkRun!)).toBeGreaterThan(0);
    // 结论落在规格里，不是只落在某个 PR 描述里。
    const spec = readFileSync(join(HERE, "..", "..", "..", "docs", "specs", "otto-engine.md"), "utf8");
    expect(spec).toContain("⑥ 段 ENGINE-A7 对照登记");
  });

  // ── 批 III（已交付；#1150 / #1151 / #1158 / #1194 / #1197 均已在主干）───────
  it.todo("ENGINE-A3 见 apps/web/lib/__tests__/engine-a3-canvas-conversation.test.tsx 与 e2e/journeys/engine-a3-canvas-conversation.spec.ts（⑦段已交付：直出 composer 与工具条 Generate 退役、送出接 Otto 对话、花钱走审批卡）");
});
