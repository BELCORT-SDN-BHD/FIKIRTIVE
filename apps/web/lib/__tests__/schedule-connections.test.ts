/**
 * #741 判官 r2 —— 「已连接账号」收敛为单一状态源。
 *
 * 同族病第三轮的病根不是某一处判断写错,而是「已连接账号」在界面里有好几个**生命周期不同**
 * 的来源:Plan 拿到的是 null,Composer 拿到的是初始 [],而且都只是挂载时的一次性快照。
 * 于是同一块屏幕上,Approve all 把一条陈旧草稿算作 ready,composer 却指着同一条草稿说
 * 「你没连账号」—— 一个放行、一个冤枉,同时发生。每多一个消费点就多一种分叉。
 *
 * 这里钉的是收敛后的形状本身:显式两态(还没读到 / 读到了,含空列表)+ 一个派生判定函数。
 * 三条规矩按优先级排:
 *   ① 渠道根本连不上 → 只给「换渠道」,永远不给连接 CTA;
 *   ② 还没读到 = 不确定 → 不放行,也不冤枉(不许说「去连账号」);
 *   ③ 读到了 → 交给服务端同一条规则,商家提前听到的就是服务端会拒绝的那句。
 */
import { describe, expect, it } from "vitest";
import {
  ACCOUNTS_LOADING,
  CHECKING_ACCOUNTS_BLOCKER,
  accountPicker,
  approvalFor,
  channelUnavailableBlocker,
  isCheckingAccounts,
  isConnectedTarget,
  loadedAccounts,
  postableChannelIds,
} from "../schedule-connections";

const IG = { id: "ig-1", name: "Kopi Kita", channel: "instagram" };
const IG_OTHER = { id: "ig-2", name: "Kopi Kita Two", channel: "instagram" };
const FB = { id: "fb-1", name: "Kopi Kita Page", channel: "facebook" };

const READY_POST = { channel: "instagram", targetId: IG.id, mediaCount: 1 };

/** 一句「连接动作」的自然形状 —— 「Connect your…」「Connect an…」「Reconnect…」。
 *  注意不能拿 /connect/i 一刀切:「Checking your connected accounts…」里的 connected 是
 *  在描述状态,不是在叫人去做一件事。 */
const CONNECT_CTA = /\b(re)?connect (your|an|a|the)\b/i;

describe("单一状态源:还没读到 ≠ 没有连接", () => {
  it("两态互斥且可分辨", () => {
    expect(isCheckingAccounts(ACCOUNTS_LOADING)).toBe(true);
    expect(isCheckingAccounts(loadedAccounts([]))).toBe(false);
    expect(isCheckingAccounts(loadedAccounts([IG]))).toBe(false);
  });

  it("还没读到时不放行,也不断言「去连账号」", () => {
    const view = approvalFor(ACCOUNTS_LOADING, READY_POST);
    expect(view.canApprove).toBe(false);
    expect(view.blockers).toEqual([CHECKING_ACCOUNTS_BLOCKER]);
    // 这一句是本轮的核心:不确定的时候不许说出任何断言式的假话。
    expect(view.blockers.join(" ")).not.toMatch(CONNECT_CTA);
    expect(view.blockers.join(" ")).not.toMatch(/isn't one of your connected/i);
  });

  it("读到空列表是一个真答案:此时才说「去连账号」", () => {
    const view = approvalFor(loadedAccounts([]), READY_POST);
    expect(view.canApprove).toBe(false);
    expect(view.blockers).toEqual(["Connect your account before approving."]);
  });

  it("读到列表且账号还在:放行", () => {
    expect(approvalFor(loadedAccounts([IG]), READY_POST)).toEqual({ blockers: [], canApprove: true });
  });

  it("读到列表但账号已不在(他处断连):如实翻成 blocker", () => {
    const view = approvalFor(loadedAccounts([IG_OTHER]), READY_POST);
    expect(view.canApprove).toBe(false);
    expect(view.blockers).toEqual(["That account isn't one of your connected channels."]);
  });

  it("账号按渠道分,别的渠道连着不算数", () => {
    const view = approvalFor(loadedAccounts([FB]), READY_POST);
    expect(view.canApprove).toBe(false);
    expect(view.blockers).toEqual(["Connect your account before approving."]);
  });

  it("缺媒体那条规则原样来自共享规则,没有在这里被重写", () => {
    const view = approvalFor(loadedAccounts([IG]), { ...READY_POST, mediaCount: 0 });
    expect(view.blockers).toEqual(["Add at least one image before approving."]);
  });
});

describe("连不上的渠道永远不给连接 CTA", () => {
  const X_POST = { channel: "x", targetId: null, mediaCount: 0 };

  it("只给换渠道指引,不含任何连接动作", () => {
    for (const accounts of [ACCOUNTS_LOADING, loadedAccounts([]), loadedAccounts([IG])]) {
      const view = approvalFor(accounts, X_POST);
      expect(view.canApprove).toBe(false);
      expect(view.blockers).toEqual([channelUnavailableBlocker("x")]);
      expect(view.blockers.join(" ")).not.toMatch(CONNECT_CTA);
      expect(view.blockers.join(" ")).not.toMatch(/connect/i);
      expect(view.blockers.join(" ")).toMatch(/another channel/i);
    }
  });

  it("说的是商家看得懂的渠道名,不是内部 id", () => {
    expect(channelUnavailableBlocker("x")).toContain("X is not available yet");
    expect(channelUnavailableBlocker("x")).toMatch(/^[A-Z].*\.$/);
  });

  it("账号选择器给的是「无此选项」,不是「去连一个」", () => {
    expect(accountPicker(ACCOUNTS_LOADING, "x")).toEqual({ phase: "unavailable" });
    expect(accountPicker(loadedAccounts([]), "x")).toEqual({ phase: "unavailable" });
  });
});

describe("派生视图与状态同源", () => {
  it("账号选择器四态分明 —— 「还没读到」与「没有」不会被折叠成同一个", () => {
    expect(accountPicker(ACCOUNTS_LOADING, "instagram")).toEqual({ phase: "checking" });
    expect(accountPicker(loadedAccounts([]), "instagram")).toEqual({ phase: "none" });
    expect(accountPicker(loadedAccounts([FB]), "instagram")).toEqual({ phase: "none" });
    expect(accountPicker(loadedAccounts([IG, FB]), "instagram")).toEqual({ phase: "ready", options: [IG] });
  });

  it("可发布渠道在还没读到时是空的,不假装谁连着", () => {
    expect([...postableChannelIds(ACCOUNTS_LOADING)]).toEqual([]);
    expect([...postableChannelIds(loadedAccounts([IG, FB]))].sort()).toEqual(["facebook", "instagram"]);
  });

  it("「这个 id 还算数吗」也走同一份状态,不确定时一律为否", () => {
    expect(isConnectedTarget(ACCOUNTS_LOADING, "instagram", IG.id)).toBe(false);
    expect(isConnectedTarget(loadedAccounts([IG]), "instagram", IG.id)).toBe(true);
    expect(isConnectedTarget(loadedAccounts([IG]), "instagram", "ig-gone")).toBe(false);
    expect(isConnectedTarget(loadedAccounts([IG]), "facebook", IG.id)).toBe(false);
    expect(isConnectedTarget(loadedAccounts([IG]), "instagram", null)).toBe(false);
  });
});
