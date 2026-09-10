/**
 * signin-acceptance-map.test.ts —— 登录门规格（docs/specs/sign-in.md，已冻结 · v1）17 条验收
 * 的落点地图。
 *
 * 规格按 issue #1311 的裁决切成五片，本次交付的是第①片（密码退役，SIGNIN-A4/A9/A11，issue
 * #1316）。剩下 14 条属于②③④⑤片，今天**还没有**真测试 —— 这个文件把这件事写成机器看得见的
 * 形状，而不是让它躺在某个人的记忆里：
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
  // ② email 一次性码门与限流（issue #1318）
  it.todo("SIGNIN-A1 —— 陌生邮箱按 Continue with email、手输六位码，直接进产品，账号与工作区已建立");
  it.todo("SIGNIN-A5 —— 点邮件里的 Log in 按钮：码已填好，按一次 Continue 即登录；同一链接第二次无效；15 分钟后无效");
  it.todo("SIGNIN-A8 —— 一小时内第 6 次要码被拒；一个码连错 4 次要求重新发码；陌生与老邮箱的响应时间与文案一致");
  it.todo("SIGNIN-A10 —— 两扇门各建一个新账号：工作区名都为空、赠金各恰好一笔 SIGNUP_GRANT_CREDITS、emailVerified=true、登录审计各一行");
  it.todo("SIGNIN-A15 —— 首登建号中途失败一次，同一邮箱再登录一次成功；库里只有一个用户、一个工作区、一笔赠金");
  it.todo("SIGNIN-A16 —— Aisha@Example.com 与 aisha@example.com 落到同一个账号；AllowedEmail 只有一行小写");
  it.todo("SIGNIN-A17 —— +tag 与点号变体只领一笔赠金；全站每小时新账号超过上限后第 51 个进不来并告警，老用户不受影响");

  // ③ Google 门（issue #1317）
  it.todo("SIGNIN-A2 —— 陌生 Google 账号按 Continue with Google 直接进产品，账号与工作区已建立");
  it.todo("SIGNIN-A3 —— 同一邮箱先码门后 Google（再反过来）进的是同一个账号、同一个工作区，库里只有一个用户");
  it.todo("SIGNIN-A13 —— Google 报「邮箱未验证」的账号被拒并回 /login 提示改用 email，数据库里不建任何用户行");
  it.todo("SIGNIN-A14 —— Google 门的每一种失败都回到 /login 页内提示，从不落在 better-auth 自带错误页或裸 JSON");

  // ④ 暂停注册与撤销（issue #1330）
  it.todo("SIGNIN-A6 —— SIGNUPS_PAUSED 打开：页顶横幅、陌生人两扇门都进不来且不建账号不寄码、老用户正常进入");
  it.todo("SIGNIN-A7 —— 撤销一个自助进来的邮箱：后台撤得掉、他已登录的会话下一次请求即失效、两扇门都进不来且不说明原因");

  // ⑤ 端到端旅程（issue #1311 的第五片）
  it.todo("SIGNIN-A12 —— 陌生邮箱收码登录 → 生成一张图 → 登出 → 同邮箱 Google 登录，看到刚才那张图、始终同一个工作区");
});
