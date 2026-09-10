/**
 * frontend-fse-010-balance-broadcast —— 余额跨标签页同步（frontend-baseline.md §5 :202，
 * FSE-010；Founder 2026-09-10 裁：标签页广播（BroadcastChannel）同步余额，不新增定时器，守 #544）。
 *
 * 走查现象：商家开着两个标签页，在一个里花掉 credits，另一个的侧栏还写着花之前那个数
 * （侧栏 18.4、Billing 正文 14.8、库里 14.8）。病根是 `balance-refresh.ts` 的监听集是**模块态**，
 * 只在本标签页里有意义。
 *
 * 「两个标签页」在这里就是**两份模块实例**（`vi.resetModules()` 之后各自 import 一次）：
 * 它们各有各的监听集，只靠一条假的 `BroadcastChannel` 相通——与浏览器里那两页的关系一模一样。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/** 一条同源频道上的所有实例互相收听；close 之后不再收。就是浏览器那条频道的最小形状。 */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  /** 整轮里一共广播了几次 —— 「收到的那一页不转播」只有数它才证得出来。 */
  static posts = 0;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  private closed = false;
  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }
  postMessage(data: unknown): void {
    FakeBroadcastChannel.posts += 1;
    for (const other of FakeBroadcastChannel.instances) {
      if (other === this || other.name !== this.name || other.closed) continue;
      other.onmessage?.({ data });
    }
  }
  close(): void {
    this.closed = true;
  }
}

/**
 * `BroadcastChannel` 在 Node 22 里是**真全局**,而整套 apps/web 的 vitest 是 singleThread、
 * 共用同一个 globalThis(见 `asset-detail-write-failures.test.ts` 里同一段说明)。把它换成假件
 * 之后必须**还原**而不是 delete —— delete 会把 Node 那个内建全局对后面几百个文件永久摘掉。
 */
const originalBroadcastChannel = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");

function restoreBroadcastChannel(): void {
  if (originalBroadcastChannel) {
    Object.defineProperty(globalThis, "BroadcastChannel", originalBroadcastChannel);
  } else {
    delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
  }
}

type BalanceRefreshModule = typeof import("../balance-refresh");

/** 开一个新「标签页」：一份全新的模块实例，带着它自己那份监听集。 */
async function openTab(): Promise<BalanceRefreshModule> {
  vi.resetModules();
  return import("../balance-refresh");
}

beforeEach(() => {
  FakeBroadcastChannel.instances = [];
  FakeBroadcastChannel.posts = 0;
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = FakeBroadcastChannel;
});

afterEach(() => {
  restoreBroadcastChannel();
  vi.restoreAllMocks();
});

describe("frontend-baseline §5 :202 FSE-010 余额跨标签页广播", () => {
  it("frontend-baseline §5 :202 FSE-010 FRONT-A11 一个标签页花掉 credits,另一个标签页的余额监听集也被触发", async () => {
    const tabA = await openTab();
    const tabB = await openTab();
    const navA = vi.fn();
    const navB = vi.fn();
    tabA.subscribeBalanceRefresh(navA);
    tabB.subscribeBalanceRefresh(navB);

    // 商家在 A 页花了钱。
    tabA.notifyBalanceRefresh();

    // 本页照旧立刻重读；B 页那一份监听集也收到了同一声 —— 这一条就是走查那个陈旧数字的对策。
    expect(navA).toHaveBeenCalledTimes(1);
    expect(navB).toHaveBeenCalledTimes(1);
  });

  it("frontend-baseline §5 :202 FSE-010 FRONT-A11 收到广播的那一页不转播:一次花钱全网只广播一次", async () => {
    const tabA = await openTab();
    const tabB = await openTab();
    const tabC = await openTab();
    const navA = vi.fn();
    const navB = vi.fn();
    const navC = vi.fn();
    tabA.subscribeBalanceRefresh(navA);
    tabB.subscribeBalanceRefresh(navB);
    tabC.subscribeBalanceRefresh(navC);

    tabA.notifyBalanceRefresh();

    // 转播会让这几页互相回声成一个不停的环(而这条路上没有任何计时器能踩刹车)。
    // 一次花钱 = 一次广播,每页恰好重读一次。
    expect(FakeBroadcastChannel.posts).toBe(1);
    expect([navA, navB, navC].map((nav) => nav.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("frontend-baseline §5 :202 FSE-010 FRONT-A11 没有 BroadcastChannel 的环境静默降级:本页照旧刷新,不抛", async () => {
    delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    const tab = await openTab();
    const nav = vi.fn();
    tab.subscribeBalanceRefresh(nav);

    expect(() => tab.notifyBalanceRefresh()).not.toThrow();
    expect(nav).toHaveBeenCalledTimes(1);
  });

  it("frontend-baseline §5 :202 FSE-010 FRONT-A11 频道拒收(隐私模式之类)也只是少一次跨页同步,花钱那条路不报错", async () => {
    class RefusingChannel extends FakeBroadcastChannel {
      override postMessage(): void {
        throw new Error("channel refused");
      }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = RefusingChannel;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tab = await openTab();
    const nav = vi.fn();
    tab.subscribeBalanceRefresh(nav);

    expect(() => tab.notifyBalanceRefresh()).not.toThrow();
    expect(nav).toHaveBeenCalledTimes(1);
  });

  it("frontend-baseline §5 :202 FSE-010 FRONT-A11 跨页同步没有引入任何计时器(#544:不新增 timer)", async () => {
    // 源码扫描,不是行为断言:这一条守的是**修法本身**——广播是浏览器推过来的一件事,
    // 一旦有人日后在这个文件里补一条轮询,这条就红。
    const source = readFileSync(path.resolve(__dirname, "../balance-refresh.ts"), "utf8");

    expect(source).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    // 而广播这条路确实在这个文件里 —— 免得有人把上面那条读成「什么都别做」。
    expect(source).toContain("BroadcastChannel");
  });
});
