// @vitest-environment jsdom
/**
 * #691 —— 排程的「媒体钥匙」只能有一把:generationId。
 *
 * 病灶:Schedule 的挑选组件把 `StuffItem.label`(= 提示词文本)当媒体标识,而传输载荷、
 * 服务端校验(按 `Generation.id` owner-scoped 查)、队列缩略图、编辑回显用的全是
 * `Generation.id`。真实 Otto 生成必带提示词 → label ≠ id → 服务端一查即空 →
 * "Some selected media isn't yours."(拒绝过头,fail closed,不是越权洞),带图的
 * Meta 排期帖一张也排不上。
 *
 * 所以这里全程驱动**真** OttoSchedule + 真 buildStuffItems,只把服务端动作换成假件。
 * 断言钉的是三头:①发出去的载荷是什么 ②队列缩略图取到了没 ③编辑时已挂的图勾中没。
 * 中间任何一段还拿 label 当钥匙都会红。
 *
 * A/B 对照写死在夹具里:同一批 stuffItems 同时含带提示词(gen-prompted,真实情况)与
 * 空提示词(gen-blank,现实中不存在——label 退化成 id 才碰巧能用)两条,断言两者行为
 * 一致 —— 「碰巧能用」不再是通过的理由。
 *
 * 一个积分都花不出去:排程从不生成媒体,且所有 server action 都是 vi.fn()。
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStuffItems } from "../stuff-items";
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { OttoSchedule } = await import("@/components/otto/OttoSchedule");

// ── 夹具 ──────────────────────────────────────────────────────────────────────
// 走查 agent 的 A/B:同一张图,只差提示词。两条都过 buildStuffItems(真实生产者),
// 所以 label/generationId 的关系不是这里手捏的,是产品代码自己定的。
const PROMPTED_SRC = "https://cdn.test/prompted.png";
const BLANK_SRC = "https://cdn.test/blank.png";

const STUFF_ITEMS = buildStuffItems({
  entities: [],
  history: [
    // 真实情况:Otto 生成必带提示词 → label 是提示词,不是 id。
    { id: "gen-prompted", projectId: "proj-1", assetId: "asset-1", src: PROMPTED_SRC, kind: "image", prompt: "QA seeded image" },
    // 现实中不存在的一档:提示词为空,label 退化成 id —— 旧代码唯一碰巧能用的情况。
    { id: "gen-blank", projectId: "proj-1", assetId: "asset-2", src: BLANK_SRC, kind: "image", prompt: "" },
  ],
  ads: [],
  records: [],
});

const IG_TARGET = { id: "ig-1", name: "Kopi Kita", channel: "instagram" as const };

function scheduledRow(over: Partial<ScheduledPostRow> = {}): ScheduledPostRow {
  return {
    id: "post-1",
    channel: "instagram",
    caption: "Morning brew",
    firstComment: null,
    scheduledAt: new Date("2026-07-10T01:00:00Z"),
    scheduledTz: "Asia/Kuala_Lumpur",
    status: "SCHEDULED",
    publishMode: "AUTO",
    source: "owner",
    metaTargetId: IG_TARGET.id,
    approvedAt: new Date("2026-07-09T00:00:00Z"),
    lastError: null,
    media: [{ generationId: "gen-prompted", position: 0 }],
    updatedAt: new Date("2026-07-09T00:00:00Z"),
    ...over,
  };
}

// ── DOM 小工具 ────────────────────────────────────────────────────────────────
// composer 走 Radix Portal,内容落在 document.body 而不是挂载容器里,所以一律从 body 查。
function all<T extends Element>(sel: string): T[] {
  return Array.from(document.body.querySelectorAll<T>(sel));
}

/** composer 打开时,一律只在对话框里找 —— 队列行自己也带同一张图的缩略图,不隔开会认错人。 */
function scope(): ParentNode {
  return document.body.querySelector('[data-slot="dialog-content"]') ?? document.body;
}

function buttonByText(text: string): HTMLButtonElement {
  const found = Array.from(scope().querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    (b.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`no button containing "${text}"`);
  return found;
}

/** 媒体格子 = composer 里内含该 url 缩略图的那颗按钮。按显示的图找,不按任何 id 找 —— 商家看到的就是图。 */
function mediaTileFor(src: string): HTMLButtonElement {
  const img = Array.from(scope().querySelectorAll<HTMLImageElement>("button img")).find(
    (i) => i.getAttribute("src") === src,
  );
  const tile = img?.closest("button");
  if (!tile) throw new Error(`no media tile showing ${src}`);
  return tile as HTMLButtonElement;
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function setNativeValue(el: HTMLTextAreaElement | HTMLSelectElement, value: string, eventName: "input" | "change") {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event(eventName, { bubbles: true }));
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderSchedule() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(OttoSchedule, { stuffItems: STUFF_ITEMS, onNavigate: () => {} }));
  });
  // 冲掉 mount 时那几发并行的 server-action promise。
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mocks.listScheduledPosts.mockResolvedValue([]);
  mocks.listOwnerTargets.mockResolvedValue({ targets: [IG_TARGET] });
  mocks.createScheduledPost.mockResolvedValue({ ok: true, id: "post-new" });
  mocks.updateScheduledPost.mockResolvedValue({ ok: true });
  mocks.approveScheduledPost.mockResolvedValue({ ok: true });
  mocks.cancelScheduledPost.mockResolvedValue({ ok: true });
  mocks.getMetaConnection.mockResolvedValue({ connected: true, canPublish: false, needsReconnect: false });
  mocks.getOwnerSettings.mockResolvedValue({ autoPublish: false, timezone: "Asia/Kuala_Lumpur" });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

/** 队列行本身就是「打开编辑」的按钮。 */
async function openEditFor(caption: string) {
  const queueRow = all<HTMLButtonElement>("button").find((b) => (b.textContent ?? "").includes(caption));
  if (!queueRow) throw new Error(`no queue row for "${caption}"`);
  await click(queueRow);
}

/** 开 New post → 选账号 → 写文案 → 点某张图 → 点 Approve & schedule。 */
async function composeAndApprove(src: string) {
  await click(buttonByText("New post"));
  const account = Array.from(scope().querySelectorAll<HTMLSelectElement>("select")).find((s) =>
    Array.from(s.options).some((o) => o.value === IG_TARGET.id),
  );
  if (!account) throw new Error("no account picker in the composer");
  await setNativeValue(account, IG_TARGET.id, "change");
  const caption = scope().querySelector<HTMLTextAreaElement>("textarea");
  if (!caption) throw new Error("no caption field in the composer");
  await setNativeValue(caption, "Morning brew", "input");
  await click(mediaTileFor(src));
  await click(buttonByText("Approve & schedule"));
}

// ── 1. 挑选 → 传输:发出去的必须是 generationId ────────────────────────────────

describe("#691 挑一张自己的图去排程", () => {
  it("带提示词的生成:发给服务端的 media 是 generationId,不是提示词文本", async () => {
    await renderSchedule();
    await composeAndApprove(PROMPTED_SRC);

    expect(mocks.createScheduledPost).toHaveBeenCalledTimes(1);
    const payload = mocks.createScheduledPost.mock.calls[0]![0] as { media: string[] };
    // 这一行就是病灶:旧代码送的是 ["QA seeded image"]。
    expect(payload.media).toEqual(["gen-prompted"]);
    // 排程随后真的走到了 approve —— 服务端 owner-scoped 查得到,不再被判「不是你的」。
    expect(mocks.approveScheduledPost).toHaveBeenCalledWith("post-new");
  });

  it("空提示词的生成走同一把钥匙 —— 「碰巧能用」不再是通过的理由", async () => {
    await renderSchedule();
    await composeAndApprove(BLANK_SRC);

    const payload = mocks.createScheduledPost.mock.calls[0]![0] as { media: string[] };
    expect(payload.media).toEqual(["gen-blank"]);
  });

  it("提示词文本一个字都不会出现在 media 载荷里(label 只作展示文案)", async () => {
    await renderSchedule();
    await composeAndApprove(PROMPTED_SRC);

    const payload = mocks.createScheduledPost.mock.calls[0]![0] as { media: string[] };
    expect(payload.media).not.toContain("QA seeded image");
  });

  it("服务端仍是 fail-closed 的权威:它判「不是你的」时,界面照实报错且不往下 approve", async () => {
    // 跨租户/已删除的 generationId 由服务端 owner-scoped 查拒绝(schedule-actions.test.ts
    // 已逐条覆盖 create/update/approve 三条路)。这里钉的是客户端侧:错误照实呈报,
    // 且绝不越过它去 approve —— 修钥匙不能顺手把这道闸修松。
    mocks.createScheduledPost.mockResolvedValue({ error: "Some selected media isn't yours." });
    await renderSchedule();
    await composeAndApprove(PROMPTED_SRC);

    expect(mocks.approveScheduledPost).not.toHaveBeenCalled();
    const alert = document.body.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Some selected media isn't yours.");
  });
});

// ── 2. 队列缩略图:按 generationId 取得到图 ───────────────────────────────────

describe("#691 队列里的帖子缩略图", () => {
  it("带提示词媒体的帖子出图,不是灰占位块", async () => {
    mocks.listScheduledPosts.mockResolvedValue([scheduledRow()]);
    await renderSchedule();

    const queueImg = all<HTMLImageElement>("img").find((i) => i.getAttribute("src") === PROMPTED_SRC);
    expect(queueImg).toBeTruthy();
  });

  it("空提示词媒体的帖子同样出图(两档行为一致)", async () => {
    mocks.listScheduledPosts.mockResolvedValue([
      scheduledRow({ media: [{ generationId: "gen-blank", position: 0 }] }),
    ]);
    await renderSchedule();

    const queueImg = all<HTMLImageElement>("img").find((i) => i.getAttribute("src") === BLANK_SRC);
    expect(queueImg).toBeTruthy();
  });
});

// ── 3. 编辑回显:已挂的图必须显示为已选 ───────────────────────────────────────

describe("#691 编辑已有帖子", () => {
  it("已挂的带提示词媒体在挑选器里显示为已选(有序号角标)", async () => {
    mocks.listScheduledPosts.mockResolvedValue([scheduledRow()]);
    await renderSchedule();

    await openEditFor("Morning brew");

    const tile = mediaTileFor(PROMPTED_SRC);
    // 序号角标 = 这张图被选中,且排在第 1 位。旧代码里 media.indexOf(label) 永远 -1,
    // 商家会以为图掉了。
    expect(tile.textContent).toContain("1");
    expect(tile.className).toContain("border-brand");
  });

  it("回显后原样保存,media 不变形(不会把提示词混进去)", async () => {
    mocks.listScheduledPosts.mockResolvedValue([scheduledRow({ status: "DRAFT" })]);
    await renderSchedule();

    await openEditFor("Morning brew");
    await click(buttonByText("Save draft"));

    expect(mocks.updateScheduledPost).toHaveBeenCalledTimes(1);
    const [, patch] = mocks.updateScheduledPost.mock.calls[0]! as [string, { media: string[] }];
    expect(patch.media).toEqual(["gen-prompted"]);
  });

  it("再点一次已挂的图 = 取消挑选,而不是把提示词又追加进 media", async () => {
    // 票面第 3 个症状的真实伤害:格子看着「没选」,商家自然会再点一次 —— 旧代码
    // media.indexOf(label) 是 -1,于是 toggleMedia(label) 往 media 里**追加**了一条提示词,
    // 保存时服务端再拿它当 Generation.id 去查,又是一次假报错。
    mocks.listScheduledPosts.mockResolvedValue([scheduledRow({ status: "DRAFT" })]);
    await renderSchedule();

    await openEditFor("Morning brew");
    await click(mediaTileFor(PROMPTED_SRC));
    await click(buttonByText("Save draft"));

    const [, patch] = mocks.updateScheduledPost.mock.calls[0]! as [string, { media: string[] }];
    expect(patch.media).toEqual([]);
  });
});
