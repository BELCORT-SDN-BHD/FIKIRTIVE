/**
 * Journey 22 — 密码那三扇门不在了，旧链接也没有断。
 *
 * 这条旅程原本叫 "reset password"：商家走 `/forgot-password`、收重置信、设新密码、用新密码登录。
 * 密码整体退役之后（docs/specs/sign-in.md，已冻结 · v1）那条链的每一环都不存在了，所以旅程按
 * 验收 SIGNIN-A4 重写 —— 同一个位置，钉的是「退役之后商家真的会看到什么」。
 *
 * 两件事一起才算数：
 *   · 旧地址不能断。三个地址都还答话，而且答的是 `/login` —— 直接删路由会让邮件、书签和外部
 *     链接落到 404，商家读到的是「这个产品没了」。
 *   · 端点也得没。页面转向只管人的眼睛；密码真正的入口是那七条 HTTP 端点，它们必须对公网 404。
 *     只钉页面的旅程会在一个「表面没有密码框、`/sign-up/email` 照样能建密码」的产品上全绿。
 */
import { test, expect } from "@playwright/test";

/** 验收 A4 逐字点名的七条密码路径。 */
const RETIRED_PASSWORD_ENDPOINTS = [
  "/sign-up/email",
  "/sign-in/email",
  "/forget-password",
  "/reset-password",
  "/change-password",
  "/set-password",
  "/request-password-reset",
];

test("SIGNIN-A4 — /signup, /forgot-password and /reset-password all land on /login", async ({ page }) => {
  for (const retired of ["/signup", "/forgot-password", "/reset-password"]) {
    await page.goto(retired);
    await expect(page, `${retired} 没有回到 /login`).toHaveURL(/\/login/);
    // 落地的是真的登录页，不是一个空壳。
    await expect(page.getByRole("heading", { name: "Log in to Fikirtive" })).toBeVisible();
    // 而且落地之后一样没有密码框。
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  }
});

test("SIGNIN-A4 — every password endpoint answers 404 to the public", async ({ page }) => {
  for (const endpoint of RETIRED_PASSWORD_ENDPOINTS) {
    const response = await page.request.post(`/api/better-auth${endpoint}`, {
      data: {
        email: "doors@e2e.test",
        password: "correct-horse-battery-staple",
        newPassword: "correct-horse-battery-staple",
        currentPassword: "correct-horse-battery-staple",
        name: "Doors",
        token: "probe-token",
      },
      failOnStatusCode: false,
    });
    expect(response.status(), `${endpoint} 应该 404，实得 ${response.status()}`).toBe(404);
  }

  // 对照组：退的是密码，不是登录。码门那一扇仍然答话（拒是对的，404 才是误伤）。
  const codeDoor = await page.request.post("/api/better-auth/sign-in/email-otp", {
    data: { email: "doors@e2e.test", otp: "000000" },
    failOnStatusCode: false,
  });
  expect(codeDoor.status()).not.toBe(404);
});
