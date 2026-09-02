import { describe, it } from "vitest";

// M3 占位(手册第 7 条:「S4 早期可先用 it.todo 占位,S5 前转正」)。
// 规格 docs/specs/creation-engine.md 验收表 CREATE-A1–A12;每条在对应施工段落地真测试后,
// 这里的占位行由该段 PR 删除——S5 只认真测试,不认本文件。
describe("creation-engine 验收占位(S2 §8 三批施工,S5 前逐条转正)", () => {
  it.todo("CREATE-A1 增强稿预览:花钱前可见可改,增强预览提交与直接提交前置报价相同");
  it.todo("CREATE-A2 自动指派参考角色,越界或互斥组合花钱前拒绝、ledger 零新增行");
  it.todo("CREATE-A3 声音开关关掉后实发 generate_audio=false,开关不影响报价");
  it.todo("CREATE-A4 1080p 自动升档,前置报价=reserve=settle 绝对值,不出现型号名,路由理由可查");
  it.todo("CREATE-A5 默认档配错降级留日志;直接请求未定价槽位拒绝、ledger 零新增行");
  it.todo("CREATE-A6 图片侧同形围栏:未定价 pro SKU 拒绝 $0,显式价目表无该条目");
  it.todo("CREATE-A7 增强不可用时用原文生成,预览诚实标注未增强,计费不受影响");
  it.todo("CREATE-A8 增强评测 ≥10 题全过机械检查,重跑 ENGINE 基线不低于基线");
  it.todo("CREATE-A9 真人脸参考图创建阶段拦截+人话提示+出路指向演员库,余额净变化 0");
  it.todo("CREATE-A10 演员库角色跨场景连续出片,不触发人脸拦截,引用落盘");
  it.todo("CREATE-A11 参考音频自动指派为节奏参考;超 3 段或总长 >15 秒花钱前拒绝");
  it.todo("CREATE-A12 sentPromptText 与批准稿逐字一致含 Regenerate,路由理由字段有值");
});
