/**
 * signin-acceptance-map.test.ts —— 登录门规格（docs/specs/sign-in.md，已冻结 · v1）17 条验收
 * 的落点地图。
 *
 * 规格按 issue #1311 的裁决切成五片，**五片都已交付**。编号在这份文件里一律写全（`SIGNIN-Ax`，
 * 不用 `A4/A9` 这种缩写）：下面那条测试按全名对账，缩写等于没点到名。
 *
 *   · ①密码退役（#1316）——SIGNIN-A4、SIGNIN-A9、SIGNIN-A11，真测试在 signin-password-retired.test.ts；
 *   · ②邮箱码门与限流（#1317）、③Google 门（#1318）、④暂停注册与撤销（#1319）、
 *     ⑤端到端旅程（#1320）的落点逐条列在下面的正文里。
 *
 * 这个文件原来的形状是「未交付的每一条一行 `it.todo`」——占位散落在各自将来的文件里会让
 * 「还剩几条没做」需要 grep 全仓才数得出来，集中一份，下一片开工时删掉自己那一行即可。占位
 * 现在一行不剩，文件留下来的是**落点地图**：哪条验收由哪个文件扛，一眼看得到。下一份规格
 * 的欠账仍然照这个形状写在自己的地图文件里。
 *
 * 为什么值得单独一个文件：M3 闸（`scripts/ci/process-gates.sh`）要求被引用规格的每一个验收
 * 编号都能在测试树里找到，`it.todo` 是它明写允许的 S4 早期占位。
 *
 * 纪律：一条 `it.todo` 只能因为**真测试落地**而消失，不能因为「这条不做了」而删 —— 那属于
 * 改规格，走 S1 重新冻结（规格 §5 变更登记）。下面那条活测试守的就是这条纪律的另一半：
 * 地图不许漏条 —— 规格验收表里出现的每一个编号，这份地图都得点到名。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

describe("登录门规格 · 17 条验收的落点地图", () => {
  // ② email 一次性码门与限流（issue #1317）—— 已交付，七行 it.todo 换成了真测试：
  //    · SIGNIN-A1  → lib/__tests__/signin-code-door.test.ts、signup-door.test.ts、
  //                   auth-enumeration-structural.test.ts、better-auth-gate.test.ts
  //    · SIGNIN-A5  → lib/__tests__/signin-code-door.test.ts、auth-email-branding.test.ts、
  //                   app/login/__tests__/login-code-resend.test.tsx
  //    · SIGNIN-A8  → lib/__tests__/signin-code-throttle.test.ts、
  //                   app/login/__tests__/signin-code-action.test.ts、login-code-resend.test.tsx
  //    · SIGNIN-A10 → lib/__tests__/signin-code-door.test.ts、signup-grant-exactly-once.test.ts
  //    · SIGNIN-A15 → lib/__tests__/signin-code-door.test.ts
  //    · SIGNIN-A16 → lib/__tests__/signin-code-door.test.ts、better-auth-gate.test.ts
  //    · SIGNIN-A17 → lib/__tests__/signup-grant-exactly-once.test.ts、signup-hourly-ceiling.test.ts

  // ③ Google 门（issue #1318）—— 已交付，四行 it.todo 换成了真测试：
  //    · SIGNIN-A2  → lib/__tests__/signin-google-door.test.ts
  //    · SIGNIN-A3  → lib/__tests__/signin-google-door.test.ts（码门先／Google 先各一条）
  //    · SIGNIN-A13 → lib/__tests__/signin-google-door.test.ts
  //    · SIGNIN-A14 → lib/__tests__/signin-google-door.test.ts（服务端：真的转到 /login、键是什么）、
  //                   app/login/__tests__/login-google-door-errors.test.tsx（页面：errorCallbackURL
  //                   真的传了、每个键都读同一句）

  // ④ 暂停注册与撤销（issue #1319）—— 两行 it.todo 换成了真测试：
  //    · SIGNIN-A6  → lib/__tests__/signin-pause-and-revoke.test.ts（三条：码门、Google 门、老商家）、
  //                   app/login/__tests__/login-paused-banner.test.tsx（页顶横幅那一半，第 2 轮补齐）
  //    · SIGNIN-A7  → lib/__tests__/signin-pause-and-revoke.test.ts（六条：撤得掉、会话当场失效、
  //                   两扇门都拒、双租户、环境名单仍查撤销、幂等）、
  //                   lib/__tests__/admin-revoke-access-action.test.ts（操作员那个动作，真库；
  //                   含「旧动作回 No pending invite、新动作撤得掉」的对照）、
  //                   lib/__tests__/admin-tenant-invite-ui.test.ts（后台按钮真的调到它）、
  //                   better-auth-gate.test.ts（环境名单命中仍查撤销）、
  //                   better-auth-oauth-session-gate.test.ts（会话闸的库内接线，既有）

  // ⑤ 端到端旅程（issue #1320）—— 最后一行 it.todo 换成了真旅程：
  //    · SIGNIN-A12 → e2e/journeys/23-two-doors-one-workspace.spec.ts（码门首登 → 生成一张图
  //                   → 登出 → 同邮箱 Google 门 → 看到同一张图、同一个工作区；外加一条反证：
  //                   签名不对的 Google 身份进不来，替身不是橡皮图章）

  /**
   * SIGNIN-A1–A17 —— 地图不许漏条。
   *
   * 一份手写的落点地图最容易坏的方式不是写错，是**规格加了一条而地图不知道**：新验收在表里
   * 出现，这里一个字都不动，而 M3 闸只问「测试树里有没有这个字符串」——它不会告诉你这份地图
   * 已经不完整了。所以这条测试直接去读冻结规格的验收表，把编号逐条对回这个文件自己的正文。
   *
   * 它刻意**不**去 grep 测试树：那是 M3 的活（`scripts/ci/process-gates.sh` 按 HEAD 逐条
   * git grep），在这里再写一遍只会得到一份会和它漂移的第二个答案。这条问的是另一个问题：
   * 「这份地图跟得上规格吗」。
   */
  it("SIGNIN-A1–A17 —— 规格验收表里的每个编号，这份地图都点到名（含 SIGNIN-A12 的端到端旅程）", () => {
    const repoRoot = path.resolve(__dirname, "../../../..");
    const spec = readFileSync(path.join(repoRoot, "docs/specs/sign-in.md"), "utf8");
    // 编号只从验收表行（`|` 开头）取，与 M3 闸同一条口径——正文里举例提到的编号不算数。
    const inSpec = [
      ...new Set(
        spec
          .split("\n")
          .filter((line) => line.startsWith("|"))
          .flatMap((line) => line.match(/SIGNIN-A[0-9]+/g) ?? []),
      ),
    ].sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));
    expect(inSpec).toHaveLength(17);

    const map = readFileSync(__filename, "utf8");
    // 词边界：`SIGNIN-A1` 不许被 `SIGNIN-A17` 冒充（这正是让一条缺失的编号悄悄过关的那种匹配）。
    const missing = inSpec.filter((id) => !new RegExp(`${id}\\b`).test(map));
    expect(missing, `这份地图没有点到名的验收编号：${missing.join("、")}`).toEqual([]);
  });
});
