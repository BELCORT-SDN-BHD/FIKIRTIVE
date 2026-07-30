/**
 * balance-refresh — 余额刷新信号的行为守卫(#550 ①)。
 *
 * 复现背景:#513 A 组把余额收进唯一的全局导航后,那里的余额只在 mount 时取一次;
 * 而已经铺满整棵 Otto/canvas 树的 onBalanceRefresh 结算事件更新的是 OttoApp 自己的
 * state —— 那个 state 现在没人渲染。信号断了,商家整场看着旧余额(S2/S6:滞后 DB 84s+,
 * 直到整页重载)。这个模块把「钱动了」的事件从任意扣费点送到任意余额显示点,
 * 不新增轮询(#544 已批评现存的 4s thread-activity 轮询)。
 */
import { describe, expect, it, vi } from "vitest";
import { notifyBalanceRefresh, subscribeBalanceRefresh } from "../balance-refresh";

describe("balance refresh signal", () => {
  it("delivers a spend event to every live subscriber", () => {
    const nav = vi.fn();
    const other = vi.fn();
    const unsubscribeNav = subscribeBalanceRefresh(nav);
    const unsubscribeOther = subscribeBalanceRefresh(other);

    try {
      notifyBalanceRefresh();
      expect(nav).toHaveBeenCalledTimes(1);
      expect(other).toHaveBeenCalledTimes(1);

      notifyBalanceRefresh();
      expect(nav).toHaveBeenCalledTimes(2);
      expect(other).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribeNav();
      unsubscribeOther();
    }
  });

  it("stops delivering once a subscriber unsubscribes (unmounted nav must not refetch)", () => {
    const nav = vi.fn();
    const unsubscribe = subscribeBalanceRefresh(nav);
    unsubscribe();

    notifyBalanceRefresh();
    expect(nav).not.toHaveBeenCalled();
  });

  it("is a no-op when nothing is listening (a spend never throws at the till)", () => {
    expect(() => notifyBalanceRefresh()).not.toThrow();
  });

  it("keeps delivering when one subscriber throws", () => {
    const broken = vi.fn(() => {
      throw new Error("boom");
    });
    const nav = vi.fn();
    const unsubscribeBroken = subscribeBalanceRefresh(broken);
    const unsubscribeNav = subscribeBalanceRefresh(nav);

    try {
      expect(() => notifyBalanceRefresh()).not.toThrow();
      expect(nav).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribeBroken();
      unsubscribeNav();
    }
  });

  it("does not deliver the in-flight event to a subscriber that arrives during it", () => {
    const late = vi.fn();
    let unsubscribeLate = () => {};
    const early = vi.fn(() => {
      unsubscribeLate = subscribeBalanceRefresh(late);
    });
    const unsubscribeEarly = subscribeBalanceRefresh(early);

    try {
      notifyBalanceRefresh();
      expect(early).toHaveBeenCalledTimes(1);
      expect(late).not.toHaveBeenCalled();

      notifyBalanceRefresh();
      expect(late).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribeEarly();
      unsubscribeLate();
    }
  });
});
