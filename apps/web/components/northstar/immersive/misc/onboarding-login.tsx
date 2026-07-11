"use client";

/**
 * 沉浸式 · Onboarding 登录 / 注册(entry surface)
 *
 * gallery 里 onboarding/login 还是 stub;内容照 account-ops 先例现建。这是一块设计降级的入口卡:
 * 一个居中 420 表单列(§L3 width ladder),email + 邮件魔链(演示,不发真请求)、社交入口占位、
 * 登录/注册两态井切换(§N4 segmented)。无 Otto、无 coral(继续按钮走 INK)、零后台。
 *
 * 走完 CTA 进产品流:注册 → onboarding/checklist(首跑引导),登录 → create/home。
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OttoAvatar } from "@/components/otto/OttoAvatar";

const BASE = "/northstar-immersive";

type Mode = "signin" | "signup";

const MODES: { value: Mode; label: string }[] = [
  { value: "signin", label: "Sign in" },
  { value: "signup", label: "Create account" },
];

export function OnboardingLogin() {
  const router = useRouter();
  // STALL #16:进城第一屏别把新人当老客。无 session 的首访默认落「Create account」+ 中性欢迎语,
  // 回访用户再手切「Sign in」。原型无真 auth,故首访 = signup 是诚实默认。
  const [mode, setMode] = React.useState<Mode>("signup");
  const [email, setEmail] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const modeRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const activeIdx = MODES.findIndex((m) => m.value === mode);

  const onModeKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (activeIdx + dir + MODES.length) % MODES.length;
    setMode(MODES[next].value);
    modeRefs.current[next]?.focus();
  };

  // 演示:无真 auth。提交 → 进度指示 → 进产品流(注册去引导清单,登录去 create/home)。
  const nextHref = mode === "signup" ? `${BASE}/onboarding/checklist` : `${BASE}/create/home`;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    window.setTimeout(() => router.push(nextHref), 800);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[460px] flex-col justify-center px-6 py-16">
      {/* 品牌头 */}
      <div className="flex flex-col items-center text-center">
        <OttoAvatar size={44} mood="idle" />
        <h1 className="mt-4 text-2xl leading-[30px] font-bold tracking-[-0.02em] text-foreground">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "signin"
            ? "Sign in to pick up where you left off."
            : "One brand, every channel — Otto does the heavy lifting."}
        </p>
      </div>

      {/* 登录 / 注册井 */}
      <div
        role="tablist"
        aria-label="Sign in or create account"
        onKeyDown={onModeKey}
        className="mt-8 inline-flex items-center gap-0.5 self-center rounded-[10px] border border-border bg-card p-0.5"
      >
        {MODES.map((m, i) => {
          const active = m.value === mode;
          return (
            <button
              key={m.value}
              ref={(el) => {
                modeRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setMode(m.value)}
              className={cn(
                "h-[30px] rounded-[8px] px-4 text-xs font-semibold transition-colors duration-[120ms]",
                active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* 表单卡 */}
      <div className="mt-6 rounded-[18px] border border-border bg-card p-6">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">Email</span>
            <input
              type="email"
              required
              disabled={pending}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourbrand.my"
              autoComplete="email"
              className="h-11 w-full rounded-[10px] border border-border bg-background px-3.5 text-[15px] leading-[22px] text-foreground outline-none transition-colors duration-[120ms] placeholder:text-muted-foreground focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
          </label>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="animate-spin" strokeWidth={2} />
                {mode === "signin" ? "Signing you in…" : "Creating your account…"}
              </>
            ) : (
              <>
                {mode === "signin" ? "Send sign-in link" : "Create account"}
                <ArrowRight strokeWidth={2} />
              </>
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            We&rsquo;ll email you a secure link. No password to remember.
          </p>
        </form>
      </div>

      {/* 法务尾注 → 沉浸式 legal */}
      <p className="mt-6 text-center text-xs text-muted-foreground">
        By continuing you agree to our{" "}
        <Link href={`${BASE}/global/legal`} className="font-medium text-foreground underline underline-offset-2">
          terms and privacy policy
        </Link>
        .
      </p>
    </div>
  );
}
