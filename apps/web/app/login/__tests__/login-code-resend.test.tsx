// @vitest-environment jsdom
//
// 接线盘点 L5 —— 登录码这一步的两条「说实话」。
//
// 这里刻意是行为测试而不是源码断言:上一版的 bug(`await sendSignInCode(); setCodeSentAgain(true)`)
// 在源码里长得完全正常,只有真的点一下「Send again」并让它失败,才看得见商家同时读到一条错误
// 和一句「已重发」。
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { LoginForm } from "../LoginForm";
import { requestSignInCode } from "../actions";

// 步与步之间是靠 URL 走的(`loginStepHref` → `router.push` → `useSearchParams`),所以这里的
// 路由必须是活的:push 记下新的 query,测试再重渲一次根节点(同一棵树,组件 state 不丢)。
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

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // `input-otp` 的密码管理器徽标探测每隔一段时间打一次 elementFromPoint,jsdom 没有它。
  // 它与本文件要证明的事无关,补一个空实现,免得定时器把整轮跑挂在无关异常上。
  if (!document.elementFromPoint) {
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
      null;
  }
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

/** 走到 code 步:它要求 email 已经被一次成功的送码填进 state,深链本身到不了。 */
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
  // push 已经把 `?step=code` 记下来了;重渲同一棵树让 useSearchParams 读到它。
  await act(async () => root!.render(tree));

  expect(el.textContent).toContain("Check your email");
  return el;
}

/**
 * 走查修复二 —— 3310 走查看到的那一幕:服务端日志写着
 * `[better-auth] auth email delivery failed: EmailSendError`,页面照样翻到「Check your email /
 * We sent a temporary login code to …」。
 *
 * 这一组钉的是**页面侧**那一半:服务端一旦如实回绝(resolve 的 `{status:"error"}`,不是 reject),
 * 页面必须留在邮箱步说实话,绝不翻页去讲那句「已寄出」。该分支页面早就有
 * (`app/login/LoginForm.tsx:144-147`),但**服务端今天从不触发它**——`app/login/actions.ts:36-38`
 * 仍是「非 invalid_email 一律回成功」。服务端侧怎么改是产品裁决,见
 * `docs/specs/frontend-baseline.md` §5 2026-09-05 尾巴组 F2 那一行(待 Founder 三选一);
 * 这两条是前置围栏:任何一版服务端修法都必须让它们保持绿。
 */
describe("FRONT-A12 — an undeliverable request never becomes 'We sent a temporary login code'", () => {
  it("FRONT-A12: stays on the email step and says why, instead of claiming a code was sent", async () => {
    const tree = createElement(LoginForm, {
      from: "/create",
      googleEnabled: false,
      initialStep: "email" as const,
    });
    // 服务端如实回绝的形状 —— resolve 的 `{status:"error"}`,不是 reject。今天的服务端从不这样
    // 回答(见本组抬头),所以这一幕在生产还不可能发生;这条钉的是它一旦发生页面不会说假话。
    requestSignInCodeMock.mockResolvedValueOnce({
      status: "error",
      reason: "unknown",
      message: "We couldn't send a sign-in code. Try again.",
    });
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

    expect(el.textContent).not.toContain("Check your email");
    expect(el.textContent).not.toContain("We sent a temporary login code to");
    const alert = el.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("Email could not be continued");
    expect(alert!.textContent).toContain("We couldn't send a sign-in code. Try again.");
  });
});

describe("login code step", () => {
  it("FRONT-A12: a 'Send again' the server refuses is not reported as 'A new login code was sent.'", async () => {
    const el = await reachCodeStep();

    requestSignInCodeMock.mockResolvedValueOnce({
      status: "error",
      reason: "unknown",
      message: "We couldn't send a sign-in code. Try again.",
    });
    await act(async () => {
      buttonByText(el, "Send again").click();
    });

    expect(el.textContent).not.toContain("A new login code was sent.");
    expect(el.querySelector('[role="alert"]')!.textContent).toContain(
      "We couldn't send a sign-in code. Try again.",
    );
  });

  it("FRONT-A12: a failed 'Send again' is reported as a failure, never as 'a new code was sent'", async () => {
    const el = await reachCodeStep();

    requestSignInCodeMock.mockRejectedValueOnce(new Error("network down"));
    await act(async () => {
      buttonByText(el, "Send again").click();
    });

    const alert = el.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("We couldn't send a sign-in code. Try again.");
    expect(el.textContent).not.toContain("A new login code was sent.");
  });

  it("FRONT-A12: a successful 'Send again' still says so", async () => {
    const el = await reachCodeStep();

    requestSignInCodeMock.mockResolvedValueOnce({ status: "success", message: "sent" });
    await act(async () => {
      buttonByText(el, "Send again").click();
    });

    expect(el.textContent).toContain("A new login code was sent.");
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it("FRONT-A2: the alert title follows the real branch — resend failure is not 'Code not accepted'", async () => {
    const el = await reachCodeStep();

    requestSignInCodeMock.mockRejectedValueOnce(new Error("network down"));
    await act(async () => {
      buttonByText(el, "Send again").click();
    });

    const alert = el.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Email could not be continued");
    expect(alert.textContent).not.toContain("Code not accepted");
  });

  it("FRONT-A2: a refused code still reads 'Code not accepted'", async () => {
    const el = await reachCodeStep();

    // 空的六位框提交 —— 客户端就把它判成 code_entry,不必打真的 Better Auth。
    await act(async () => {
      el.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    const alert = el.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Code not accepted");
    expect(alert.textContent).toContain("That code didn't work.");
  });
});
