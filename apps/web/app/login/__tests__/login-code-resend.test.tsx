// @vitest-environment jsdom
//
// 登录页「不许说一句自己做不到的话」—— 三组围栏。
//
// 抬头随内容改过一次(#1223 P2-2):这个文件起初只有接线盘点 L5 那两条(code 步的「Send again」
// 报假成功、错误标题写死),#1223 又加了邮箱步那一条;#1223 已由 #1229 取代并入主干,现在这里
// 是三组 ——
//   ① `FRONT-A12 — a deployment that cannot send mail says so on the email step`
//      (Founder 2026-09-05 裁决①「按环境提示」:部署级判定,含能寄信的控制组);
//   ② `FRONT-A12 — a refused request never becomes 'We sent a temporary login code'`
//      (#1223 那条页面侧围栏:能寄信的部署上服务端如实回绝,页面留在邮箱步);
//   ③ `login code step`(code 步的「Send again」与两种错误标题);
//   ④ `FRONT-A12 — an invalid address on the email step speaks with one voice`
//      (判官 #1237 P2-3:同一个「地址不对」不许有原生气泡与自家提示两个产地)。
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
 * Founder 2026-09-05 裁决①「按环境提示」定下的口径,是这一组现在钉的东西:判断落在**部署**
 * 层——这个部署有没有邮件通道(`lib/email/transport.ts` 的 `emailDeliveryAvailable()`,一次
 * env 读,对每个地址同一个答案),服务端算好了当 prop 递给页面(`app/login/page.tsx`),页面
 * 在**输入邮箱那一步**就说出来,而不是翻到下一屏再讲一句假的「已寄出」。措辞只提环境、不提
 * 邮箱,所以它不构成「这个地址有没有账号」的探针(FRONT-A2);单封信投递失败仍然是运维信号,
 * 与这件事不是一回事(`lib/better-auth/signin-code-contract.ts`)。
 *
 * 下面第二组(code 步的「Send again」)钉的是页面侧的通用围栏:服务端**任何**一版如实回绝
 * (resolve 的 `{status:"error"}`,不是 reject)都不许被报成「已重发」。
 */
describe("FRONT-A12 — a deployment that cannot send mail says so on the email step", () => {
  const ENVIRONMENT_SENTENCE = "Sign-in codes aren't available in this environment yet.";

  function emailStep(signInCodesAvailable: boolean) {
    return createElement(LoginForm, {
      from: "/create",
      googleEnabled: false,
      signInCodesAvailable,
      initialStep: "email" as const,
    });
  }

  it("FRONT-A12: says the environment sentence and never claims a code was sent", async () => {
    const el = await render(emailStep(false));

    expect(el.textContent).toContain(ENVIRONMENT_SENTENCE);
    // 这一步原本许下的承诺,现在不说了。
    expect(el.textContent).not.toContain("We'll send a temporary login code.");
    expect(el.textContent).not.toContain("Check your email");
    expect(el.textContent).not.toContain("We sent a temporary login code to");
  });

  it("FRONT-A12: the button is disabled and a submit still asks the server for nothing", async () => {
    const el = await render(emailStep(false));

    expect(buttonByText(el, "Continue with email").disabled).toBe(true);
    const email = el.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => {
      setReactInputValue(email, "owner@example.com");
    });
    // 输入框里按 Enter 的隐式提交也走这一条 —— 页面绝不能因此翻页。
    await act(async () => {
      el.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(requestSignInCodeMock).not.toHaveBeenCalled();
    expect(el.textContent).not.toContain("Check your email");
    expect(el.textContent).not.toContain("We sent a temporary login code to");
  });

  it("FRONT-A2: the sentence talks about the environment, never about this email address", async () => {
    const el = await render(emailStep(false));
    const shown = el.textContent ?? "";
    expect(shown).not.toContain("owner@example.com");
    expect(ENVIRONMENT_SENTENCE).not.toMatch(/email|address|account/i);
  });

  it("FRONT-A12: a deployment that CAN send mail is unchanged — it still reaches 'Check your email'", async () => {
    // 控制组。少了它,「永远显示环境句」的实现也会让上面三条全绿。
    const tree = emailStep(true);
    requestSignInCodeMock.mockResolvedValueOnce({ status: "success", message: "sent" });
    const el = await render(tree);

    expect(el.textContent).toContain("We'll send a temporary login code.");
    expect(el.textContent).not.toContain(ENVIRONMENT_SENTENCE);
    expect(buttonByText(el, "Continue with email").disabled).toBe(false);

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
    expect(el.textContent).toContain("We sent a temporary login code to");
  });
});

/**
 * #1223 那条页面侧围栏,回补(#1229 判官 P2-3:被环境口径那一组改写时净减掉了)。
 *
 * 上一组说的是「这个**部署**寄不出信」——判定在 env 上,按钮根本按不下去。这一组说的是另一半:
 * 部署**能**寄信(`signInCodesAvailable` 为真、按钮可按),而服务端对这一次请求如实回绝
 * (resolve 的 `{status:"error"}`,不是 reject)。今天的服务端在这条路上从不这样回答
 * (`app/login/actions.ts` 只在部署级判定与地址格式两处回绝,单封投递失败按 #678 留在运维日志里),
 * 所以这一幕在生产还不可能发生;这条钉的是它一旦发生,页面不会翻到「已寄出」那一屏说假话。
 * 任何一版让服务端如实回绝的修法都必须让它保持绿。
 */
describe("FRONT-A12 — a refused request never becomes 'We sent a temporary login code'", () => {
  it("FRONT-A12: stays on the email step and says why, instead of claiming a code was sent", async () => {
    const tree = createElement(LoginForm, {
      from: "/create",
      googleEnabled: false,
      // 能寄信的部署 —— 与上一组的区别就在这一格。
      signInCodesAvailable: true,
      initialStep: "email" as const,
    });
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
    // 服务端真的被问了 —— 少了这条,一个「什么都不做」的实现也能让下面全绿。
    expect(requestSignInCodeMock).toHaveBeenCalledTimes(1);
    await act(async () => root!.render(tree));

    expect(el.textContent).not.toContain("Check your email");
    expect(el.textContent).not.toContain("We sent a temporary login code to");
    // 还站在邮箱步上,而且说了原因。
    expect(el.textContent).toContain("your email address?");
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

/**
 * 第四组 —— 同一个「地址不对」只许有一个产地(判官 #1237 P2-3)。
 *
 * 邮箱这一步有两条路会碰到无效地址:提交(`Continue with email`,以及在输入框里按 Enter)与
 * `Use password instead`。后者是 `type="button"`,浏览器的原生校验碰不到它,所以它一直走
 * 产品自己那句 `Enter a valid email address.`;而提交那一路被 `type="email" required` 的原生
 * 气泡先接走 —— 措辞、样式、语言都不一样,商家读到哪一句全看他按了哪颗键。
 *
 * 这一组钉的是收成一句之后的状态:表单 `noValidate`,两条路读到逐字相同的一句。
 * 摘掉 `noValidate` ⇒ 第一条当场红;把任一条路换成第二种措辞 ⇒ 第二条当场红。
 */
describe("FRONT-A12 — an invalid address on the email step speaks with one voice", () => {
  function emailStepTree() {
    return createElement(LoginForm, {
      from: "/create",
      googleEnabled: false,
      signInCodesAvailable: true,
      initialStep: "email" as const,
    });
  }

  it("FRONT-A12: the email step opts out of the browser's native bubble, so the product's own message is the one shown", async () => {
    const el = await render(emailStepTree());
    const form = el.querySelector("form")!;

    // 原生气泡是第二个产地:jsdom 不画它,所以只能钉「这条路已经交回给我们自己的检查」。
    expect(form.noValidate, "表单还开着浏览器原生校验 —— 提交这一路会先弹原生气泡").toBe(true);
    // 输入框的语义不受影响:键盘形态与无障碍语义都还在,只是不再另开一个错误产地。
    const email = el.querySelector<HTMLInputElement>('input[type="email"]')!;
    expect(email.required).toBe(true);
  });

  it("FRONT-A12: submitting a bad address and asking for the password path give the SAME single sentence", async () => {
    const el = await render(emailStepTree());
    const email = el.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => {
      setReactInputValue(email, "not-an-address");
    });

    const said: string[] = [];

    // 路一:提交。
    await act(async () => {
      el.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    said.push(el.querySelector('[role="alert"]')!.textContent ?? "");
    // 地址都没解析过,服务端一次都不该被问 —— 少了这条,一个「先送出去再说」的实现也能绿。
    expect(requestSignInCodeMock).not.toHaveBeenCalled();

    // 路二:`Use password instead`(type="button",原生校验碰不到它)。
    await act(async () => buttonByText(el, "Use password instead").click());
    said.push(el.querySelector('[role="alert"]')!.textContent ?? "");

    expect(said[0]).toContain("Enter a valid email address.");
    expect(new Set(said).size, `两条路说了两句不同的话:${said.join(" / ")}`).toBe(1);
    // 两条路都留在邮箱步,没有一条把商家推去下一屏。
    expect(el.textContent).toContain("your email address?");
  });
});
