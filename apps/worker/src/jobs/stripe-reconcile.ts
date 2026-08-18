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
 * TODO(#359 收敛):告警此刻直连 Sentry。分支 claude/c1a-alerting 的 founder-alert 模块
 * (Sentry + 邮件 + Telegram,Founder 2026-08-18 裁决)合入 main 之后,把下面的 `alert()`
 * 一处改成调它即可 —— 触发条件就是那个模块落地。
 */
import Stripe from "stripe";
import * as Sentry from "@sentry/node";
import { prisma } from "@fikirtive/db";
import { runAsSystem } from "@fikirtive/db/principal";

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
  /** 没跑成的原因(没配 Stripe 密钥 / 拉取失败),跑成了就是 null。 */
  skipped: string | null;
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

/** 告警。Sentry 未配 DSN 时 captureException 是安全 no-op;它自己抛错也绝不能把这一轮扫描
 *  带下去(退化成 console.error)。 */
function alert(message: string, extra: Record<string, unknown>): void {
  try {
    Sentry.captureException(new Error(message), { extra });
  } catch (e) {
    console.error(`[stripe-reconcile] alert transport failed: ${message}`, extra, e);
  }
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
  const empty: StripeReconcileResult = { scanned: 0, paid: 0, unreconciled: 0, firstSeen: 0, alerted: 0, skipped: null };
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
      alert(`[stripe-reconcile] could not read Stripe — payments in the last 48h are UNVERIFIED this sweep: ${reason}`, { reason });
      return { ...empty, alerted: 1, skipped: `stripe list failed: ${reason}` };
    }

    let paid = 0;
    let unreconciled = 0;
    let firstSeen = 0;
    let alerted = 0;
    if (truncated) {
      alert(
        `[stripe-reconcile] the 48h window returned more than ${STRIPE_RECONCILE_MAX_PAGES * PAGE_SIZE} checkout sessions — this sweep did NOT see all of them; raise the page cap`,
        { cap: STRIPE_RECONCILE_MAX_PAGES * PAGE_SIZE },
      );
      alerted++;
    }

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
      if (entry) continue; // 有账本行 —— 这笔已经入账,什么都不做

      unreconciled++;
      const amount = typeof session.amount_total === "number" ? session.amount_total : null;
      const currency = typeof session.currency === "string" ? session.currency.toUpperCase() : "";
      const money = amount === null ? "an unknown amount" : `${currency} ${(amount / 100).toFixed(2)}`;

      // 两轮确认制的状态机,整个装在这一行审计的**主键**里(判官 P2-1)。
      //   create 成功  ⇒ 这一笔是**首见** ⇒ 只观察,不惊动 founder。延迟到账(FPX/GrabPay)
      //                  的付款几乎必然在下一轮之前落账,于是它就此安静消失。
      //   撞主键 P2002 ⇒ **上一轮就见过** ⇒ 缺口活过了一整轮,升级报警。
      //   其它写失败  ⇒ 分不清首见还是再见(比如组织行已经不在、库抖了一下)⇒ 按再见处理,
      //                  报警。宁可早喊一轮,也绝不让一次数据库故障把缺口变哑。
      // 状态放在库里而不是进程内存,是因为 worker 随时可能重启,而「见过没见过」必须跨重启成立。
      let seenBefore: boolean;
      try {
        await prisma.actionEvent.create({
          data: {
            id: `stripe_unreconciled:${session.id}`,
            ownerId: orgId || "founder",
            type: "credits.purchase.unreconciled",
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

      if (!seenBefore) {
        firstSeen++;
        console.warn(
          `[stripe-reconcile] first sighting: ${money} paid on Stripe with no ledger entry yet (session=${session.id} org=${orgId || "unknown"}). ` +
            `Not alerting yet — a delayed-notification payment (FPX/GrabPay) looks exactly like this while its webhook is still in flight. ` +
            `If it is still missing next sweep, that is when the founder hears about it.`,
        );
        continue;
      }

      alert(
        `[stripe-reconcile] a merchant PAID ${money} on Stripe and the credits ledger STILL has no entry for it a full sweep later — they were charged and received nothing. ` +
          `Replay the Checkout Session's webhook event in the Stripe dashboard (that is the only correct fix; this sweep never writes credits). ` +
          `session=${session.id} org=${orgId || "unknown"}`,
        {
          sessionId: session.id,
          orgId: orgId || null,
          amountTotal: amount,
          currency: currency || null,
          paymentIntentId: session.payment_intent ?? null,
          idempotencyKey,
        },
      );
      alerted++;
    }

    return { scanned: sessions.length, paid, unreconciled, firstSeen, alerted, skipped: null };
  });
}
