/**
 * #791-2 三处假开关清扫 —— 商家面的两处。
 *
 * (a) Inbox 的「Otto handling」:conversation.automationState 只有 disabled /
 *     otto_active / paused_by_human 三个值,而 M2 从不写 otto_active
 *     (customer-inbox-service.ts 自己的注释:「M2 never writes otto_active」),
 *     paused_by_human 又只能由 takeOverConversation 从 otto_active 转过来。
 *     于是 Inbox 里那枚品牌色徽章、那句「Otto is currently handling this
 *     conversation」和「Take over」按钮,是一个永远到不了的状态的界面。
 *     商家读到的是「Otto 在替我回客人」——产品里没有这回事。
 *
 * (b) Settings 的「Notifications · Email / In-app」:两个开关写进
 *     Organization.settings 就没有下文了 —— 全仓没有任何一行读 notifyEmail /
 *     notifyInApp,也没有任何发信或站内信通道。开着等于关着。
 *
 * 这两条都按「移除」处理:接真需要的是产品本身不存在的能力(对客 AI 自动回复、
 * 通知通道),留着开关就是留着承诺。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const webRoot = path.resolve(__dirname, "../..");
/** Source with comments stripped — the assertions below are about what the product SAYS
 *  to a merchant, and a comment explaining why a branch was deleted is not that. */
function readCode(rel: string): string {
  return readFileSync(path.join(webRoot, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("#791-2a Inbox 不再展示永远到不了的「Otto handling」", () => {
  it("徽章不再为 otto_active 造一句「Otto handling」—— 任何到不了的状态都落回真话", async () => {
    const { controlBadgePresentation } = await import("@/components/crm/inbox/inbox-format");
    expect(controlBadgePresentation("otto_active").label).toBe("Manual only");
    expect(controlBadgePresentation("disabled").label).toBe("Manual only");
    expect(controlBadgePresentation("something_new").label).toBe("Manual only");
    // 真发生过的那一种仍然如实说
    expect(controlBadgePresentation("paused_by_human").label).toBe("Human took over · Otto paused");
    expect(readCode("components/crm/inbox/inbox-format.ts")).not.toContain("Otto handling");
  });

  it("会话页不再有「Otto 正在处理 / Take over」这条分支", () => {
    const src = readCode("components/crm/inbox/inbox-conversation-page.tsx");
    expect(src).not.toContain("otto_active");
    expect(src).not.toMatch(/Otto is currently handling/);
    expect(src).not.toMatch(/>Take over</);
  });
});

describe("#791-2b Settings 不再有没人读的 Notifications 开关", () => {
  it("OwnerSettings 里不再有 notifyEmail / notifyInApp", async () => {
    const { DEFAULT_SETTINGS } = await import("@/lib/owner-settings");
    expect(Object.keys(DEFAULT_SETTINGS)).not.toContain("notifyEmail");
    expect(Object.keys(DEFAULT_SETTINGS)).not.toContain("notifyInApp");
  });

  it("Settings 界面里不再有 Notifications 这一节", () => {
    const src = readCode("components/otto/settings/sections.tsx");
    expect(src).not.toContain("notifyEmail");
    expect(src).not.toContain("notifyInApp");
    expect(src).not.toMatch(/id: "notifications"/);
  });

  it("旧账号存过的 notify* 值不会因为字段消失而炸掉设置读取", async () => {
    const { mergeSettings, DEFAULT_SETTINGS } = await import("@/lib/owner-settings");
    const merged = mergeSettings({ notifyEmail: false, notifyInApp: false, timezone: "Asia/Kuala_Lumpur" });
    expect(merged).toEqual({ ...DEFAULT_SETTINGS, timezone: "Asia/Kuala_Lumpur" });
  });
});
