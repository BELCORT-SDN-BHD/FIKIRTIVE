/**
 * Balance-refresh signal — "the money moved, whoever is showing it should re-read it".
 *
 * The spendable balance is rendered in exactly one place now: the persistent global
 * navigation (#513 A组). That rail is mounted by the root layout, while every spend
 * happens deep inside a page's own tree (Otto turns, canvas generations, the asset
 * detail panel) — there is no shared React state between them, so a settle had no way
 * to reach the number the merchant is actually looking at. It stayed on the value
 * fetched at mount until a full page reload (#550: the sidebar lagged the database by
 * 84s+ during the S2/S6 walkthrough).
 *
 * This is a plain module-scoped emitter, not a poll: a spend site calls
 * notifyBalanceRefresh() at the moment it already knows a charge settled, and whoever
 * displays a balance re-reads it then. No new timer is introduced — #544 flagged one
 * timer too many, and the discipline outlived the timer it was about: the 4s
 * thread-activity poll this comment used to name is gone (grep: no interval reads
 * /api/otto/thread-activity today; the panel's expand signal asks it exactly once per
 * visit, `lib/otto-panel-activity.ts`). "No new timer" still governs both.
 *
 * Browser-only in effect — the listener set is module state, so it is meaningful only
 * inside the browser bundle where the nav and the spend sites share it. The module still
 * LOADS on the server (the nav is a client component inside a server-rendered tree), so the
 * cross-tab channel below opens only where a `window` exists: on the server there is no
 * second tab to reach, and Node's own built-in BroadcastChannel would hand back a live
 * handle nobody in that process ever closes.
 *
 * FSE-010（frontend-baseline.md §5 :202，Founder 2026-09-10 裁）——「模块态」这句话正是
 * 走查里那个数字的病根：商家开着两个标签页，在一个里花掉 credits，另一个的侧栏还写着花之前
 * 那个数（走查：侧栏 18.4、Billing 正文 14.8、库里 14.8），因为那一页的监听集是它自己那份。
 * 修法是 `BroadcastChannel`：花钱那一刻**同时**在本页派送与向同源的别的标签页广播一声，
 * 收到的那一页照它自己那条既有的路重读一次。**不新增计时器**（#544 的纪律）——广播是浏览器
 * 推过来的一件事，不是我们每隔几秒去问一次。
 */

type BalanceRefreshListener = () => void;

const listeners = new Set<BalanceRefreshListener>();

/**
 * 频道名。两个标签页只靠这一个字符串认出彼此，所以它只能有一份（换掉它 = 换一条频道，
 * 旧标签页从此听不见新标签页）。
 */
const BALANCE_REFRESH_CHANNEL = "fikirtive:balance-refresh";

let channel: BroadcastChannel | null = null;
let channelOpened = false;

/**
 * 打开（或取回）这一页的那条频道。**静默降级**：`BroadcastChannel` 不在（服务端渲染、老浏览器、
 * 被隐私模式挡掉）就返回 null，本页照旧只在本页派送——跨页同步是加分项，不是余额显示的前提，
 * 一次拿不到频道绝不能让花钱那条路上冒出一个错。
 */
function openBalanceChannel(): BroadcastChannel | null {
  if (channelOpened) return channel;
  channelOpened = true;
  // 只在浏览器里开。Node 22 自己也带一个真的 `BroadcastChannel`，所以「构造器在不在」这个判据
  // 在服务端渲染与测试进程里一样成立 —— 而那儿根本没有第二个标签页可同步，开出来的
  // 只是一个挂着 `onmessage` 的活句柄，而这个模块的关闭路径只在页面里走得到。
  // 跨页同步本就是浏览器那一侧的事，判据就写成浏览器。
  if (typeof window === "undefined") return null;
  const Ctor = (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
  if (typeof Ctor !== "function") return null;
  try {
    const opened = new Ctor(BALANCE_REFRESH_CHANNEL);
    // 别的标签页广播过来 —— 只在本页派送，**绝不转播**：转播会让两页互相回声成一个不停的环，
    // 而这条路上没有任何计时器能给它踩刹车。
    opened.onmessage = () => {
      deliverLocally();
    };
    channel = opened;
  } catch {
    channel = null;
  }
  return channel;
}

/**
 * 关掉这一页那条频道。**唯一的关闭时机是最后一个余额显示退订**：在那之后这一页没有人还
 * 听得见广播，留着的只是一个还挂着 `onmessage` 的活对象。把 `channelOpened` 一并放回 false，
 * 下一次订阅照原样再开一条 —— 这个模块从头到尾只维持一条频道（惰性单例）。
 */
function closeBalanceChannel(): void {
  const opened = channel;
  channel = null;
  channelOpened = false;
  if (!opened) return;
  try {
    opened.close();
  } catch {
    // 关不上也无所谓：这一页已经没有人在听了。
  }
}

/** Register a balance display. Returns the unsubscribe for the effect's teardown. */
export function subscribeBalanceRefresh(listener: BalanceRefreshListener): () => void {
  listeners.add(listener);
  // 订阅的那一刻就把收听端打开 —— 一页只显示余额、自己从不花钱时，它听得见别页那一声，
  // 靠的全是这一行。
  openBalanceChannel();
  return () => {
    listeners.delete(listener);
    // 最后一个显示卸载了就把频道还回去（见 `closeBalanceChannel`）。
    if (listeners.size === 0) closeBalanceChannel();
  };
}

/** Guard a repeatedly-issued async read against out-of-order responses.
 *
 *  Call the returned `begin()` when a read starts; it hands back an `isLatest()` that is
 *  false once a newer read has begun. A settle fires several refreshes in quick
 *  succession (the hold, then the settle/refund), and `getMyAccount` responses are not
 *  guaranteed to come back in the order they were sent — without this, a slow earlier
 *  response can land last and repaint an OLDER balance. That makes a "refresh" actively
 *  worse than not refreshing, which is the opposite of what #550 is trying to buy.
 *
 *  Each gate has its own sequence, so two independent displays never invalidate each
 *  other's reads. */
export function createLatestReadGate(): () => () => boolean {
  let issued = 0;
  return () => {
    const mine = ++issued;
    return () => mine === issued;
  };
}

/** Deliver to this tab's own displays. Iterates a snapshot so a listener that
 *  subscribes/unsubscribes during delivery cannot change who this round reaches, and one
 *  throwing listener cannot swallow the rest — a display bug must never surface as a
 *  failure on a spend path. */
function deliverLocally(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn("balance-refresh listener failed (non-fatal):", error);
    }
  }
}

/** Announce that a charge settled and any displayed balance is now stale — in this tab
 *  and, FSE-010, in whatever other tabs the merchant left open on the same origin. The
 *  broadcast is best-effort by design: it goes out AFTER this tab's own displays have been
 *  told, and a channel that is missing or refuses the message changes nothing here. */
export function notifyBalanceRefresh(): void {
  deliverLocally();
  try {
    openBalanceChannel()?.postMessage(BALANCE_REFRESH_CHANNEL);
  } catch (error) {
    console.warn("balance-refresh broadcast failed (non-fatal):", error);
  }
}
