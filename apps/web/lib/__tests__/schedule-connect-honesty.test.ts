// @vitest-environment jsdom
/**
 * #694 + #695 —— Schedule 说的必须等于产品做得到的。
 *
 * #694 病灶:一个渠道都没连的**全新商家**打开 composer,渠道列表回退成「全部渠道」,
 * X 就混了进来。可 X 根本连不上 —— Connections 那边诚实地只写「Not available yet」,
 * 没有任何控件;composer 里那颗「Connect」按钮把商家送到那一行,路到此为止。商家还能
 * 就这么存下一个永远发不出去的 X 草稿。附带两处同根:Plan/Queue 的渠道筛选器始终列着 X;
 * 账户页的「x of 3 connected」把一个连不上的渠道算进了分母。
 *
 * #695 病灶:「Approve & schedule」灰着,提示只解释了「缺账号」。账号一选,提示消失,
 * 按钮继续灰着 —— 真正缺的「至少挑一张图」从头到尾没说过。
 *
 * 两票同一句话:界面给的路必须走得通,界面说的理由必须是真理由。
 *
 * 全程驱动**真** OttoSchedule / 真 buildSettingsSections,只把 server action 换成假件。
 * 一个积分都花不出去:排程从不生成媒体。
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStuffItems } from "../stuff-items";
import { DEFAULT_SETTINGS } from "../owner-settings";
import type { AccountInfo } from "../account-actions";

const mocks = vi.hoisted(() => ({
  listScheduledPosts: vi.fn(),
  listOwnerTargets: vi.fn(),
  createScheduledPost: vi.fn(),
  updateScheduledPost: vi.fn(),
  approveScheduledPost: vi.fn(),
  cancelScheduledPost: vi.fn(),
  getMetaConnection: vi.fn(),
  getOwnerSettings: vi.fn(),
  setOwnerSetting: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));

vi.mock("@/lib/schedule-actions", () => ({
  listScheduledPosts: mocks.listScheduledPosts,
  listOwnerTargets: mocks.listOwnerTargets,
  createScheduledPost: mocks.createScheduledPost,
  updateScheduledPost: mocks.updateScheduledPost,
  approveScheduledPost: mocks.approveScheduledPost,
  cancelScheduledPost: mocks.cancelScheduledPost,
}));
vi.mock("@/lib/meta-actions", () => ({ getMetaConnection: mocks.getMetaConnection }));
vi.mock("@/lib/owner-settings-actions", () => ({
  getOwnerSettings: mocks.getOwnerSettings,
  setOwnerSetting: mocks.setOwnerSetting,
}));
vi.mock("@/lib/otto-client-actions", () => ({ setAdsAutonomy: mocks.setAdsAutonomy }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { OttoSchedule } = await import("@/components/otto/OttoSchedule");
const { buildSettingsSections } = await import("@/components/otto/settings/sections");

const IMG_SRC = "https://cdn.test/kopi.png";
const STUFF_ITEMS = buildStuffItems({
  entities: [],
  history: [{ id: "gen-1", projectId: "proj-1", assetId: "asset-1", src: IMG_SRC, kind: "image", prompt: "Kopi shot" }],
  ads: [],
  records: [],
});

const IG_TARGET = { id: "ig-1", name: "Kopi Kita", channel: "instagram" as const };

// ── DOM 小工具(composer 走 Radix Portal,内容落在 body) ────────────────────────
function scope(): ParentNode {
  return document.body.querySelector('[data-slot="dialog-content"]') ?? document.body;
}

function buttonByText(text: string, root: ParentNode = document.body): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    (b.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`no button containing "${text}"`);
  return found;
}

/** 某个 Field 的整块(标签 + 控件)—— Field 渲染成 <label><span>标题</span>…</label>。 */
function field(label: string, root: ParentNode = scope()): HTMLElement {
  const found = Array.from(root.querySelectorAll<HTMLLabelElement>("label")).find(
    (l) => l.querySelector("span")?.textContent === label,
  );
  if (!found) throw new Error(`no "${label}" field`);
  return found;
}

/** composer 里 Channel 一栏摆出来的渠道,按商家看到的名字。 */
function composerChannelLabels(): string[] {
  return Array.from(field("Channel").querySelectorAll("button")).map((b) => (b.textContent ?? "").trim());
}

/** Plan/Queue 顶上的渠道筛选器选项 —— 认「All」那一颗所在的那一排(composer 之外)。 */
function channelFilterLabels(): string[] {
  const dialog = document.body.querySelector('[data-slot="dialog-content"]');
  const all = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => (b.textContent ?? "").trim() === "All" && !dialog?.contains(b),
  );
  if (!all?.parentElement) throw new Error("no channel filter bar");
  return Array.from(all.parentElement.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim());
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function setNativeValue(
  el: HTMLTextAreaElement | HTMLSelectElement,
  value: string,
  eventName: "input" | "change",
) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event(eventName, { bubbles: true }));
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const navigated: string[] = [];

async function renderSchedule() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(OttoSchedule, {
        stuffItems: STUFF_ITEMS,
        onNavigate: (v: string) => { navigated.push(v); },
      }),
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  navigated.length = 0;
  mocks.listScheduledPosts.mockResolvedValue([]);
  mocks.listOwnerTargets.mockResolvedValue([]);
  mocks.createScheduledPost.mockResolvedValue({ ok: true, id: "post-new" });
  mocks.updateScheduledPost.mockResolvedValue({ ok: true });
  mocks.approveScheduledPost.mockResolvedValue({ ok: true });
  mocks.cancelScheduledPost.mockResolvedValue({ ok: true });
  mocks.getMetaConnection.mockResolvedValue({ connected: false, canPublish: false, needsReconnect: false });
  mocks.getOwnerSettings.mockResolvedValue({ autoPublish: false, timezone: "Asia/Kuala_Lumpur" });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

// ── #694 走不通的渠道不该出现在任何入口 ──────────────────────────────────────────

describe("#694 全新商家的 composer 只给真能连上的渠道", () => {
  it("零连接时不再回退成「全部渠道」—— X 连不上,就不出现在可选项里", async () => {
    await renderSchedule();
    await click(buttonByText("New post"));

    const labels = composerChannelLabels();
    // 这一行就是病灶:旧代码 connectedChannels.length ? … : CHANNEL_META.map(…)。
    expect(labels).not.toContain("X");
    expect(labels).toEqual(["Instagram", "Facebook"]);
  });

  it("零连接时那颗 Connect 按钮通向真走得通的连接动作", async () => {
    await renderSchedule();
    await click(buttonByText("New post"));

    const account = field("Account");
    expect(account.textContent).toContain("Connect an account first");
    await click(buttonByText("Connect", account));
    // 送到 Connections —— 那里 Instagram / Facebook 各有一颗真的 Connect 按钮
    // (otto-connections-page.test.ts 已逐条钉过),不再是没有控件的死路。
    expect(navigated).toEqual(["connections"]);
  });

  it("连不上的渠道也不出现在 Plan/Queue 的筛选器里(附带口径 1)", async () => {
    await renderSchedule();

    expect(channelFilterLabels()).toEqual(["All", "Instagram", "Facebook"]);
  });

  it("连上 IG 之后,可选渠道只剩真有投放目标的那一个", async () => {
    mocks.listOwnerTargets.mockResolvedValue([IG_TARGET]);
    mocks.getMetaConnection.mockResolvedValue({ connected: true, canPublish: false, needsReconnect: false });
    await renderSchedule();
    await click(buttonByText("New post"));

    expect(composerChannelLabels()).toEqual(["Instagram"]);
  });
});

describe("#694 账户页的连接进度不把连不上的渠道算进分母(附带口径 2)", () => {
  const account: AccountInfo = {
    email: "w2b@example.test",
    organizationName: "Kopi Kita",
    isFounder: false,
    balance: 100,
    reserved: 0,
    balanceUsd: 10,
    recent: [],
  };

  function connectionsHint(channels: { id: string; label: string; status: "connected" | "not_connected"; targets: string[]; connectUrl: string }[]) {
    const sections = buildSettingsSections({
      account,
      settings: DEFAULT_SETTINGS,
      channels,
      packs: [],
      adsAutonomy: "ASK",
      canPublish: false,
      onDeleteAccountRequest: vi.fn(),
    });
    const field = sections
      .find((s) => s.id === "connections")!
      .fields.find((f) => f.id === "manage")!;
    if (field.kind !== "custom") throw new Error("connections/manage should be a custom field");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = createRoot(host);
    act(() => { r.render(field.render()); });
    const text = host.textContent ?? "";
    act(() => r.unmount());
    host.remove();
    return text;
  }

  const REGISTRY_CHANNELS = [
    { id: "instagram", label: "Instagram", status: "connected" as const, targets: ["Kopi Kita"], connectUrl: "/api/meta/authorize" },
    { id: "facebook", label: "Facebook", status: "connected" as const, targets: ["Kopi Kita"], connectUrl: "/api/meta/authorize" },
    { id: "x", label: "X", status: "not_connected" as const, targets: [], connectUrl: "/api/x/authorize" },
  ];

  it("两个能连的都连上了就是「2 of 2」,不是让人以为还差一个的「2 of 3」", () => {
    // 票面原文:「2 of 3 connected」—— 分母把一个根本连不上的渠道算了进去。
    expect(connectionsHint(REGISTRY_CHANNELS)).toContain("2 of 2 connected");
    expect(connectionsHint(REGISTRY_CHANNELS)).not.toContain("of 3");
  });

  it("一个都没连时是「0 of 2」", () => {
    const none = REGISTRY_CHANNELS.map((c) => ({ ...c, status: "not_connected" as const, targets: [] }));
    expect(connectionsHint(none)).toContain("0 of 2 connected");
  });
});

// ── #695 按钮灰着的理由必须说得出口,而且一直看得见 ─────────────────────────────

describe("#695 Approve & schedule 灰着时,商家看得见到底缺什么", () => {
  beforeEach(() => {
    mocks.listOwnerTargets.mockResolvedValue([IG_TARGET]);
    mocks.getMetaConnection.mockResolvedValue({ connected: true, canPublish: false, needsReconnect: false });
  });

  function approveButton(): HTMLButtonElement {
    return buttonByText("Approve & schedule", scope());
  }

  async function pickAccount() {
    const select = Array.from(scope().querySelectorAll<HTMLSelectElement>("select")).find((s) =>
      Array.from(s.options).some((o) => o.value === IG_TARGET.id),
    );
    if (!select) throw new Error("no account picker in the composer");
    await setNativeValue(select, IG_TARGET.id, "change");
  }

  async function pickImage() {
    const img = Array.from(scope().querySelectorAll<HTMLImageElement>("button img")).find(
      (i) => i.getAttribute("src") === IMG_SRC,
    );
    const tile = img?.closest("button");
    if (!tile) throw new Error("no media tile to pick");
    await click(tile);
  }

  it("刚打开:两样都缺,两句都摆在屏幕上", async () => {
    await renderSchedule();
    await click(buttonByText("New post"));

    expect(approveButton().disabled).toBe(true);
    const text = scope().textContent ?? "";
    expect(text).toContain("Pick which account to post to before approving.");
    expect(text).toContain("Add at least one image before approving.");
  });

  it("选完账号:按钮还灰着,理由不许跟着消失 —— 票面的核心症状", async () => {
    await renderSchedule();
    await click(buttonByText("New post"));
    await pickAccount();

    expect(approveButton().disabled).toBe(true);
    const text = scope().textContent ?? "";
    // 旧代码此时 title 变成 undefined,屏幕上一句解释都没有。
    expect(text).toContain("Add at least one image before approving.");
    // 已经满足的那一条不再念叨。
    expect(text).not.toContain("Pick which account to post to before approving.");
  });

  it("又写了文案仍然不够,提示照旧在那儿", async () => {
    await renderSchedule();
    await click(buttonByText("New post"));
    await pickAccount();
    const caption = scope().querySelector<HTMLTextAreaElement>("textarea")!;
    await setNativeValue(caption, "Morning brew", "input");

    expect(approveButton().disabled).toBe(true);
    expect(scope().textContent).toContain("Add at least one image before approving.");
  });

  it("挑了图:按钮可用,提示全部退场", async () => {
    await renderSchedule();
    await click(buttonByText("New post"));
    await pickAccount();
    await pickImage();

    expect(approveButton().disabled).toBe(false);
    const text = scope().textContent ?? "";
    expect(text).not.toContain("before approving.");
  });

  it("缺项提示是读给人听的,不是只有鼠标停上去才有的 title", async () => {
    await renderSchedule();
    await click(buttonByText("New post"));
    await pickAccount();

    const live = Array.from(scope().querySelectorAll('[role="status"]')).find((el) =>
      (el.textContent ?? "").includes("Add at least one image before approving."),
    );
    expect(live, "缺项提示必须是页面上可见、可被读屏软件读到的一段文字").toBeTruthy();
  });
});

// ── 单点权威的词法围栏 ────────────────────────────────────────────────────────

describe("#694 #695 单点权威,不许再各说各话", () => {
  const src = (rel: string) => readFileSync(path.resolve(__dirname, "../../components/otto", rel), "utf8");
  const schedule = src("OttoSchedule.tsx");
  const connections = src("OttoConnections.tsx");
  const sections = src("settings/sections.tsx");

  it("approve 的前置条件与话术只有一份:界面读共享校验函数,不自己写句子", () => {
    expect(schedule).toContain("scheduleApproveBlockers");
    // 缺项句子只能来自共享规则,界面里不许再有第二份原文。
    expect(schedule).not.toContain("Add at least one image");
    expect(schedule).not.toContain("Pick which account to post to");
    expect(schedule).not.toContain("Pick an account to approve");
    // 规则本身也不许再被手写第二遍(「有账号 + 有媒体」曾经在界面里被复制了三份)。
    expect(schedule).not.toMatch(/metaTargetId\s*&&\s*p?\.?media\.length/);
  });

  it("「哪些渠道现在真能连」只有一份:三处入口都过同一道滤", () => {
    // Connections 页原本自带这张名单;它现在住在客户端渠道镜像里,composer、
    // 筛选器、账户卡片一起读 —— X OAuth 落地时一处放开,四处同时点亮。
    expect(connections).not.toMatch(/const\s+UNAVAILABLE_PUBLISHING_CHANNEL_IDS\s*=/);
    expect(connections).toContain("UNAVAILABLE_PUBLISHING_CHANNEL_IDS");
    expect(schedule).toContain("CONNECTABLE_CHANNEL_META");
    expect(sections).toMatch(/isConnectableChannel|CONNECTABLE_CHANNEL/);
  });
});
