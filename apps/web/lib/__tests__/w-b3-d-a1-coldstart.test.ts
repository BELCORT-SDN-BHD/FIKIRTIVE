import { describe, it, expect } from "vitest";
import { HOOK_COLDSTART_NOTE } from "@/components/northstar/immersive/studio-factory/data";

// W-B3-D · 锚 A1 通过阈值(gate4 诚实契约):品牌记忆冷启动必须诚实标注 —— 格式提示是品类信号,
// 尚未从用户账号学习。断言这条铁律文案在产品里真实存在(非散文承诺)。
describe("A1 cold-start honesty (gate4): format hints are category signals, not learned yet", () => {
  it("HOOK_COLDSTART_NOTE names them as category signals", () => {
    expect(HOOK_COLDSTART_NOTE).toContain("category signals");
  });
  it("HOOK_COLDSTART_NOTE is honest that it hasn't learned from the account yet", () => {
    expect(HOOK_COLDSTART_NOTE.toLowerCase()).toContain("not learned from your account yet");
  });
});
