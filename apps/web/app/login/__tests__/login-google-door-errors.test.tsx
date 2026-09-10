// @vitest-environment jsdom
//
// SIGNIN-A14 —— Google 门失败之后，商家在**登录页里**读到的那一句（规格 docs/specs/sign-in.md
// 已冻结 · v1 §1.3、§1.4）。这一份守页面这一半；服务端那一半（回调真的转到 /login，键是什么）
// 在 `lib/__tests__/signin-google-door.test.ts`。
//
// 两件事在这里被钉住：
//   ① LoginForm 按下 Continue with Google 时**必须**把 `errorCallbackURL` 交给 Better Auth。
//      不传，拒绝就落在库自带的 `/api/better-auth/error` 上（那条反向围栏在服务端那一份里）。
//   ② 登录页对**每一个**库真的会发出的键都读同一句。不是一张会分岔的表：规格 §1.3 要求
//      「取消授权」「被撤销」「暂停期陌生人」「邮箱未验证」在页面上读起来完全一样。
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { LoginForm } from "../LoginForm";
import LoginPage from "../page";
import { authClient } from "@/lib/better-auth/client";
import {
  SIGN_IN_REFUSED_EMAIL_UNVERIFIED,
  SIGN_IN_REFUSED_PAUSED,
  SIGN_IN_REFUSED_REVOKED,
  SIGN_IN_REFUSED_UNAVAILABLE,
} from "@/lib/better-auth/signin-refusal";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/better-auth/client", () => ({
  authClient: {
    signIn: { emailOtp: vi.fn(), social: vi.fn(async () => ({ error: null })) },
  },
}));

/** 登录页第一件事是问「已经登录了吗」。这里永远是没有 —— 这一页只在没登录时存在。 */
vi.mock("@/lib/better-auth/compat", () => ({ auth: vi.fn(async () => null) }));

/**
 * 被核对过的错误键清单 —— better-auth 1.6.20（本仓库 `node_modules` 里的 dist），逐条带出处。
 * 键最终都由 `oauth2/errors.mjs` 的 `redirectOnError` 写成 `?error=<键>`，转向的目标就是
 * LoginForm 传下去的 `errorCallbackURL`。
 */
const VERIFIED_ERROR_KEYS: Array<[string, string]> = [
  // ① Google 自己带回来的 error 参数，原样当键（api/routes/callback.mjs:56）。
  //    商家在 Google 的同意页按「取消」就是这一个。
  ["access_denied", "callback.mjs:56 — 供应商回传的 error 原样当键"],
  // ② 回调自己的失败（api/routes/callback.mjs）。
  ["invalid_callback_request", "callback.mjs:51 — query 解析失败"],
  ["no_code", "callback.mjs:59 — 回来了但没有 code"],
  ["oauth_provider_not_found", "callback.mjs:64 — 这个部署没配这个供应商"],
  ["invalid_code", "callback.mjs:76/78 — 拿 code 换 token 失败"],
  ["unable_to_get_user_info", "callback.mjs:85 — 拿不到 userinfo"],
  ["no_callback_url", "callback.mjs:89 — state 里没有 callbackURL"],
  ["email_not_found", "callback.mjs:126 — 供应商没给邮箱"],
  // ③ state 那一段（state.mjs 的 StateError.code，经 oauth2/state.mjs:parseState 转出来）。
  ["state_not_found", "state.mjs:75 — 回调里没有 state"],
  ["state_mismatch", "state.mjs:107/127 — state 找不到或已过期"],
  ["state_invalid", "state.mjs:93 — state 解不开"],
  ["state_generation_error", "state.mjs:68 — 发起时写不下 verification 行"],
  ["internal_server_error", "oauth2/state.mjs:38 — 非 StateError 的解析失败"],
  // ④ handleOAuthUserInfo 的返回值，经 callback.mjs:156-158 的 split(' ').join('_')。
  ["account_not_linked", "link-account.mjs:24 — 同邮箱但不许合并"],
  ["unable_to_link_account", "link-account.mjs:42 — 写 account 行失败"],
  ["signup_disabled", "link-account.mjs:78 — 这个供应商关了隐式注册"],
  ["unable_to_create_user", "link-account.mjs:115/122 — 建用户失败"],
  ["unable_to_create_session", "link-account.mjs:130 — 建会话失败"],
  // ⑤ 我们自己的四种拒绝（lib/better-auth/signin-refusal.ts）。前三种经 ④ 那条路（读 message）
  //    或 callback.mjs:152-155（读 body.code），两条路读的是同一个常量。
  [SIGN_IN_REFUSED_PAUSED, "signin-refusal.ts — 暂停期的陌生人"],
  [SIGN_IN_REFUSED_REVOKED, "signin-refusal.ts — 被撤销的邮箱"],
  [SIGN_IN_REFUSED_UNAVAILABLE, "signin-refusal.ts — 每小时新账号上限撞满"],
  [SIGN_IN_REFUSED_EMAIL_UNVERIFIED, "signin-refusal.ts — Google 报邮箱未验证"],
];

/** 规格 §1.3 逐字。 */
const MESSAGE = "Google sign-in didn't complete. Try again or use email.";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!document.elementFromPoint) {
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => null;
  }
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function render(element: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

describe("SIGNIN-A14 —— Google 门的失败回到登录页", () => {
  it("SIGNIN-A14 —— 按下 Continue with Google 时把 errorCallbackURL 交给 Better Auth，值是 /login", async () => {
    const social = vi.mocked(authClient.signIn.social);
    const dom = await render(
      createElement(LoginForm, { from: "/create", googleEnabled: true, signInCodesAvailable: true }),
    );

    const button = Array.from(dom.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Continue with Google"),
    );
    expect(button).toBeTruthy();
    await act(async () => button!.click());

    expect(social).toHaveBeenCalledTimes(1);
    const arg = social.mock.calls[0]![0] as { provider: string; callbackURL: string; errorCallbackURL: string };
    expect(arg.provider).toBe("google");
    // 成功回原本要去的深链，失败回登录页本身。
    expect(arg.callbackURL).toBe("/create");
    expect(arg.errorCallbackURL).toBe("/login");
  });

  it.each(VERIFIED_ERROR_KEYS)(
    "SIGNIN-A14 —— ?error=%s 在登录页里读到那一句（来源：%s）",
    async (key) => {
      const page = await LoginPage({ searchParams: Promise.resolve({ error: key }) });
      const dom = await render(page);
      expect(dom.textContent).toContain(MESSAGE);
      // 页内提示，不是别处：它躺在登录页自己的 Alert 里。
      const alert = dom.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain(MESSAGE);
    },
  );

  it("SIGNIN-A14 —— 一个认不出来的键也读同一句：这一页的 ?error= 只有 OAuth 回调一个产地", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({ error: "something_new_in_a_future_release" }) });
    const dom = await render(page);
    expect(dom.querySelector('[role="alert"]')?.textContent).toContain(MESSAGE);
  });

  it("SIGNIN-A14 —— 没有 ?error= 就没有 Alert（一进登录页不许平白挂一条失败）", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({}) });
    const dom = await render(page);
    expect(dom.querySelector('[role="alert"]')).toBeNull();
  });
});
