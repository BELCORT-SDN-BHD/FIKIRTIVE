import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../../..");

function readWeb(relativePath: string): string {
  return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

describe("auth design system", () => {
  const loginPage = readWeb("app/login/page.tsx");
  const loginForm = readWeb("app/login/LoginForm.tsx");
  const signupPage = readWeb("app/signup/page.tsx");
  const signupForm = readWeb("app/signup/SignupForm.tsx");
  const authShell = readWeb("components/auth/AuthPageShell.tsx");
  const authStepCard = readWeb("components/auth/AuthStepCard.tsx");
  const reviewFixture = readWeb("design-system/patterns/auth/AuthAccessJourneyReference.tsx");

  it("uses one Fikirtive-owned shell and one step card across fixture and production", () => {
    expect(authShell).toContain("<FikirtiveMark");
    expect(authShell).toContain("fikirtive");
    expect(authShell).not.toContain("OttoMark");
    expect(authStepCard).toContain("<Card");

    for (const source of [loginPage, signupPage]) {
      expect(source).toContain("<AuthPageShell>");
      expect(source).not.toContain("<main");
      expect(source).not.toContain("<svg");
    }
    expect(reviewFixture).toContain('AuthStepCard as StepCard');
    expect(reviewFixture).toContain("<AuthPageShell>");
  });

  it("composes production forms from canonical controls", () => {
    for (const source of [loginForm, signupForm]) {
      expect(source).toContain("<AuthStepCard");
      expect(source).toContain("<FieldGroup");
      expect(source).toContain("<Field");
      expect(source).toContain("<FieldLabel");
      expect(source).toContain("<Alert");
      expect(source).toContain("<Spinner");
      expect(source).not.toContain("<label");
      expect(source).not.toContain("<svg");
      expect(source).not.toContain("style={{");
    }

    expect(loginForm).toContain("<FieldSeparator>or</FieldSeparator>");
    expect(loginForm).toContain("<InputOTP");
    expect(loginForm).toContain("<InputOTPGroup>");
    expect(loginForm).toContain("<InputOTPSlot");
    expect(signupForm).toContain("<PasswordInput");
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
      "Create an account",
      "Continue with email",
      "What's your email address?",
      "We'll send a temporary login code.",
      "Email needed",
      "Use password instead",
      "Check your email",
      "We sent a temporary login code to",
      "Code not accepted",
      "Continue with login code",
      "Send again",
      "Use another email",
      "Enter your password",
      "Password not accepted",
      "Forgot password?",
      "Use a login code",
      "Back to login",
    ]) {
      expect(reviewFixture).toContain(line);
      expect(loginForm).toContain(line);
    }
  });

  // FRONT-A14 —— 错误标题不再靠手挑。上一轮漏掉「Email needed」的病根就是「清单里写了
  // 哪几句就查哪几句」:清单是人挑的,漏了不会红。这里改成**逐个枚举夹具**,例外必须
  // 具名并写明理由 —— 夹具新增一句而生产没跟上,会当场变红。
  it("FRONT-A14 carries every alert title the approved Auth pattern defines", () => {
    // 夹具专有:这块牌子是给走查者看的,告诉他这一步不会真的打开 Google 窗口。
    // 生产在这一步真的跳转,没有、也不该有它。
    const FIXTURE_ONLY = new Set(["Provider handoff preview"]);

    const fixtureTitles = [
      ...new Set(
        [...reviewFixture.matchAll(/<AlertTitle>([^<]+)<\/AlertTitle>/g)].map((match) => match[1]),
      ),
    ];
    expect(fixtureTitles.length).toBeGreaterThan(0);

    for (const title of fixtureTitles) {
      if (FIXTURE_ONLY.has(title)) {
        expect(loginForm).not.toContain(title);
        continue;
      }
      expect(loginForm).toContain(title);
    }
  });

  // FRONT-A14 —— 邮箱步两种错误态,两个标题,不许再合成一个。
  it("FRONT-A14 titles the email step's empty-email refusal exactly as the fixture does", () => {
    // 夹具那一态的触发器:空邮箱按「Use password instead」。
    expect(reviewFixture).toContain("if (!email.trim()) {");
    expect(reviewFixture).toContain('<AlertTitle>Email needed</AlertTitle>');

    // 生产同一条路可达 —— 那颗按钮是 type="button",原生 required 拦不住它,
    // 所以它命中 invalid_email 这条 reason,标题必须是夹具那一句。
    expect(loginForm).toContain('reason: "invalid_email"');
    expect(loginForm).toContain(
      '{error.source === "sign_in_code" && error.reason === "invalid_email"\n'
        + '                    ? "Email needed"\n'
        + '                    : "Email could not be continued"}',
    );

    // 服务端故障(reason "unknown")夹具没有这一态,标题保留主干原句 —— 那时邮箱是好的。
    expect(loginForm).toContain("SIGN_IN_CODE_UNKNOWN_FAILED_MESSAGE");
    expect(reviewFixture).not.toContain("Email could not be continued");
  });

  it("FRONT-A14 leaves 'Sign-in failed' on the hub only — the password step follows the fixture", () => {
    // 密码步从前也写「Sign-in failed」,与夹具的「Password not accepted」不同。hub 上那一句
    // 是对的(社交登录失败与密码无关),所以它只剩一处。
    expect(loginForm.match(/<AlertTitle>Sign-in failed<\/AlertTitle>/g) ?? []).toHaveLength(1);
    expect(loginForm).toContain("<AlertTitle>Password not accepted</AlertTitle>");
    expect(reviewFixture).not.toContain("Sign-in failed");
  });

  it("FRONT-A2 keeps the password refusal existence-neutral", () => {
    // 标题跟设计稿走,但那句中性拒绝不许被改成「该邮箱不存在 / 密码错误」两句话。
    expect(loginForm).toContain('message: "Wrong email or password."');
    expect(loginForm).not.toContain("signInError.message");
  });

  it("keeps signup refusal copy existence-neutral", () => {
    expect(signupForm).toContain('setError("We couldn\'t create the account. Try again.")');
    expect(signupForm).not.toContain("signUpError.message");
  });
});
