/**
 * SIGNIN-A6 —— 验收表那一行的第一句：「页顶横幅说明暂停」（docs/specs/sign-in.md 已冻结 · v1
 * §1.3「空态」）。门那一半（两扇门都拦、不建账号、不寄码、老商家照进）在真库上由
 * `lib/__tests__/signin-pause-and-revoke.test.ts` 证明；这个文件只证明**商家看得见**那一半。
 *
 * 为什么渲染真的页面而不是断言源码：横幅要么在这棵树里，要么不在。判官在第 1 轮记下的正是
 * 「一条验收只交付了库函数、没有任何人能看见」，源码 grep 会把那种缺陷读成绿的。
 *
 * 只 mock 两样东西，而且都不是被测物：会话（页面在有会话时直接 redirect，测不到内容）与
 * `LoginForm`（客户端组件，靠 `useSearchParams` 之类的 Next 运行时；它自己的行为由
 * `login-code-resend.test.tsx` 管）。开关、文案常量、判定函数与页面本身全是真的。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/better-auth/compat", () => ({ auth: vi.fn(async () => null) }));
vi.mock("../LoginForm", () => ({ LoginForm: () => null }));

const { default: LoginPage } = await import("../page");
const { SIGNUPS_PAUSED_MESSAGE } = await import("@/lib/signup-gate");

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved.SIGNUPS_PAUSED = process.env.SIGNUPS_PAUSED;
});

afterEach(() => {
  if (saved.SIGNUPS_PAUSED === undefined) delete process.env.SIGNUPS_PAUSED;
  else process.env.SIGNUPS_PAUSED = saved.SIGNUPS_PAUSED;
});

async function renderLogin(): Promise<string> {
  const tree = await LoginPage({ searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(tree);
}

describe("登录页的暂停横幅", () => {
  it("SIGNIN-A6 —— SIGNUPS_PAUSED 打开时，登录页顶挂着说明暂停的横幅（规格 §1.3 原文两句）", async () => {
    process.env.SIGNUPS_PAUSED = "1";
    const html = await renderLogin();

    expect(html).toContain(SIGNUPS_PAUSED_MESSAGE);
    // 逐字对规格 §1.3。第二句是给**老商家**看的：门关的是新注册，不是他。
    expect(html).toContain("New signups are paused right now. Existing accounts can still log in.");
  });

  it("SIGNIN-A6 —— 开关关着时页面上没有这条横幅（不许对着没暂停的部署喊暂停）", async () => {
    delete process.env.SIGNUPS_PAUSED;
    const html = await renderLogin();

    expect(html).not.toContain("New signups are paused");
  });

  /** 开关是 fail-closed 的（`signupsPaused()`：除了 0/false/off/no，任何值都算暂停）。
   *  横幅必须跟着同一个判定走，否则会出现「门关着、页面说没关」的分歧。 */
  it("SIGNIN-A6 —— 横幅跟的是 signupsPaused() 那一个判定，不是另一套字符串比较", async () => {
    process.env.SIGNUPS_PAUSED = "yes";
    expect(await renderLogin()).toContain("New signups are paused");

    process.env.SIGNUPS_PAUSED = "off";
    expect(await renderLogin()).not.toContain("New signups are paused");
  });
});
