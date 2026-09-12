/**
 * 意图编号的**浏览器一侧**(`lib/asset-action-intent.ts`)—— 规格
 * `docs/specs/asset-action-idempotency.md` §1.4 改动二与 §4 异议栏。
 *
 * 规格把这条边界交给了这个模块,并且明写了存活范围(「这一次提交的内存 + sessionStorage,
 * 提交落地即丢弃」),因为存太短会把断线恢复当成新购买(多扣一次钱),存太长会把商家真的
 * 「再来一张」当成重放(按钮像坏了)。服务端那一半只把编号当键材料,分不出这两种错法 ——
 * 所以它们只能在这里钉。
 *
 * 钱的那一半(同编号 ⇒ 一单一扣,换编号 ⇒ 新的一单)在真库上跑:
 * `asset-idempotency-ledger.test.ts`(ASSET-A3 / A4)与 `asset-action-idempotency.test.ts`。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 真 sessionStorage 的最小替身:这个模块只用 getItem / setItem / removeItem。 */
function installSessionStorage(): Map<string, string> {
  const backing = new Map<string, string>();
  const store = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => { backing.set(k, v); },
    removeItem: (k: string) => { backing.delete(k); },
  };
  Object.defineProperty(globalThis, "window", {
    value: { sessionStorage: store },
    configurable: true,
    writable: true,
  });
  return backing;
}

const { assetIntentSlot, beginAssetIntent, endAssetIntent } = await import("../asset-action-intent");

let stored: Map<string, string>;

beforeEach(() => {
  stored = installSessionStorage();
  // 上一条用例可能在内存里留了编号 —— 每条用例用自己的格,互不借力。
});

function freshSlot(): string {
  return assetIntentSlot("regen", `gen_${Math.random().toString(36).slice(2)}`);
}

describe("意图编号的存活范围", () => {
  it("ASSET-A5 提交还没落地就再问一次(断线重连 / server action 重发)⇒ 拿回同一个编号", () => {
    const slot = freshSlot();
    const first = beginAssetIntent(slot);
    expect(first).toBeTruthy();
    expect(beginAssetIntent(slot), "没落地就还是同一次意图").toBe(first);
  });

  it("ASSET-A5 编号熬得过一次刷新:内存清空后仍从 sessionStorage 拿回同一个", async () => {
    const slot = freshSlot();
    const before = beginAssetIntent(slot);
    expect(stored.get(`fikirtive.asset-intent.${slot}`)).toBe(before);

    // 刷新 = 模块的内存副本没了,sessionStorage 还在。重新加载一份模块实例来模拟。
    vi.resetModules();
    const reloaded = await import("../asset-action-intent");
    expect(reloaded.beginAssetIntent(slot), "刷新后的自动重发必须回到原单").toBe(before);
  });

  it("ASSET-A4 提交落地之后再按一次 ⇒ 新编号(这才是「再来一张」)", () => {
    const slot = freshSlot();
    const firstPress = beginAssetIntent(slot);
    endAssetIntent(slot);

    const secondPress = beginAssetIntent(slot);
    expect(secondPress).not.toBe(firstPress);
    // 落地那一刻两处都清干净了 —— 刷新也不会把旧编号捞回来。
    expect(stored.get(`fikirtive.asset-intent.${slot}`)).toBe(secondPress);
  });

  it("ASSET-A4 换动作或换底图是另一格:三个按钮的编号互不串台", () => {
    const anchor = `gen_${Math.random().toString(36).slice(2)}`;
    const regen = beginAssetIntent(assetIntentSlot("regen", anchor));
    const animate = beginAssetIntent(assetIntentSlot("animate", anchor));
    const otherImage = beginAssetIntent(assetIntentSlot("regen", `${anchor}_2`));
    expect(new Set([regen, animate, otherImage]).size).toBe(3);
  });

  it("sessionStorage 不可用(隐私模式 / SSR)⇒ 照样出编号,不炸付费按钮", () => {
    Object.defineProperty(globalThis, "window", { value: undefined, configurable: true, writable: true });
    const slot = freshSlot();
    const id = beginAssetIntent(slot);
    expect(id).toBeTruthy();
    expect(beginAssetIntent(slot), "内存那一份仍然管用").toBe(id);
    expect(() => endAssetIntent(slot)).not.toThrow();
  });
});
