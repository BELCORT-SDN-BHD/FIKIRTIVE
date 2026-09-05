import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { EmailSendError } from "../types";
import { createResendEmailPort, resendPortCanSend } from "../resend-adapter";

const DEV_FILE = path.join(process.cwd(), "..", "..", ".data", "last-magic-link.txt");

describe("createResendEmailPort", () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.AUTH_EMAIL_FROM;
    vi.stubEnv("NODE_ENV", "test");
  });
  afterEach(async () => {
    await rm(DEV_FILE, { force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("dev fallback (no RESEND_API_KEY, non-production)", () => {
    it("writes devPreview to <repo>/.data/last-magic-link.txt when given, without hitting the network", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const port = createResendEmailPort();

      await port.send({ to: "a@x.test", subject: "S", text: "Sign in:\nhttps://x.test/verify?t=1\n\nignore.", devPreview: "https://x.test/verify?t=1" });

      expect(await readFile(DEV_FILE, "utf8")).toBe("https://x.test/verify?t=1");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("falls back to text (then html) when devPreview is omitted", async () => {
      const port = createResendEmailPort();
      await port.send({ to: "a@x.test", subject: "S", text: "plain body" });
      expect(await readFile(DEV_FILE, "utf8")).toBe("plain body");
    });

    it("logs the same preview value it persists", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const port = createResendEmailPort();
      await port.send({ to: "a@x.test", subject: "Sign in to Fikirtive", devPreview: "u123" });
      expect(logSpy).toHaveBeenCalledWith("[better-auth] Sign in to Fikirtive for a@x.test: u123");
    });
  });

  // FRONT-A12 —— 「这个部署到底能不能寄出邮件」是一句关于进程的话,不是关于某个地址的话。
  // 登录请求路径靠它决定要不要说「check your email」,所以它必须与 send 的那条分支同源:
  // 谁被单独改一处,这里就变红。
  describe("FRONT-A12 resendPortCanSend — the transport's own readiness, address-independent", () => {
    it("FRONT-A12: says no exactly when a production process has no key", () => {
      vi.stubEnv("NODE_ENV", "production");
      expect(resendPortCanSend()).toBe(false);

      vi.stubEnv("RESEND_API_KEY", "re_live");
      expect(resendPortCanSend()).toBe(true);
    });

    it("FRONT-A12: says yes outside production, where the dev fallback IS a delivery", () => {
      expect(process.env.RESEND_API_KEY).toBeUndefined();
      expect(resendPortCanSend()).toBe(true);
    });

    it("FRONT-A12: agrees with what send() actually does — refusal and throw are one rule", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const port = createResendEmailPort();

      expect(resendPortCanSend()).toBe(false);
      const err = await port.send({ to: "a@x.test", subject: "S", text: "t" }).catch((e) => e);
      expect((err as EmailSendError).kind).toBe("config_missing");
    });
  });

  describe("config_missing classification", () => {
    it("throws EmailSendError(kind: config_missing) when no key is configured in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const port = createResendEmailPort();
      const err = await port.send({ to: "a@x.test", subject: "S", text: "t" }).catch((e) => e);
      expect(err).toBeInstanceOf(EmailSendError);
      expect((err as EmailSendError).message).toBe("RESEND_API_KEY is not configured.");
      expect((err as EmailSendError).kind).toBe("config_missing");
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
