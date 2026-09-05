/**
 * Creation 引擎验收表 ↔ 测试的**映射表**（机器闸 M3 的登记处）—— 全仓唯一一份。
 *
 * 规格 `docs/specs/creation-engine.md`（已冻结 · v2）的验收表有 12 行。这个文件回答一个
 * 问题：**每一条今天有没有真身、真身在哪**。已交付的写成一条会跑的用例，当场核对它点名的
 * 测试文件真的存在、并且真的逐字带着那个编号；没交付的仍是 `it.todo`（「登记在册、尚未
 * 实现」——M3 认这个形状，而它对人的意思是一句诚实话：这条验收今天没有证据）。
 *
 * **为什么是一份**（2026-09-05 清单 I4）：在此之前同一件事有三份，而且已经互相打架——
 *   · `apps/web/lib/__tests__/creation-engine-acceptance-placeholders.test.ts`（13 条全 todo）
 *   · `apps/web/lib/__tests__/creation-engine-acceptance-todo.test.ts`（11 条 todo，抬头
 *     自陈 CREATE-A3 已有真身）
 *   · 本文件（15 条 todo，把已交付的 A4/A5/A6 也写成 todo 并在描述里指真身）
 * 同一个 A3 在一份里算已交付、在另一份里还是 todo；A4/A5/A6 注明「本段已交付」却仍挂着
 * `it.todo`。三份都是「登记处」，于是谁也不是权威。前两份随本轮删除，登记只留这一份；
 * 位置沿用 `money-engine-acceptance.test.ts` 的既有约定（引擎的验收索引住在
 * `packages/core/src/`），体例也照它。
 *
 * **规矩**：某条验收落地真测试后，把它从 `PENDING` 挪进 `DELIVERED` 并写上真身文件；
 * 编号无论在哪一边都逐字留在这个文件里（M3 用 fixed-string grep）。
 *
 * **不在本文件里的**：`packages/otto/` 那两份是 **ENGINE-**（`docs/specs/otto-engine.md`）
 * 的登记表，不是 CREATE- 的第四份；它们自己的合并（`evals/acceptance-map.test.ts` 与
 * `src/otto-acceptance-map.test.ts` 重复登记 ENGINE-A1/A7）归 otto-engine.md 那一份规格的
 * PR，不在本轮写集——见 `docs/specs/frontend-baseline.md` §5 本轮登记行。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * 已交付的验收：编号 → 它的真身住在哪几个测试文件里。
 *
 * 这不是注释，是断言的输入：下面那条用例会打开每一个文件，确认它存在、且逐字带着这个
 * 编号。所以这张表不会像注释那样悄悄过期——真身被改名或被删，这里当场红。
 */
const DELIVERED: readonly { readonly id: string; readonly what: string; readonly tests: readonly string[] }[] = [
  {
    id: "CREATE-A1",
    what: "增强稿预览:花钱前可见可改,增强提交与直接提交前置报价相同",
    tests: [
      "packages/otto/src/skills/propose.test.ts",
      "packages/otto/src/instructions.test.ts",
      "apps/web/lib/__tests__/creation-reference-receipt-card.test.tsx",
    ],
  },
  {
    id: "CREATE-A2",
    what: "参考自动指派角色;越界或互斥组合在花钱前拒绝、ledger 零新增行",
    tests: [
      "packages/core/src/reference-map.test.ts",
      "packages/otto/src/skills/propose.test.ts",
      "apps/web/lib/__tests__/creation-multi-reference-card.test.ts",
      "apps/worker/src/jobs/gen-multi-reference.test.ts",
    ],
  },
  {
    id: "CREATE-A3",
    what: "声音开关关掉后实发 generate_audio=false,开关不影响报价",
    tests: [
      "apps/web/lib/__tests__/video-audio-toggle.test.ts",
      "apps/web/lib/__tests__/canvas-video-audio-submit.test.ts",
      "packages/generation/src/byteplus-audio.test.ts",
    ],
  },
  {
    id: "CREATE-A4",
    what: "1080p 自动升档,前置报价=reserve=settle 绝对值,不出现型号名,路由理由可查",
    tests: [
      "packages/core/src/creation-routing.test.ts",
      "packages/core/src/cowork-route.test.ts",
      "apps/web/lib/__tests__/creation-routing-ledger.test.ts",
      "apps/web/lib/__tests__/otto-resolution-tier-ledger.test.ts",
      "apps/worker/src/jobs/gen-receipt.test.ts",
    ],
  },
  {
    id: "CREATE-A5",
    what: "默认档配错降级留日志;直接请求未定价槽位拒绝、ledger 零新增行",
    tests: [
      "packages/core/src/creation-routing.test.ts",
      "packages/core/src/creation-routing-degrade.test.ts",
      "apps/web/lib/__tests__/creation-routing-ledger.test.ts",
    ],
  },
  {
    id: "CREATE-A6",
    what: "图片侧同形围栏:未定价 pro SKU 拒绝 $0,显式价目表无该条目",
    tests: [
      "packages/core/src/creation-routing.test.ts",
      "packages/generation/src/byteplus.test.ts",
      "apps/web/lib/__tests__/creation-routing-ledger.test.ts",
    ],
  },
  {
    id: "CREATE-A9",
    what: "真人脸参考图创建阶段拦截+人话提示+出路指向演员库,余额净变化 0",
    tests: [
      "apps/worker/src/jobs/gen-reference-person.test.ts",
      "packages/core/src/gen-failure.test.ts",
      "apps/web/lib/__tests__/gen-failure-two-surfaces.test.ts",
    ],
  },
  {
    id: "CREATE-A10",
    what: "演员库角色跨场景连续出片,不触发人脸拦截,引用落盘",
    tests: [
      "packages/core/src/actor-library.test.ts",
      "packages/core/src/entity-policy.test.ts",
      "apps/web/lib/__tests__/actor-library-seed.test.ts",
      "apps/web/lib/__tests__/official-avatar-readonly-actions.test.ts",
    ],
  },
  {
    id: "CREATE-A12",
    what: "sentPromptText 与批准稿逐字一致含 Regenerate,路由理由字段有值",
    tests: [
      "packages/core/src/creation-routing.test.ts",
      "apps/web/lib/__tests__/creation-routing-ledger.test.ts",
      "apps/web/lib/__tests__/asset-detail-receipt.test.ts",
      "apps/worker/src/jobs/gen-receipt.test.ts",
    ],
  },
];

describe("Creation 验收表 ↔ 测试映射(全仓唯一登记处)", () => {
  // ── 已交付：真身存在，且真的带着这个编号 ──────────────────────────────────
  it.each(DELIVERED.map((row) => [row.id, row.what, row.tests] as const))(
    "%s %s —— 已交付,真身可当场打开",
    (id, _what, tests) => {
      const broken = tests.filter((relative) => {
        const full = join(REPO_ROOT, relative);
        if (!existsSync(full)) return true;
        return !readFileSync(full, "utf8").includes(id);
      });
      expect(
        broken,
        `${id} 的映射断了:这些文件不存在,或者里面已经找不到「${id}」这个编号。` +
          `修法:要么把真身的新位置写回本文件,要么把 ${id} 挪回下面的 it.todo(诚实地说它没了)。\n` +
          broken.join("\n"),
      ).toEqual([]);
    },
  );

  // ── 尚未交付：登记在册、今天没有证据（§8 三批里还没轮到的那几段）──────────
  it.todo("CREATE-A7 增强不可用时用原文生成,预览诚实标注未增强,计费不受影响 —— 批 II §8.2(增强层回退)");
  it.todo("CREATE-A8 增强评测 ≥10 题全过机械检查,重跑 ENGINE 基线不低于基线 —— 批 III §8.3(依赖 packages/otto/evals/)");
  it.todo("CREATE-A11 参考音频自动指派为节奏参考;超 3 段或总长 >15 秒花钱前拒绝 —— 批 II §8.2(参考音频)");

  it("这份登记本身是活的:十二条验收编号逐字都在这个文件里", () => {
    // 一句自证（体例照 money-engine-acceptance.test.ts）。M3 用的是 fixed-string grep,
    // 所以有人整理这个文件时把一条连编号一起删掉,闸只会说「找不到」,说不清是「验收没了」
    // 还是「登记断了」。这条用例读自己的源码,当场把话说清楚。
    const src = readFileSync(new URL(import.meta.url), "utf8");
    const missing = Array.from({ length: 12 }, (_, i) => `CREATE-A${i + 1}`).filter(
      (id) => !new RegExp(`${id}(?![0-9])`).test(src),
    );
    expect(missing, `这些验收编号在本文件里已经找不到落点了:${missing.join(", ")}`).toEqual([]);
    // 一条编号只能站一边,不能既算已交付又算 todo —— 那正是合并前三份互相打架的样子。
    const delivered = new Set(DELIVERED.map((row) => row.id));
    const pending = ["CREATE-A7", "CREATE-A8", "CREATE-A11"];
    expect(pending.filter((id) => delivered.has(id))).toEqual([]);
    expect(delivered.size + pending.length).toBe(12);
  });
});
