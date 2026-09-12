/**
 * clock-invariants.test.ts — #796 / #760 第 2 项:「三个时钟按并发假设重算」。
 *
 * 为什么这件事值一整个测试文件:清道夫的阈值算错,后果不是慢,是**误杀在跑的付费任务** ——
 * 商家看到失败、拿到退款,而供应商那边照样出片照样计费。烧的是毛利,丢的是信任。
 * 这些数字散在三个文件里(供应商轮询超时在 packages/generation、队列过期在 packages/core、
 * 清道夫窗口在 apps/worker),谁都能单独改一个,而这条链条只要一处失序就出上面那个后果。
 *
 * 链条(从内到外,每一层都必须严格大于上一层,#1386 之后的现行值):
 *
 *   供应商轮询超时 15m  <  stale 判定 35m  <  队列过期 40m  <  清道夫窗口 45m
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
 *
 * #1386(零排队①,spec creation-engine.md §5 2026-09-12 场⑦,#961 2026-09-12 核证)——
 * 上面四个数字从 15/18/20/25 改到 15/35/40/45。根因:「一个任务的在途时长」这句话本身没错,
 * 但它量的是 `startedAt`(claim 那一刻)到终态,而**付费 POST 真正开始的那一刻**还要先排
 * `providerRequestGate`(@fikirtive/generation 的进程内信号量,gen/refgen/understand 共用)。
 * `WORKER_ROLE=wait` 的并发默认值一旦生效(apps/worker/src/plan.ts WAIT_DEFAULTS),排这道闸
 * 最坏能排到 20 分钟(下面 `worstQueueWaitMs` 的原班推导),而旧的 18m stale 线只留了 8m 余量
 * ——一次**健康**的慢任务(排队 20m + 一轮出图 10m = 30m)会被判「卡死」失败 + 退款,商家没
 * 拿到东西,厂商照样收钱。本票的语义修复:排队等待时间不算「卡死」,只有真正开始执行后的
 * 停滞才算——落地成「整条链留够合法排队的余量,而不是把 claim 之后的排队一律算进卡死」。
 * 35/40/45 由 `worstQueueWaitMs` 现读的最坏配置(WORKER_ROLE=wait、默认闸位 6)倒推,带 5m
 * 安全边际,不是拍脑袋的整数——下面「#1386 修复钉板」两条测试把这句话变成断言。
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
  // 但「渲染 5m + 下载 5m < 18m(当时的 stale)」**不是全部账**(判官 P2 点名的漏项)。stale
  // 量的起点是 `startedAt` —— QUEUED→GENERATING 那一刻写下的(本目录 `gen.ts` 的 claim),而
  // 付费 POST 在那之后还要先在 `providerRequestGate`(进程内唯一,默认 6 格,gen / refgen /
  // understand 共用同一个账户额度)**排队**。排队时间落在被量的窗口**里面**,所以真正的账是:
  //
  //     排队 + 渲染 5m + 下载 5m  <  stale   ⇒   留给排队的余量 = stale − 10m
  //
  // 当时(PR #1332)把图片 POST 的占位从 60s 抬到 5m,余量从 12m 收窄到 8m,且**一轮排队的
  // 价钱也从 60s 变成了 5m**——「够不够」不能只答「够一轮」,要按最坏排几轮算,而轮数由这个
  // 进程能同时推到闸前多少个请求决定:
  //
  //     闸前需求 = 任务槽位 × 每个任务的付费请求扇出(一张图 = 一个付费 POST)
  //     最坏排队 = (ceil(需求 / 闸位) - 1) 轮 × 一轮最慢 5m
  //
  // 三个数都从真源现读:槽位 `workerPlan(env)`、扇出 `MAX_GEN_COUNT` / `MAX_REFGEN_COUNT`、
  // **闸位 `providerRequestLimit(env)`**。闸位尤其不能写死默认 6 —— 运维手册要求多副本时自己再除
  // (`replicas × PROVIDER_MAX_CONCURRENT_REQUESTS ≤ 8`),而它正是决定答案的除数。
  //
  // #1386(零排队①)把 stale 从 18m 改到 35m,余量从 8m 改到 25m —— 下面几条钉的是:默认角色
  // 在单副本闸位(6)下装得下(不变式,一直成立);闸位降到 6 以下(手册允许的 2 副本 = 4 格)
  // 与 `WORKER_ROLE=wait` 这两个 PR #1332 时期的**已知缺口**,现在都装得下了(#1386 修复钉
  // 板);未覆盖的仍然只有「多个视频任务同时占着闸位」那一档(见下面那条已知缺口测试)。
  const IMAGE_ATTEMPT_MS = ARK_IMAGE_TIMEOUT_MS + ARK_DOWNLOAD_TIMEOUT_MS;
  const GEN_QUEUE_ALLOWANCE_MS = GEN_STALE_MS - IMAGE_ATTEMPT_MS;
  /** 修法(PR #1332)前图片 POST 占的那把尺(控制面 60s)。下面「视频占闸」测试仍用它算
   *  「一个视频任务是否单独就撞穿余量」,与 #1386 无关的历史常量。 */
  const PRE_FIX_IMAGE_POST_MS = 60_000;

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

  it("并发闸的排队时间也在被量的窗口里 —— 默认角色 + 单副本闸位最坏排一轮 5m,装得进 25m 余量(#1386)", () => {
    expect(IMAGE_ATTEMPT_MS).toBe(10 * MINUTE);
    expect(GEN_QUEUE_ALLOWANCE_MS).toBe(25 * MINUTE);
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

  it("#1386 修复钉板:闸位调到 6 以下(手册允许的 2 副本 = 4 格)默认角色现在装得下", () => {
    // PR #1332 时期这一格是「已知缺口」:运维手册明写多副本要自己再除
    // `replicas × PROVIDER_MAX_CONCURRENT_REQUESTS ≤ 8`(账户额度 10 减 2 的余量),
    // 2 副本 ⇒ 每副本 4 格,默认角色的 11 个请求要清 2 轮 = 10m,曾经大过旧余量 8m。
    // #1386 把 GEN_STALE_MS 从 18m 改到 35m(GEN_QUEUE_ALLOWANCE_MS 从 8m 改到 25m)之后,
    // 这 10m 排队舒舒服服地装得下 —— 这条测试把「缺口已收口」变成断言,不再只是登记。
    const twoReplicas = { [PROVIDER_MAX_CONCURRENT_REQUESTS_ENV]: "4" };
    expect(providerRequestLimit(twoReplicas)).toBe(4);
    expect(paidRequestDemand(twoReplicas)).toBe(MAX_GEN_COUNT + MAX_REFGEN_COUNT + 1);
    const wait = worstQueueWaitMs(twoReplicas, ARK_IMAGE_TIMEOUT_MS);
    expect(wait).toBe(2 * ARK_IMAGE_TIMEOUT_MS);
    expect(wait).toBeLessThan(GEN_QUEUE_ALLOWANCE_MS);
    expect(wait + IMAGE_ATTEMPT_MS).toBeLessThan(GEN_STALE_MS);

    // 边界钉死:手册允许的 2 副本(闸位 4)现在稳稳装得下,门槛比旧线(只有单副本闸位 6 才
    // 装得下)宽松了不少,但**不是无限宽容**——极端收窄(1 格)依旧撞穿,说明这是真的按最坏
    // 排队算出来的余量,不是把窗口开到没有意义的大。改宽 `ARK_IMAGE_TIMEOUT_MS` 或改窄
    // stale 会把这个门槛推移,那时必须回到这里重新论证。
    const fitsAt = (limit: number): boolean =>
      worstQueueWaitMs({ [PROVIDER_MAX_CONCURRENT_REQUESTS_ENV]: String(limit) }, ARK_IMAGE_TIMEOUT_MS) <
      GEN_QUEUE_ALLOWANCE_MS;
    expect(fitsAt(1)).toBe(false); // 闸位收到 1 格(远窄于手册允许的下限)依旧撞穿
    expect(fitsAt(2)).toBe(false); // 边界本身:2 格排队正好等于余量,`<` 不算过关
    expect([3, 4, 5, 6].map(fitsAt)).toEqual([true, true, true, true]); // 手册允许区间起(4 格)全部装得下
  });

  it("#1386 修复钉板:WORKER_ROLE=wait 默认并发、全图片负载下的最坏排队现在留在窗口内(不是「健康慢任务永不误判」的无条件保证——残余缺口见下方注释与 #1388)", () => {
    // PR #1332 时期这一格是「已知缺口」,#961 2026-09-12 核证过它会真的发生:`wait` 角色要人
    // 显式写 `WORKER_ROLE=wait` 才生效(`plan.ts`,判官 r1 P0 定案),默认部署不走它;一旦设
    // 了,闸前需求 30、默认闸位 6 格 ⇒ 最坏要清 4 轮 = 20m 排队,曾经大过旧余量 8m —— 一次
    // **健康**的慢出图(排队 20m + 出图一轮 10m = 30m,正是 #961 说的「排队积压 20–30 分钟」)
    // 会撞穿旧 stale 18m,被判「卡死」失败 + 退款,商家没拿到东西,厂商照样收钱。
    //
    // 判官 P2-2(PR #1410 合并前)诚实化——这条测试题目曾经写「健康慢任务不被误判失败退款」,
    // 读起来像是无条件保证,但下面 `worstQueueWaitMs(waitEnv, ARK_IMAGE_TIMEOUT_MS)` 把「一轮」
    // 按图片超时 5 分钟算,隐含假设是闸前排的全是图片任务。同一个 `providerRequestGate`(进程内
    // 唯一,gen/refgen/understand 共用)的格子实际上也会被**整条视频任务**占住(提交 60s + 轮询
    // 15m ≈ 16m,比图片一轮慢 3 倍多)或被 understand 占住(90s)。残余缺口的量级:若干格恰好
    // 被视频占满时,一轮的实际时长不是 5m 而是最多 ~16m —— 用同一条 `worstQueueWaitMs` 数学,
    // `WORKER_ROLE=wait` 默认闸前需求 30、闸位 6 ⇒ 最坏 4 轮,若这几轮里有格子被视频占着,
    // 4 × 16m = 64m 就可能撞穿本文件钉的 35/40/45 分钟窗口——35 分钟届时仍可能不够,且不能靠
    // 再加宽数字解决(视频任务本身就要 15m,加宽到覆盖多台视频同时占闸会让图片这条路的数字
    // 失去意义)。真正的修法是零排队③(issue #1388)「打开等待型并发时按视频侧并发上限重算」
    // ——在那张票落地前,`WORKER_ROLE=wait` 不会在生产开启(今天生产没有这个角色,#796/plan.ts
    // 默认 `all`),所以这条残余缺口目前不活;它活起来的前提就是 #1388 要解决的那件事。下面
    // 「已知缺口钉板」测试钉的是这一档里最小的反例(单个视频任务),不是多视频同时占闸的最坏情况
    // ——那个最坏情况仍然登记、未证明装得下,见 #1388。
    const waitEnv = { WORKER_ROLE: "wait" };
    const demand = paidRequestDemand(waitEnv);
    expect(demand).toBe(4 * MAX_GEN_COUNT + 2 * MAX_REFGEN_COUNT + 2);
    const worstWait = worstQueueWaitMs(waitEnv, ARK_IMAGE_TIMEOUT_MS);
    expect(worstWait).toBe(4 * ARK_IMAGE_TIMEOUT_MS); // 20m
    const worstHealthyTotal = worstWait + IMAGE_ATTEMPT_MS; // 20m 排队 + 10m 出图 = 30m
    expect(worstHealthyTotal).toBe(30 * MINUTE);

    // 排队等待时间不算「卡死」,只有真正开始执行后的停滞才算(#1386 语义修复,票面原话)——
    // 落地成:整条链必须留够这 30m,一次健康慢任务才不会被 stale / 清道夫误判失败退款。
    expect(worstHealthyTotal).toBeLessThan(GEN_STALE_MS);
    expect(worstHealthyTotal).toBeLessThan(genExpireMs);
    expect(worstHealthyTotal).toBeLessThan(GEN_REAP_MS);
    expect(worstWait).toBeLessThan(GEN_QUEUE_ALLOWANCE_MS);

    // 钉死修复本身:把这条测试的 GEN_STALE_MS 换回旧值(18m)会让上面的断言炸——这就是
    // 「变异测试」要的效果:改回旧数字,这条测试第一个报警,而不是安安静静地继续绿。
    expect(GEN_STALE_MS).toBeGreaterThan(18 * MINUTE);
  });

  it("已知缺口钉板:一个视频任务的闸位就吃光图片那条路的排队余量(先于 #1386 存在,#1386 的加宽顺带盖住了单个视频任务这一档)", () => {
    // 视频任务占的是**整条任务**的位(提交 + 轮询,`byteplus.ts` 的 `generateVideo` 在最外层
    // acquire),最长 60s + 15m。旧余量 8m 时,一个视频任务单独就大过它,是先于 #1386 存在的
    // 缺口(PR #1332 登记「未做」)。#1386 把余量从 8m 改到 25m 之后,单个视频任务(15m)现在
    // 装得下——但这条测试只钉「一个视频任务」这个最小反例,**没有**证明多个视频任务同时占
    // 着闸位、图片任务排在它们后面的最坏情况也装得下(那需要按视频侧自己的并发上限重算,
    // 属于零排队②③打开等待型并发时才会实际发生的配置,不在本票范围)——那一档仍然登记
    // 排队,S5 或②③施工时再补。
    expect(VIDEO_POLL_TIMEOUT_MS).toBeLessThan(GEN_QUEUE_ALLOWANCE_MS);
    expect(VIDEO_POLL_TIMEOUT_MS).toBeLessThan(
      GEN_STALE_MS - (PRE_FIX_IMAGE_POST_MS + ARK_DOWNLOAD_TIMEOUT_MS),
    );
  });

  it("五个数字就是现行值(改任何一个都必须回到这里重新论证)", () => {
    expect(VIDEO_POLL_TIMEOUT_MS).toBe(15 * MINUTE);
    expect(GEN_STALE_MS).toBe(35 * MINUTE);
    expect(genExpireMs).toBe(40 * MINUTE);
    expect(GEN_REAP_MS).toBe(45 * MINUTE);
    expect(GEN_QUEUED_REAP_MS).toBe(45 * MINUTE);
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

describe("零排队(spec creation-engine.md §5 2026-09-12 场⑦)——①之外的三项不在本票范围", () => {
  // 登记行完整验收句(逐字):「商家 A 连发 4 条长视频后，商家 B 的短任务立即开跑不等队」。
  // 覆盖的是②开第二台 worker ＋ ③等待型并发开高 ＋ ④降级为兜底规则叠加之后的整体感知 ——
  // 需要真的跑第二台 worker、真的把并发打开,单元测试代不了「进第三轮走查」。#1386(①)只
  // 负责让①③打开之后卡死判定不再误伤,已在上面用真实数字钉死;这里占位是为了不让
  // 完整验收句在测试树里彻底失踪。
  it.todo("商家 A 连发 4 条长视频后，商家 B 的短任务立即开跑不等队（需②③④落地 + 第三轮走查，非本票范围）");
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
