/**
 * founder-alert.test.ts —— 报警管道的行为钉板(整顿 C1a)。
 *
 * 这个文件断言的不是「代码里有一行 captureException」,而是**这类事件必然产生一次带上下文
 * 的上报**,以及三条通道各自失败时管道到底怎么表现。用注入的假 transport,一个真实外呼都不发。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FOUNDER_ALERT_EMAIL,
  createFounderAlertChannels,
  createResendAlertEmailChannel,
  createSentryChannel,
  createTelegramChannel,
  dispatchFounderAlert,
  formatFounderAlertText,
  type FounderAlert,
  type FounderAlertChannels,
} from "./founder-alert.js";

const ALERT: FounderAlert = {
  key: "gen.paid_for_nothing",
  title: "A merchant paid for a generation and received nothing",
  action: "Decide the refund by hand.",
  context: { genJobId: "gen_1", orgId: "org_1", chargedCredits: 22 },
};

const okChannel = () => vi.fn(async () => "sent" as const);
const skippedChannel = () => vi.fn(async () => "skipped" as const);

function channels(over: Partial<FounderAlertChannels> = {}): FounderAlertChannels {
  return { sentry: okChannel(), email: okChannel(), telegram: okChannel(), ...over };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("formatFounderAlertText", () => {
  it("carries the title, what to do, the machine key and every context field", () => {
    const text = formatFounderAlertText(ALERT);
    expect(text).toContain("A merchant paid for a generation and received nothing");
    expect(text).toContain("Decide the refund by hand.");
    expect(text).toContain("gen.paid_for_nothing");
    expect(text).toContain("genJobId: gen_1");
    expect(text).toContain("orgId: org_1");
    expect(text).toContain("chargedCredits: 22");
  });

  it("a null context value reads as unknown rather than vanishing", () => {
    // 读不到金额和「金额是 0」不是一回事,报警里也不许长得一样。
    expect(formatFounderAlertText({ ...ALERT, context: { chargedCredits: null } })).toContain("chargedCredits: unknown");
  });
});

describe("dispatchFounderAlert", () => {
  it("one alert ⇒ exactly one report on every configured channel, each carrying the context", async () => {
    const c = channels();
    const outcomes = await dispatchFounderAlert(ALERT, c);

    for (const name of ["sentry", "email", "telegram"] as const) {
      expect(c[name], name).toHaveBeenCalledTimes(1);
      expect(c[name]).toHaveBeenCalledWith(expect.objectContaining({ key: "gen.paid_for_nothing", context: ALERT.context }));
    }
    expect(outcomes).toEqual([
      { channel: "sentry", status: "sent" },
      { channel: "email", status: "sent" },
      { channel: "telegram", status: "sent" },
    ]);
  });

  it("an unconfigured Telegram is skipped silently — Sentry and email still go out", async () => {
    const c = channels({ telegram: skippedChannel() });
    const outcomes = await dispatchFounderAlert(ALERT, c);
    expect(outcomes).toContainEqual({ channel: "telegram", status: "skipped" });
    expect(c.sentry).toHaveBeenCalledTimes(1);
    expect(c.email).toHaveBeenCalledTimes(1);
  });

  it("a CONFIGURED Telegram that fails to send leaves a Sentry trace — never swallowed", async () => {
    const sentry = okChannel();
    const c = channels({ sentry, telegram: vi.fn(async () => { throw new Error("telegram sendMessage returned HTTP 403"); }) });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const outcomes = await dispatchFounderAlert(ALERT, c);

    expect(outcomes).toContainEqual({ channel: "telegram", status: "failed", reason: "telegram sendMessage returned HTTP 403" });
    // 一次是原报警,一次是「这条报警没送到」——后者带得上原上下文,查得回是哪一单。
    expect(sentry).toHaveBeenCalledTimes(2);
    expect(sentry).toHaveBeenLastCalledWith(expect.objectContaining({
      key: "gen.paid_for_nothing.channel_failed",
      context: expect.objectContaining({ genJobId: "gen_1", alertChannel: "telegram", alertError: "telegram sendMessage returned HTTP 403" }),
    }));
  });

  it("an email failure does not stop Telegram, and also leaves a Sentry trace", async () => {
    const sentry = okChannel();
    const telegram = okChannel();
    const c = channels({ sentry, telegram, email: vi.fn(async () => { throw new Error("resend returned HTTP 500"); }) });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const outcomes = await dispatchFounderAlert(ALERT, c);

    expect(outcomes).toContainEqual({ channel: "email", status: "failed", reason: "resend returned HTTP 500" });
    expect(telegram).toHaveBeenCalledTimes(1);
    expect(sentry).toHaveBeenCalledTimes(2);
  });

  it("never throws, even with all three channels down — an alert must not take the money path with it", async () => {
    const boom = vi.fn(async () => { throw new Error("down"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const outcomes = await dispatchFounderAlert(ALERT, { sentry: boom, email: boom, telegram: boom });
    expect(outcomes.map((o) => o.status)).toEqual(["failed", "failed", "failed"]);
  });
});

describe("createSentryChannel", () => {
  it("groups on the STABLE half and carries the changing half as structured context", async () => {
    // 聚类是这条断言的全部意义:会变的 id 留在 message 里,Sentry 会给每一单开一个 issue,
    // 「这类事发生过几次」就再也问不出来了。
    const captureMessage = vi.fn();
    expect(await createSentryChannel({ captureMessage })(ALERT)).toBe("sent");
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [message, context] = captureMessage.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(message).toContain("gen.paid_for_nothing");
    expect(message, "作业 id 进了 message ⇒ 每一单自成一个 issue").not.toContain("gen_1");
    expect(context.level).toBe("error");
    expect(context.tags).toEqual({ founder_alert: "gen.paid_for_nothing" });
    expect(context.extra).toEqual(expect.objectContaining({ genJobId: "gen_1", orgId: "org_1", chargedCredits: 22 }));
  });
});

describe("createTelegramChannel", () => {
  it("no token or no chat id ⇒ skipped, and NOT ONE request is made", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const env of [{}, { TELEGRAM_BOT_TOKEN: "t" }, { TELEGRAM_ALERT_CHAT_ID: "-100" }]) {
      expect(await createTelegramChannel(env)(ALERT)).toBe("skipped");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("both set ⇒ one sendMessage to that chat with the alert text", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchSpy);
    expect(await createTelegramChannel({ TELEGRAM_BOT_TOKEN: "123:AA", TELEGRAM_ALERT_CHAT_ID: "-1001" })(ALERT)).toBe("sent");
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123:AA/sendMessage");
    const body = JSON.parse(String(init.body));
    expect(body.chat_id).toBe("-1001");
    expect(body.text).toContain("genJobId: gen_1");
  });

  it("a non-2xx throws — and the thrown message never carries the token (it lives in the URL)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403 }) as Response));
    const send = createTelegramChannel({ TELEGRAM_BOT_TOKEN: "123:SECRET", TELEGRAM_ALERT_CHAT_ID: "-1001" });
    await expect(send(ALERT)).rejects.toThrow("HTTP 403");
    await expect(send(ALERT)).rejects.not.toThrow(/SECRET/);
  });
});

describe("createResendAlertEmailChannel", () => {
  it("no API key ⇒ skipped, no request (the normal dev/CI state)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await createResendAlertEmailChannel({})(ALERT)).toBe("skipped");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends to the founder mailbox with the alert as subject + body", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchSpy);
    expect(await createResendAlertEmailChannel({ RESEND_API_KEY: "re_x", AUTH_EMAIL_FROM: "Fikirtive <a@b.com>" })(ALERT)).toBe("sent");
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init.body));
    expect(body.to).toBe(FOUNDER_ALERT_EMAIL);
    expect(body.from).toBe("Fikirtive <a@b.com>");
    expect(body.subject).toContain("A merchant paid for a generation and received nothing");
    expect(body.text).toContain("orgId: org_1");
  });

  it("a non-2xx throws, so the dispatcher records it as failed instead of silently 'sent'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 422 }) as Response));
    await expect(createResendAlertEmailChannel({ RESEND_API_KEY: "re_x" })(ALERT)).rejects.toThrow("HTTP 422");
  });

  it("both outbound calls carry a deadline — a hung provider must not stall the refund sweep", async () => {
    // 这条报警是在 reapStaleGenJobs 的每行循环里 await 的。一个被接受却永远不回答的连接
    // 会把整趟退款巡检钉住,那比报警发不出去糟得多(#678 给认证邮件装 signal 的同一理由)。
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init);
      return { ok: true } as Response;
    }));
    await createResendAlertEmailChannel({ RESEND_API_KEY: "re_x" })(ALERT);
    await createTelegramChannel({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_ALERT_CHAT_ID: "-1" })(ALERT);
    expect(seen).toHaveLength(2);
    for (const init of seen) expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("createFounderAlertChannels (production wiring)", () => {
  it("a deployment with Sentry only still delivers — email and telegram report themselves as skipped", async () => {
    const captureMessage = vi.fn();
    const outcomes = await dispatchFounderAlert(ALERT, createFounderAlertChannels({ captureMessage }, {}));
    expect(outcomes).toEqual([
      { channel: "sentry", status: "sent" },
      { channel: "email", status: "skipped" },
      { channel: "telegram", status: "skipped" },
    ]);
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });
});
