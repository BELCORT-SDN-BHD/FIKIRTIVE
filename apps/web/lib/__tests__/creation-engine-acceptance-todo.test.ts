/**
 * Creation 引擎验收表的**占位账**(docs/specs/creation-engine.md,已冻结 · v2)。
 *
 * 为什么存在:M3 闸(scripts/ci/process-gates.sh)要求——凡是 PR 描述引用了某份冻结规格,
 * 那份规格验收表里的**每一个**编号都必须逐字出现在测试树里。Creation 引擎是首次开工,
 * §8 施工稿把 12 条验收切成三批(批 I / 批 II / 批 III),所以本段之外的 11 条今天没有落点,
 * 闸对每一条都红——这与本 PR 改了什么无关,任何引用这份规格的 PR 都同样红。
 *
 * 闸自己给的正门就是这个:「S4 早期可先 it.todo("<编号> …") 占位」(process-gates.sh m3 的
 * 修法提示,项目 CLAUDE.md 开发流程第 7 条同一口径)。占位不是豁免:`it.todo` 在 vitest 里
 * 计入 todo 计数、永远不会假绿,S5 验收只认真跑起来的断言。
 *
 * 规矩:哪一条被真正实现,就把它这一行从这里**删掉**,断言写进那条路自己的行为测试里。
 * 这个文件应当随施工推进逐行缩短,最终整个删除;它变长就是走错了方向。
 *
 * 已经有真测试、因此不在本文件的:
 *   CREATE-A3 —— apps/web/lib/__tests__/video-audio-toggle.test.ts
 *                 ＋ packages/generation/src/byteplus-audio.test.ts
 */
import { describe, it } from "vitest";

describe("Creation 引擎验收:批 I 其余条目(§8.1,本 PR 之外的施工段)", () => {
  it.todo("CREATE-A4 —— 1080p 过地板测试价 ⇒ 路由到高清档,报价＝reserve 绝对值＝settle 绝对值,型号名不外露(§8.1① 能力路由)");
  it.todo("CREATE-A5 —— 默认视频型号指向未定价槽位 ⇒ 降级留日志;直接请求未定价槽位 ⇒ 拒绝、ledger 零新增行(§8.1① SKU 白名单)");
  it.todo("CREATE-A6 —— 请求未定价的 pro 图 SKU ⇒ 拒绝、$0;图片围栏与视频同形(§8.1① SKU 白名单)");
  it.todo("CREATE-A9 —— 真人脸参考图 ⇒ 创建阶段拦截＋人话提示＋出路指向演员库;ledger reserve/refund 成对、无 SETTLE(§8.1③)");
  it.todo("CREATE-A10 —— 演员库角色跨场景连续出片不触发人脸拦截,所引角色落盘可查(§8.1③ 后端半;商家面归批 II)");
  it.todo("CREATE-A12 —— sentPromptText 与商家批准的增强稿逐字一致(含 Regenerate 重发同一串),routeReason 有值可读(§8.1⑤ 前半＋批 II 后半)");
});

describe("Creation 引擎验收:批 II(§8.2,新前端纯合并落主干后)", () => {
  it.todo("CREATE-A1 —— 花钱前先见增强稿预览、可编辑可直接用;增强提交与直接提交前置报价数字相同(§8.2 增强层)");
  it.todo("CREATE-A2 —— 素材自动指派角色、指派句可见可改;越界指派与首尾帧×全模态互斥在花钱前拒绝、ledger 零新增行(§8.2 自动指派＋拒绝闸)");
  it.todo("CREATE-A7 —— 增强服务不可用 ⇒ 用商家原文生成、预览处诚实标注未增强,生成与计费不受影响(§8.2 增强层回退)");
  it.todo("CREATE-A11 —— 音频自动指派为节奏参考、报价前置;超 3 段或总长超 15 秒在花钱前拒绝、ledger 零新增行(§8.2 参考音频)");
});

describe("Creation 引擎验收:批 III(§8.3,随 Otto 引擎 S2)", () => {
  it.todo("CREATE-A8 —— 增强评测 ≥10 题过四项机械检查,且改 craft/ 后重跑 otto-engine.md 基线不低于基线(依赖 packages/otto/evals/ 骨架,今天不存在)");
});
