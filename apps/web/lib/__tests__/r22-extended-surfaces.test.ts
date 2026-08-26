// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/help", useRouter: () => navigation }));

const { R22ApprovalsView } = await import("@/components/approvals/R22ApprovalsView");
const { default: CampaignListPage } = await import("@/components/campaign/campaign-list-page");
const { R22HelpView } = await import("@/components/help/R22HelpView");
const { R22LibraryView } = await import("@/components/library/R22LibraryView");
const { R22NotificationsView } = await import("@/components/notifications/R22NotificationsView");
const { R22Onboarding } = await import("@/components/onboarding/R22Onboarding");
const { AnalyticsSurface, R22_ANALYTICS_FIXTURE } = await import("@/components/schedule/analytics-surface");
const { SignupForm } = await import("@/app/signup/SignupForm");
const { readR22WorkspaceDirectory, writeR22WorkspaceDirectory } = await import("@/components/r22/r22-workspace-fixture");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEB_ROOT = path.resolve(__dirname, "../..");
let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  navigation.push.mockReset();
  navigation.replace.mockReset();
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(element: ReactElement) {
  act(() => root!.render(element));
}

function button(label: string, scope: ParentNode = container!): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  if (!found) throw new Error(`no button labelled ${label}`);
  return found as HTMLButtonElement;
}

function click(node: HTMLElement) {
  act(() => node.click());
}

function type(node: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("R22 extended frontend contracts", () => {
  it("persists one active workspace inside an authorized fixture directory", () => {
    const initial = readR22WorkspaceDirectory();
    expect(initial.activeId).toBe("batik-house");
    writeR22WorkspaceDirectory({
      activeId: "nadi-studio",
      workspaces: initial.workspaces,
    });
    expect(readR22WorkspaceDirectory()).toMatchObject({
      activeId: "nadi-studio",
      workspaces: expect.arrayContaining([{ id: "nadi-studio", name: "Nadi Studio", role: "Admin" }]),
    });
  });

  it("keeps notification history while mark-all-read clears only the unread filter", async () => {
    mount(createElement(R22NotificationsView, {
      fixture: true,
      state: "ready",
      initialItems: [
        { id: "unread", title: "Needs approval", detail: "One item", time: "Now", href: "/approvals?fixture=r22", read: false, kind: "approval" },
        { id: "read", title: "Already published", detail: "One post", time: "Yesterday", href: "/schedule?fixture=r22", read: true, kind: "publishing" },
      ],
    }));

    click(button("Unread 1"));
    expect(container!.textContent).toContain("Needs approval");
    expect(container!.textContent).not.toContain("Already published");

    click(button("Mark all as read"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 230)); });
    expect(container!.textContent).toContain("No unread notifications");
    click(button("All"));
    expect(container!.textContent).toContain("Needs approval");
    expect(container!.textContent).toContain("Already published");
  });

  it("keeps unknown Library, Notifications, Help, and Analytics reads distinct from empty", () => {
    mount(createElement(R22LibraryView, {
      fixture: true,
      fixtureRestore: false,
      state: "unknown",
      initialItems: [{ id: "protected", projectId: "fixture-raya", assetId: "asset", url: "/protected.jpg", kind: "image", prompt: "Protected Raya image", favorite: false, createdAt: "2026-08-25T08:42:00.000Z" }],
    }));
    expect(container!.textContent).toContain("Library read outcome is unknown");
    expect(container!.textContent).not.toContain("Nothing has been made yet");
    expect(container!.textContent).not.toContain("Protected Raya image");

    act(() => root!.render(createElement(R22NotificationsView, {
      fixture: true,
      state: "unknown",
      initialItems: [{ id: "protected", title: "Protected approval", detail: "Private detail", time: "Now", href: "/approvals", read: false, kind: "approval" }],
    })));
    expect(container!.textContent).toContain("Notification read outcome is unknown");
    expect(container!.textContent).not.toContain("No notification history");
    expect(container!.textContent).not.toContain("Protected approval");

    act(() => root!.render(createElement(R22HelpView, { fixture: true, state: "unknown" })));
    expect(container!.textContent).toContain("Product help read outcome is unknown");
    expect(container!.textContent).not.toContain("No matching article");
    expect(container!.textContent).not.toContain("Reconnect a publishing channel");

    act(() => root!.render(createElement(AnalyticsSurface, { fixture: true, fixtureQuality: "unknown", initial: R22_ANALYTICS_FIXTURE })));
    expect(container!.textContent).toContain("Performance read outcome is unknown");
    expect(container!.textContent).not.toContain("15,280");
    expect(container!.textContent).not.toContain("Connect Meta to see performance");
  });

  it("applies a bulk rejection to every selected fixture item and can undo it", async () => {
    mount(createElement(R22ApprovalsView, { fixture: true }));
    const checks = [...container!.querySelectorAll('[role="checkbox"]')] as HTMLButtonElement[];
    click(checks[0]!);
    click(checks[1]!);

    // 八件升级把旧的「Send back」拆成 Ask … to revise(走版本循环)与 Reject(终局)。
    // 这条测的是**终局**那一半 —— 它原本就叫「bulk rejection」,只是当年只有一个按钮。
    const bulk = container!.querySelector(".r22-approvals-bulk")!;
    click(button("Reject", bulk));
    expect(container!.textContent).toContain("Why reject 2 items?");

    click(container!.querySelector('[role="radio"][value="Wrong facts or price"]') as HTMLButtonElement);
    const rejectPanel = container!.querySelector(".r22-approvals-reject")!;
    click(button("Reject", rejectPanel));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(container!.textContent).toContain("2 rejected. Fixture state only.");

    click(button("Undo"));
    expect(container!.textContent).toContain("6 need your review");
    expect(container!.textContent).not.toContain("2 rejected. Fixture state only.");
  });

  it("keeps an approval unchanged after an unconfirmed fixture error and retries safely", async () => {
    mount(createElement(R22ApprovalsView, { fixture: true, fixtureOutcome: "error" }));
    click(button("Approve", container!.querySelector(".r22-approvals-item")!));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(container!.textContent).toContain("Nothing changed");
    expect(container!.textContent).toContain("6 need your review");
    click(button("Retry"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(container!.textContent).toContain("1 approved. Fixture state only.");
    expect(container!.textContent).toContain("5 need your review");
  });

  it("keeps approval read failures distinct from empty and hides protected details", () => {
    mount(createElement(R22ApprovalsView, { fixture: true, fixtureState: "error" }));
    expect(container!.textContent).toContain("Approvals could not load");
    expect(container!.textContent).not.toContain("Nothing needs your review");
    click(button("Retry"));
    expect(container!.textContent).toContain("6 need your review");

    act(() => root!.render(createElement(R22ApprovalsView, { fixture: true, fixtureState: "permission" })));
    expect(container!.textContent).toContain("Approvals are not available to this member");
    expect(container!.textContent).not.toContain("Candle care tip for the pandan range");
    expect(container!.textContent).not.toContain("need your review");
  });

  it("reconciles an unknown approval outcome without applying it twice", async () => {
    mount(createElement(R22ApprovalsView, { fixture: true, fixtureOutcome: "unknown" }));
    click(button("Approve", container!.querySelector(".r22-approvals-item")!));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(container!.textContent).toContain("outcome is unknown");
    expect(container!.textContent).toContain("6 need your review");
    click(button("Retry"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(container!.textContent).toContain("5 need your review");
    expect(container!.textContent).toContain("Approved 3");
  });

  it("keeps a failed campaign draft and creates it once on the same safe retry", async () => {
    mount(createElement(CampaignListPage, {
      fixture: true,
      fixtureCreateOutcome: "error",
      initialState: { ok: true, campaigns: [], nextCampaignId: "fixture", nextCampaignProof: "fixture" },
    }));
    click(button("Plan a campaign"));
    const inputs = [...document.querySelectorAll("input")] as HTMLInputElement[];
    type(inputs.find((node) => node.type === "text")!, "Deepavali launch");
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { textareaSetter.call(textarea, "Launch the gift set without discounts"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    const dates = inputs.filter((node) => node.type === "date");
    type(dates[0]!, "2026-10-01");
    type(dates[1]!, "2026-10-20");
    click(button("Create campaign", document));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 520)); });
    expect(document.body.textContent).toContain("Campaign creation was not confirmed");
    expect(inputs.find((node) => node.type === "text")!.value).toBe("Deepavali launch");
    click(button("Create campaign", document));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 520)); });
    expect(container!.textContent).toContain("Campaign draft created in this fixture");
    expect(container!.textContent?.match(/Deepavali launch/g)).toHaveLength(1);
    expect(readFileSync(path.join(WEB_ROOT, "components/campaign/campaign-list-page.tsx"), "utf8")).not.toContain("Date.now()");
  });

  it("searches fixture help, returns from article detail, and keeps support context opt-in", () => {
    mount(createElement(R22HelpView, { fixture: true }));
    const search = container!.querySelector('input[placeholder="Search product help"]') as HTMLInputElement;
    type(search, "reconnect");
    expect(container!.textContent).toContain("Reconnect a publishing channel");
    expect(container!.textContent).not.toContain("Create and return to a Canvas project");

    const result = [...container!.querySelectorAll("button")].find((node) => node.textContent?.includes("Reconnect a publishing channel"))!;
    click(result as HTMLButtonElement);
    expect(container!.textContent).toContain("Back to results");
    click(button("Back to results"));

    const contextChecks = [...container!.querySelectorAll('[role="checkbox"]')] as HTMLButtonElement[];
    click(contextChecks[0]!);
    click(contextChecks[1]!);
    const exit = [...container!.querySelectorAll("a")].find((node) => node.textContent?.includes("real email exit"))!;
    expect(exit.getAttribute("href")).toContain("Page%3A%20%2Fhelp");
    expect(exit.getAttribute("href")).toContain("current%20workspace");
  });

  it("keeps one fixture support request id through review, error, retry, waiting, and close", async () => {
    mount(createElement(R22HelpView, { fixture: true, supportOutcome: "error" }));
    type(container!.querySelector('input[placeholder="What do you need help with?"]') as HTMLInputElement, "Approval is still waiting");
    const detail = container!.querySelector('textarea[placeholder^="Tell support"]') as HTMLTextAreaElement;
    const detailSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { detailSetter.call(detail, "The approved post is still waiting in Schedule."); detail.dispatchEvent(new Event("input", { bubbles: true })); });
    click(button("Review request"));
    expect(container!.textContent).toContain("Review before submitting");
    click(button("Submit request"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 460)); });
    expect(container!.textContent).toContain("Request was not submitted");
    expect(container!.textContent).toContain("fixture-support-1");
    click(button("Retry same request"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 460)); });
    expect(container!.textContent).toContain("Request queued");
    expect(container!.textContent).toContain("fixture-support-1");
    click(button("Refresh request status"));
    expect(container!.textContent).toContain("Waiting for a support reply");
    click(button("Close fixture request"));
    expect(container!.textContent).toContain("Request closed");
  });

  it("keeps onboarding fixture connection and first-post actions local", async () => {
    mount(createElement(R22Onboarding, {
      initialStep: "channel",
      initialWorkspaceName: "Batik House",
      initialChannelState: "disconnected",
      fixture: true,
    }));

    expect(container!.querySelector('a[href="/api/meta/authorize"]')).toBeNull();
    click(button("Connect Instagram"));
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 380)); });
    expect(container!.textContent).toContain("Granted in this visual fixture");
    expect(container!.textContent).toContain("No provider authorization or connection was saved");

    act(() => root!.render(createElement(R22Onboarding, {
      key: "post",
      initialStep: "post",
      initialWorkspaceName: "Batik House",
      initialChannelState: "disconnected",
      fixture: true,
    })));
    type(container!.querySelector('input[placeholder="A candle care tip for the new pandan scent"]') as HTMLInputElement, "A calm Raya launch post");
    click(button("Generate post 3 cr"));
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 650)); });
    expect(container!.textContent).toContain("First post · Instagram");
    click(button("Approve"));
    expect(container!.textContent).toContain("no provider publish was called");
    expect(navigation.push).not.toHaveBeenCalledWith(expect.stringContaining("/create/canvas"));
  });

  it("reconciles an unknown signup fixture request without calling the provider", async () => {
    mount(createElement(SignupForm, { fixture: true, fixtureState: "unknown" }));
    const inputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    type(inputs.find((node) => node.name === "shopName")!, "Batik House");
    type(inputs.find((node) => node.name === "email")!, "founder@example.com");
    type(inputs.find((node) => node.name === "password")!, "fixture-password");
    click(button("Create account"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(container!.textContent).toContain("outcome is unknown");
    expect(inputs.find((node) => node.name === "email")!.value).toBe("founder@example.com");
    click(button("Check account status"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(container!.textContent).toContain("No account, email, workspace, or starter credits were created");
  });

  it("fences visual fixtures from campaign, Schedule, Settings, and provider writes", () => {
    const campaign = readFileSync(path.join(WEB_ROOT, "components/campaign/campaign-list-page.tsx"), "utf8");
    const schedule = readFileSync(path.join(WEB_ROOT, "components/schedule/r22-schedule-composer.tsx"), "utf8");
    const settings = readFileSync(path.join(WEB_ROOT, "components/settings/R22SettingsShell.tsx"), "utf8");
    const home = readFileSync(path.join(WEB_ROOT, "components/home/HomeView.tsx"), "utf8");
    const ottoHost = readFileSync(path.join(WEB_ROOT, "components/otto/panel/OttoPanelHost.tsx"), "utf8");
    const ottoConversation = readFileSync(path.join(WEB_ROOT, "components/otto/panel/OttoPanelConversation.tsx"), "utf8");

    expect(campaign).toContain("if (fixture) {");
    expect(campaign).toContain("writeFixture(CAMPAIGN_DRAFT_KEY, null)");
    expect(campaign.indexOf("if (fixture) {")).toBeLessThan(campaign.indexOf("await proposeCampaign"));
    expect(schedule).toContain("if (fixture) {");
    expect(schedule).toContain("onFixtureUpsert(post)");
    expect(schedule.indexOf("if (fixture) {")).toBeLessThan(schedule.indexOf("await createScheduledPost"));
    expect(settings).toContain('if (fixture) { onFixtureSave?.(next); return onNotice("Spend cap updated in this preview. Nothing has been saved to your live account yet."); }');
    expect(settings.indexOf("if (fixture) { onFixtureSave")).toBeLessThan(settings.indexOf("await setOwnerSetting"));
    expect(settings).toContain("disabled={busy || fixture}");
    expect(home).toContain('window.location.assign("/api/meta/authorize")');
    // 权限那句是状态句,按 Founder 2026-08-25 缩辖区裁决收进 `HOME_COPY`(措辞未变)。
    expect(home).toContain("HOME_COPY.noPasswordStored");
    expect(ottoHost).toContain("if (fixture) return;");
    // Founder 2026-08-25 裁决:fixture 诚实由顶栏「Prototype · sample data」徽章承担,
    // 面板里那句话回到人话(原型 `#ottoContext` 的寄存器)。这条围栏钉的仍是同一件事 ——
    // 那条回话必须写明「这里不会替商家动任何东西」——只是不再用工程黑话写。
    //
    // 那句话搬了家(Cloudflare 四子流那一轮):回话从一段自己编的散文换成了原型
    // `responseFor()` 的结构化答案卡,而「这一轮什么都没动」不再是散文里的一个从句,
    // 是每一路答案都必须带的那条 `note`。所以这条围栏跟着钉到答案模型上 —— 钉的是
    // 同一件事,而且比上一版更硬:上一版只要那一句在,这一版要求**每一路**都有。
    const ottoAnswer = readFileSync(path.join(WEB_ROOT, "components/otto/panel/otto-answer.ts"), "utf8");
    expect(ottoAnswer).toContain("This chat did not change workspace state or spend credits.");
    expect(ottoAnswer).toContain("This chat did not change the approval or spend credits.");
    expect(ottoAnswer).toContain("This chat did not start a routine or change a routine state.");
    expect(ottoAnswer).toContain("This chat did not save, remove, or alter any Otto IQ record.");
    expect(ottoAnswer).toContain("No analytics job was started and no credits were spent.");
    expect(ottoConversation).toContain("no action will run from chat");
    expect(ottoConversation).not.toContain("Visual fixture");
    for (const unstableFixtureId of [
      "fixture-voice-${Date.now",
      "fixture-post-${Date.now",
      "routine-activity-${Date.now",
      "fixture-member-${Date.now",
      "fixture-chip-${Date.now",
      "fixture-user-${Date.now",
    ]) expect(`${campaign}\n${schedule}\n${settings}\n${ottoHost}\n${ottoConversation}`).not.toContain(unstableFixtureId);
  });
});
