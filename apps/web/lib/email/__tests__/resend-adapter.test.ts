import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EmailSendError } from "../types";
import { createResendEmailPort } from "../resend-adapter";

describe("createResendEmailPort", () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.AUTH_EMAIL_FROM;
    vi.stubEnv("NODE_ENV", "test");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("config_missing classification", () => {
    it("throws EmailSendError(kind: config_missing) whenever no key is configured", async () => {
      // 这一条从「生产才抛」放宽成「没钥匙就抛」:没钥匙时的本地回落已经整块搬去
      // `stub-adapter.ts`,由 `transport.ts` 按名字挑,这个适配器只会在**有钥匙**时被选中。
      // 于是没钥匙调用它是一个响亮的故障,而不是一次 `Bearer undefined` 的真请求。
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const port = createResendEmailPort();
      const err = await port.send({ to: "a@x.test", subject: "S", text: "t" }).catch((e) => e);
      expect(err).toBeInstanceOf(EmailSendError);
      expect((err as EmailSendError).message).toBe("RESEND_API_KEY is not configured.");
      expect((err as EmailSendError).kind).toBe("config_missing");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("live send via fetch (RESEND_API_KEY set)", () => {
    beforeEach(() => {
      process.env.RESEND_API_KEY = "test-key";
    });

    it("passes to/subject/text through, with the default from address", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", fetchMock);
      const port = createResendEmailPort();

      await port.send({ to: "a@x.test", subject: "Verify your Fikirtive email", text: "Verify your email:\nhttps://x.test/v\n\nignore." });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.resend.com/emails");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
      expect(JSON.parse(init.body as string)).toEqual({
        from: "Fikirtive <onboarding@resend.dev>",
        to: "a@x.test",
        subject: "Verify your Fikirtive email",
        text: "Verify your email:\nhttps://x.test/v\n\nignore.",
      });
    });

    it("uses AUTH_EMAIL_FROM when set, and message.from as the highest-priority override", async () => {
      process.env.AUTH_EMAIL_FROM = "Fikirtive <noreply@fikirtive.test>";
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", fetchMock);
      const port = createResendEmailPort();

      await port.send({ to: "a@x.test", subject: "S", text: "t" });
      let init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(JSON.parse(init.body as string).from).toBe("Fikirtive <noreply@fikirtive.test>");

      await port.send({ to: "a@x.test", subject: "S", text: "t", from: "Custom <custom@fikirtive.test>" });
      init = fetchMock.mock.calls[1][1] as RequestInit;
      expect(JSON.parse(init.body as string).from).toBe("Custom <custom@fikirtive.test>");
    });

    /** #757 — the abort cannot recall a request the provider has already accepted, so the
     *  protection against that request being made twice has to live at the provider. */
    it("forwards an idempotency key when the caller supplies one, and omits the header otherwise", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", fetchMock);
      const port = createResendEmailPort();

      await port.send({ to: "a@x.test", subject: "S", text: "t", idempotencyKey: "abc123" });
      let headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBe("abc123");

      await port.send({ to: "a@x.test", subject: "S", text: "t" });
      headers = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
      expect(headers).not.toHaveProperty("Idempotency-Key");
    });

    it("classifies a 5xx/429 response as retryable", async () => {
      for (const status of [429, 500, 503]) {
        const fetchMock = vi.fn().mockResolvedValue({ ok: false, status });
        vi.stubGlobal("fetch", fetchMock);
        const port = createResendEmailPort();
        const err = await port.send({ to: "a@x.test", subject: "S", text: "t" }).catch((e) => e);
        expect(err).toBeInstanceOf(EmailSendError);
        expect((err as EmailSendError).message).toBe(`Auth email failed (${status}).`);
        expect((err as EmailSendError).kind).toBe("retryable");
      }
    });

    it("classifies a non-429 4xx response as non_retryable", async () => {
      for (const status of [400, 401, 403, 404]) {
        const fetchMock = vi.fn().mockResolvedValue({ ok: false, status });
        vi.stubGlobal("fetch", fetchMock);
        const port = createResendEmailPort();
        const err = await port.send({ to: "a@x.test", subject: "S", text: "t" }).catch((e) => e);
        expect(err).toBeInstanceOf(EmailSendError);
        expect((err as EmailSendError).message).toBe(`Auth email failed (${status}).`);
        expect((err as EmailSendError).kind).toBe("non_retryable");
      }
    });
  });
});
