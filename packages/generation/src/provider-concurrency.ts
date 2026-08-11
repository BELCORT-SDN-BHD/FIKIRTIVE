/**
 * provider-concurrency — 供应商账户额度的**请求级**闸门(#796 判官 r1 P1-1)。
 *
 * r1 把这件事算错了,错得很典型:它按「同时在跑几个 job」来对账户额度,而账户额度管的是
 * **同时发出去几个请求**。这两个数在我们这里差一个数量级 ——
 *
 *   一个图片 job 会为它的每一张图各发一个付费 POST(`Promise.allSettled`,见 byteplus.ts
 *   的 `generate`)。gen 的 count 上限 4,refgen 的上限 6(`MAX_REFGEN_COUNT`)。
 *   于是「gen 4 个 job + refgen 2 个 job」在最坏情况下是 4×4 + 2×6 = **28 个并发请求**,
 *   而账户额度是 10。按 job 算得出的「6,安全」是一个假账。
 *
 * 所以闸门必须站在**请求**这一层,而且必须由 gen 与 refgen **共用** —— 它们打的是同一个
 * 账户。这个模块导出的是一个进程内信号量:providers 在每个付费请求外面套一层,超出上限的
 * 请求排队等待,而不是发出去换一个 429。
 *
 * 为什么是排队而不是报错:429 对商家来说就是「生成失败」,对我们来说是白烧的重试。
 * 多等几秒钟没人看得出来,失败每个人都看得出来。
 *
 * 视频任务按**整个任务**占一个位(提交 + 轮询),不是只占提交那一下 —— 账户额度对视频
 * 说的是「同时在跑几个任务」。保守方向选错了只是少用一点额度;另一个方向选错了是 429。
 */

/** 进程内并发闸门。没有定时器、没有队列上限 —— 等待者按先来后到排队。 */
export class RequestGate {
  #limit: number;
  #inFlight = 0;
  #waiting: (() => void)[] = [];
  /** 观测用:进程生命周期里同时在途的请求峰值。测试用它证明闸门真的按住了。 */
  #peak = 0;

  constructor(limit: number) {
    this.#limit = Math.max(1, Math.floor(limit));
  }

  get limit(): number { return this.#limit; }
  get inFlight(): number { return this.#inFlight; }
  get peakInFlight(): number { return this.#peak; }

  /**
   * 取一个位,返回归还函数。归还**必须**在 finally 里调用,否则位子会永久漏掉。
   *
   * **槽位移交语义**(#796 判官 r2 P1-1 修正)。r2 的写法是「归还时先 `inFlight--`,再唤醒
   * 一个等待者」,而被唤醒者要等到**下一轮 microtask** 才 `inFlight++`。这中间有一条缝:
   *
   *   1. `release()` 把 inFlight 从 6 减到 5,并唤醒等待者 W(W 还没跑);
   *   2. **同一轮**里来了一个新请求 N,它看到 5 < 6,直接 `++` 占走那个空位(6);
   *   3. microtask 轮到 W,它也 `++` —— inFlight 变成 **7**,超了上限。
   *
   * 判官给的最小复现就是这个形状({limit:6, inFlight:7, peak:7}),同步连着释放几个还能更糟。
   * 对我们来说 7 就是账户额度上多出来的一个并发请求 —— 429,商家读作「生成失败」。
   *
   * 修法是把那条缝取消掉:归还时**如果有等待者,槽位直接移交** —— 计数一动不动,唤醒者
   * 醒来后也不再 `++`。只有在没人等的时候才真的把计数减掉。于是任何时刻的 `inFlight`
   * 都是「已发出去的位子数」,新请求在同一轮里看到的就是移交后的真实值,插不进队。
   */
  async acquire(): Promise<() => void> {
    if (this.#inFlight >= this.#limit) {
      // 等的是一个**已经算在 inFlight 里**的位子(移交)。醒来即持有,不再自增。
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    } else {
      this.#inFlight++;
      if (this.#inFlight > this.#peak) this.#peak = this.#inFlight;
    }
    let released = false;
    return () => {
      if (released) return; // 双重归还不许多放一个位子进来
      released = true;
      const next = this.#waiting.shift();
      // 有人在等 ⇒ 把这个位子直接交给他,计数不变(所以峰值也不可能因此上升)。
      // 没人在等 ⇒ 位子真的空出来。
      if (next) next();
      else this.#inFlight--;
    };
  }

  /** acquire + finally release 的常用形态。 */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try { return await fn(); }
    finally { release(); }
  }
}

/**
 * 每个进程允许同时向供应商发出的付费请求数。
 *
 * 默认 6:官方账户额度 10(2026-08-08 `arkcli models get` 实测 `concurrent_requests: 10`),
 * 留 4 的余量给重试和别处顺手发起的调用。多副本时必须自己再除:`replicas × 这个数 ≤ 8`。
 */
export const PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT = 6;
export const PROVIDER_MAX_CONCURRENT_REQUESTS_ENV = "PROVIDER_MAX_CONCURRENT_REQUESTS";

export function providerRequestLimit(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env[PROVIDER_MAX_CONCURRENT_REQUESTS_ENV]);
  // 非法值退回默认,**绝不退到 0**:0 会把闸门变成一堵永远不开的墙。
  return Number.isInteger(n) && n >= 1 ? n : PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT;
}

let gate: RequestGate | undefined;

/** 进程内**唯一**的闸门 —— gen 与 refgen 必须共用同一个实例,它们花的是同一个账户的额度。 */
export function providerRequestGate(): RequestGate {
  return (gate ??= new RequestGate(providerRequestLimit()));
}

/** 测试专用:换掉单例。生产代码不要调用。 */
export function __setProviderRequestGateForTests(next: RequestGate | undefined): void {
  gate = next;
}
