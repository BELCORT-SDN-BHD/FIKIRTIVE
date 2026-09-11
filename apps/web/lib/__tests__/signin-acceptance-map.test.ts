/**
 * signin-acceptance-map.test.ts —— 登录门规格（docs/specs/sign-in.md，已冻结 · v1）17 条验收
 * 的落点地图。
 *
 * 规格按 issue #1311 的裁决切成五片。已交付：第①片（密码退役，SIGNIN-A4/A9/A11，issue #1316）、
 * 第②片（邮箱码门与限流，SIGNIN-A1/A5/A8/A10/A15/A16/A17，issue #1317）、第③片（Google 门，
 * SIGNIN-A2/A3/A13/A14，issue #1318）。剩下 3 条属于④⑤片，今天**还没有**真测试 —— 这个文件
 * 把这件事写成机器看得见的形状，而不是让它躺在某个人的记忆里：
 *
 *   · 已交付的三条不在这里，它们有真行为测试（signin-password-retired.test.ts）；
 *   · 未交付的每一条是一行 `it.todo`，逐字带编号、点名它属于哪一片、由哪张票接手。
 *
 * 为什么值得单独一个文件：M3 闸（`scripts/ci/process-gates.sh`）要求被引用规格的每一个验收
 * 编号都能在测试树里找到，`it.todo` 是它明写允许的 S4 早期占位。占位散落在各自将来的文件里
 * 会让「还剩几条没做」需要 grep 全仓才数得出来；集中一份，下一片开工时删掉自己那一行即可。
 *
 * 纪律：一条 `it.todo` 只能因为**真测试落地**而消失，不能因为「这条不做了」而删 —— 那属于
 * 改规格，走 S1 重新冻结（规格 §5 变更登记）。
 */
import { describe, it } from "vitest";

describe("登录门规格 · 尚未交付的验收（各自的切片接手时把这一行换成真测试）", () => {
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
  //    · SIGNIN-A6  → lib/__tests__/signin-pause-and-revoke.test.ts（五条：码门、Google 门、
  //                   只有一张邀请的、只写在环境名单里的、老商家）、
  //                   app/login/__tests__/login-paused-banner.test.tsx（页顶横幅那一半，第 2 轮补齐）
  //    · SIGNIN-A7  → lib/__tests__/signin-pause-and-revoke.test.ts（十四条：撤得掉、会话当场失效、
  //                   两扇门都拒、双租户、环境名单仍查撤销、founder 名单盖不过撤销、founder 地址撤
  //                   不动、闸读过之后才提交的撤销、没有撤销时不动会话、撤销后走真码门、幂等，外加
  //                   第 5 轮两条握锁的并发用例（after 钩子的接线、那一次读真的是 FOR SHARE）与第 6
  //                   轮那条「等不到就超时、fail closed」）、
  //                   lib/__tests__/admin-revoke-access-action.test.ts（操作员那个动作，真库；
  //                   含「旧动作回 No pending invite、新动作撤得掉」的对照）、
  //                   lib/__tests__/admin-tenant-invite-ui.test.ts（后台按钮真的调到它）、
  //                   better-auth-gate.test.ts（七条：环境名单命中仍查撤销、founder 名单也不短路、
  //                   环境名单不等于登录过，二次确认删会话失败时的告警两条，外加第 6 轮两条
  //                   fail-closed 分支：FOR SHARE 那次读失败、读不到 ba_user 邮箱行）、
  //                   better-auth-oauth-session-gate.test.ts（会话闸的库内接线，既有）

  // ⑤ 端到端旅程（issue #1311 的第五片）
  it.todo("SIGNIN-A12 —— 陌生邮箱收码登录 → 生成一张图 → 登出 → 同邮箱 Google 登录，看到刚才那张图、始终同一个工作区");
});
