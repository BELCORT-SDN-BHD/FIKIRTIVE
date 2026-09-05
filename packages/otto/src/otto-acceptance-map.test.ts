/**
 * Otto 引擎验收表 ↔ 测试的**映射表**(机器闸 M3 的登记处)。
 *
 * 规格 docs/specs/otto-engine.md 的验收表有七行(ENGINE-A1–A7),而 S2 §7.1 把它们按依赖
 * 切成七段、三批。这个文件是**全表**的登记处:哪一段落地就把它那一行转正,
 * 别处不再另立第二份登记表。今天已转正四条:ENGINE-A5(①段 §7.2①)、ENGINE-A2(②段 §7.2②)、
 * ENGINE-A4(⑤段 §7.2⑤)、ENGINE-A3(⑦段 §7.2⑦)。
 *
 * 这个文件的用处与 Creation 那份(packages/core/src/creation-acceptance-map.test.ts)相同:
 * **把没交付的那几条说出口**,而不是让它们从测试树上消失 ——
 *   · 已交付的编号在下面写明真身在哪个文件(读的人一步就找得到);
 *   · 未交付的编号是 `it.todo`,即「登记在册、尚未实现」。M3 认这个形状(闸的判词逐字写着
 *     「S4 早期可先 it.todo 占位」),而它对人的意思是一句诚实话:这条验收今天**没有**证据,
 *     别把闸绿当成它过了。
 *
 * 每一条 todo 都注明归哪一段,所以哪一段落地时该把哪一条转正是确定的,不需要谁去回忆。
 * 转正 = 把 `it.todo` 换成真正的行为测试(S5 验收只认真身)。
 */
import { describe, it } from "vitest";

describe("Otto 验收表 ↔ 测试映射(S2 §7.1 七段)", () => {
  // ── ①段(本段交付,真身在这三个文件里)────────────────────────────────────
  it.todo("ENGINE-A5 见 packages/core/src/llm-prices.test.ts(未定价即抛、猜价已删)+ packages/core/src/env-contract.test.ts(开机拒绝启动、warn 免疫)+ packages/otto/src/model.test.ts(manifest 组合期查价、计价型号单一源)——①段已交付");

  // ── ②段(已交付,真身在这三个文件里)────────────────────────────────────
  it.todo("ENGINE-A2 见 packages/otto/src/runtime-turn-trace.test.ts(跑完/截断都落档案、无明文围栏、sink 抛错不承重)+ packages/db/src/otto-turn-trace-tenant.test.ts(双租户互不可见、外键与主键)+ apps/web/lib/__tests__/otto-actions.test.ts 与 otto-stream-route.test.ts(三门接线与入库列集)——②段已交付");

  // ── 批 I 的其余两段(不在本段写集)─────────────────────────────────────────
  it.todo("ENGINE-A1 评测集 v0 ≥10 题逐个判分 + 基线档案入档 —— ③段 §7.2③(packages/otto/evals/ 今天还不存在)");
  it.todo("ENGINE-A6 长对话旧轮折成摘要、对话继续,新一轮成本不随历史无限上涨 —— ④段 §7.2④");

  // ── ⑤段(已交付,真身在这三个文件里)────────────────────────────────────
  it.todo("ENGINE-A4 见 apps/web/lib/__tests__/engine-a4-truncated-turn-refund.test.ts(真库:零交付 → reserve/refund 成对、余额净变 0、消费历史「Held, then refunded in full」;有交付 → 按实结算不退)+ packages/otto/src/runtime.test.ts(零交付判词:只读/无 item/失败的写 ⇒ 退,落盘的写/铸出的卡片 ⇒ 结算)+ apps/web/lib/__tests__/otto-stream-route.test.ts(入口诚实文案)——⑤段已交付");

  // ── 批 II 的另一段(不在本段写集)─────────────────────────────────────────
  it.todo("ENGINE-A7 技能文件柜替换单体后重跑评测,总分不低于 ENGINE-A1 基线 —— ⑥段 §7.2⑥");

  // ── 批 III(已交付;#1150 / #1151 / #1158 / #1194 / #1197 均已在主干)────────
  it.todo("ENGINE-A3 见 apps/web/lib/__tests__/engine-a3-canvas-conversation.test.tsx(画布上没有任何直出花钱控件的真渲染集合断言、送出开的是一条 surface=canvas 的对话、花钱动作仍长在 OttoApprovalCard 上、三条常驻价目披露)+ e2e/journeys/engine-a3-canvas-conversation.spec.ts(端到端旅程)——⑦段已交付");
});
