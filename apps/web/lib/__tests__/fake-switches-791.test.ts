/**
 * #791-2 三处假开关清扫 —— 商家面的两处。
 *
 * (a) Inbox 的「Otto handling」:conversation.automationState 只有 disabled /
 *     otto_active / paused_by_human 三个值,而 M2 从不写 otto_active
 *     (customer-inbox-service.ts 自己的注释:「M2 never writes otto_active」),
 *     paused_by_human 又只能由当时的 takeOverConversation 从 otto_active 转过来。
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

/**
 * #810 P3-1(跨族判官):#791-2 只删了界面那一半。服务端仍然在
 * automationState === "otto_active" 时拒存草稿并回一句 "Take over the conversation from
 * Otto…",takeOverConversation 也仍然是公开导出的动作 —— 指向一个页面上已经不存在的按钮。
 * 编排者裁定:整套移除。旧数据里那个值仍然照实显示在时间线上,但它不再挡任何人打字。
 */
describe("#810 P3-1 take-over 残留整套移除", () => {
  it("三层都不再导出 takeOverConversation,错误码 TAKEOVER_REQUIRED 也一并消失", async () => {
    const service = await import("@/lib/customer-inbox-service");
    const gateway = await import("@/lib/customer-inbox-gateway");
    const uiActions = await import("@/lib/customer-inbox-ui-actions");
    for (const mod of [service, gateway, uiActions]) {
      expect(Object.keys(mod)).not.toContain("takeOverConversation");
    }
    expect(Object.keys(service.customerInboxService)).not.toContain("takeOverConversation");
    expect(Object.keys(service.CUSTOMER_INBOX_ERROR_CODES)).not.toContain("TAKEOVER_REQUIRED");
  });

  it("源码里零残留引用(注释不算 —— 断言的是产品做什么)", () => {
    for (const rel of [
      "lib/customer-inbox-service.ts",
      "lib/customer-inbox-gateway.ts",
      "lib/customer-inbox-ui-actions.ts",
      "components/crm/inbox/inbox-format.ts",
      "components/crm/inbox/inbox-conversation-page.tsx",
    ]) {
      const src = readCode(rel);
      expect(src, rel).not.toContain("takeOverConversation");
      expect(src, rel).not.toContain("TAKEOVER_REQUIRED");
    }
  });

  it("旧数据里的 takeover 事件仍然如实出现在时间线上(移除动作 ≠ 抹掉历史)", async () => {
    const { eventDescription } = await import("@/components/crm/inbox/inbox-format");
    const phrase = eventDescription(
      {
        kind: "takeover",
        fromAssigneeMembershipId: null,
        toAssigneeMembershipId: null,
        fromAutomationState: "otto_active",
        toAutomationState: "paused_by_human",
        note: null,
      },
      () => null,
    );
    expect(phrase).toBe("A team member took over from Otto");
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
