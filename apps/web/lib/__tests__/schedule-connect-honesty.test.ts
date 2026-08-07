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
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStuffItems } from "../stuff-items";
import { DEFAULT_SETTINGS } from "../owner-settings";
import type { AccountInfo } from "../account-actions";
import type { ScheduledPostRow } from "../schedule-actions";

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

function postRow(over: Partial<ScheduledPostRow> = {}): ScheduledPostRow {
  return {
    id: "post-1",
    channel: "instagram",
    caption: "Morning brew",
    firstComment: null,
    scheduledAt: new Date("2026-08-20T01:00:00Z"),
    scheduledTz: "Asia/Kuala_Lumpur",
    status: "DRAFT",
    publishMode: "AUTO",
    source: "owner",
    metaTargetId: IG_TARGET.id,
    approvedAt: null,
    lastError: null,
    media: [{ generationId: "gen-1", position: 0 }],
    updatedAt: new Date("2026-08-19T00:00:00Z"),
    ...over,
  };
}

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

// ── #741 判官 r1 [P1] 账户有效性:界面不能只认草稿里存过的旧 id ──────────────────

describe("#741 r1 断开连接后,界面不再假装账号还在", () => {
  const STALE = "ig-gone"; // 草稿里存着的旧 id —— 商家断开连接后它还躺在那儿
  const OTHER_TARGET = { id: "ig-2", name: "Kopi Kita Two", channel: "instagram" as const };

  beforeEach(() => {
    mocks.getMetaConnection.mockResolvedValue({ connected: true, canPublish: false, needsReconnect: false });
  });

  async function openDraft(caption: string) {
    const row = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      (b.textContent ?? "").includes(caption),
    );
    if (!row) throw new Error(`no queue row for "${caption}"`);
    await click(row);
  }

  it("旧 id 已不在连接列表里:批准禁用,并如实说这不是你连着的账号", async () => {
    mocks.listOwnerTargets.mockResolvedValue([OTHER_TARGET]);
    mocks.listScheduledPosts.mockResolvedValue([postRow({ metaTargetId: STALE })]);
    await renderSchedule();
    await openDraft("Morning brew");

    const approve = buttonByText("Approve & schedule", scope());
    // 病灶:旧代码只看 !!metaTargetId,按钮是亮的,服务端 approve 时必拒。
    expect(approve.disabled).toBe(true);
    expect(scope().textContent).toContain("That account isn't one of your connected channels.");
  });

  it("一个账号都没连:指路去连接,不是叫人挑一个不存在的账号", async () => {
    mocks.listOwnerTargets.mockResolvedValue([]);
    mocks.listScheduledPosts.mockResolvedValue([postRow({ metaTargetId: STALE })]);
    await renderSchedule();
    await openDraft("Morning brew");

    expect(buttonByText("Approve & schedule", scope()).disabled).toBe(true);
    expect(scope().textContent).toContain("Connect your account before approving.");
  });

  it("账号仍然连着:批准照常可用,不误伤", async () => {
    mocks.listOwnerTargets.mockResolvedValue([IG_TARGET]);
    mocks.listScheduledPosts.mockResolvedValue([postRow({ metaTargetId: IG_TARGET.id })]);
    await renderSchedule();
    await openDraft("Morning brew");

    expect(buttonByText("Approve & schedule", scope()).disabled).toBe(false);
    expect(scope().textContent).not.toContain("before approving.");
  });

  it("Approve all 不把陈旧账号的帖子计为 ready", async () => {
    mocks.listOwnerTargets.mockResolvedValue([OTHER_TARGET]);
    mocks.listScheduledPosts.mockResolvedValue([
      postRow({ id: "p-stale", source: "otto", status: "DRAFT", caption: "Otto draft", metaTargetId: STALE }),
    ]);
    await renderSchedule();

    // 旧代码:1 of 1 ready、按钮可按 —— 按下去服务端逐条拒。
    const approveAll = buttonByText("Approve all", document.body);
    expect(approveAll.textContent).toContain("Approve all 0");
    expect(approveAll.disabled).toBe(true);
    expect(document.body.textContent).toContain("That account isn't one of your connected channels.");
  });
});

// ── #741 判官 r1 [P2] 历史 X 草稿要如实呈现 ────────────────────────────────────

describe("#741 r1 打开一条历史 X 草稿", () => {
  beforeEach(() => {
    mocks.listOwnerTargets.mockResolvedValue([IG_TARGET]);
    mocks.getMetaConnection.mockResolvedValue({ connected: true, canPublish: false, needsReconnect: false });
    mocks.listScheduledPosts.mockResolvedValue([
      postRow({ id: "p-x", channel: "x", caption: "Legacy X draft", metaTargetId: null, media: [] }),
    ]);
  });

  async function openXDraft() {
    const row = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      (b.textContent ?? "").includes("Legacy X draft"),
    );
    if (!row) throw new Error("no queue row for the legacy X draft");
    await click(row);
  }

  it("渠道区如实显示这条帖子在 X 上,而不是一个选中都没有", async () => {
    await renderSchedule();
    await openXDraft();

    const buttons = Array.from(field("Channel").querySelectorAll<HTMLButtonElement>("button"));
    const labels = buttons.map((b) => (b.textContent ?? "").trim());
    // 病灶:可连渠道过滤被无条件用在编辑器上,X 整个消失,界面看不出这条草稿属于谁。
    expect(labels).toContain("X");
    const xButton = buttons.find((b) => (b.textContent ?? "").trim() === "X")!;
    // 选中态用的是同一套高亮 class(border-foreground bg-secondary)。
    expect(xButton.className).toContain("border-foreground");
  });

  it("X 仍然不可选:按钮禁用,并说清这条帖子发不出去", async () => {
    await renderSchedule();
    await openXDraft();

    const xButton = Array.from(field("Channel").querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => (b.textContent ?? "").trim() === "X",
    )!;
    expect(xButton.disabled).toBe(true);
    expect(field("Channel").textContent).toMatch(/not available yet/i);
  });

  it("能连的渠道照旧可选 —— 商家可以把这条草稿挪到真发得出去的渠道", async () => {
    await renderSchedule();
    await openXDraft();

    const ig = Array.from(field("Channel").querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => (b.textContent ?? "").trim() === "Instagram",
    )!;
    expect(ig.disabled).toBe(false);
  });

  it("新建草稿的可选渠道不受影响,X 不会因此回到新帖入口", async () => {
    await renderSchedule();
    await click(buttonByText("New post"));

    expect(composerChannelLabels()).toEqual(["Instagram"]);
  });

  it("「连得上但还没连」不等于「连不上」:断开后的 IG 草稿仍可留在 IG,不被说成 not available", async () => {
    // 这一条挡的是本次修法自己可能踩的坑:如果把「不在可选列表里」一律当成「渠道不可用」,
    // 商家断开连接后打开自己的 IG 草稿,会看到「Instagram is not available yet」—— 假话。
    mocks.listOwnerTargets.mockResolvedValue([]);
    mocks.getMetaConnection.mockResolvedValue({ connected: false, canPublish: false, needsReconnect: false });
    mocks.listScheduledPosts.mockResolvedValue([
      postRow({ id: "p-ig", channel: "instagram", caption: "Orphan IG draft", metaTargetId: null }),
    ]);
    await renderSchedule();
    const row = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      (b.textContent ?? "").includes("Orphan IG draft"),
    )!;
    await click(row);

    const ig = Array.from(field("Channel").querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => (b.textContent ?? "").trim() === "Instagram",
    )!;
    expect(ig.className).toContain("border-foreground");
    expect(ig.disabled).toBe(false);
    expect(field("Channel").textContent).not.toMatch(/not available yet/i);
  });
});

// ── #741 判官 r1 [P2] Approve all 的汇总句必须如实 ─────────────────────────────

describe("#741 r1 Approve all 的缺项汇总只报真的缺项", () => {
  beforeEach(() => {
    mocks.listOwnerTargets.mockResolvedValue([IG_TARGET]);
    mocks.getMetaConnection.mockResolvedValue({ connected: true, canPublish: false, needsReconnect: false });
  });

  function planCardText(): string {
    const approveAll = buttonByText("Approve all", document.body);
    return approveAll.closest("div")?.parentElement?.textContent ?? document.body.textContent ?? "";
  }

  it("只缺媒体的批次:汇总句说图,不提根本不缺的渠道/账号", async () => {
    mocks.listScheduledPosts.mockResolvedValue([
      postRow({ id: "p1", source: "otto", status: "DRAFT", caption: "Otto A", media: [] }),
      postRow({ id: "p2", source: "otto", status: "DRAFT", caption: "Otto B" }),
    ]);
    await renderSchedule();

    const text = planCardText();
    expect(text).toContain("1 of 2 ready");
    expect(text).toContain("Add at least one image before approving.");
    // 病灶:旧汇总句写死「add media & a channel」,渠道根本不缺也照说不误。
    expect(text.toLowerCase()).not.toContain("a channel");
  });

  it("只缺账号的批次:汇总句说账号,不提图", async () => {
    mocks.listScheduledPosts.mockResolvedValue([
      postRow({ id: "p1", source: "otto", status: "DRAFT", caption: "Otto A", metaTargetId: null }),
    ]);
    await renderSchedule();

    const text = planCardText();
    expect(text).toContain("Pick which account to post to before approving.");
    expect(text).not.toContain("Add at least one image before approving.");
  });

  it("全部就绪时汇总句退场,回到那句「说声就走」", async () => {
    mocks.listScheduledPosts.mockResolvedValue([
      postRow({ id: "p1", source: "otto", status: "DRAFT", caption: "Otto A" }),
    ]);
    await renderSchedule();

    const text = planCardText();
    expect(text).not.toContain("before approving.");
    expect(text).toContain("Say go once you");
  });
});

// ── #741 判官 r2 —— 单一状态源:同屏不许一边放行一边冤枉 ────────────────────────

describe("#741 r2 连接状态还没读到时,整屏一致地「不确定」", () => {
  beforeEach(() => {
    mocks.getMetaConnection.mockResolvedValue({ connected: true, canPublish: false, needsReconnect: false });
    // 连接读一直悬着 = 「还没读到」。帖子照常渲染,连接状态停在 loading。
    mocks.listOwnerTargets.mockReturnValue(new Promise(() => {}));
    mocks.listScheduledPosts.mockResolvedValue([
      postRow({ id: "p-otto", source: "otto", status: "DRAFT", caption: "Otto draft" }),
    ]);
  });

  it("Plan 一条都不计 ready,Approve all 禁用", async () => {
    await renderSchedule();

    const approveAll = buttonByText("Approve all", document.body);
    // 病灶:Plan 收到 null 时把带旧 targetId 的帖子当作 ready,按钮可按。
    expect(approveAll.textContent).toContain("Approve all 0");
    expect(approveAll.disabled).toBe(true);
  });

  it("Plan 的汇总句说的是「正在查」,不是断言式的「去连账号」", async () => {
    await renderSchedule();

    const text = document.body.textContent ?? "";
    expect(text).toContain("Checking your connected accounts");
    expect(text).not.toContain("Connect your account before approving.");
  });

  it("composer 同屏同一口径:中性句、不冤枉、也不给 Connect CTA", async () => {
    await renderSchedule();
    // Otto 提的草稿住在 Plan 卡片里,打开它的入口是那一行的「Tweak」。
    await click(buttonByText("Tweak", document.body));

    const text = scope().textContent ?? "";
    // 病灶:Composer 收到初始 [] → 误报「没连账号」并禁用,与 Plan 的放行同屏矛盾。
    expect(text).toContain("Checking your connected accounts");
    expect(text).not.toContain("Connect your account before approving.");
    expect(text).not.toContain("Connect an account first");
    expect(buttonByText("Approve & schedule", scope()).disabled).toBe(true);
  });
});

describe("#741 r2 他处断连:下一个刷新周期内草稿自动翻成 blocker", () => {
  beforeEach(() => {
    mocks.getMetaConnection.mockResolvedValue({ connected: true, canPublish: false, needsReconnect: false });
    mocks.listScheduledPosts.mockResolvedValue([
      postRow({ id: "p-otto", source: "otto", status: "DRAFT", caption: "Otto draft", metaTargetId: IG_TARGET.id }),
    ]);
  });

  /** 一次刷新周期 = 商家切回这个标签页(focus)。帖子与连接列表必须走同一趟。 */
  async function refreshCycle() {
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("一个账号都不剩(全部断开):计数下降,理由改口为「去连账号」", async () => {
    mocks.listOwnerTargets.mockResolvedValue([IG_TARGET]);
    await renderSchedule();
    expect(buttonByText("Approve all", document.body).textContent).toContain("Approve all 1");

    // 商家在别处断开了连接;下一趟刷新才知道 —— 而刷新必须把连接一起重读。
    mocks.listOwnerTargets.mockResolvedValue([]);
    await refreshCycle();

    const approveAll = buttonByText("Approve all", document.body);
    expect(approveAll.textContent).toContain("Approve all 0");
    expect(approveAll.disabled).toBe(true);
    expect(document.body.textContent).toContain("Connect your account before approving.");
  });

  it("换成了别的账号:同一草稿翻成「这不是你连着的账号」", async () => {
    mocks.listOwnerTargets.mockResolvedValue([IG_TARGET]);
    await renderSchedule();
    expect(buttonByText("Approve all", document.body).textContent).toContain("Approve all 1");

    mocks.listOwnerTargets.mockResolvedValue([{ id: "ig-2", name: "Another Page", channel: "instagram" as const }]);
    await refreshCycle();

    expect(buttonByText("Approve all", document.body).textContent).toContain("Approve all 0");
    expect(document.body.textContent).toContain("That account isn't one of your connected channels.");
  });

  it("刷新是同一条时间线:帖子与连接列表每趟一起重读", async () => {
    mocks.listOwnerTargets.mockResolvedValue([IG_TARGET]);
    await renderSchedule();
    const postsAfterMount = mocks.listScheduledPosts.mock.calls.length;
    const targetsAfterMount = mocks.listOwnerTargets.mock.calls.length;

    await refreshCycle();

    // 病灶:连接列表只在挂载时读一次,focus/60s 刷新只重读帖子。
    expect(mocks.listScheduledPosts.mock.calls.length).toBe(postsAfterMount + 1);
    expect(mocks.listOwnerTargets.mock.calls.length).toBe(targetsAfterMount + 1);
  });
});

describe("#741 r2 X 草稿:只指路换渠道,不给一个不存在的连接动作", () => {
  beforeEach(() => {
    mocks.listOwnerTargets.mockResolvedValue([IG_TARGET]);
    mocks.getMetaConnection.mockResolvedValue({ connected: true, canPublish: false, needsReconnect: false });
    mocks.listScheduledPosts.mockResolvedValue([
      postRow({ id: "p-x", channel: "x", caption: "Legacy X draft", metaTargetId: null, media: [] }),
    ]);
  });

  async function openXDraft() {
    const row = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      (b.textContent ?? "").includes("Legacy X draft"),
    )!;
    await click(row);
  }

  it("composer 里没有 Connect 按钮,也没有「Connect an account first」那段", async () => {
    await renderSchedule();
    await openXDraft();

    const text = scope().textContent ?? "";
    // 病灶:X 明明没有连接入口,同屏却又让换渠道、又让执行一个不存在的动作。
    expect(text).not.toContain("Connect an account first");
    const connectButtons = Array.from(scope().querySelectorAll("button")).filter(
      (b) => (b.textContent ?? "").trim() === "Connect",
    );
    expect(connectButtons).toEqual([]);
  });

  it("缺项句只含换渠道指引,不含任何连接动作", async () => {
    await renderSchedule();
    await openXDraft();

    const live = Array.from(scope().querySelectorAll('[role="status"]'))
      .map((el) => el.textContent ?? "")
      .join(" ");
    expect(live).toMatch(/move this post to another channel/i);
    expect(live).not.toMatch(/connect/i);
    expect(buttonByText("Approve & schedule", scope()).disabled).toBe(true);
  });
});

// ── 单点权威的词法围栏 ────────────────────────────────────────────────────────
//
// #741 判官 r1 [P2]:上一版围栏只读三个写死的组件、只比对少数精确文本 —— 新组件手写渠道
// 数组不会被扫到,OttoSchedule 里第二份批准话术也照样过关,等于没有围栏。现在改成 glob 扫
// apps/web 的 components / lib / app 三棵树下全部 .ts/.tsx。
//
// **威胁模型边界(如实声明,不虚标能力)**:这是词法检查,不是类型或数据流分析。它能抓到的
// 是「以字面量形式写出来的第二份真相」——这正是本仓两次实际发生过的形状(#694 的 composer
// 回退、#741 的 :705 汇总句)。它抓不到:
//   ① 动态拼出来的渠道名单(`ids.filter(...)`、从服务端字符串拼装);
//   ② 换一种说法的批准缺项话术(例如 "you still need a photo");
//   ③ 把话术搬到 JSON / 数据库 / 翻译文件里再读回来;
//   ④ 注释剥离用的是正则,遇到极端的字符串内容可能少剥或多剥一点。
// 这四类只能靠复审。围栏的价值是挡住「顺手再写一份」的自然写法,不是证明不存在第二份真相。
describe("#694 #695 #741 单点权威:全仓词法围栏", () => {
  const WEB_ROOT = path.resolve(__dirname, "../..");
  // Every place a merchant-facing surface can be written: components, the shared lib, and the
  // route tree. Missing one of these is how the previous fence let a second truth through.
  const SCAN_ROOTS = ["components", "lib", "app"];

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(full);
      return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
    });
  }

  /** 注释里的示例和历史说明不算「第二份真相」,先剥掉再匹配。 */
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
  }

  // 手写的渠道 id 名单:`["instagram","facebook"]`、`new Set(["x","instagram"])` 这类形状。
  const HANDWRITTEN_CHANNEL_LIST =
    /[[(]\s*(["'])(instagram|facebook|x)\1\s*,\s*(["'])(instagram|facebook|x)\3/;
  // 手写的批准缺项话术:「(add|pick|choose|connect|select) … before approving」与
  // 「at least one image/video/photo/media」两种自然形状。
  const HANDWRITTEN_APPROVE_COPY = [
    /(add|pick|choose|connect|select)\b[^.]{0,60}before approving/i,
    /at least one (image|video|photo|media)/i,
  ];

  // 允许清单:这两处回答的是**另一个问题**(「哪些渠道由 Meta 连接支撑」/「哪些渠道属于 Meta
  // 自然发布」),不是「现在能不能连上」。它们与 UNAVAILABLE_PUBLISHING_CHANNEL_IDS 各司其职,
  // 不是同一份真相的副本。新文件写出同样形状会被抓住 —— 这正是围栏要挡的。
  const CHANNEL_LIST_ALLOWLIST = new Set([
    "lib/channels/meta-shared.ts",
    "lib/auto-publish-gate.ts",
  ]);

  const files = SCAN_ROOTS.flatMap((r) => walk(path.join(WEB_ROOT, r))).map((f) => ({
    rel: path.relative(WEB_ROOT, f),
    code: stripComments(readFileSync(f, "utf8")),
  }));

  it("围栏本身认得出它要抓的两种形状(不是一条永远为真的断言)", () => {
    // 承重自检:正则先在样本上证明自己会响,再去扫真实代码。
    expect(HANDWRITTEN_CHANNEL_LIST.test('const ids = ["instagram", "facebook"];')).toBe(true);
    expect(HANDWRITTEN_CHANNEL_LIST.test('new Set(["x", "instagram"])')).toBe(true);
    expect(
      HANDWRITTEN_APPROVE_COPY.some((re) => re.test("add media & a channel to the rest before approving.")),
    ).toBe(true);
    expect(HANDWRITTEN_APPROVE_COPY.some((re) => re.test("Add at least one image before approving."))).toBe(true);
    // 反例:不该误伤别的「before approving」句子。
    expect(
      HANDWRITTEN_APPROVE_COPY.some((re) => re.test("Review your schedule before approving.")),
    ).toBe(false);
    // 扫描面必须真的覆盖到了这些文件(路径写错时不能静默通过)。
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.rel === "components/otto/OttoSchedule.tsx")).toBe(true);
    expect(files.some((f) => f.rel === "components/otto/settings/sections.tsx")).toBe(true);
    expect(files.some((f) => f.rel === "lib/channels/channel-meta.ts")).toBe(true);
  });

  it("apps/web 里没有第二份「哪些渠道能连」的手写名单", () => {
    const offenders = files
      .filter((f) => !CHANNEL_LIST_ALLOWLIST.has(f.rel) && HANDWRITTEN_CHANNEL_LIST.test(f.code))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("apps/web 里没有第二份批准缺项话术 —— 句子只能来自 scheduleApproveBlockers", () => {
    const offenders = files
      .filter((f) => HANDWRITTEN_APPROVE_COPY.some((re) => re.test(f.code)))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  // #741 r2:approve 规则只有两个合法应用点 —— 服务端动作(权威)与客户端的单一状态源
  // (它把 loading / loaded 与渠道可连性叠在规则之上)。任何组件直接调用它,就等于又开了一个
  // 生命周期不同的判定点 —— 正是这三轮同族病的病根。
  const APPROVE_RULE_CALLERS = new Set(["lib/schedule-actions.ts", "lib/schedule-connections.ts"]);

  it("组件不许自己调 approve 规则 —— 判定只能来自单一状态源", () => {
    const offenders = files
      .filter((f) => !APPROVE_RULE_CALLERS.has(f.rel) && f.code.includes("scheduleApproveBlockers"))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
    // 反面:这两处必须真的在用它,不能空手过关。
    for (const rel of APPROVE_RULE_CALLERS) {
      expect(files.find((f) => f.rel === rel)?.code).toContain("scheduleApproveBlockers");
    }
  });

  it("Schedule 屏不许自己拼「账号还算不算数」的判定,只能问单一状态源", () => {
    const schedule = files.find((f) => f.rel === "components/otto/OttoSchedule.tsx")!.code;
    expect(schedule).toContain("approvalFor");
    // 自己 filter 一遍 targets 再拿去比对 —— 就是又生出一个判定点。
    expect(schedule).not.toMatch(/targets\s*\.\s*(filter|some|find)\s*\(/);
    expect(schedule).not.toMatch(/metaTargetId\s*&&\s*p?\.?media\.length/);
    expect(schedule).not.toContain("Pick an account to approve");
  });

  it("消费方读的是共享权威,而不是各自空手过关", () => {
    const byRel = new Map(files.map((f) => [f.rel, f.code]));
    const schedule = byRel.get("components/otto/OttoSchedule.tsx")!;
    const connections = byRel.get("components/otto/OttoConnections.tsx")!;
    const sections = byRel.get("components/otto/settings/sections.tsx")!;
    const actions = byRel.get("lib/schedule-actions.ts")!;

    expect(actions).toContain("scheduleApproveBlockers");

    // 可连渠道名单:Connections 不再自带一份,三处入口读同一处。
    expect(connections).not.toMatch(/const\s+UNAVAILABLE_PUBLISHING_CHANNEL_IDS\s*=/);
    expect(connections).toContain("UNAVAILABLE_PUBLISHING_CHANNEL_IDS");
    expect(schedule).toContain("CONNECTABLE_CHANNEL_META");
    expect(sections).toMatch(/isConnectableChannel|CONNECTABLE_CHANNEL/);
  });
});
