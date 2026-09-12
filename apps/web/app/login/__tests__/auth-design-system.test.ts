import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../../..");

function readWeb(relativePath: string): string {
  return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

/**
 * SIGNIN-A4 —— 已批准的 Auth 夹具（`design-system/patterns/auth/AuthAccessJourneyReference.tsx`）
 * 仍然画着密码那一屏与忘记密码入口，而生产已经按 docs/specs/sign-in.md（已冻结 · v1）把密码整体
 * 退役了。夹具是设计权威，改它属于设计侧治理，不在本切片的写集内 —— 所以这里的做法是：把
 * 「夹具有、生产不该有」的每一句**具名列出**并反向断言，而不是把 FRONT-A14 的逐句对照关掉。
 *
 * 具名的代价是：夹具哪天跟上了，这份清单会当场变红，提醒下一个人把它删掉。这正是想要的。
 */
const RETIRED_BY_SIGNIN_A4 = new Set([
  "Use password instead",
  "Enter your password",
  "Password not accepted",
  "Forgot password?",
  "Use a login code",
]);

describe("auth design system", () => {
  const loginPage = readWeb("app/login/page.tsx");
  const loginForm = readWeb("app/login/LoginForm.tsx");
  const authShell = readWeb("components/auth/AuthPageShell.tsx");
  const authStepCard = readWeb("components/auth/AuthStepCard.tsx");
  const reviewFixture = readWeb("design-system/patterns/auth/AuthAccessJourneyReference.tsx");

  it("uses one Fikirtive-owned shell and one step card across fixture and production", () => {
    expect(authShell).toContain("<FikirtiveMark");
    expect(authShell).toContain("fikirtive");
    expect(authShell).not.toContain("OttoMark");
    expect(authStepCard).toContain("<Card");

    expect(loginPage).toContain("<AuthPageShell>");
    expect(loginPage).not.toContain("<main");
    expect(loginPage).not.toContain("<svg");
    expect(reviewFixture).toContain('AuthStepCard as StepCard');
    expect(reviewFixture).toContain("<AuthPageShell>");
  });

  it("composes the production form from canonical controls", () => {
    expect(loginForm).toContain("<AuthStepCard");
    expect(loginForm).toContain("<FieldGroup");
    expect(loginForm).toContain("<Field");
    expect(loginForm).toContain("<FieldLabel");
    expect(loginForm).toContain("<Alert");
    expect(loginForm).toContain("<Spinner");
    expect(loginForm).not.toContain("<label");
    expect(loginForm).not.toContain("<svg");
    expect(loginForm).not.toContain("style={{");

    expect(loginForm).toContain("<FieldSeparator>or</FieldSeparator>");
    expect(loginForm).toContain("<InputOTP");
    expect(loginForm).toContain("<InputOTPGroup>");
    expect(loginForm).toContain("<InputOTPSlot");
    // SIGNIN-A4 —— 生产不再有任何密码控件。
    expect(loginForm).not.toContain("<PasswordInput");
  });

  it("keeps the OTP primitive aligned with the light-only design system", () => {
    const inputOtp = readWeb("components/ui/input-otp.tsx");

    expect(inputOtp).toContain("size-9");
    expect(inputOtp).not.toContain("dark:");
  });

  // FRONT-A14 —— 逐句对照已批准的 Auth pattern。夹具是设计权威;这里钉住的是「同一步上
  // 商家读到的字与设计稿一模一样」,包括错误态的标题(它在 happy path 的走查里看不见,
  // 正是最容易各写各的那一类字)。
  it("FRONT-A14 keeps every login step's copy identical to the approved Auth pattern", () => {
    for (const line of [
      "Log in to Fikirtive",
      "Choose how you want to continue.",
      "Continue with email",
      "What's your email address?",
      "We'll send a temporary login code.",
      "Email needed",
      "Check your email",
      "We sent a temporary login code to",
      "Code not accepted",
      "Continue with login code",
      "Send again",
      "Use another email",
      "Back to login",
      // SIGNIN-A4 —— 夹具里的密码那几句不在这张清单上,它们由下面那条反向断言看着。
      ...RETIRED_BY_SIGNIN_A4,
    ]) {
      expect(reviewFixture).toContain(line);
      if (RETIRED_BY_SIGNIN_A4.has(line)) {
        expect(loginForm, `${line} 已随密码退役,生产不该再有`).not.toContain(line);
        continue;
      }
      expect(loginForm).toContain(line);
    }

    // SIGNIN-A4 —— 「Create an account」是夹具与生产**都**该没有的一句:没有第二个注册页。
    // 夹具今天还留着它,所以这里只对生产断言,并把夹具那一侧写进上面的说明里。
    expect(loginForm).not.toContain("Create an account");
  });

  // FRONT-A14 —— 错误标题不再靠手挑。上一轮漏掉「Email needed」的病根就是「清单里写了
  // 哪几句就查哪几句」:清单是人挑的,漏了不会红。这里改成**逐个枚举夹具**,例外必须
  // 具名并写明理由 —— 夹具新增一句而生产没跟上,会当场变红。
  it("FRONT-A14 carries every alert title the approved Auth pattern defines", () => {
    // 夹具专有:这块牌子是给走查者看的,告诉他这一步不会真的打开 Google 窗口。
    // 生产在这一步真的跳转,没有、也不该有它。
    // SIGNIN-A4 —— 「Password not accepted」加进来的理由与 RETIRED_BY_SIGNIN_A4 同一条:
    // 密码那一屏在生产已经不存在,夹具还画着。
    const FIXTURE_ONLY = new Set(["Provider handoff preview", "Password not accepted"]);

    const fixtureTitles = [
      ...new Set(
        [...reviewFixture.matchAll(/<AlertTitle>([^<]+)<\/AlertTitle>/g)].map((match) => match[1]),
      ),
    ];
    expect(fixtureTitles.length).toBeGreaterThan(0);

    // 只在生产的 <AlertTitle> 块里找 —— 对整份源码做子串匹配的话,中文注释里出现的
    // 同名字符串就能把这条测试喂饱:标题从 JSX 里删掉它照样绿,证明不了它声称的事。
    const loginFormAlertTitles = [
      ...loginForm.matchAll(/<AlertTitle>([\s\S]*?)<\/AlertTitle>/g),
    ]
      .map((match) => match[1])
      .join("\n");
    expect(loginFormAlertTitles.length).toBeGreaterThan(0);

    for (const title of fixtureTitles) {
      if (FIXTURE_ONLY.has(title)) {
        expect(loginFormAlertTitles).not.toContain(title);
        continue;
      }
      expect(loginFormAlertTitles).toContain(title);
    }
  });

  // FRONT-A14 —— 邮箱步两种错误态,两个标题,不许再合成一个。
  it("FRONT-A14 titles the email step's empty-email refusal exactly as the fixture does", () => {
    // 夹具那一态的触发器:空邮箱按「Use password instead」。
    expect(reviewFixture).toContain("if (!email.trim()) {");
    expect(reviewFixture).toContain('<AlertTitle>Email needed</AlertTitle>');

    // 生产同一态可达 —— 夹具靠「Use password instead」触发它,生产那颗按钮随密码退役
    // (SIGNIN-A4),但同一条 reason 仍然走得到:表单是 noValidate,空的/写坏的地址交给
    // `sendSignInCode` 自己判,命中 invalid_email,标题必须是夹具那一句。
    expect(loginForm).toContain('reason: "invalid_email"');

    // 三条互不依赖格式的断言,一起证明「两种错误态、两个标题」这件事。
    // (钉整段带缩进的源码字面量会被一次 prettier 重排在零行为变化下打红。)
    const emailStepTitle = [
      ...loginForm.matchAll(/<AlertTitle>([\s\S]*?)<\/AlertTitle>/g),
    ]
      .map((match) => match[1])
      .find((body) => body.includes("Email needed"));
    expect(emailStepTitle).toBeDefined();
    expect(emailStepTitle).toContain('error.reason === "invalid_email"');
    expect(emailStepTitle).toContain('? "Email needed"');
    expect(emailStepTitle).toContain(": SIGN_IN_CODE_FAILED_TITLE");

    // 服务端故障(reason "unknown")夹具没有这一态,标题保留主干原句 —— 那时邮箱是好的。
    // 那一句现在只写一次(常量),邮箱步与 code 步的「Send again」共用它。
    expect(loginForm).toContain(
      'const SIGN_IN_CODE_FAILED_TITLE = "Email could not be continued"',
    );
    expect(loginForm.match(/"Email could not be continued"/g) ?? []).toHaveLength(1);
    expect(loginForm).toContain("SIGN_IN_CODE_UNKNOWN_FAILED_MESSAGE");
    expect(reviewFixture).not.toContain("Email could not be continued");
  });

  it("FRONT-A14 leaves 'Sign-in failed' on the hub only", () => {
    // 密码步从前也写「Sign-in failed」。那一步随密码退役(SIGNIN-A4),hub 上那一句仍然是对的
    // (社交登录失败与密码无关),所以它只剩一处 —— 数字不变,原因换了。
    expect(loginForm.match(/<AlertTitle>Sign-in failed<\/AlertTitle>/g) ?? []).toHaveLength(1);
    expect(reviewFixture).not.toContain("Sign-in failed");
  });

  it("SIGNIN-A4/FSE-201 keeps the code refusal existence-neutral", () => {
    // 「Wrong email or password.」随密码退役。同一条性质(拒绝不许泄露这个邮箱有没有账号)
    // 现在由码门那两句扛:错、过期、次数用尽在**服务端答案**这一维上仍然合成同一句,而且
    // 不提那个地址。FSE-201 加的第二句(`SIGN_IN_CODE_SPENT_MESSAGE`)按**商家自己按了几次**
    // 挑出来 —— 那个数对每个地址一样,由按的人自己造成,所以它不是探针;「页面不读服务端
    // 那一版答案」这件事由 signin-code-action.test.ts 的 FSE-201 那条围栏钉住。
    expect(loginForm).toContain("SIGN_IN_CODE_REJECTED_MESSAGE");
    expect(loginForm).toContain("SIGN_IN_CODE_SPENT_MESSAGE");
    expect(loginForm).not.toContain("Wrong email or password.");
    expect(loginForm).not.toContain("signInError.message");
  });
});
