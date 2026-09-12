"use client";

/**
 * 「这一次商家按下按钮」的**意图编号** —— 资产付费动作(Regenerate / Animate / Edit /
 * Template)防重复扣钱的浏览器一侧(规格 `docs/specs/asset-action-idempotency.md`
 * §1.4 改动二 + §4 异议栏,验收 ASSET-A3 / A4 / A5)。
 *
 * 它解决的是服务端单凭请求体解决不了的一件事:**同一份请求体的两次提交,到底是同一次
 * 意图的重放,还是商家真的想再来一张。** 两者在服务端逐字相同,所以分界线只能由发起
 * 那一端给 —— 与 Stripe 的 idempotency key 同一条惯例:调用方为「一次意图」生成一个
 * 编号,同编号的重放永远拿回第一次的结果。
 *
 * 存活范围是规格写死的,不留给实现随手决定(§4):
 *   · **一次提交**的内存 + `sessionStorage`;
 *   · 提交**落地**(服务端给了任何回答,成功或拒绝)即丢弃,下一次按下重新生成。
 *
 * 于是两个方向都夹住:
 *   · 提交还没落地就重发(断网重连、server action 重试、刷新后自动恢复)⇒ 编号还在
 *     ⇒ 同一把键 ⇒ 回到原来那一单,账本零新行(ASSET-A5);
 *   · 商家自己再按一次 ⇒ 上一次已经落地、编号已经丢掉 ⇒ 新编号 ⇒ 新的一单、照扣一次
 *     (ASSET-A4)。
 *
 * `sessionStorage` 而不是 `localStorage`:编号只在这一个标签页这一次会话里有意义。
 * 第二个标签页本来就是另一次意图(商家在那里自己按了一次),不该共用同一把键。
 */

/** 内存是第一份;`sessionStorage` 只是它熬过一次刷新的备份。 */
const inMemory = new Map<string, string>();

const STORAGE_PREFIX = "fikirtive.asset-intent.";

/** SSR、隐私模式、被禁的站点数据 —— 任何一种都只让编号少熬一次刷新,绝不该炸掉付费按钮。 */
function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * 一次意图的归属格。同一个动作锚在同一张图上 = 同一格;换动作或换底图本来就是另一件事
 * (服务端的键也把这两样编进去)。
 */
export function assetIntentSlot(op: string, anchorGenerationId: string): string {
  return `${op}:${anchorGenerationId}`;
}

function mint(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // 老浏览器 / 非安全上下文没有 randomUUID。编号只需要「同一次提交内稳定、跨提交不重复」,
    // 不是密码学材料 —— 但它进的是幂等键,所以撞号 = 两次不同的意图共用一单。时间戳 +
    // 两段随机把这个概率压到实务上不可能,而且永远不会因为缺少一个 API 就把按钮变成不可用。
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * 这一格**现在这一次提交**的编号:还没落地的就沿用,没有的就新出一个。
 *
 * 每一次按下按钮之前调一次,把结果随请求送给 `startAssetGen`。
 */
export function beginAssetIntent(slot: string): string {
  const held = inMemory.get(slot);
  if (held) return held;

  const store = session();
  const stored = store?.getItem(STORAGE_PREFIX + slot);
  if (stored) {
    inMemory.set(slot, stored);
    return stored;
  }

  const fresh = mint();
  inMemory.set(slot, fresh);
  try {
    store?.setItem(STORAGE_PREFIX + slot, fresh);
  } catch {
    /* 存不下就只活在内存里:少熬一次刷新,不影响这一次提交的去重。 */
  }
  return fresh;
}

/**
 * 这一次提交**落地了** —— 丢掉编号,于是下一次按下是一次新的购买。
 *
 * 「落地」= 服务端给了回答(建单成功、或任何一句拒绝),不是「跑完了」。跑的过程中
 * 重连重发已经没有意义:那一单的 id 已经在手上,面板轮询它就是了。
 */
export function endAssetIntent(slot: string): void {
  inMemory.delete(slot);
  try {
    session()?.removeItem(STORAGE_PREFIX + slot);
  } catch {
    /* 清不掉也只是让同一格的下一次按下被当成重放 —— 方向安全(少扣钱),而且下一张
       底图/下一个动作换格,不会卡住。 */
  }
}
