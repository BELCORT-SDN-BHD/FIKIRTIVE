/**
 * Creation 引擎验收表 ↔ 测试的**映射表**(机器闸 M3 的登记处)。
 *
 * 规格 docs/specs/creation-engine.md 的验收表有 12 行,而 S2 §8.0 把它们按依赖切成三批:
 * 批 I(今天)、批 II(新前端纯合并落主干之后)、批 III(随 Otto 引擎)。
 * 本段(§8.1① 能力路由 + SKU 白名单)只交付其中三条。
 *
 * 这个文件的用处是**把没交付的那几条说出口**,而不是让它们从测试树上消失:
 *   · 已交付的编号在下面写明它的真身在哪个文件(读的人一步就找得到);
 *   · 未交付的编号是 `it.todo`,即「登记在册、尚未实现」——M3 认这个形状(闸的
 *     判词逐字写着「S4 早期可先 it.todo 占位」),而它对人的意思是一句诚实话:
 *     这条验收今天**没有**证据,别把闸绿当成它过了。
 *
 * 每一条 todo 都注明**归哪一批**,所以哪一批落地时该把哪几条转正是确定的,
 * 不需要谁去回忆。转正 = 把 `it.todo` 换成真正的行为测试(S5 验收只认真身)。
 */
import { describe, it } from "vitest";

describe("Creation 验收表 ↔ 测试映射(S2 §8.0 三批)", () => {
  // ── 批 I(本段交付,真身在这两个文件里)────────────────────────────────────
  it.todo("CREATE-A4 见 packages/core/src/creation-routing.test.ts + apps/web/lib/__tests__/creation-routing-ledger.test.ts(本段已交付)");
  it.todo("CREATE-A5 见 packages/core/src/creation-routing.test.ts + apps/web/lib/__tests__/creation-routing-ledger.test.ts(本段已交付)");
  it.todo("CREATE-A6 见 packages/core/src/creation-routing.test.ts + apps/web/lib/__tests__/creation-routing-ledger.test.ts(本段已交付)");

  // ── 批 I 的其余段(声音开关 / 演员库 / 真人脸口径),不在本段写集 ──────────
  it.todo("CREATE-A3 声音开关不影响报价、实发 generate_audio=false —— 批 I §8.1②(VideoSpecPicker 段)");
  it.todo("CREATE-A9 真人脸创建阶段拦截 + 出路指向演员库,余额净变化 0 —— 批 I §8.1③(演员库段)");
  it.todo("CREATE-A10 演员库角色跨场景连续出片、引用落盘 —— 批 I §8.1③(演员库段)");

  // ── 批 II(新前端纯合并落主干之后)────────────────────────────────────────
  it.todo("CREATE-A1 花钱前见增强稿预览、可改可直接用,两条提交路报价相同 —— 批 II §8.2(增强层)");
  it.todo("CREATE-A2 素材自动指派角色、越界指派花钱前拒绝 ledger 零新增行 —— 批 II §8.2(指派器)");
  it.todo("CREATE-A7 增强服务不可用时用原文生成并诚实标注未增强 —— 批 II §8.2(增强层)");
  it.todo("CREATE-A11 参考音频自动指派为节奏参考;超上限花钱前拒绝 —— 批 II §8.2(参考音频)");
  it.todo("CREATE-A12 sentPromptText 与批准稿逐字一致(含 Regenerate 重发)—— 批 II §8.2;其中「路由理由字段有值可读」的前半已由本段交付(见 creation-routing-ledger.test.ts)");

  // ── 批 III(随 Otto 引擎 S2:评测骨架今天还不存在)──────────────────────────
  it.todo("CREATE-A8 增强评测 ≥10 题、四项机械检查、不低于 ENGINE-A1 基线 —— 批 III §8.3(依赖 packages/otto/evals/)");
});
