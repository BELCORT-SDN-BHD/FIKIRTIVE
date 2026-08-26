// @vitest-environment jsdom
/**
 * r22-settings-beta-scope.test.ts —— beta V1 的 Settings 收窄(Founder 裁决 2026-08-27,
 * 卫生大扫除台账 P2-14 / P2-22)。
 *
 * 裁决:beta 期 Settings 只留 **Profile / Preferences / Billing and credits** 三节。其余八节
 * (General / Members / Roles / Domains / Connections / Connected accounts / Security /
 * Notifications)**只藏不删** —— 照 `R22DashboardShell` 的 `BETA_HIDDEN_NAV_KEYS` 先例:
 * 权威表 `SETTINGS_GROUPS` 一格没动、壳里八节的实现一行没删,收窄发生在两处壳层动作,
 * 并留一个显式开关 `?sections=all` 把十一节原样开回来。
 *
 * 七条钉的是**商家真的看得到什么**:
 *   ① 侧栏只画三节,空掉的分组连标题一起不画;
 *   ② 深链落到被藏的一节 ⇒ 不 404、不报错,落到 Profile,而且**说出来**他按的是哪扇门;
 *   ③ `/settings` 裸地址(默认落点 General 也在被藏名单里)⇒ 静静落到 Profile,不弹解释 ——
 *      那个名字商家没按过;
 *   ④ `/settings/connections` 这条真路由 ⇒ 回落且说出 Connections(Help 抽屉那条链接就落这);
 *   ⑤ 商家自己按走别的一节 ⇒ 那句回落提示跟着走,不赖在屏幕上;
 *   ⑥ `?sections=all` ⇒ 十一节全回、深链直达、无回落提示;
 *   ⑦ P2-14:留下的三节里动作收尾句照现行 preview 口径,不再逐件否认 beta 期根本不存在的
 *      channel / domain record / invitation。
 *
 * 变异自检(2026-08-27 逐条实做,做完还原,红 → 绿):
 *   · 侧栏那句 `betaScope ? group.items.filter(...) : group.items` 改回 `group.items`
 *     (= 被藏节回渲染)⇒ ① 红;
 *   · `R22SettingsEntry` 的 `fallsBack` 改成抛 `notFound()`/直接返回 null(= 回落变 404)
 *     ⇒ ②④ 红;
 *   · `betaScope = !betaGateOpen` 改成常量 `true`(= 开闸失效)⇒ ⑥ 红。
 */
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings",
}));
vi.mock("@/lib/owner-settings-actions", () => ({ setOwnerSetting: vi.fn() }));
vi.mock("@/lib/meta-actions", () => ({ disconnectMeta: vi.fn() }));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const { R22SettingsShell } = await import("@/components/settings/R22SettingsShell");
const { R22SettingsEntry } = await import("@/components/settings/R22SettingsEntry");
const {
  BETA_SETTINGS_SECTIONS,
  BETA_HIDDEN_SETTINGS_SECTIONS,
  SETTINGS_GROUPS,
  R22_SETTINGS_SECTION_LABELS,
} = await import("@/components/settings/r22-settings-sections");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATA = {
  workspaceName: "Batik House",
  displayName: "Nadia",
  email: "nadia@batikhouse.my",
  balance: 1240,
  recent: [],
  accountReadable: true,
  spendCapCredits: 40,
  timezone: "Malaysia Time · GMT+8",
  channels: [],
};

/** beta 期商家在 Settings 侧栏读得到的三格名字,逐字来自权威表 —— 期望侧不手抄。 */
const VISIBLE_LABELS = BETA_SETTINGS_SECTIONS.map((id) => R22_SETTINGS_SECTION_LABELS[id]);
const HIDDEN_LABELS = BETA_HIDDEN_SETTINGS_SECTIONS.map((id) => R22_SETTINGS_SECTION_LABELS[id]);

let host: HTMLDivElement;
let root: Root;

async function mount(props: Record<string, unknown>) {
  await act(async () => {
    root.render(h(R22SettingsShell, { data: DATA, fixture: true, ...props } as never));
  });
  // fixture 分支要等第一个 effect 跑完才算落定。
  await act(async () => { await Promise.resolve(); });
}

const navLabels = () => Array.from(host.querySelectorAll(".r22-settings-group > button")).map((node) => node.textContent?.trim() ?? "");
const groupTitles = () => Array.from(host.querySelectorAll(".r22-settings-group > p")).map((node) => node.textContent?.trim() ?? "");
const fallbackNotice = () => host.querySelector("[data-r22-settings-fallback]");

/** 入口是服务端组件:走 fixture 分支拿回它交给壳的那份 props,不碰 requireOwner。 */
async function entryProps(searchParams: Record<string, string>, defaultSection?: string) {
  const element = await R22SettingsEntry({
    searchParams: Promise.resolve({ fixture: "r22", ...searchParams }),
    ...(defaultSection ? { defaultSection: defaultSection as never } : {}),
  });
  return (element as unknown as { props: { initialSection: string; betaScope: boolean; betaFallbackFrom?: string } }).props;
}

beforeEach(() => {
  navigation.replace.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  try { window.sessionStorage.clear(); } catch { /* 存档被锁住时这一面照样能用 */ }
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("① beta 侧栏只画三节", () => {
  it("三节都在,八节一格不剩", async () => {
    await mount({ initialSection: "profile", betaScope: true });
    const labels = navLabels();
    for (const label of VISIBLE_LABELS) expect(labels, `${label} 不在 beta 侧栏里`).toContain(label);
    for (const label of HIDDEN_LABELS) expect(labels, `被藏的「${label}」回到了侧栏`).not.toContain(label);
    expect(labels.length, "侧栏格子数与名单不符").toBe(BETA_SETTINGS_SECTIONS.length);
  });

  it("空掉的分组连标题一起不画 —— 一个空的「Workspace」标题等于说这里坏了", async () => {
    await mount({ initialSection: "profile", betaScope: true });
    expect(groupTitles()).toEqual(["Personal", "Publishing"]);
  });

  it("名单同源:被藏八节 + 留下三节 = 权威表全表,没有第二张手抄名单", () => {
    const authority = SETTINGS_GROUPS.flatMap((group) => group.items.map((item) => item.id));
    expect([...BETA_SETTINGS_SECTIONS, ...BETA_HIDDEN_SETTINGS_SECTIONS].sort()).toEqual([...authority].sort());
    expect(BETA_SETTINGS_SECTIONS).toEqual(["profile", "preferences", "billing"]);
  });
});

describe("② 深链落到被藏的一节:温和回落,不 404 不静默", () => {
  it("?section=members ⇒ 落 Profile,并说出他按的是 Members", async () => {
    const props = await entryProps({ section: "members" });
    expect(props.initialSection, "回落落点不是 beta 三节之一").toBe("profile");
    expect(props.betaScope).toBe(true);
    expect(props.betaFallbackFrom).toBe("Members");

    await mount({ initialSection: props.initialSection, betaScope: props.betaScope, betaFallbackFrom: props.betaFallbackFrom });
    const notice = fallbackNotice();
    expect(notice, "回落了却一声不吭").toBeTruthy();
    expect(notice!.getAttribute("role"), "回落不是错误,别用 alert 吓人").toBe("status");
    expect(notice!.textContent).toContain("Members");
    expect(notice!.textContent).toContain("Profile");
    // 落点真的是 Profile 那一节的内容,不是一张空壳。
    expect(host.querySelector(".r22-settings-content h1")?.textContent).toBe("Profile");
  });

  it("④ /settings/connections 这条真路由照样回落并说出 Connections", async () => {
    const props = await entryProps({}, "connections");
    expect(props.initialSection).toBe("profile");
    expect(props.betaFallbackFrom).toBe("Connections");
  });

  it("③ /settings 裸地址静静落到 Profile —— General 这个名字商家没按过,不为它弹解释", async () => {
    const props = await entryProps({});
    expect(props.initialSection).toBe("profile");
    expect(props.betaFallbackFrom).toBeUndefined();

    await mount({ initialSection: props.initialSection, betaScope: props.betaScope, betaFallbackFrom: props.betaFallbackFrom });
    expect(fallbackNotice()).toBeNull();
  });

  it("⑤ 商家自己按走别的一节,那句回落提示跟着走", async () => {
    await mount({ initialSection: "profile", betaScope: true, betaFallbackFrom: "Members" });
    expect(fallbackNotice()).toBeTruthy();
    const billing = Array.from(host.querySelectorAll(".r22-settings-group > button")).find((node) => node.textContent?.includes("Billing"));
    await act(async () => { billing?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(fallbackNotice(), "换了一节,上一次的回落解释还赖在屏幕上").toBeNull();
  });
});

describe("⑥ 显式开关 ?sections=all 把十一节原样开回来", () => {
  it("开闸后深链直达被藏的一节,不回落也不解释", async () => {
    const props = await entryProps({ section: "members", sections: "all" });
    expect(props.initialSection, "开闸了还在回落").toBe("members");
    expect(props.betaScope).toBe(false);
    expect(props.betaFallbackFrom).toBeUndefined();
  });

  it("开闸后侧栏十一格全回 —— 八节是藏起来的,不是删掉的", async () => {
    await mount({ initialSection: "members", betaScope: false });
    const labels = navLabels();
    for (const label of [...VISIBLE_LABELS, ...HIDDEN_LABELS]) expect(labels, `开闸后仍缺「${label}」`).toContain(label);
    expect(labels.length).toBe(SETTINGS_GROUPS.flatMap((group) => group.items).length);
    expect(host.querySelector(".r22-settings-content h1")?.textContent).toBe("Members");
  });
});

describe("⑦ P2-14 留下三节的动作收尾句", () => {
  it("Top up 成功后只说这一次的边界,不再逐件否认 beta 期不存在的东西", async () => {
    await mount({ initialSection: "billing", betaScope: true });
    const topUp = Array.from(host.querySelectorAll(".r22-settings-content button")).find((node) => node.textContent?.trim() === "Top up");
    await act(async () => { topUp?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const save = Array.from(document.body.querySelectorAll('.r22-settings-dialog [data-slot="dialog-footer"] button')).find((node) => node.textContent?.trim() === "Save changes");
    await act(async () => { save?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });

    const success = document.body.querySelector(".r22-settings-action-success");
    expect(success, "成功层没出来").toBeTruthy();
    expect(success!.textContent, "现行 preview 口径丢了").toContain("in this preview");
    for (const denial of ["no channel", "no domain record", "no invitation"]) {
      expect(success!.textContent, `收尾句还在替不存在的动作道歉:「${denial}」`).not.toContain(denial);
    }
  });
});
