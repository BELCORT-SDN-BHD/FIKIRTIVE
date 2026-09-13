/**
 * clock-invariants.test.ts — #796 / #760 第 2 项:「三个时钟按并发假设重算」,#1435(零排队,
 * QUEUE-A6,docs/specs/zero-queue.md)在此基础上把「在飞视频」的判定锚点从 claim 时长换成
 * 提交时刻。
 *
 * 为什么这件事值一整个测试文件:清道夫的阈值算错,后果不是慢,是**误杀在跑的付费任务** ——
 * 商家看到失败、拿到退款,而供应商那边照样出片照样计费。烧的是毛利,丢的是信任。
 * 这些数字散在三个文件里(图片 POST 超时在 packages/generation、队列过期在 packages/core、
 * 清道夫窗口在 apps/worker),谁都能单独改一个,而这条链条只要一处失序就出上面那个后果。
 *
 * 图片链(从内到外,每一层都必须严格大于上一层,#1386 之后的现行值,#1435 未改这四个数字):
 *
 *   图片 POST 超时 5m  <  stale 判定 35m  <  队列过期 40m  <  清道夫窗口 45m
 *
 *   - POST 超时 < stale:一次**正常**的慢出图绝不能被当成「卡死」。
 *   - stale < 队列过期:重投一定意味着过期已发生,所以重投时用 stale 判定是安全的。
 *   - 队列过期 < 清道夫:清道夫跑在自己的定时器上,它必须等到 pg-boss 自己都放弃之后才动手,
 *     否则它会把一个 pg-boss 仍会送达的付费任务判死 + 退款。
 *
 * 视频链(#1435 新增,QUEUE-A6 的核心改写)—— **不再是**上面那条链的一部分:
 *
 *   一次提交/一次查询状态只占位 ARK_CONTROL_TIMEOUT_MS(60s,量级同图片 POST,还更短);
 *   查到 succeeded 那一次投递另需下载片子字节(ARK_DOWNLOAD_TIMEOUT_MS,5m,判官初审
 *   P3-10 —— 与图片链「渲染 POST + 下载」同构地算进去,不给视频那一半漏记这一段),合计
 *   一次投递最长约 6m
 *     <  商家可见的等待上限 VIDEO_MERCHANT_WAIT_MS(15m,判官初审 P1-3,锚在提交时刻)
 *     <  清道夫的消息丢失兜底 VIDEO_SUBMISSION_ABANDON_MS(65m,同样锚在提交时刻)
 *
 * 旧语义(#1386 及更早)把视频的「提交 + 原地轮询到终态」当成一次不可分割的付费调用,量出
 * 「最长 60s + 15m ≈ 16m」,逼着整条图片链的余量为它留够空间——这正是 #1388 判官点名的
 * 跨队列缺口(见下方两个「#1388」describe block,本次由「已知缺口,未装得下」改判「缺口已
 * 消除」)。#1435 把提交与每一次轮询拆成互相独立的短命 pg-boss 投递(apps/worker/src/jobs/
 * gen.ts 的 resume-poll 分支),在飞视频不再持有 gen 施工位,两次投递之间也不再连续占着
 * providerRequestGate——它的「是否卡死」判定因此换了把尺子,而且是**两把**不同分工的尺子
 * (判官初审 P1-3 拆开,首版实现误合成了一把):
 *
 *   - `VIDEO_MERCHANT_WAIT_MS`(15m)—— resume-poll 主路自己用的商家口径:消息正常按计划
 *     送达、真的在轮询,只是视频还没渲染完,过了 15m 就诚实判「结果不明,按已计费处理」
 *     终态退款,绝不让这一单活到引擎自己约 60m 的终止钟去踩一条早就该判官核实过、实际未
 *     实测的"expired 官方口径 \$0"暗路(那条暗路一旦真被踩到,PLAIN 错误 ⇒ requeue ⇒
 *     下一次投递读不到标记 ⇒ 当成全新提交重来一次,`GEN_RETRY_LIMIT` 预算内最多能让同一单
 *     真的重新付费提交 3 次——判官实测)。
 *   - `VIDEO_SUBMISSION_ABANDON_MS`(65m)—— **只**留给 `isGenRowStale`(清道夫独立扫描)
 *     当兜底,管的是消息**彻底丢失**(resume-poll 那条主路因此从未有机会运行、判断过 15m)
 *     那种情形。两把尺子服务完全不同的失效模式,谁都不覆盖谁——完整分工账见
 *     packages/generation/src/byteplus.ts 里 `VIDEO_MERCHANT_WAIT_MS` 自己的文档注释。
 *
 * 一个带在飞任务标记的视频行,在 gen.ts 的 resume-poll 检查点(`videoProviderTask` 短路
 * 分支)会排在 QUEUED→GENERATING 认领与 GEN_STALE_MS 判定**之前**,所以 GEN_STALE_MS 永远
 * 不会量到同一次投递。
 *
 * 并发假设(#796 的定案)与 #1386 的历史推导(15/18/20/25 → 15/35/40/45)保持不变,#1435
 * 未动 GEN_STALE_MS / genExpireMs / GEN_REAP_MS / GEN_QUEUED_REAP_MS 这四个数字本身——
 * 改的是「视频是否受这条链约束」这件事,不是链条的刻度。
 */
import { describe, it, expect } from "vitest";
import { GEN_QUEUE_POLICY, REFGEN_QUEUE_POLICY, RESEARCH_QUEUE_POLICY, PUBLISH_QUEUE_POLICY, PUBLISH_EXECUTION_DEADLINE_MS, GEN_QUEUE, REFGEN_QUEUE, UNDERSTAND_QUEUE, MAX_GEN_COUNT, MAX_REFGEN_COUNT } from "@fikirtive/core";
import { VIDEO_SUBMISSION_ABANDON_MS, VIDEO_MERCHANT_WAIT_MS, ARK_CONTROL_TIMEOUT_MS, ARK_IMAGE_TIMEOUT_MS, ARK_DOWNLOAD_TIMEOUT_MS, PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT, PROVIDER_MAX_CONCURRENT_REQUESTS_ENV, providerRequestLimit } from "@fikirtive/generation";
import { workerPlan } from "../plan.js";
import { GEN_STALE_MS, GEN_REAP_MS, GEN_QUEUED_REAP_MS, GEN_DONE_EMPTY_GRACE_MS } from "./gen.js";
import { REFGEN_STALE_MS, REFGEN_REAP_MS, REFGEN_QUEUED_REAP_MS } from "./refgen.js";

const MINUTE = 60_000;
const genExpireMs = GEN_QUEUE_POLICY.expireInSeconds * 1000;
const refgenExpireMs = REFGEN_QUEUE_POLICY.expireInSeconds * 1000;

describe("gen 时钟链:图片 POST 超时 < stale < 队列过期 < 清道夫(#1435 后视频不再是这条链的一部分,见下方独立 describe)", () => {
  it("QUEUE-A6 —— 视频的『提交/轮询』本身只占位 ARK_CONTROL_TIMEOUT_MS,量级同图片 POST 还更短,不会撑爆 stale 判定的余量", () => {
    // #1435 前:一次视频调用的「占位时长」是旧账的 VIDEO_POLL_TIMEOUT_MS(15m,原地轮询到
    // 终态),逼近甚至可能撞穿 stale 判定,是 #1388 判官点名的跨队列缺口的根因。#1435 后:
    // 提交与每一次轮询都是独立的短调用(packages/generation/src/byteplus.ts 的 submitVideo /
    // pollVideo,各自 gate.run(() => fetch(...)) 一次就返回),各自只占 ARK_CONTROL_TIMEOUT_MS
    // (60s)——量级不再是图片 POST 的 3 倍,而是比它更短。
    expect(ARK_CONTROL_TIMEOUT_MS).toBe(60_000);
    expect(ARK_CONTROL_TIMEOUT_MS).toBeLessThan(ARK_IMAGE_TIMEOUT_MS);
    expect(ARK_CONTROL_TIMEOUT_MS).toBeLessThan(GEN_STALE_MS);

    // 判官初审 P3-10 —— 上面三条量的只是**状态查询本身**(poll 的那次 GET),不是一次
    // `pollVideo` 调用真实可能花的全部时间。查到 succeeded 的那一次,`pollVideo` 自己还要
    // 再下载一次片子字节(`packages/generation/src/byteplus.ts`,与图片下载共用同一把
    // `ARK_DOWNLOAD_TIMEOUT_MS`),这一步不在闸门里、也不算「查询」,但它是这**一次投递**
    // 真实占用的总时长的一部分——与图片链「渲染 POST + 下载」两段相加的写法必须同构,不能
    // 只给视频那一半留个更好看的数字。
    const VIDEO_SUCCEEDED_DELIVERY_MS = ARK_CONTROL_TIMEOUT_MS + ARK_DOWNLOAD_TIMEOUT_MS; // ≈ 60s + 5m ≈ 6m
    expect(VIDEO_SUCCEEDED_DELIVERY_MS).toBe(6 * MINUTE);
    // 即使把下载这一段也算进去,一次「查到 succeeded」的投递依旧远小于 stale 判定——这条
    // 视频链从不需要为它单独核算余量的结论没有变,只是现在核算时诚实地把下载算了进去。
    expect(VIDEO_SUCCEEDED_DELIVERY_MS).toBeLessThan(GEN_STALE_MS);
  });

  it("QUEUE-A6 —— 在飞视频的『等太久』判定换了锚点(量提交时刻,不是 claim 时刻),而且判官初审 P1-3 把它拆成两把各管各的尺子", () => {
    // 尺子①(VIDEO_MERCHANT_WAIT_MS,15m)—— resume-poll 主路自己的商家口径,#1435 首版
    // 实现里被误合成了 65m 那一把,判官初审 P1-3 拆开。它必须严格小于②,理由直接写在两把
    // 尺子的名字里:必须先于「消息真的丢了才需要清道夫兜底」这件事发生,商家才不会在一条
    // **仍在正常轮询**的作业上等超过产品口径。
    expect(VIDEO_MERCHANT_WAIT_MS).toBe(15 * MINUTE);
    expect(VIDEO_MERCHANT_WAIT_MS).toBeLessThan(VIDEO_SUBMISSION_ABANDON_MS);
    // 尺子②(VIDEO_SUBMISSION_ABANDON_MS,65m)—— 刻意比 GEN_STALE_MS 宽(65m > 35m):
    // 它保护的是「健康视频被反复轮询很多轮,只是消息按计划送达」,不是「claim 后多久没
    // 消息」;`isGenRowStale` 用它当**清道夫独立扫描**的消息丢失兜底,与①服务不同场景,
    // 两把永不会量到同一次投递,因为 gen.ts 的 resume-poll 检查点(job.videoOptions 里有
    // 在飞任务标记就短路)排在 QUEUED→GENERATING 认领与 GEN_STALE_MS 判定之前
    // (apps/worker/src/jobs/gen.ts,`videoProviderTask` 短路分支)。
    expect(VIDEO_SUBMISSION_ABANDON_MS).toBe(65 * MINUTE);
    expect(VIDEO_SUBMISSION_ABANDON_MS).toBeGreaterThan(GEN_STALE_MS);
  });

  it("stale 判定在队列过期之前 —— 重投时用它才成立", () => {
    expect(GEN_STALE_MS).toBeLessThan(genExpireMs);
  });

  it("清道夫窗口在队列过期之后 —— 绝不跟 pg-boss 抢一条还活着的付费任务", () => {
    expect(GEN_REAP_MS).toBeGreaterThan(genExpireMs);
    expect(GEN_QUEUED_REAP_MS).toBeGreaterThan(genExpireMs);
  });

  it("队列过期本身覆盖得住最慢的一次合法投递", () => {
    // #1435 前这一条量的是视频那次「提交+原地轮询到终态」的单次调用(15m),余量仅 5m 安全
    // 边际,是最紧的一环。#1435 后最长的单次投递换成了图片路的 POST+下载(下方
    // IMAGE_ATTEMPT_MS),视频的提交/轮询单次投递反而短得多——下面同时钉两条,证明两条路
    // 各自都留有远比过去宽裕的安全边际,而不是曾经那种「刚好够,几乎没有余量」的状态。
    expect(genExpireMs).toBeGreaterThan(ARK_IMAGE_TIMEOUT_MS + ARK_DOWNLOAD_TIMEOUT_MS);
    expect(genExpireMs - (ARK_IMAGE_TIMEOUT_MS + ARK_DOWNLOAD_TIMEOUT_MS)).toBe(30 * MINUTE);
    expect(genExpireMs).toBeGreaterThan(ARK_CONTROL_TIMEOUT_MS);
    expect(genExpireMs - ARK_CONTROL_TIMEOUT_MS).toBe(39 * MINUTE);
  });

  // ── creation §5 :177 —— 图片那条路也有它自己的第一环,而且此前**没人守** ──────────
  //
  // 图片是同步渲染:POST 的时长就是出图时长。这一环同样必须落在 stale 之前,否则一次正常
  // 的慢出图会被判成「卡死」并误杀退款。
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
  // 板);#1435 之前唯一还没收口的一档是「视频任务连续占住闸位挤占跨队列预算」,见下方两个
  // 「#1388」describe block —— 现在也收口了。
  const IMAGE_ATTEMPT_MS = ARK_IMAGE_TIMEOUT_MS + ARK_DOWNLOAD_TIMEOUT_MS;
  const GEN_QUEUE_ALLOWANCE_MS = GEN_STALE_MS - IMAGE_ATTEMPT_MS;

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

  it("#1386 修复钉板:WORKER_ROLE=wait 默认并发、全图片负载下的最坏排队现在留在窗口内", () => {
    // PR #1332 时期这一格是「已知缺口」,#961 2026-09-12 核证过它会真的发生:`wait` 角色要人
    // 显式写 `WORKER_ROLE=wait` 才生效(`plan.ts`,判官 r1 P0 定案),默认部署不走它;一旦设
    // 了,闸前需求 30、默认闸位 6 格 ⇒ 最坏要清 4 轮 = 20m 排队,曾经大过旧余量 8m —— 一次
    // **健康**的慢出图(排队 20m + 出图一轮 10m = 30m,正是 #961 说的「排队积压 20–30 分钟」)
    // 会撞穿旧 stale 18m,被判「卡死」失败 + 退款,商家没拿到东西,厂商照样收钱。
    //
    // 判官 P2-2(PR #1410 合并前)诚实化过:这条测试题目曾经写「健康慢任务不被误判失败退款」,
    // 读起来像是无条件保证,但下面 `worstQueueWaitMs(waitEnv, ARK_IMAGE_TIMEOUT_MS)` 把「一轮」
    // 按图片超时 5 分钟算,当时隐含假设是闸前排的全是图片任务——同一个 `providerRequestGate`
    // (进程内唯一,gen/refgen/understand 共用)的格子那时也会被**整条视频任务**连续占住
    // (旧账:提交 60s + 轮询 15m ≈ 16m),让「一轮」实际变成 16m 而不是 5m,是当时留白的
    // 残余缺口(#1388,见下方两个 describe block)。#1435 把视频拆成互相独立的短调用后,视频
    // 占住一轮的时长也只是 ARK_CONTROL_TIMEOUT_MS(60s,比图片的 5m 还短)——下面
    // `worstQueueWaitMs(waitEnv, ARK_IMAGE_TIMEOUT_MS)` 用图片超时当「一轮」的上界,现在对
    // 任何一轮(不论排的是图片、refgen、understand 还是视频)都成立,不再需要「假设闸前排的
    // 全是图片任务」这条隐含前提——这份无条件保证下面两个「#1388」describe block 会专门
    // 证明。
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

  it("QUEUE-A6 —— 缺口已消除:视频任务不再整段占着闸位,单次提交/轮询占位量级同图片 POST 而非旧账的 16m", () => {
    // #1435 前:一个视频任务的闸位时长是「提交 60s + 轮询到终态最长 15m」≈ 16m,整段不释放,
    // 是这条已知缺口的根因(先于 #1386 存在,PR #1332 登记「未做」;#1386 的加宽只顺带盖住
    // 了「单个视频任务」这一最小反例,没有解决它连续占位的根本问题)。#1435 后:submitVideo /
    // pollVideo(packages/generation/src/byteplus.ts)各自只在自己那次 fetch 期间持有
    // providerRequestGate(packages/generation/src/provider-concurrency.ts),提交与每一次
    // 轮询之间完全放手(两次调用之间相隔 GEN_VIDEO_POLL_DELAY_SECONDS=10s 的重排延迟,
    // apps/worker/src/jobs/gen.ts)——这段间隔里视频任务对闸位和 gen 施工位的占用都是零,
    // 由 packages/generation/src/provider-concurrency.test.ts 的「两次调用之间完全不占位」
    // 一组测试直接证明。
    expect(ARK_CONTROL_TIMEOUT_MS).toBeLessThanOrEqual(ARK_IMAGE_TIMEOUT_MS);
    expect(ARK_CONTROL_TIMEOUT_MS).toBeLessThan(GEN_QUEUE_ALLOWANCE_MS);
    // 用 worstQueueWaitMs 同一条数学验证:哪怕闸前排的整整齐齐全是视频请求(纯视频负载,一轮
    // 按 ARK_CONTROL_TIMEOUT_MS 算而不是 ARK_IMAGE_TIMEOUT_MS),默认角色 11 个请求、闸位 6
    // 的最坏排队反而比全图片负载更短,同样装得进 25m 余量。
    const worstVideoRoundWait = worstQueueWaitMs({}, ARK_CONTROL_TIMEOUT_MS);
    expect(worstVideoRoundWait).toBe(ARK_CONTROL_TIMEOUT_MS);
    expect(worstVideoRoundWait).toBeLessThan(GEN_QUEUE_ALLOWANCE_MS);
  });

  it("五个数字就是现行值(改任何一个都必须回到这里重新论证)", () => {
    expect(VIDEO_SUBMISSION_ABANDON_MS).toBe(65 * MINUTE);
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

describe("零排队(spec creation-engine.md §5 2026-09-12 场⑦)——②③仍不在本票范围,①④⑤已交付", () => {
  // 登记行完整验收句(逐字):「商家 A 连发 4 条长视频后，商家 B 的短任务立即开跑不等队」。
  // #1435(QUEUE-A1,docs/specs/zero-queue.md)交付的正是这句验收句本身——见
  // apps/worker/src/jobs/gen-fairness-claim-db.test.ts / gen-video-*-db.test.ts 的真库集成
  // 测试(验收句逐字进测试名)。①(#1386,本文件的图片链数字)与④(#1430 的
  // `shouldDeferGenClaimForFairness` 每商家最多 N-1 槽兜底)先前已交付。②开第二台 worker 与
  // ③等待型并发开高仍不在本票范围:下面两组测试证明③在 gate=6 不变时无法安全推进——它们
  // 与「进第三轮走查」一起,是留给 Founder 的范围决定,不是本票能替他拍板的实现细节。
  it.todo("商家 A 连发 4 条长视频后，商家 B 的短任务立即开跑不等队（②③落地 + 第三轮走查，非本票范围——QUEUE-A1 本身已在真库集成测试兑现）");
});

describe("#1388 判官 BLOCK 安全定向① —— ③等待型并发开高的算术:gate=6 不变时,N 无法超过今天的 4", () => {
  // 「闸前需求 = N × MAX_GEN_COUNT + REFGEN_CONCURRENCY × MAX_REFGEN_COUNT + UNDERSTAND_CONCURRENCY」
  // 与上面「WORKER_ROLE=wait 默认并发」那组用的是同一条公式(worstQueueWaitMs 的推导),只是把
  // N 当自变量重算,而不是只验证今天的 4。REFGEN(2)与 UNDERSTAND(2)保持今天的默认值不变——
  // 抬这两个不在本票范围,也不是「等待型并发开高」字面指的那件事。
  //
  // 判官复核回炉 P3-d —— 下面「N≤4」这条结论只是**全图片最坏扇出**下的上限,不要读成不分
  // 负载构成的绝对天花板:公式按 `N × MAX_GEN_COUNT` 展开,是因为图片任务一个 GenJob 会在
  // 短时间里连续发起多次请求(MAX_GEN_COUNT 张一组),每张都要单独抢一次闸;纯视频负载不是
  // 这样——一个视频 GenJob 全程只发起 1 个瞬时请求(#1435 后:提交或某一次轮询,各自只占
  // ARK_CONTROL_TIMEOUT_MS 就放手,不是整段占位)。若 gen 的 N 个槽全是纯视频,闸前需求按
  // 「1 请求/槽」算是 `demand = N + 2×MAX_REFGEN_COUNT + 2`:N=5 时 demand=19,
  // `rounds = ceil(19/6)-1 = 3`,`wait = 3×5m = 15m`,`total = 15m+10m = 25m < 35m`
  // ——N=5 在纯视频负载下反而装得下。「N≤4」是这一组测试专门校验的全图片上界,不是不论
  // 负载构成都成立的结论;换算清楚见上面 §5 的登记与 PR 描述。
  const genExpireMsHere = GEN_QUEUE_POLICY.expireInSeconds * 1000;
  const worstQueueWaitAtN = (n: number, gate: number): number => {
    const demand = n * MAX_GEN_COUNT + 2 * MAX_REFGEN_COUNT + 2;
    return (Math.ceil(demand / gate) - 1) * ARK_IMAGE_TIMEOUT_MS;
  };
  const IMAGE_ATTEMPT_MS_HERE = ARK_IMAGE_TIMEOUT_MS + ARK_DOWNLOAD_TIMEOUT_MS;

  it("gate=6(单副本默认)固定:N=4(今天的值)是这条不等式仍然装得下的上限", () => {
    const wait = worstQueueWaitAtN(4, PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT);
    expect(wait).toBe(20 * MINUTE);
    expect(wait + IMAGE_ATTEMPT_MS_HERE).toBeLessThan(GEN_STALE_MS); // 30m < 35m
  });

  it("gate=6 固定:N=5 已经撞穿(边界即撞穿,不必抬到很高才出事)", () => {
    const wait = worstQueueWaitAtN(5, PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT);
    const total = wait + IMAGE_ATTEMPT_MS_HERE;
    expect(total).toBe(35 * MINUTE);
    expect(total).not.toBeLessThan(GEN_STALE_MS); // 35m,严格小于判定下第一个不成立的整数 N
  });

  it("gate=6 固定:N=6 撞得更狠,连队列过期窗口都保不住", () => {
    const wait = worstQueueWaitAtN(6, PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT);
    const total = wait + IMAGE_ATTEMPT_MS_HERE;
    expect(total).toBeGreaterThan(GEN_STALE_MS);
    expect(total).toBeGreaterThanOrEqual(genExpireMsHere);
  });

  it("若同时把 gate 从 6 调宽到 8(账户硬顶 10、usable 8,另一个 Founder 决定,本票未做):N 最多能到 6", () => {
    const wait6 = worstQueueWaitAtN(6, 8);
    expect(wait6 + IMAGE_ATTEMPT_MS_HERE).toBeLessThan(GEN_STALE_MS); // 30m < 35m
    const wait7 = worstQueueWaitAtN(7, 8);
    expect(wait7 + IMAGE_ATTEMPT_MS_HERE).not.toBeLessThan(GEN_STALE_MS); // N=7 在 gate=8 下同样撞穿
  });

  it("结论:本票不改 WAIT_DEFAULTS[GEN_QUEUE](仍是 4)——任何 N>4 在 gate=6 下都撞穿,这是范围题", () => {
    // 把这条测试的 GEN_STALE_MS 换成更宽的数字会让上面几条的撞穿断言失真——那正是「变异测试」
    // 要的效果:改宽窗口,这条测试第一个报警,提醒回来这里重新论证 N 的上限,而不是安安静静
    // 继续绿。三条路都不是这张票能替 Founder 拍板的实现细节:调宽 gate、再放宽 stale/过期/
    // 清道夫窗口(#1386 已经放宽过一轮)、或调低 REFGEN/UNDERSTAND 的默认并发让出闸前预算。
    expect(GEN_STALE_MS).toBe(35 * MINUTE);
    expect(PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT).toBe(6);
  });
});

describe("QUEUE-A6 —— #1388 判官 BLOCK 安全定向①(第二问)之缺口现已消除:视频不再连续占住闸位", () => {
  // 上面那组只查了「gen 全是图片」的最坏情况(demand 按 MAX_GEN_COUNT 扇出算)。#1388 判官
  // 点名的第二问是另一个方向:gen 的槽位如果被**视频**占住,留给 refgen/understand 的闸位
  // 会不会变少、排更久?#1435 前这道缺口是真的——一个视频任务占住闸位的时长是「提交 60s +
  // 轮询 15m ≈ 16m」,不是 5m 一轮,4 个 gen 槽位全被视频占住时,gate=6 只剩 2 格留给
  // refgen(demand 12)+ understand(demand 2),算出的健康排队能压到 40 分钟,撞穿 GEN_STALE_MS
  // (35m)、与队列过期(40m)打平——这正是本票验收句(商家 A 连发 4 条长视频)会真的触发的
  // 场景,今天的 WAIT_DEFAULTS[GEN_QUEUE]=4 不用抬就能撞上。
  //
  // #1435 把视频拆成互相独立的短调用(提交/每次轮询各自只占 ARK_CONTROL_TIMEOUT_MS≈60s,
  // 两次调用之间完全放手,见 packages/generation/src/provider-concurrency.test.ts 的「两次
  // 调用之间完全不占位」测试),这道缺口的前提(视频连续占住 K 个闸位达 16m)不再成立——下面
  // 用同一条历史公式重算,证明商家真连发 4 条长视频时,refgen/understand 面对的『被视频占用
  // 的一轮』只是 60s 级,不是 16m 级,GEN_STALE_MS 的余量绰绰有余。
  it("QUEUE-A6 —— 4 个 gen 槽位全跑视频时,refgen/understand 不再被『永久扣掉 K 格』,最坏排队从旧账 40m 收窄到 20m,舒舒服服装在 GEN_STALE_MS 内", () => {
    const K = 4; // WAIT_DEFAULTS[GEN_QUEUE]=4,最坏 4 个槽位全是视频(验收句原话:商家 A 连发 4 条长视频)
    const gate = PROVIDER_MAX_CONCURRENT_REQUESTS_DEFAULT; // 6,单副本默认
    const otherDemand = (4 - K) * MAX_GEN_COUNT + 2 * MAX_REFGEN_COUNT + 2; // gen 的图片份额归零,只剩 refgen+understand
    expect(otherDemand).toBe(14);

    // #1435 前的旧账:视频任务提交后不释放闸位,整个占位期都要从 gate 里永久减去
    // (remainingGate = gate - K)——历史存档,证明这道缺口过去确实存在,不是编出来的。
    const oldRemainingGate = gate - K;
    const oldRounds = Math.ceil(otherDemand / oldRemainingGate) - 1;
    const oldWorstTotal = oldRounds * ARK_IMAGE_TIMEOUT_MS + ARK_IMAGE_TIMEOUT_MS + ARK_DOWNLOAD_TIMEOUT_MS;
    expect(oldRemainingGate).toBe(2);
    expect(oldWorstTotal).toBe(40 * MINUTE);
    expect(oldWorstTotal).not.toBeLessThan(GEN_STALE_MS); // 旧账确实撞穿 —— 缺口是真的

    // #1435 后:视频只在真正发起那次 fetch 期间占位,两次轮询之间(GEN_VIDEO_POLL_DELAY_SECONDS
    // =10s 的重排间隔)彻底放手——refgen/understand 面对的是满员的 6 格闸位,不再有「被视频
    // 永久占住 K 格」这件事。一轮的时长上界仍按图片 POST 算(refgen/understand 自己的请求
    // 本来就是图片量级);哪怕恰好轮到视频的那次短暂占位,ARK_CONTROL_TIMEOUT_MS <
    // ARK_IMAGE_TIMEOUT_MS,用图片的 5m 当上界依旧安全,不需要为视频单独放宽这条尺子。
    const remainingGate = gate;
    const rounds = Math.ceil(otherDemand / remainingGate) - 1;
    const worstWait = rounds * ARK_IMAGE_TIMEOUT_MS;
    const worstTotal = worstWait + ARK_IMAGE_TIMEOUT_MS + ARK_DOWNLOAD_TIMEOUT_MS;
    expect(remainingGate).toBe(6);
    expect(rounds).toBe(2);
    expect(worstWait).toBe(10 * MINUTE);
    expect(worstTotal).toBe(20 * MINUTE);

    // 缺口已消除:旧账 40m 打平队列过期,新账 20m 舒舒服服装在 stale 判定(35m)与队列过期
    // (40m)之内——不再需要判官登记的「未装得下」。
    expect(worstTotal).toBeLessThan(GEN_STALE_MS);
    expect(worstTotal).toBeLessThan(genExpireMs);
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
