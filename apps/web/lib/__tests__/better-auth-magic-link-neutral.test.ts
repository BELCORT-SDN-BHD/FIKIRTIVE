import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockAllowedEmailFindUnique = vi.fn();
const mockSend = vi.fn();

vi.mock("@fikirtive/db", () => ({
  prisma: {
    allowedEmail: { findUnique: mockAllowedEmailFindUnique },
  },
}));

vi.mock("@/lib/email", () => ({
  emailPort: { send: mockSend },
}));

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "x".repeat(40);
  process.env.BETTER_AUTH_URL = "http://localhost:3100";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.FOUNDER_ADMIN_EMAILS = "";
  process.env.AUTH_ALLOWED_EMAILS = "";
});

describe("Better Auth enumeration-safe responses", () => {
  beforeEach(() => {
    mockAllowedEmailFindUnique.mockReset();
    mockSend.mockReset();
  });

  it("returns the normal success shape without creating or sending for a non-allowlisted email", async () => {
    mockAllowedEmailFindUnique.mockResolvedValueOnce(null);
    const { auth } = await import("@/lib/better-auth/server");

    const response = await auth.handler(
      new Request("http://localhost:3100/api/better-auth/sign-in/magic-link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3100",
        },
        body: JSON.stringify({
          email: "stranger@example.com",
          callbackURL: "/",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: true });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("makes a non-allowlisted password request indistinguishable from invalid credentials", async () => {
    mockAllowedEmailFindUnique.mockResolvedValueOnce(null);
    const { auth } = await import("@/lib/better-auth/server");

    const response = await auth.handler(
      new Request("http://localhost:3100/api/better-auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3100",
        },
        body: JSON.stringify({
          email: "stranger@example.com",
          password: "not-the-password",
        }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "Invalid email or password",
    });
  });

  it("does not send a reset email for a non-allowlisted existing user", async () => {
    mockAllowedEmailFindUnique.mockResolvedValueOnce(null);
    const { auth } = await import("@/lib/better-auth/server");
    const context = await auth.$context;
    const sendResetPassword = context.options.emailAndPassword?.sendResetPassword;
    expect(sendResetPassword).toBeTypeOf("function");
    if (!sendResetPassword) throw new Error("sendResetPassword is not configured");

    await expect(
      sendResetPassword({
        user: {
          id: "removed-user",
          email: "removed@example.com",
          emailVerified: true,
          name: "Removed",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        url: "http://localhost:3100/reset-password/token",
        token: "token",
      }),
    ).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
