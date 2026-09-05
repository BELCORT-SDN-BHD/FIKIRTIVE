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
 * **它为什么住在 `evals/` 而不是 `src/`**：§7.5 表 A 给本段划的写集是
 * `packages/otto/evals/`、`packages/otto/knowledge/craft/`、`packages/otto/package.json`、
 * `scripts/ci/quality.sh` —— 往 `src/` 放一个七段共用的文件会越写集，
 * 也会让四路并行的批 I 在同一个文件上撞车。后续各段把自己那一行的 `it.todo` 换成真身即可。
 */
import { describe, it } from "vitest";

describe("Otto 验收表 ↔ 测试映射(S2 §7.0 七段三批)", () => {
  // ── 本段交付（真身在 ./evals.test.ts）──────────────────────────────────────
  it.todo("ENGINE-A1 见 packages/otto/evals/evals.test.ts（本段已交付：跑一次、逐题有分、总分入档、回归即非零退出）");

  // ── 批 I 的其余三段，不在本段写集 ─────────────────────────────────────────
  it.todo("ENGINE-A5 见 packages/core/src/llm-prices.test.ts 与 env-contract.test.ts（①段已交付并合入主干：价目查不到即抛、开机拒绝）");
  it.todo("ENGINE-A2 每轮调试档案：装了哪些技能文件、走了几步、调了哪些动作，零商家内容明文 —— 批 I §7.2②");
  it.todo("ENGINE-A6 见 packages/otto/src/runtime-history-budget.test.ts 与 src/history-budget.test.ts（④段已交付：成对感知裁剪、旧轮折进 rollingSummary、第 N+1 轮实结不随历史上涨）");

  // ── 批 II（依赖批 I）──────────────────────────────────────────────────────
  it.todo("ENGINE-A4 截断且零交付的一轮全额退款、消费历史可见退款行 —— 批 II §7.2⑤（钱路重挡）");
  // ⑥段已交付**机制**（柜子、生成器、装配器、新鲜度闸、单体退役）——真身在
  // packages/otto/src/knowledge-cabinet.test.ts 与 instructions.test.ts 的两道 golden。
  // 但这一行的判定是「重跑评测**总分不低于基线**」，而基线档案 `baselines/engine.json`
  // 至今跑不出来（③段登记：主检出 .env.local 的 Anthropic 钥匙 401）。所以它仍是 `it.todo`：
  // 没有基线就没有「不低于」，把机制测试当成这一行过了，就是这份映射表存在的意义的反面。
  it.todo("ENGINE-A7 技能文件柜替换单体后重跑评测，总分不低于基线 —— 批 II §7.2⑥（机制已交付：src/knowledge-cabinet.test.ts；跑分待 Founder 换钥匙后 evals:check）");

  // ── 批 III（等 PR #1150 / #1151 / #1158 三者合入主干）──────────────────────
  it.todo("ENGINE-A3 画布输入框发消息得到对话回复、花钱动作仍走卡片确认 —— 批 III §7.2⑦");
});
