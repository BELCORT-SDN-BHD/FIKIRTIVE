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
import { GEN_QUEUE_POLICY, REFGEN_QUEUE_POLICY, RESEARCH_QUEUE_POLICY, PUBLISH_QUEUE_POLICY, PUBLISH_EXECUTION_DEADLINE_MS } from "@fikirtive/core";
import { VIDEO_POLL_TIMEOUT_MS } from "@fikirtive/generation";
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
