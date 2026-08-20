/**
 * founder-alert —— 「商家的钱出事了,需要人来看」这一类事件的唯一出口(整顿 C1a)。
 *
 * 病因:代码里已经有几处写得非常清楚的求救——「这个商家付了钱什么都没拿到,需要 founder
 * 裁决」——而它们全部只落 `console.error`。生产日志没有人二十四小时盯着,于是这句话事实上
 * 说给了没有人。报警渠道本身也一样:SENTRY_DSN 是 optional,没配就整条监控静音,而开机检查
 * 不拦——「装了监控」和「监控在响」被当成了同一件事。
 *
 * 三条通道,职责各不相同,所以不是备份关系:
 *   · Sentry   —— 归档与聚类。事后查「这类事发生过几次」只能靠它。
 *   · 邮件     —— 送到 {@link FOUNDER_ALERT_EMAIL},离线也能追到人。
 *   · Telegram —— 手机上会响的那一个。**optional**:token 要 CEO 自己建 bot 才有
 *                 (向导:docs/ops/telegram-alerts.md),没配就静默跳过。
 *
 * 三条硬规矩:
 *   1. **派发永不抛**。报警是旁路,它把一条钱路的代码路径拖垮,就成了自己要报的那种事故。
 *   2. **没配置 = skipped,配了发不出去 = failed 且必须留痕**。两者绝不能长得一样:前者是
 *      刻意的部署状态,后者是一条没送到的报警——把它吞掉,就等于报警系统自己在骗人。
 *   3. **上下文只放 org / 金额 / 作业 id 这类定位信息**,不放密钥、不放商家内容。
 */

/** 报警落地的信箱。写死是故意的:多一个 env 就多一个「配错了没人发现」的地方。 */
export const FOUNDER_ALERT_EMAIL = "tools@belcort.com";

/** 定位一件事需要的字段。值只允许标量——嵌套对象在邮件与 Telegram 里没法读。 */
export type FounderAlertContext = Record<string, string | number | boolean | null | undefined>;

export type FounderAlert = {
  /** 稳定的机器键(如 `gen.paid_for_nothing`)。Sentry 靠它聚类,邮件标题靠它一眼分类。 */
  key: string;
  /** 一行人话:发生了什么。 */
  title: string;
  /** 一行人话:接下来该做什么。收到报警的人不该还要去读代码才知道下一步。 */
  action: string;
  /** org / 金额 / 作业 id。 */
  context: FounderAlertContext;
};

export type FounderAlertChannelName = "sentry" | "email" | "telegram";

/** 通道约定:送出去返回 "sent";这台部署没配置这条通道返回 "skipped";发送失败**抛**。 */
export type FounderAlertChannel = (alert: FounderAlert) => Promise<"sent" | "skipped">;

export type FounderAlertChannels = Record<FounderAlertChannelName, FounderAlertChannel>;

/**
 * 四种取值刻意互不重叠——把其中任意两种合并,报警系统就开始对自己说谎:
 *   sent       —— 送出去了。
 *   skipped    —— 这台部署没配这条通道(刻意的状态)。
 *   suppressed —— 配了、能发,但**这一条是重复**,只让 Sentry 承载(见 dispatch 的 repeat)。
 *   failed     —— 配了、该发、没发成。唯一需要有人去修的一种。
 */
export type FounderAlertOutcome = {
  channel: FounderAlertChannelName;
  status: "sent" | "skipped" | "suppressed" | "failed";
  /** failed 时的原因,只留消息文本,永不带值/密钥。 */
  reason?: string;
};

export type DispatchFounderAlertOptions = {
  /**
   * 这一条是**同一件事的重复**(调用方已经为它发过一次完整报警)。
   *
   * 为什么需要它:钱路上那些「故意不清理」的行——`gen.paid_for_nothing` 就是标准例——会被
   * 每 5 分钟一趟的巡检一遍遍扫到。没有这个开关,一行卡住 = 每天约 288 封邮件 + 288 条
   * Telegram,而那把 `RESEND_API_KEY` 和商家登录邮件是同一把:一条报警能把登录打挂,
   * 报警就成了自己要报的那种事故。
   *
   * 但**重复绝不等于不重要**,所以不是静音:Sentry 照常收,它本来就是按 key 聚类计数的
   * 那一层,「这一行今天被扫到多少次」正好是它擅长回答的问题。压掉的只有会重复打扰人的
   * 两条推送通道,而且记成 `suppressed` 而不是 `skipped`——没配置和被压掉是两回事。
   */
  repeat?: boolean;
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 报警正文。邮件与 Telegram 共用同一份文字——两个渠道说的话不一样只会制造对账成本。 */
export function formatFounderAlertText(alert: FounderAlert): string {
  const lines = Object.entries(alert.context)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v === null ? "unknown" : String(v)}`);
  return [`[Fikirtive] ${alert.title}`, "", `What to do: ${alert.action}`, "", `Event: ${alert.key}`, ...lines].join("\n");
}

/**
 * 把一条报警发出去。**永不抛**,返回逐通道结果供调用方(与测试)检查。
 *
 * Sentry 先发:它是唯一「一定在」的通道,也是另外两条失败时留痕的地方。邮件与 Telegram
 * 各自失败都只影响自己,并且各自转成一条 `<key>.channel_failed` 进 Sentry ——
 * 一条没送到的报警必须在别处留下痕迹,否则整个报警系统在无声地退化。
 */
export async function dispatchFounderAlert(
  alert: FounderAlert,
  channels: FounderAlertChannels,
  opts: DispatchFounderAlertOptions = {},
): Promise<FounderAlertOutcome[]> {
  const outcomes: FounderAlertOutcome[] = [];

  let sentryOk = true;
  try {
    outcomes.push({ channel: "sentry", status: await channels.sentry(alert) });
  } catch (e) {
    sentryOk = false;
    outcomes.push({ channel: "sentry", status: "failed", reason: errText(e) });
    console.error(`[founder-alert] ${alert.key}: sentry channel failed:`, errText(e));
  }

  // 重复命中:两条推送通道**根本不调用**(不是发了再丢),Sentry 上面已经收过了。
  if (opts.repeat) {
    for (const name of ["email", "telegram"] as const) outcomes.push({ channel: name, status: "suppressed" });
    return outcomes;
  }

  for (const name of ["email", "telegram"] as const) {
    try {
      outcomes.push({ channel: name, status: await channels[name](alert) });
    } catch (e) {
      const reason = errText(e);
      outcomes.push({ channel: name, status: "failed", reason });
      console.error(`[founder-alert] ${alert.key}: ${name} channel failed:`, reason);
      if (!sentryOk) continue;
      try {
        await channels.sentry({
          key: `${alert.key}.channel_failed`,
          title: `A founder alert could not be delivered over ${name}`,
          action: `Fix the ${name} credentials — the alert below reached Sentry only.`,
          context: { ...alert.context, alertChannel: name, alertError: reason },
        });
      } catch {
        // 留痕本身也失败:日志上面那一行已经写过了,这里再抛就成了报警拖垮钱路。
      }
    }
  }

  return outcomes;
}

/* ────────────────────────── 具体通道 ────────────────────────── */

type EnvRecord = Record<string, string | undefined>;

/**
 * 每条外呼的死线。存在的理由与 #678 给 EmailPort 装 `signal` 的完全一样:一个被对方接受
 * 却永远不回答的连接,会在 socket 还开着的整段时间里把调用方钉在这里——而这里的调用方是
 * **巡检的每行循环**(`reapStaleGenJobs` 里 `await founderAlert(...)`)。一条卡住的报警
 * 因此能变成一整趟停摆的退款巡检,那比报警发不出去糟得多。
 */
const ALERT_FETCH_TIMEOUT_MS = 10_000;

/** Sentry SDK 里我们用到的那一个方法。写成结构类型,core 就不必依赖 @sentry/node。 */
export type SentryLike = {
  captureMessage: (
    message: string,
    context?: { level?: "error" | "warning"; tags?: Record<string, string>; extra?: Record<string, unknown> },
  ) => unknown;
};

/**
 * Sentry 通道。
 *
 * **没有 DSN 就报 "skipped",绝不报 "sent"。** 这条曾经写成恒 "sent",理由是「C1a 之后
 * SENTRY_DSN 在生产必填,开机检查会拦住」——但那个理由漏了一个真实存在的形状:走
 * `FIKIRTIVE_ENV_CONTRACT=warn` 逃生阀启动的生产进程。那台机器没有 DSN、`Sentry.init`
 * 从不运行、每次 capture 静默 no-op,而派发结果会白纸黑字写着 `sentry: sent`。
 * 那正是这张票要消灭的「说的 ≠ 做的」——只不过长在了报警器自己身上,是最不能有的地方。
 *
 * 用 `captureMessage` + 结构化 context,而不是 `captureException(new Error(...))`,理由是**聚类**:
 *   · 合成的 Error 的堆栈全部指向这个文件的同一行,Sentry 会把每一种 founder 报警都归成
 *     同一个 issue —— 「商家付了钱什么都没拿到」和「Stripe 收了钱不知道给谁」混在一起,
 *     等于两条都读不出来。
 *   · message 只放稳定部分(key + 标题),会变的 org / 金额 / 作业 id 走 extra,于是同一类事
 *     聚成一个 issue、按 `founder_alert` 标签就能筛,而每一次的定位信息一个字都没丢。
 * 钱路 catch 那一族仍然用 captureException —— 那里有真实的 Error 与真实的堆栈,
 * 见 apps/worker/src/alerting.ts。
 */
export function createSentryChannel(sentry: SentryLike, env: EnvRecord = process.env): FounderAlertChannel {
  return async (alert) => {
    if (!(env.SENTRY_DSN ?? "").trim()) return "skipped";
    sentry.captureMessage(`[founder-alert] ${alert.key} — ${alert.title}`, {
      level: "error",
      tags: { founder_alert: alert.key },
      extra: { ...alert.context, action: alert.action, text: formatFounderAlertText(alert) },
    });
    return "sent";
  };
}

/**
 * 邮件通道 —— Resend REST API,与 apps/web/lib/email/resend-adapter.ts 同一个端点、同两个
 * env(RESEND_API_KEY / AUTH_EMAIL_FROM)。
 *
 * 为什么不直接复用那个 adapter:它在 apps/web 里、带 `server-only`,worker 拿不到它;而
 * 「商家付了钱什么都没拿到」这句求救**就长在 worker 里**。所以发信实现放在两侧都能引的
 * core,web 与 worker 用的是同一条报警发信路径,而不是各写一份。商家的认证邮件仍然走
 * 原来的 EmailPort,一个字未动。
 */
export function createResendAlertEmailChannel(env: EnvRecord = process.env): FounderAlertChannel {
  return async (alert) => {
    const apiKey = (env.RESEND_API_KEY ?? "").trim();
    if (!apiKey) return "skipped"; // 开发机与 CI 的正常状态;生产缺它由 env 契约去管
    const text = formatFounderAlertText(alert);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(ALERT_FETCH_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: (env.AUTH_EMAIL_FROM ?? "").trim() || "Fikirtive <onboarding@resend.dev>",
        to: FOUNDER_ALERT_EMAIL,
        subject: `[Fikirtive] ${alert.title}`,
        text,
      }),
    });
    if (!res.ok) throw new Error(`resend returned HTTP ${res.status}`);
    return "sent";
  };
}

/**
 * Telegram 通道 —— 两个 env 齐了才发,缺任一个都是 "skipped"(不是错误:bot 要 CEO 自己建,
 * 建之前这条通道本来就不存在)。建 bot 与取 chat_id 的两分钟向导在 docs/ops/telegram-alerts.md。
 */
export function createTelegramChannel(env: EnvRecord = process.env): FounderAlertChannel {
  return async (alert) => {
    const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
    const chatId = (env.TELEGRAM_ALERT_CHAT_ID ?? "").trim();
    if (!token || !chatId) return "skipped";
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      signal: AbortSignal.timeout(ALERT_FETCH_TIMEOUT_MS),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: formatFounderAlertText(alert), disable_web_page_preview: true }),
    });
    // 报错里绝不带 token:它就在 URL 里,把 URL 或响应体抄进异常等于把密钥写进日志。
    if (!res.ok) throw new Error(`telegram sendMessage returned HTTP ${res.status}`);
    return "sent";
  };
}

/** 生产接线:三条通道一次配齐。Sentry 由各自的宿主传进来(core 不依赖 @sentry/node)。 */
export function createFounderAlertChannels(sentry: SentryLike, env: EnvRecord = process.env): FounderAlertChannels {
  return {
    sentry: createSentryChannel(sentry, env),
    email: createResendAlertEmailChannel(env),
    telegram: createTelegramChannel(env),
  };
}
