/**
 * stripe-reconcile.ts —— 钱路 M1-b ①:**Stripe 与账本的定时对账**。
 *
 * 补的是哪个洞。整条充值路只有一个入账点:Stripe 的 webhook 打进来,`grantCredits` 用
 * `stripe:<session.id>` 这把幂等键写下账本那一行。这条路正常时是精确一次的 —— 但它有一个
 * 前提:**webhook 得打得进来**。签名密钥换了、路由 502、Stripe 把重投用完了、事件在我们
 * 停机的那几分钟里过期,任何一种都会让「商家的钱进了 Stripe、我们库里一行痕迹都没有」变成
 * 一个**没有任何东西会发现**的状态:商家付了钱,额度不到账,系统上上下下没有一个地方在看。
 *
 * 2026-08-17 charles 的 RM25 就是这个形状,当时是靠人肉发现的。这个 sweeper 就是那双眼睛。
 *
 * 边界(重要):**只报不补账**。
 *   - 它一个字都不写钱:不 grant、不 reserve、不 settle、不 refund。账本上的每一行仍然只由
 *     既有的 webhook 路径产生。补账的正确做法是在 Stripe 后台重投那个事件,让**同一条**入账
 *     路径带着**同一把**幂等键跑一次 —— 于是「一次付款一行账」这句话仍然由数据库唯一约束
 *     保证,而不是由第二套补账逻辑保证。这个 sweeper 若自己发额度,就是在钱路上开出第二个
 *     权威,那正是 Money exactly-once 禁止的事。
 *   - 它读 Stripe,只读已支付的 checkout session;它读账本,只问「有没有这一行」。
 *
 * 时间窗与**两轮确认制**(判官 P2-1)。回看 48 小时,并跳过最近 30 分钟。但那 30 分钟只挡得住
 * 「webhook 慢了一会儿」,挡不住**延迟到账**:
 *
 *   Stripe 的 `created` 过滤器筛的是 **session 创建时间,不是付款时间**。FPX / GrabPay 这类
 *   延迟通知的付款方式(马来西亚的主流)会先以 `unpaid` 完成 session,几小时后才真正到账 ——
 *   webhook 那边正是靠 `checkout.session.async_payment_succeeded` 这一支接住它的
 *   (apps/web/app/api/stripe/webhook/route.ts)。一个三小时前创建、刚刚才 paid 的 session,
 *   早就滑出了 30 分钟宽限期,而它的 webhook 可能还在路上。只按一轮就报警,等于第一天就把
 *   一批**完全合法**的付款喊成「商家付了钱一分没拿到」—— 而被无视的告警等于没有告警,那正是
 *   这个 sweeper 自己要避免的东西。
 *
 *   所以:**首见缺口只记观察,不惊动 founder;下一轮(30 分钟后)仍是缺口才升级报警。**
 *   观察态就存在那一行审计里 —— 主键由 session id 派生,所以「见过没见过」由数据库唯一约束
 *   回答,而不是靠进程内存(worker 随时可能重启)。延迟到账的 session 在这两轮之间几乎必然
 *   落账,于是它安静地消失;真正的缺口只晚 30 分钟,而 48 小时的窗口远远兜得住。
 *
 * 升级之后的告警仍然是 at-least-once:一笔确认过的缺口在被补上之前,每一轮都再喊一次
 * (Sentry 把同一笔的重复事件收进同一个 issue,既不是风暴,也不会被一次数据库故障消音)。
 * 审计写不下去时(比如组织行已经不在)也一律按「见过」处理并报警 —— 宁可早喊一轮,
 * 也不许一次数据库故障把缺口变哑。
 *
 * ────────── MONEY-A12(规格 §7.5)三处升级 ──────────
 *
 * ① **告警走 founderAlert 三通道**(Sentry + 邮件 + Telegram)。原来的 TODO 说的就是这件事,
 *    founder-alert 模块早已在 main。裸 Sentry 的问题不是它不记录,是没有人二十四小时盯着它。
 *
 * ② **一天最多吵一次人**(顾问复审 ⑧)。缺口在被补上之前每 30 分钟就还在,三通道逐轮发
 *    等于一天 48 封邮件 —— 而那把 `RESEND_API_KEY` 和商家登录邮件是同一把。所以超过当天
 *    第一次的都走 `repeat`:Sentry 照收(计数与聚类一个字不少),只有会响的两条通道被压掉。
 *    节流状态和「见过没见过」一样放在 ActionEvent 的**主键**里,worker 重启不重置。
 *
 * ③ **缺口不随 48 小时扫描窗静默消失**。Stripe 的 `created` 过滤器只捞得到窗口内的 session:
 *    一笔缺口活过两天就从扫描结果里消失,而它从来没有被解决,只是没人再看得见它。现在每一轮
 *    先把**还没了结的观察行**从库里捞出来(它们是缺口自己的名单,与 Stripe 窗口无关),逐笔
 *    重查账本:账本已经补上 ⇒ 自动写关闭行、不再吵;仍然没有 ⇒ 继续报警,直到人工关闭
 *    (admin 动作 `apps/web/lib/reconcile-actions.ts` 写关闭行)。
 *
 * ④ **首见不再靠「撞主键」一件事定生死**(#1046-P2)。原判据是「观察行已存在 = 已经过了一轮」,
 *    但这个 sweeper 开机也跑一轮:worker 一重启,刚写下的观察行立刻被当成「活过一整轮」,
 *    首见就成了紧急告警。现在读观察行里的 `firstSeenAt`,真的过了一个扫描窗才升级。
 */
import Stripe from "stripe";
import { prisma } from "@fikirtive/db";
import { runAsSystem } from "@fikirtive/db/principal";
import {
  FOUNDER_OWNER_ID,
  RECONCILE_CLOSED_TYPE,
  RECONCILE_OBSERVED_TYPE,
  reconcileClosureId,
  reconcileObservationId,
} from "@fikirtive/core";
import type { FounderAlert } from "@fikirtive/core/founder-alert";
import { founderAlert } from "../alerting.js";

/** 这个 sweeper 用到的 Stripe 面 —— 只有 checkout.sessions.list 这一个只读调用。
 *  定成一个窄端口(而不是整个 Stripe SDK)是为了测试能注入一个假 client:钱路的用例
 *  绝不打真 Stripe。 */
export type StripeCheckoutSessionLike = {
  id: string;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_intent?: string | null;
  created?: number | null;
  metadata?: Record<string, string> | null;
};

export type StripeSessionsPort = {
  list(params: {
    created: { gte: number; lte: number };
    limit: number;
    starting_after?: string;
  }): Promise<{ data: StripeCheckoutSessionLike[]; has_more: boolean }>;
};

/** 回看窗口:48 小时。 */
export const STRIPE_RECONCILE_WINDOW_MS = 48 * 60 * 60 * 1000;
/** 宽限期:最近 30 分钟内成交的不算缺口 —— webhook 还在路上是正常的。 */
export const STRIPE_RECONCILE_GRACE_MS = 30 * 60 * 1000;
/**
 * 一个缺口要活多久才算「活过了一整轮扫描」(#1046-P2)。
 *
 * 与扫描间隔、与宽限期**刻意是同一个数**:定时器就是每 30 分钟一轮,所以「首见之后又过了
 * 30 分钟还在」正是「下一轮仍是缺口」的时间说法。判据从「观察行存在」换成「观察行够老」,
 * 是因为前者会被**开机那一轮**骗到:worker 一重启就再扫一次,刚写下的观察行当场被当成
 * 陈年缺口,首见直接升级成紧急告警。
 */
export const STRIPE_RECONCILE_CONFIRM_MS = STRIPE_RECONCILE_GRACE_MS;

const PAGE_SIZE = 100; // Stripe 单页上限
/** 翻页上限。20 × 100 = 一个 48h 窗口里 2000 笔,远超实际量;真撞上了会另报一次警,
 *  因为「这一轮没看全」和「这一轮没发现问题」绝不能长得一样。导出是为了让用例够得着它。 */
export const STRIPE_RECONCILE_MAX_PAGES = 20;

export type StripeReconcileResult = {
  /** 窗口内取回的 session 总数(含未支付的)。 */
  scanned: number;
  /** 其中 payment_status === "paid" 的。 */
  paid: number;
  /** 已支付但账本里没有对应入账行的 —— 这一轮看到的缺口总数(含首见的)。 */
  unreconciled: number;
  /** 其中**首见**的:只记了观察行,没有惊动 founder(延迟到账的付款正是长这样)。 */
  firstSeen: number;
  /** 实际发出的告警数(= 二次及以后确认的缺口,外加分页截断 / 读 Stripe 失败各一条)。 */
  alerted: number;
  /** 已滑出 48 小时窗口、靠观察行名单继续追踪的未了结缺口数(MONEY-A12)。 */
  tracked: number;
  /** 这一轮自动关闭的观察行数(账本行已经补上 —— 缺口真的没了)。 */
  closed: number;
  /** 没跑成的原因(没配 Stripe 密钥 / 拉取失败),跑成了就是 null。 */
  skipped: string | null;
};

/** 观察行 payload 里我们自己写下、后面要读回来的那几格。 */
type ObservationPayload = {
  sessionId?: unknown;
  orgId?: unknown;
  credits?: unknown;
  amountTotal?: unknown;
  currency?: unknown;
  paymentIntentId?: unknown;
  firstSeenAt?: unknown;
};

/** 一笔缺口的事实 —— 窗口内(来自 Stripe)与窗口外(来自观察行)统一成同一形状。 */
type GapFacts = {
  sessionId: string;
  orgId: string;
  amountTotal: number | null;
  currency: string;
  paymentIntentId: string | null;
  firstSeenAt: string | null;
};

/** 真 Stripe client,按需构造。没有密钥就没有这一面 —— 本地开发与测试是常态,不是错误。 */
function realStripePort(): StripeSessionsPort | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const client = new Stripe(key);
  return {
    list: async (params) => {
      const page = await client.checkout.sessions.list({
        created: { gte: params.created.gte, lte: params.created.lte },
        limit: params.limit,
        ...(params.starting_after ? { starting_after: params.starting_after } : {}),
      });
      return {
        // 逐字段搬,不做 cast:Stripe 的 payment_intent 可能是展开后的对象,这里只要 id。
        data: page.data.map((s) => ({
          id: s.id,
          payment_status: s.payment_status,
          amount_total: s.amount_total,
          currency: s.currency,
          payment_intent: typeof s.payment_intent === "string" ? s.payment_intent : null,
          created: s.created,
          metadata: s.metadata,
        })),
        has_more: page.has_more,
      };
    },
  };
}

/**
 * 告警(MONEY-A12 ①②):founderAlert 三通道 + **同一件事一天只吵一次人**。
 *
 * 节流不是静音:超过当天第一次的走 `repeat`,Sentry 照收(它本来就是按 key 聚类计数的那一层),
 * 只有邮件与 Telegram 被压掉。节流状态写在 ActionEvent 的主键 `<throttleId>:<UTC 日期>` 上,
 * 因为 worker 随时可能重启,而「今天喊过没有」必须跨重启成立。
 *
 * 写不进节流行(不是撞主键的那种失败)⇒ 分不清今天喊没喊过 ⇒ **照常全渠道喊**:一次数据库
 * 抖动可以让人多收一封邮件,不可以让一笔缺口变哑。`founderAlert` 自己永不抛。
 */
async function alertThrottledDaily(throttleId: string, alert: FounderAlert, nowMs: number): Promise<void> {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  let repeat = false;
  try {
    await prisma.actionEvent.create({
      data: {
        id: `${throttleId}:${day}`,
        ownerId: FOUNDER_OWNER_ID,
        type: "credits.reconcile.alerted",
        payload: { key: alert.key, day, sentAt: new Date(nowMs).toISOString() },
      },
    });
  } catch (e) {
    repeat = typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
    if (!repeat) {
      console.error(`[stripe-reconcile] could not record the alert-throttle row for ${throttleId}; alerting in full anyway:`, e);
    }
  }
  await founderAlert(alert, { repeat });
}

/**
 * 跑一轮对账。返回这一轮的账,便于调用方打日志、也便于测试断言。**永不抛错** —— 它挂在
 * worker 的定时器上,一次 Stripe 超时不该把整个 worker 带下去。
 */
export async function reconcileStripePayments(opts?: {
  /** 注入的 Stripe 面(测试用)。不传就按 STRIPE_SECRET_KEY 构造真 client。 */
  client?: StripeSessionsPort | null;
  now?: Date;
}): Promise<StripeReconcileResult> {
  const empty: StripeReconcileResult = { scanned: 0, paid: 0, unreconciled: 0, firstSeen: 0, alerted: 0, tracked: 0, closed: 0, skipped: null };
  const port = opts?.client ?? realStripePort();
  if (!port) return { ...empty, skipped: "STRIPE_SECRET_KEY is not set — nothing to reconcile against" };

  const now = (opts?.now ?? new Date()).getTime();
  const lte = Math.floor((now - STRIPE_RECONCILE_GRACE_MS) / 1000);
  const gte = Math.floor((now - STRIPE_RECONCILE_WINDOW_MS) / 1000);

  // #463:跨租户的扫描 + 平台级审计,具名系统身份。这里没有任何一笔租户写(审计行的
  // ownerId 只是它记录的那个组织,ActionEvent 本身是平台级 append-only 日志)。
  return runAsSystem("stripe-reconciler", async () => {
    const sessions: StripeCheckoutSessionLike[] = [];
    let truncated = false;
    let cursor: string | undefined;
    try {
      for (let page = 0; page < STRIPE_RECONCILE_MAX_PAGES; page++) {
        const res = await port.list({ created: { gte, lte }, limit: PAGE_SIZE, ...(cursor ? { starting_after: cursor } : {}) });
        sessions.push(...res.data);
        if (!res.has_more) break;
        cursor = res.data.at(-1)?.id;
        if (!cursor) break; // has_more 但空页 —— 没有游标可走,当成读完
        if (page === STRIPE_RECONCILE_MAX_PAGES - 1) truncated = true;
      }
    } catch (e) {
      // 读不到 Stripe ≠ 没有缺口。绝不能安静地当成「一切正常」。
      const reason = e instanceof Error ? e.message : String(e);
      await alertThrottledDaily(
        "stripe_reconcile_unreadable",
        {
          key: "stripe.reconcile_could_not_read_stripe",
          title: "The Stripe reconciliation sweep could not read Stripe — the last 48h of payments are UNVERIFIED",
          action:
            "Check the Stripe API status and STRIPE_SECRET_KEY. Until a sweep completes, nothing is watching for 'merchant paid and the ledger has no entry'.",
          context: { reason },
        },
        now,
      );
      return { ...empty, alerted: 1, skipped: `stripe list failed: ${reason}` };
    }

    let paid = 0;
    let unreconciled = 0;
    let firstSeen = 0;
    let alerted = 0;
    let closedThisSweep = 0;
    if (truncated) {
      await alertThrottledDaily(
        "stripe_reconcile_truncated",
        {
          key: "stripe.reconcile_window_truncated",
          title: `The 48h reconciliation window returned more than ${STRIPE_RECONCILE_MAX_PAGES * PAGE_SIZE} checkout sessions — this sweep did NOT see all of them`,
          action: "Raise STRIPE_RECONCILE_MAX_PAGES in apps/worker/src/jobs/stripe-reconcile.ts and deploy — a truncated sweep can hide a real gap.",
          context: { cap: STRIPE_RECONCILE_MAX_PAGES * PAGE_SIZE },
        },
        now,
      );
      alerted++;
    }

    // MONEY-A12 ③:缺口自己的名单,与 Stripe 的 48 小时窗口无关。
    //
    // 走 `(projectId, type)` 这个**既有索引**(观察行与关闭行的 projectId 都是 null,type 逐字
    // 相等)—— ActionEvent 是平台级 append-only 日志,对它全表扫迟早会把这一轮扫描拖垮。
    // 名单是有界的:一行对应一笔真实缺口,而缺口一旦了结(账本补上或人工关闭)就写关闭行退出。
    const trail = await prisma.actionEvent.findMany({
      where: { projectId: null, type: { in: [RECONCILE_OBSERVED_TYPE, RECONCILE_CLOSED_TYPE] } },
      select: { type: true, payload: true },
    });
    const closedSessions = new Set<string>();
    const openGaps = new Map<string, GapFacts>();
    for (const row of trail) {
      const p = (row.payload ?? {}) as ObservationPayload;
      const sessionId = typeof p.sessionId === "string" ? p.sessionId : "";
      if (!sessionId) continue;
      if (row.type === RECONCILE_CLOSED_TYPE) closedSessions.add(sessionId);
      else openGaps.set(sessionId, observedGap(sessionId, p));
    }
    for (const sessionId of closedSessions) openGaps.delete(sessionId);

    for (const session of sessions) {
      if (session.payment_status !== "paid") continue;
      paid++;
      const orgId = typeof session.metadata?.orgId === "string" ? session.metadata.orgId : "";
      // 账本那一行的身份就是这把幂等键 —— 与 webhook 侧 grantCredits 用的逐字同一把。
      //
      // 有 orgId(正常形状:结账时由服务端写进 metadata)就走 (orgId, idempotencyKey) 这个**唯一
      // 索引**,一次索引命中。没有 orgId 是异常形状(webhook 侧会记 credits.purchase.bad),此时
      // 只能按键扫 —— 罕见,而且这种 session 本来就一定要报警。
      const idempotencyKey = `stripe:${session.id}`;
      const entry = orgId
        ? await prisma.creditLedger.findUnique({ where: { orgId_idempotencyKey: { orgId, idempotencyKey } }, select: { id: true } })
        : await prisma.creditLedger.findFirst({ where: { idempotencyKey }, select: { id: true } });
      if (entry) {
        // 账本已经有那一行 —— 缺口没了。如果它还挂在观察名单上(webhook 事后被重投、或人工
        // 补了同一把幂等键),就地写关闭行:名单只留**真的还没了结**的缺口,否则它会越滚越长,
        // 而每一轮都要为已经解决的事再查一次库、再判一次要不要喊。
        if (openGaps.has(session.id)) {
          openGaps.delete(session.id);
          if (await closeObservation(session.id, orgId, "ledger entry present — the payment reconciled itself")) closedThisSweep++;
        }
        continue;
      }

      unreconciled++;
      // 人已经把这笔关掉了(退款了结、测试 session……)—— 记数照旧,但绝不再喊。
      if (closedSessions.has(session.id)) continue;
      const amount = typeof session.amount_total === "number" ? session.amount_total : null;
      const currency = typeof session.currency === "string" ? session.currency.toUpperCase() : "";
      const money = amount === null ? "an unknown amount" : `${currency} ${(amount / 100).toFixed(2)}`;

      // 两轮确认制的状态机,整个装在这一行审计的**主键**里(判官 P2-1)。
      //   create 成功  ⇒ 这一笔是**首见** ⇒ 只观察,不惊动 founder。延迟到账(FPX/GrabPay)
      //                  的付款几乎必然在下一轮之前落账,于是它就此安静消失。
      //   撞主键 P2002 ⇒ 之前见过 ⇒ **再看首见时刻**:真的过了一整个扫描窗才升级(#1046-P2;
      //                  开机那一轮会紧接着首见跑,不读时间就会把首见喊成紧急告警)。
      //   其它写失败  ⇒ 分不清首见还是再见(比如组织行已经不在、库抖了一下)⇒ 按再见处理,
      //                  报警。宁可早喊一轮,也绝不让一次数据库故障把缺口变哑。
      // 状态放在库里而不是进程内存,是因为 worker 随时可能重启,而「见过没见过」必须跨重启成立。
      let seenBefore: boolean;
      try {
        await prisma.actionEvent.create({
          data: {
            id: reconcileObservationId(session.id),
            ownerId: orgId || FOUNDER_OWNER_ID,
            type: RECONCILE_OBSERVED_TYPE,
            payload: {
              sessionId: session.id,
              orgId: orgId || null,
              credits: session.metadata?.credits ?? null,
              amountTotal: amount,
              currency: currency || null,
              paymentIntentId: session.payment_intent ?? null,
              // 判官 P3-2:这是 session 的**创建**时间,不是付款时间 —— 名字必须说实话。
              // Checkout Session 本身不带「何时付的款」,那在 PaymentIntent 上;延迟到账时
              // 两者可以差好几个小时,而这个差正是两轮确认制存在的原因。
              sessionCreatedAt: typeof session.created === "number" ? new Date(session.created * 1000).toISOString() : null,
              firstSeenAt: new Date(now).toISOString(),
            },
          },
        });
        seenBefore = false;
      } catch (e) {
        const duplicate = typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
        seenBefore = true; // 撞主键 = 真见过;其它错 = 说不准,按见过报警(fail loud)
        if (!duplicate) {
          console.error(`[stripe-reconcile] could not record the observation row for ${session.id}; escalating anyway:`, e);
        }
      }

      const firstSeenAt = openGaps.get(session.id)?.firstSeenAt ?? null;
      openGaps.delete(session.id); // 这一笔本轮已经处理过,下面的窗口外那一段不必再碰它
      // 首见,或者首见得还不够久 —— 一个扫描窗都还没过完,不惊动 founder。
      if (!seenBefore || (firstSeenAt !== null && now - Date.parse(firstSeenAt) < STRIPE_RECONCILE_CONFIRM_MS)) {
        if (!seenBefore) firstSeen++;
        console.warn(
          `[stripe-reconcile] ${seenBefore ? "seen since" : "first sighting"} ${firstSeenAt ?? "just now"}: ${money} paid on Stripe with no ledger entry yet ` +
            `(session=${session.id} org=${orgId || "unknown"}). ` +
            `Not alerting yet — a delayed-notification payment (FPX/GrabPay) looks exactly like this while its webhook is still in flight. ` +
            `If it is still missing a full sweep window later, that is when the founder hears about it.`,
        );
        continue;
      }

      await escalateGap(
        { sessionId: session.id, orgId, amountTotal: amount, currency, paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null, firstSeenAt },
        now,
        true,
      );
      alerted++;
    }

    // MONEY-A12 ③:窗口外的未了结缺口。到这里 openGaps 里剩下的,全是 Stripe 这一轮**没有
    // 返回**的观察行 —— 绝大多数是因为它们的 session 早已滑出 48 小时。缺口不会因为看不见就
    // 消失,所以逐笔重查账本:补上了就关闭,没补上就继续喊(每天一次),直到人工关闭。
    let tracked = 0;
    for (const gap of openGaps.values()) {
      const idempotencyKey = `stripe:${gap.sessionId}`;
      const entry = gap.orgId
        ? await prisma.creditLedger.findUnique({ where: { orgId_idempotencyKey: { orgId: gap.orgId, idempotencyKey } }, select: { id: true } })
        : await prisma.creditLedger.findFirst({ where: { idempotencyKey }, select: { id: true } });
      if (entry) {
        if (await closeObservation(gap.sessionId, gap.orgId, "ledger entry present — the payment reconciled itself")) closedThisSweep++;
        continue;
      }
      tracked++;
      await escalateGap(gap, now, false);
      alerted++;
    }

    return { scanned: sessions.length, paid, unreconciled, firstSeen, alerted, tracked, closed: closedThisSweep, skipped: null };
  });
}

/** 观察行 payload → 缺口事实。窗口内(Stripe 直供)与窗口外(库里读回)统一成同一形状。 */
function observedGap(sessionId: string, p: ObservationPayload): GapFacts {
  return {
    sessionId,
    orgId: typeof p.orgId === "string" ? p.orgId : "",
    amountTotal: typeof p.amountTotal === "number" ? p.amountTotal : null,
    currency: typeof p.currency === "string" ? p.currency : "",
    paymentIntentId: typeof p.paymentIntentId === "string" ? p.paymentIntentId : null,
    firstSeenAt: typeof p.firstSeenAt === "string" ? p.firstSeenAt : null,
  };
}

/** 一笔缺口的升级报警(三通道,同一笔一天一次)。**永不抛**。 */
async function escalateGap(gap: GapFacts, nowMs: number, inStripeWindow: boolean): Promise<void> {
  const money = gap.amountTotal === null ? "an unknown amount" : `${gap.currency || "?"} ${(gap.amountTotal / 100).toFixed(2)}`;
  await alertThrottledDaily(
    `stripe_unreconciled_alert:${gap.sessionId}`,
    {
      key: "stripe.paid_but_no_ledger_entry",
      title: `A merchant PAID ${money} on Stripe and the credits ledger still has no entry for it — they were charged and received nothing`,
      action:
        "Replay that Checkout Session's webhook event in the Stripe dashboard — that is the only correct fix (this sweep never writes credits). " +
        "The sweep closes the observation by itself once the ledger row lands; if the payment was settled some other way (refunded, a test session), " +
        "close it with the admin action in apps/web/lib/reconcile-actions.ts so it stops alerting.",
      context: {
        sessionId: gap.sessionId,
        orgId: gap.orgId || "unresolved",
        amountTotal: gap.amountTotal,
        currency: gap.currency || null,
        paymentIntentId: gap.paymentIntentId,
        idempotencyKey: `stripe:${gap.sessionId}`,
        firstSeenAt: gap.firstSeenAt,
        // 窗口外 = 这笔缺口已经老过 48 小时,Stripe 的扫描再也捞不到它;它还在被追踪,
        // 靠的是观察行名单。收到报警的人需要知道这个差别(它意味着「很久了」)。
        stillInStripeScanWindow: inStripeWindow,
      },
    },
    nowMs,
  );
}

/** 写关闭行。**永不抛**:一笔关不上的观察行只是下一轮再喊一次,而抛出去会带走整趟扫描。
 *  返回是否真的新写了一行(撞主键 = 早就关过了,不重复记数)。 */
async function closeObservation(sessionId: string, orgId: string, note: string): Promise<boolean> {
  try {
    await prisma.actionEvent.create({
      data: {
        id: reconcileClosureId(sessionId),
        ownerId: orgId || FOUNDER_OWNER_ID,
        type: RECONCILE_CLOSED_TYPE,
        payload: { sessionId, orgId: orgId || null, closedBy: "stripe-reconciler", note },
      },
    });
    return true;
  } catch (e) {
    const duplicate = typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
    if (!duplicate) console.error(`[stripe-reconcile] could not close the observation row for ${sessionId}:`, e);
    return false;
  }
}
