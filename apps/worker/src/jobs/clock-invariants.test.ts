/**
 * clock-invariants.test.ts — #796 / #760 第 2 项:「三个时钟按并发假设重算」。
 *
 * 为什么这件事值一整个测试文件:清道夫的阈值算错,后果不是慢,是**误杀在跑的付费任务** ——
 * 商家看到失败、拿到退款,而供应商那边照样出片照样计费。烧的是毛利,丢的是信任。
 * 这些数字散在三个文件里(供应商轮询超时在 packages/generation、队列过期在 packages/core、
 * 清道夫窗口在 apps/worker),谁都能单独改一个,而这条链条只要一处失序就出上面那个后果。
 *
 * 链条(从内到外,每一层都必须严格大于上一层):
 *
 *   供应商轮询超时 15m  <  stale 判定 18m  <  队列过期 20m  <  清道夫窗口 25m
 *
 *   - 供应商超时 < stale:一次**正常**的长视频调用绝不能被当成「卡死」。
 *   - stale < 队列过期:重投一定意味着过期已发生,所以重投时用 stale 判定是安全的。
 *   - 队列过期 < 清道夫:清道夫跑在自己的定时器上,它必须等到 pg-boss 自己都放弃之后才动手,
 *     否则它会把一个 pg-boss 仍会送达的付费任务判死 + 退款。
 *
 * 并发假设(#796 的定案):`localConcurrency` 下每个轮询器各取各的活、各跑各的钟,
 * 所以「一个任务的在途时长」还是它自己的时长 —— N 路并发不拉长其中任何一个窗口,
 * 上面四个数字**不需要**因为并发而改动。这个文件把这句话变成断言,而不是留在注释里。
 * (换成 `batchSize: N` + Promise.all 就不成立了:同一批里最慢的那个决定整批的在途时长,
 * 队列过期就得覆盖 max(batch) 而不是 max(job) —— 这是不采用那个形状的第二个理由。)
 */
import { describe, it, expect } from "vitest";
import { GEN_QUEUE_POLICY, REFGEN_QUEUE_POLICY, RESEARCH_QUEUE_POLICY, PUBLISH_QUEUE_POLICY, PUBLISH_EXECUTION_DEADLINE_MS, GEN_QUEUE, REFGEN_QUEUE, UNDERSTAND_QUEUE, MAX_GEN_COUNT, MAX_REFGEN_COUNT } from "@fikirtive/core";
import { VIDEO_POLL_TIMEOUT_MS, ARK_IMAGE_TIMEOUT_MS, ARK_DOWNLOAD_TIMEOUT_MS, PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT, PROVIDER_MAX_CONCURRENT_REQUESTS_ENV, providerRequestLimit } from "@fikirtive/generation";
import { workerPlan } from "../plan.js";
import { GEN_STALE_MS, GEN_REAP_MS, GEN_QUEUED_REAP_MS, GEN_DONE_EMPTY_GRACE_MS } from "./gen.js";
import { REFGEN_STALE_MS, REFGEN_REAP_MS, REFGEN_QUEUED_REAP_MS } from "./refgen.js";

const MINUTE = 60_000;
const genExpireMs = GEN_QUEUE_POLICY.expireInSeconds * 1000;
const refgenExpireMs = REFGEN_QUEUE_POLICY.expireInSeconds * 1000;

describe("gen 时钟链:供应商超时 < stale < 队列过期 < 清道夫", () => {
  it("一次正常的长视频调用不会被 stale 判定误伤", () => {
    // The provider gives up at 15m. If the stale cutoff sat below that, a duplicate delivery
    // landing at minute 16 of a perfectly healthy 15-minute video would fail the job closed and
    // refund a merchant whose clip was still coming.
    expect(VIDEO_POLL_TIMEOUT_MS).toBeLessThan(GEN_STALE_MS);
  });

  it("stale 判定在队列过期之前 —— 重投时用它才成立", () => {
    expect(GEN_STALE_MS).toBeLessThan(genExpireMs);
  });

  it("清道夫窗口在队列过期之后 —— 绝不跟 pg-boss 抢一条还活着的付费任务", () => {
    expect(GEN_REAP_MS).toBeGreaterThan(genExpireMs);
    expect(GEN_QUEUED_REAP_MS).toBeGreaterThan(genExpireMs);
  });

  it("队列过期本身覆盖得住最慢的一次合法调用", () => {
    // expire must cover the provider call itself PLUS the download+store tail after it.
    expect(genExpireMs).toBeGreaterThan(VIDEO_POLL_TIMEOUT_MS);
    expect(genExpireMs - VIDEO_POLL_TIMEOUT_MS).toBeGreaterThanOrEqual(5 * MINUTE);
  });

  // ── creation §5 :177 —— 图片那条路也有它自己的第一环,而且此前**没人守** ──────────
  //
  // 图片是同步渲染:POST 的时长就是出图时长(视频那条是「建任务 60s + 轮询 15m」)。
  // 这一环同样必须落在 stale 之前,否则一次正常的慢出图会被判成「卡死」并误杀退款。
  //
  // 但「渲染 5m + 下载 5m < 18m」**不是全部账**(判官 P2 点名的漏项)。stale 量的起点是
  // `startedAt` —— QUEUED→GENERATING 那一刻写下的(本目录 `gen.ts` 的 claim),而付费 POST 在那
  // 之后还要先在 `providerRequestGate`(进程内唯一,默认 6 格,gen / refgen / understand 共用同
  // 一个账户额度)**排队**。排队时间落在被量的窗口**里面**,所以真正的账是:
  //
  //     排队 + 渲染 5m + 下载 5m  <  stale 18m   ⇒   留给排队的余量 = 8m
  //
  // 本片把图片 POST 的占位从 60s 抬到 5m:余量从 12m 收窄到 8m,而且**一轮排队的价钱也从
  // 60s 变成了 5m**。所以「够不够」不能只答「够一轮」(第 2 轮的论据停在这里,不准) ——
  // 要按最坏排几轮算,而轮数由这个进程能同时推到闸前多少个请求决定:
  //
  //     闸前需求 = 任务槽位 × 每个任务的付费请求扇出(一张图 = 一个付费 POST)
  //     最坏排队 = (ceil(需求 / 闸位) - 1) 轮 × 一轮最慢 5m
  //
  // 三个数都从真源现读:槽位 `workerPlan(env)`、扇出 `MAX_GEN_COUNT` / `MAX_REFGEN_COUNT`、
  // **闸位 `providerRequestLimit(env)`**。闸位尤其不能写死默认 6 —— 运维手册要求多副本时自己再除
  // (`replicas × PROVIDER_MAX_CONCURRENT_REQUESTS ≤ 8`),而它正是决定答案的除数。
  //
  // 下面三条钉的是:默认角色**在单副本闸位(6)下**装得下,是不变式;闸位降到 6 以下(手册允许的
  // 2 副本 = 4 格)默认角色也装不下;`WORKER_ROLE=wait` 更装不下 —— 后两格都是**本片收窄的**,
  // 是登记的缺口,不是不变式。
  const IMAGE_ATTEMPT_MS = ARK_IMAGE_TIMEOUT_MS + ARK_DOWNLOAD_TIMEOUT_MS;
  const GEN_QUEUE_ALLOWANCE_MS = GEN_STALE_MS - IMAGE_ATTEMPT_MS;
  /** 修法前图片 POST 占的那把尺(控制面 60s)。只用来回答「这一格是不是本片收窄的」。 */
  const PRE_FIX_IMAGE_POST_MS = 60_000;
  /** 修法前留给排队的余量(12m)。同上,只用于「本片收窄没收窄」的对照。 */
  const PRE_FIX_ALLOWANCE_MS = GEN_STALE_MS - (PRE_FIX_IMAGE_POST_MS + ARK_DOWNLOAD_TIMEOUT_MS);

  /** 一个 worker 进程最坏能同时推到闸前多少个付费请求 = 槽位 × 每个任务的请求扇出。 */
  function paidRequestDemand(env: NodeJS.ProcessEnv): number {
    const { concurrency } = workerPlan(env);
    return (
      (concurrency[GEN_QUEUE] ?? 0) * MAX_GEN_COUNT + // 散图路:count 张图 = count 个付费 POST
      (concurrency[REFGEN_QUEUE] ?? 0) * MAX_REFGEN_COUNT +
      (concurrency[UNDERSTAND_QUEUE] ?? 0) // 理解一次一个请求,但花的是同一个账户额度
    );
  }
  /**
   * 最坏排队 = 前面还要清掉几轮 × 一轮最慢(一个图片 POST 打满它的截止时间)。
   *
   * 闸门宽度**从真源现读**(`providerRequestLimit(env)`,读 `PROVIDER_MAX_CONCURRENT_REQUESTS`),
   * 不写死 `PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT`:那个数是运维可调的,而下面「装不装得下」
   * 的答案正是被它除出来的。写死会让答案在多副本配置下永远算成单副本的样子 —— 断言绿着,
   * 商家那边照样被误杀。槽位与扇出已经从 `workerPlan()` / `MAX_*_COUNT` 现读,除数不能例外。
   */
  const worstQueueWaitMs = (env: NodeJS.ProcessEnv, roundMs: number): number =>
    (Math.ceil(paidRequestDemand(env) / providerRequestLimit(env)) - 1) * roundMs;

  it("一次正常的慢出图不会被 stale 判定误伤", () => {
    expect(ARK_IMAGE_TIMEOUT_MS).toBeLessThan(GEN_STALE_MS);
    expect(IMAGE_ATTEMPT_MS).toBeLessThan(GEN_STALE_MS);
  });

  it("并发闸的排队时间也在被量的窗口里 —— 默认角色 + 单副本闸位最坏排一轮 5m,装得进 8m 余量", () => {
    expect(IMAGE_ATTEMPT_MS).toBe(10 * MINUTE);
    expect(GEN_QUEUE_ALLOWANCE_MS).toBe(8 * MINUTE);
    // 不设 `WORKER_ROLE` = 默认 `all`:等待型队列各 1 格 ⇒ 闸前最多 4(gen) + 6(refgen) + 1(understand)。
    const demand = paidRequestDemand({});
    expect(demand).toBe(MAX_GEN_COUNT + MAX_REFGEN_COUNT + 1);
    // 不设 `PROVIDER_MAX_CONCURRENT_REQUESTS` = 默认 6 格 = 运维手册的**单副本**配置
    // (`docs/ops/worker-services.md`:`replicas × PROVIDER_MAX_CONCURRENT_REQUESTS ≤ 8`)。
    expect(providerRequestLimit({})).toBe(PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT);
    // 11 个请求、6 格 ⇒ 排在最后的那个前面只有一轮要清。
    const wait = worstQueueWaitMs({}, ARK_IMAGE_TIMEOUT_MS);
    expect(wait).toBe(ARK_IMAGE_TIMEOUT_MS);
    expect(wait).toBeLessThan(GEN_QUEUE_ALLOWANCE_MS);
    expect(wait + IMAGE_ATTEMPT_MS).toBeLessThan(GEN_STALE_MS);
  });

  it("已知缺口钉板:闸位调到 6 以下(手册允许的 2 副本 = 4 格)默认角色也装不下(本片收窄的正是这一格)", () => {
    // 上一条的绿只对**单副本**成立,而运维手册明写多副本要自己再除:
    // `replicas × PROVIDER_MAX_CONCURRENT_REQUESTS ≤ 8`(账户额度 10 减 2 的余量)。
    // 2 副本 ⇒ 每副本 4 格。此时**默认角色**(不设 `WORKER_ROLE`)的 11 个请求要清 2 轮 = 10m,
    // 大过 8m 余量 ⇒ 一次健康的慢出图整趟 20m,撞穿 stale 18m,被判「卡死」失败 + 退款。
    const twoReplicas = { [PROVIDER_MAX_CONCURRENT_REQUESTS_ENV]: "4" };
    expect(providerRequestLimit(twoReplicas)).toBe(4);
    expect(paidRequestDemand(twoReplicas)).toBe(MAX_GEN_COUNT + MAX_REFGEN_COUNT + 1);
    const wait = worstQueueWaitMs(twoReplicas, ARK_IMAGE_TIMEOUT_MS);
    expect(wait).toBe(2 * ARK_IMAGE_TIMEOUT_MS);
    expect(wait).toBeGreaterThan(GEN_QUEUE_ALLOWANCE_MS);
    expect(wait + IMAGE_ATTEMPT_MS).toBeGreaterThanOrEqual(GEN_STALE_MS);

    // 而修法前同样 2 轮只要 2×60s = 2m,装得进当时 12m 的余量 ⇒ 这一格**是本片收窄的**。
    expect(worstQueueWaitMs(twoReplicas, PRE_FIX_IMAGE_POST_MS)).toBeLessThan(PRE_FIX_ALLOWANCE_MS);

    // 边界钉死:默认角色现在**只有**闸位 ≥ 6(= 单副本)才装得下。改宽 `ARK_IMAGE_TIMEOUT_MS`
    // 或改窄 stale 会把这个门槛推高,那时必须回到这里重新论证,而不是让上一条继续绿着。
    const fitsAt = (limit: number): boolean =>
      worstQueueWaitMs({ [PROVIDER_MAX_CONCURRENT_REQUESTS_ENV]: String(limit) }, ARK_IMAGE_TIMEOUT_MS) <
      GEN_QUEUE_ALLOWANCE_MS;
    expect([1, 2, 3, 4, 5].map(fitsAt)).toEqual([false, false, false, false, false]);
    expect(fitsAt(6)).toBe(true);
  });

  it("已知缺口钉板:WORKER_ROLE=wait 的槽位把最坏排队推过余量(本片收窄的正是这一格)", () => {
    // 这条**不是**不变式,是把一笔账钉在明面上。`wait` 角色要人显式写 `WORKER_ROLE=wait`
    // 才生效(`plan.ts`,判官 r1 P0 定案),默认部署不走它;一旦设了,闸前需求 30、6 格 ⇒
    // 最坏还要清 4 轮 = 20m,大过 8m 余量。
    const demand = paidRequestDemand({ WORKER_ROLE: "wait" });
    expect(demand).toBe(4 * MAX_GEN_COUNT + 2 * MAX_REFGEN_COUNT + 2);
    expect(worstQueueWaitMs({ WORKER_ROLE: "wait" }, ARK_IMAGE_TIMEOUT_MS)).toBeGreaterThan(GEN_QUEUE_ALLOWANCE_MS);
    // 而修法前同样 4 轮只要 4×60s = 4m,装得进当时 12m 的余量 —— 所以这一格**是本片收窄的**,
    // 不像下面那条视频的先于本片存在。开大闸位补不上:账户并发硬顶 10,还小于需求 30,
    // 把闸开大只是把排队换成撞供应商。真要关它得给排队加截止、或把 stale 的起点挪到闸后,
    // 两者都动别的规格线。处置:登记在 PR #1332 描述「未做」栏,S5 裁是修还是续登。
    expect(worstQueueWaitMs({ WORKER_ROLE: "wait" }, PRE_FIX_IMAGE_POST_MS)).toBeLessThan(PRE_FIX_ALLOWANCE_MS);
  });

  it("已知缺口钉板:一个视频任务的闸位就吃光图片那条路的排队余量(先于本片存在)", () => {
    // 视频任务占的是**整条任务**的位(提交 + 轮询,`byteplus.ts` 的 `generateVideo` 在最外层
    // acquire),最长 60s + 15m —— 一格就大过 8m 余量。它不是本片引入的:修法前余量 12m,
    // 同样小于它(下面第二条断言)。同上登记在 PR #1332「未做」栏。
    expect(VIDEO_POLL_TIMEOUT_MS).toBeGreaterThan(GEN_QUEUE_ALLOWANCE_MS);
    expect(VIDEO_POLL_TIMEOUT_MS).toBeGreaterThan(
      GEN_STALE_MS - (PRE_FIX_IMAGE_POST_MS + ARK_DOWNLOAD_TIMEOUT_MS),
    );
  });

  it("四个数字就是现行值(改任何一个都必须回到这里重新论证)", () => {
    expect(VIDEO_POLL_TIMEOUT_MS).toBe(15 * MINUTE);
    expect(GEN_STALE_MS).toBe(18 * MINUTE);
    expect(genExpireMs).toBe(20 * MINUTE);
    expect(GEN_REAP_MS).toBe(25 * MINUTE);
    expect(GEN_QUEUED_REAP_MS).toBe(25 * MINUTE);
  });

  // #782 r13 —— 第五个数字,而且它**不属于**上面那条链。
  it("DONE-零产出的宽限期是它自己的一条尺度,不受队列过期约束", () => {
    // 上面每个窗口都在保护「一次可能还在跑的付费调用」,所以都必须站在队列过期之后。这一个
    // 保护的东西不同:它盯的是一行**已经终态**的作业(generationIds 与结算同一笔事务、写在
    // DONE 之前,所以 DONE 的那一刻产出就是最终值)。零本来就正确;十分钟只是不让巡检成为
    // 第一个注意到一行的人,同时让一个真坏掉的行在商家的一次落座里就走到救援入口。
    expect(GEN_DONE_EMPTY_GRACE_MS).toBe(10 * MINUTE);
    expect(GEN_DONE_EMPTY_GRACE_MS).toBeLessThan(GEN_REAP_MS);
  });
});

describe("refgen 时钟链跟 gen 同构(两条队列打同一个供应商)", () => {
  it("stale < 过期 < 清道夫", () => {
    expect(REFGEN_STALE_MS).toBeLessThan(refgenExpireMs);
    expect(REFGEN_REAP_MS).toBeGreaterThan(refgenExpireMs);
    expect(REFGEN_QUEUED_REAP_MS).toBeGreaterThan(refgenExpireMs);
  });

  it("跟 gen 的窗口一致 —— 两条队列的「worker 崩了」是同一个意思", () => {
    expect(REFGEN_STALE_MS).toBe(GEN_STALE_MS);
    expect(REFGEN_REAP_MS).toBe(GEN_REAP_MS);
    expect(REFGEN_QUEUED_REAP_MS).toBe(GEN_QUEUED_REAP_MS);
  });
});

describe("另外两条等待型队列的时钟也在并发下成立", () => {
  it("publish:执行硬超时 < 队列过期(handler 先被掐死,pg-boss 才会重投)", () => {
    expect(PUBLISH_EXECUTION_DEADLINE_MS).toBeLessThan(PUBLISH_QUEUE_POLICY.expireInSeconds * 1000);
  });

  it("research:retryLimit 0 —— 并发不会把一次失败的花钱运行变成两次", () => {
    // Concurrency multiplies deliveries; retryLimit:0 plus the QUEUED→RUNNING CAS is what keeps
    // a research spend at exactly one attempt no matter how many pollers see the message.
    expect(RESEARCH_QUEUE_POLICY.retryLimit).toBe(0);
  });
});
