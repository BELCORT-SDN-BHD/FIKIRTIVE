// @vitest-environment jsdom
//
// FSE-201 —— 码错到第 4 次，页面必须换一句话。
//
// 走查（`docs/audits/fullstack-staging-2026-09-11/findings-catalog.md` FSE-201）看到的一幕：
// 第 1–4 次错码的提示逐字相同，而服务端在第 4 次就把这个码作废了（`allowedAttempts: 3`，
// better-auth email-otp 的 `atomicVerifyOTP`：第 4 次直接 `TOO_MANY_ATTEMPTS` 且不重建
// verification 行）。商家读到的是同一句「Check it and try again」，于是对着一个已经死掉的
// 码反复重抄。S5 批量裁决 2026-09-12（docs/specs/sign-in.md §5）：第 4 次起改成点名重发新码
// 的人话。
//
// 这一句为什么由**客户端自己数**，而不是读服务端回的 `TOO_MANY_ATTEMPTS`：
// 规格 §1.3 要求「地址被撤销」「暂停期的陌生人」两种拒绝的页面反应与码错一模一样。那两种
// 地址根本不会被铸码（`sendVerificationOTP` 前的 `signInDoorDecision`），所以它们永远拿不到
// `TOO_MANY_ATTEMPTS` —— 一旦文案跟着服务端的错误码分岔，第 4 次读到哪一句就成了「这个地址
// 有没有被撤销／有没有账号」的探针。商家自己按了几次是他自己造成的事实，对任何地址都一样。
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { LoginForm } from "../LoginForm";
import { requestSignInCode } from "../actions";
import { authClient } from "@/lib/better-auth/client";
import {
  SIGN_IN_CODE_REJECTED_MESSAGE,
  SIGN_IN_CODE_SPENT_MESSAGE,
} from "@/lib/better-auth/signin-code-contract";

const nav = vi.hoisted(() => ({ search: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => {
      nav.search = new URLSearchParams(href.split("?")[1] ?? "");
    },
  }),
  useSearchParams: () => nav.search,
}));

vi.mock("../actions", () => ({
  requestSignInCode: vi.fn(),
}));

vi.mock("@/lib/better-auth/client", () => ({
  authClient: {
    signIn: { email: vi.fn(), emailOtp: vi.fn(), social: vi.fn() },
  },
}));

const requestSignInCodeMock = vi.mocked(requestSignInCode);
const emailOtpMock = vi.mocked(authClient.signIn.emailOtp);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // `input-otp` 的密码管理器徽标探测每隔一段时间打一次 elementFromPoint，jsdom 没有它。
  if (!document.elementFromPoint) {
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
      null;
  }
  // 这里**不**去动 `window.location`：本文件每一次提交都走失败路，碰不到成功那一路的
  // `location.assign`；而把它换成一个普通对象会顺着这个 worker 漏给后面的文件（实测打红
  // login-code-resend 的片段用例与 library 那条读 `location.search` 的用例）。
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  nav.search = new URLSearchParams();
  vi.clearAllMocks();
});

async function render(element: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((button) =>
    (button.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`no button labelled ${text}`);
  return found as HTMLButtonElement;
}

/** 走到 code 步：它要求 email 已经被一次成功的送码填进 state，深链本身到不了。 */
async function reachCodeStep() {
  const tree = createElement(LoginForm, {
    from: "/create",
    googleEnabled: false,
    initialStep: "email" as const,
  });
  requestSignInCodeMock.mockResolvedValueOnce({ status: "success", message: "sent" });
  const el = await render(tree);

  const email = el.querySelector<HTMLInputElement>('input[type="email"]')!;
  await act(async () => {
    setReactInputValue(email, "owner@example.com");
  });
  await act(async () => {
    el.querySelector("form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await act(async () => root!.render(tree));

  expect(el.textContent).toContain("Check your email");
  return el;
}

/** 输一个六位码并提交一次；`serverAnswer` 是 better-auth 客户端这一次回的东西。 */
async function submitCode(
  el: HTMLElement,
  digits: string,
  serverAnswer: unknown = { error: { code: "INVALID_OTP", status: 400, message: "Invalid OTP" } },
): Promise<string> {
  const codeInput = el.querySelector<HTMLInputElement>("input#code")!;
  await act(async () => {
    setReactInputValue(codeInput, digits);
  });
  emailOtpMock.mockResolvedValueOnce(serverAnswer as never);
  await act(async () => {
    el.querySelector("form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  const alert = el.querySelector('[role="alert"]');
  if (!alert) throw new Error("提交之后页面没有任何 alert —— 这一次根本没被判成拒绝");
  return alert.textContent ?? "";
}

describe("FSE-201 —— 第 4 次错码不再说和前三次一样的话", () => {
  it("FSE-201: the first three refusals repeat one sentence and the fourth names sending a new code", async () => {
    const el = await reachCodeStep();

    const first = await submitCode(el, "111111");
    const second = await submitCode(el, "222222");
    const third = await submitCode(el, "333333");
    const fourth = await submitCode(el, "444444");

    // 前三次：逐字同一句（服务端此时还在数这个码的三次机会）。
    expect(first).toContain(SIGN_IN_CODE_REJECTED_MESSAGE);
    expect(second).toContain(SIGN_IN_CODE_REJECTED_MESSAGE);
    expect(third).toContain(SIGN_IN_CODE_REJECTED_MESSAGE);

    // 第 4 次：另一句，而且点名要按 Send again 拿新码。
    expect(fourth).not.toContain(SIGN_IN_CODE_REJECTED_MESSAGE);
    expect(fourth).toContain(SIGN_IN_CODE_SPENT_MESSAGE);
    expect(SIGN_IN_CODE_SPENT_MESSAGE).toContain("Send again");
    // 标题仍是已批准夹具那一句 —— 换的是说明，不是这一步的设计。
    expect(fourth).toContain("Code not accepted");
    // 而且它不提这个邮箱（FRONT-A2：拒绝不谈这个地址）。
    expect(fourth).not.toContain("owner@example.com");
    expect(emailOtpMock).toHaveBeenCalledTimes(4);
  });

  it("FSE-201: the fourth sentence stays put while the merchant keeps typing the dead code", async () => {
    // 走查里那一幕的后半段：第 5 次输的是**那封邮件里真正的码**，服务端照样拒（verification
    // 行在第 4 次就没了）。页面这时候不该退回「再检查一下」那句话。
    const el = await reachCodeStep();

    await submitCode(el, "111111");
    await submitCode(el, "222222");
    await submitCode(el, "333333");
    await submitCode(el, "444444");
    const fifth = await submitCode(el, "555555");

    expect(fifth).toContain(SIGN_IN_CODE_SPENT_MESSAGE);
    expect(fifth).not.toContain(SIGN_IN_CODE_REJECTED_MESSAGE);
  });

  it("FSE-201: which sentence appears is decided by the merchant's own count, never by the server's answer", async () => {
    // 同一次数、两种服务端答案 —— 读到的必须逐字相同。撤销地址与暂停期陌生人拿不到
    // TOO_MANY_ATTEMPTS（他们的码从来没被铸出来），文案一旦跟着错误码分岔就是一支探针。
    const invalid = { error: { code: "INVALID_OTP", status: 400, message: "Invalid OTP" } };
    const tooMany = { error: { code: "TOO_MANY_ATTEMPTS", status: 403, message: "Too many attempts" } };

    const withAnswer = async (answer: unknown) => {
      const el = await reachCodeStep();
      const lines = [
        await submitCode(el, "111111", answer),
        await submitCode(el, "222222", answer),
        await submitCode(el, "333333", answer),
        await submitCode(el, "444444", answer),
      ];
      if (root) await act(async () => root?.unmount());
      container?.remove();
      root = null;
      container = null;
      nav.search = new URLSearchParams();
      return lines;
    };

    expect(await withAnswer(invalid)).toEqual(await withAnswer(tooMany));
  });

  it("FSE-201: pressing Send again starts the count over, so the new code's first miss reads like a first miss", async () => {
    const el = await reachCodeStep();

    await submitCode(el, "111111");
    await submitCode(el, "222222");
    await submitCode(el, "333333");
    expect(await submitCode(el, "444444")).toContain(SIGN_IN_CODE_SPENT_MESSAGE);

    requestSignInCodeMock.mockResolvedValueOnce({ status: "success", message: "sent" });
    await act(async () => {
      buttonByText(el, "Send again").click();
    });
    expect(el.textContent).toContain("A new login code was sent.");

    // 码用尽之后 `Send again` 铸的是一个**新**码（`resendStrategy: "reuse"` 只在还有机会时
    // 复用同一个码），新码有它自己的三次机会，所以第一次错回到第一句。
    expect(await submitCode(el, "555555")).toContain(SIGN_IN_CODE_REJECTED_MESSAGE);
  });
});
