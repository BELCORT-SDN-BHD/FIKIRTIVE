/* @nsPage district="Onboarding + 登录" page="login" status="draft"
   sources="区划图·地下管网 / 住户服务(#74);design-rules §3" approvedAt="" pr="" */
"use client";

/**
 * 登录 / 注册页 — 进城的门。
 *
 * 依据:PAGE-INVENTORY 十二·Onboarding 行 1(email/password + 验证、重置;front door 排版)。
 * archetype:§L2 Auth — split hero「flex 1.15 : 1」(hero 隐于 <1024)、表单列 360;
 * coral glow 只落 hero 半边,永不落表单(§O3 account/auth:表单半边零 Otto,决定要读作用户的)。
 * 表单:§F 字段解剖(label→control→help/error 单行槽)、§F4 校验「早奖励晚惩罚」、
 * §F2 输入态、§F10 coral 只许 focus ring;§V 文案(sentence case、无 em-dash、无 please)。
 * 三模式(sign-in / sign-up / reset)本地状态切换,零后台。verify 屏 = 注册后确认态。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Check, CircleAlert, Eye, EyeOff, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { MockNote } from "@/components/northstar/_shared";
import { NS_BRAND } from "@/components/northstar/_mock";

type Mode = "signin" | "signup" | "reset" | "verify";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MODE_COPY: Record<Exclude<Mode, "verify">, { title: string; sub: string; submit: string; pending: string }> = {
  signin: {
    title: "Welcome back",
    sub: "Sign in to pick up where you left off.",
    submit: "Sign in",
    pending: "Signing in…",
  },
  signup: {
    title: "Open your shop",
    sub: "A few details and Otto starts learning your store.",
    submit: "Create account",
    pending: "Creating account…",
  },
  reset: {
    title: "Reset your password",
    sub: "We'll email you a link to set a new one.",
    submit: "Send reset link",
    pending: "Sending…",
  },
};

/* ── 单字段(§F1 解剖:label → control → help/error 单行槽) ── */
function Field({
  id,
  label,
  type = "text",
  value,
  onChange,
  onBlur,
  placeholder,
  autoComplete,
  error,
  help,
  rightLink,
  trailing,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  autoComplete?: string;
  error?: string;
  help?: string;
  rightLink?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] leading-[18px] font-semibold text-foreground">
          {label}
        </label>
        {rightLink}
      </div>
      <div className="relative">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : help ? `${id}-help` : undefined}
          className={cn(
            "h-11 w-full rounded-[14px] border bg-card px-3.5 text-base text-foreground shadow-[var(--shadow-xs)] outline-none transition-[color,border-color,box-shadow] duration-[120ms]",
            "placeholder:text-muted-foreground",
            trailing && "pr-11",
            error
              ? "border-destructive focus-visible:ring-[3px] focus-visible:ring-destructive/40"
              : "border-input hover:border-[color-mix(in_oklab,var(--foreground)_15%,var(--input))] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40",
          )}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="flex items-center gap-1.5 text-[13px] leading-[18px] font-medium text-error-soft-foreground">
          <CircleAlert className="size-3.5 shrink-0" strokeWidth={2} />
          {error}
        </p>
      ) : help ? (
        <p id={`${id}-help`} className="text-xs leading-4 text-muted-foreground">
          {help}
        </p>
      ) : null}
    </div>
  );
}

export default function Page() {
  const [mode, setMode] = React.useState<Mode>("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  // 校验只在 blur 之后且 dirty 才判(§F4 早奖励晚惩罚)
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = React.useState(false);

  const formMode = mode === "verify" ? "signin" : mode;
  const copy = MODE_COPY[formMode];

  const emailValid = EMAIL_RE.test(email);
  const pwValid = password.length >= 8;
  const nameValid = name.trim().length >= 2;

  const showEmailErr = (touched.email || submitted) && email.length > 0 && !emailValid;
  const showPwErr = mode !== "reset" && (touched.password || submitted) && !pwValid;
  const showNameErr = mode === "signup" && (touched.name || submitted) && !nameValid;

  function resetForm(next: Mode) {
    setMode(next);
    setTouched({});
    setSubmitted(false);
    setPending(false);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const ok =
      emailValid &&
      (mode === "reset" || pwValid) &&
      (mode !== "signup" || nameValid);
    if (!ok) return;
    setPending(true);
    // 原型:模拟提交,注册 → verify 屏,其余回复初值
    window.setTimeout(() => {
      setPending(false);
      if (mode === "signup") setMode("verify");
      else if (mode === "reset") setMode("verify");
    }, 1100);
  }

  return (
    <div className="gb flex min-h-dvh bg-background text-foreground">
      {/* ── Hero 半边(§L2:flex 1.15,隐于 <1024;coral glow 只落这半边) ── */}
      <aside className="relative hidden flex-[1.15] flex-col justify-between overflow-hidden border-r border-border bg-secondary/40 p-12 lg:flex">
        {/* coral glow,只落 hero(§O3);低调、非满屏 */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -left-16 size-[420px] rounded-full opacity-[0.14] blur-[80px]"
          style={{ background: "var(--brand)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 bottom-8 size-[320px] rounded-full opacity-[0.10] blur-[80px]"
          style={{ background: "var(--brand)" }}
        />

        <div className="relative flex items-center gap-2.5">
          <OttoAvatar size={32} mood="idle" />
          <span className="text-[17px] font-bold tracking-[-0.01em]">FIKIRTIVE</span>
        </div>

        <div className="relative max-w-[440px]">
          <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.021em] text-foreground">
            Your whole marketing team, in one shop assistant.
          </h1>
          <p className="mt-4 text-[15px] leading-[22px] text-muted-foreground">
            Otto plans your posts, makes the visuals, answers your customers and watches your
            ads. You stay in charge of every spend.
          </p>
          <div className="mt-8 flex flex-col gap-3">
            {[
              "Make a week of content in minutes",
              "Otto drafts, you approve before anything goes out",
              "See what's working in plain words",
            ].map((line) => (
              <div key={line} className="flex items-center gap-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-soft">
                  <Check className="size-3 text-brand-soft-foreground" strokeWidth={3} />
                </span>
                <span className="text-sm text-foreground">{line}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4">
          <OttoAvatar size={40} mood="helpful" />
          <div className="min-w-0">
            <p className="text-sm leading-[1.45] text-foreground">
              "Welcome. Once you're in, show me one product and I'll draft your first post."
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Otto, your shop assistant</p>
          </div>
        </div>
      </aside>

      {/* ── 表单半边(360 列居中;零 coral 除 focus ring) ── */}
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px]">
          {/* 移动端顶部品牌(hero 隐藏时) */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <OttoAvatar size={28} mood="idle" />
            <span className="text-base font-bold tracking-[-0.01em]">FIKIRTIVE</span>
          </div>

          {mode === "verify" ? (
            <VerifyScreen email={email} onBack={() => resetForm("signin")} />
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-[24px] leading-[30px] font-bold tracking-[-0.02em] text-foreground">
                  {copy.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{copy.sub}</p>
              </div>

              <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
                {mode === "signup" && (
                  <Field
                    id="name"
                    label="Your name"
                    value={name}
                    onChange={setName}
                    onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                    placeholder="Aisyah Rahman"
                    autoComplete="name"
                    error={showNameErr ? "Enter your name so Otto knows who to greet." : undefined}
                  />
                )}

                <Field
                  id="email"
                  label="Email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  placeholder="you@yourbrand.com"
                  autoComplete="email"
                  error={showEmailErr ? "Enter a valid email address." : undefined}
                />

                {mode !== "reset" && (
                  <Field
                    id="password"
                    label="Password"
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={setPassword}
                    onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                    placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    error={showPwErr ? "Use at least 8 characters." : undefined}
                    help={mode === "signup" && !showPwErr ? "At least 8 characters." : undefined}
                    rightLink={
                      mode === "signin" ? (
                        <button
                          type="button"
                          onClick={() => resetForm("reset")}
                          className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          Forgot?
                        </button>
                      ) : undefined
                    }
                    trailing={
                      <button
                        type="button"
                        aria-label={showPw ? "Hide password" : "Show password"}
                        onClick={() => setShowPw((v) => !v)}
                        className="flex size-9 items-center justify-center rounded-[10px] text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground"
                      >
                        {showPw ? <EyeOff className="size-4" strokeWidth={2} /> : <Eye className="size-4" strokeWidth={2} />}
                      </button>
                    }
                  />
                )}

                {/* 提交按钮 = 人的动作 = INK(§F10:花钱才提前复述,登录不花钱) */}
                <Button type="submit" size="default" className="mt-1 w-full" disabled={pending}>
                  {pending ? copy.pending : copy.submit}
                </Button>
              </form>

              {mode === "reset" ? (
                <button
                  type="button"
                  onClick={() => resetForm("signin")}
                  className="mt-6 flex w-full items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="size-4" strokeWidth={2} />
                  Back to sign in
                </button>
              ) : (
                <p className="mt-6 text-center text-sm text-muted-foreground">
                  {mode === "signin" ? "New to FIKIRTIVE? " : "Already have an account? "}
                  <button
                    type="button"
                    onClick={() => resetForm(mode === "signin" ? "signup" : "signin")}
                    className="font-semibold text-foreground underline-offset-2 hover:underline"
                  >
                    {mode === "signin" ? "Open your shop" : "Sign in"}
                  </button>
                </p>
              )}

              <p className="mt-8 text-center text-xs leading-4 text-muted-foreground">
                By continuing you agree to our{" "}
                <Link href="/northstar/global/legal" className="underline-offset-2 hover:text-foreground hover:underline">
                  terms
                </Link>{" "}
                and{" "}
                <Link href="/northstar/global/legal" className="underline-offset-2 hover:text-foreground hover:underline">
                  privacy policy
                </Link>
                .
              </p>
            </>
          )}
        </div>
      </main>

      <MockNote path="/northstar/onboarding/login" />
    </div>
  );
}

/* ── Verify 屏(注册 / 重置后确认态:检查邮箱) ── */
function VerifyScreen({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="flex size-14 items-center justify-center rounded-[18px] bg-brand-soft">
        <Mail className="size-6 text-brand-soft-foreground" strokeWidth={2} />
      </span>
      <h2 className="mt-5 text-[24px] leading-[30px] font-bold tracking-[-0.02em] text-foreground">
        Check your email
      </h2>
      <p className="mt-2 max-w-[300px] text-sm leading-[1.5] text-muted-foreground">
        We sent a link to{" "}
        <span className="font-semibold text-foreground">{email || NS_BRAND.email}</span>. Open it to
        confirm and finish setting up.
      </p>
      <Button variant="secondary" size="default" className="mt-6 w-full">
        Resend link
      </Button>
      <button
        type="button"
        onClick={onBack}
        className="mt-4 flex items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" strokeWidth={2} />
        Back to sign in
      </button>
    </div>
  );
}
