"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeftIcon, CheckIcon, MailIcon, RefreshCwIcon } from "lucide-react"

import { AuthPageShell } from "@/components/auth/AuthPageShell"
import { AuthStepCard as StepCard } from "@/components/auth/AuthStepCard"
import { PasswordInput } from "@/components/auth/PasswordInput"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"

import { isAuthReviewStep, type AuthReviewStep } from "./model"
import { authReviewHref } from "./review-links"

const SAMPLE_EMAIL = "founder@yourbrand.com"
const SAMPLE_CODE_LENGTH = 6

function GoogleMark() {
  return (
    <span aria-hidden className="grid size-5 place-items-center rounded-full border border-border bg-card text-[11px] font-bold">
      G
    </span>
  )
}

function ReviewNotice() {
  return (
    <div className="fixed inset-x-0 top-0 z-10 flex h-11 items-center justify-center border-b border-border bg-background/95 px-4 backdrop-blur-sm">
      <Badge variant="outline" className="bg-background font-medium">
        Review fixture · No account is accessed
      </Badge>
    </div>
  )
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ReviewNotice />
      <AuthPageShell>{children}</AuthPageShell>
    </>
  )
}

function BackToHub({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick} className="mx-auto">
      <ArrowLeftIcon aria-hidden />
      Back to login
    </Button>
  )
}

export function AuthAccessJourneyReference({
  initialFrom = "/create",
  initialStep = "hub",
}: {
  initialFrom?: string
  initialStep?: AuthReviewStep
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const routeStep = searchParams.get("step") ?? undefined
  const step = isAuthReviewStep(routeStep) ? routeStep : initialStep
  const from = searchParams.get("from") || initialFrom
  const [email, setEmail] = useState(SAMPLE_EMAIL)
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const [codeSentAgain, setCodeSentAgain] = useState(false)

  function go(next: AuthReviewStep) {
    setNotice(null)
    setCodeSentAgain(false)
    router.push(authReviewHref(next, from), { scroll: false })
  }

  function requireEmail(next: AuthReviewStep) {
    if (!email.trim()) {
      setNotice("Enter your email address.")
      return
    }
    go(next)
  }

  if (step === "hub") {
    return (
      <AuthShell>
        <StepCard
          title="Log in to Fikirtive"
          description="Choose how you want to continue."
          footer={
            <p className="text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <button type="button" onClick={() => go("signup")} className="font-semibold text-foreground underline underline-offset-4">
                Create an account
              </button>
            </p>
          }
        >
          <FieldGroup className="gap-4">
            <div>
              <Button type="button" className="w-full" onClick={() => go("email")}>
                <MailIcon aria-hidden />
                Continue with email
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">You used email last time.</p>
            </div>
            <FieldSeparator>or</FieldSeparator>
            <Button type="button" variant="secondary" className="w-full" onClick={() => go("provider")}>
              <GoogleMark />
              Continue with Google
            </Button>
          </FieldGroup>
        </StepCard>
      </AuthShell>
    )
  }

  if (step === "email") {
    return (
      <AuthShell>
        <StepCard
          title="What's your email address?"
          description="We'll send a temporary login code."
          footer={<BackToHub onClick={() => go("hub")} />}
        >
          <form onSubmit={(event) => { event.preventDefault(); requireEmail("code") }}>
            <FieldGroup className="gap-5">
              {notice ? <Alert role="alert" variant="destructive"><AlertTitle>Email needed</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert> : null}
              <Field data-invalid={notice ? true : undefined}>
                <FieldLabel htmlFor="auth-review-email">Email</FieldLabel>
                <Input
                  id="auth-review-email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(event) => { setEmail(event.target.value); setNotice(null) }}
                  placeholder="you@yourbrand.com"
                />
              </Field>
              <Button type="submit" className="w-full">Continue with email</Button>
              <Button type="button" variant="link" size="sm" onClick={() => requireEmail("password")}>
                Use password instead
              </Button>
            </FieldGroup>
          </form>
        </StepCard>
      </AuthShell>
    )
  }

  if (step === "code") {
    const complete = code.length === SAMPLE_CODE_LENGTH
    return (
      <AuthShell>
        <StepCard
          title="Check your email"
          description={<>We sent a temporary login code to <span className="font-medium text-foreground">{email || SAMPLE_EMAIL}</span>.</>}
          footer={<BackToHub onClick={() => go("hub")} />}
        >
          <form onSubmit={(event) => { event.preventDefault(); if (complete) go("success"); else setNotice("Enter the complete six-digit code.") }}>
            <FieldGroup className="gap-5">
              {notice ? <Alert role="alert" variant="destructive"><AlertTitle>Code not accepted</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert> : null}
              <Field data-invalid={notice ? true : undefined}>
                <FieldLabel htmlFor="auth-review-code" className="sr-only">Login code</FieldLabel>
                <InputOTP
                  id="auth-review-code"
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={SAMPLE_CODE_LENGTH}
                  aria-label="Login code"
                  value={code}
                  onChange={(value) => { setCode(value.replace(/\D/g, "").slice(0, SAMPLE_CODE_LENGTH)); setNotice(null); setCodeSentAgain(false) }}
                  containerClassName="justify-center"
                >
                  <InputOTPGroup>
                    {Array.from({ length: SAMPLE_CODE_LENGTH }, (_, index) => <InputOTPSlot key={index} index={index} />)}
                  </InputOTPGroup>
                </InputOTP>
              </Field>
              <Button type="submit" className="w-full">Continue with login code</Button>
              <div className="flex items-center justify-center gap-1">
                <Button type="button" variant="ghost" size="xs" onClick={() => { setNotice(null); setCodeSentAgain(true) }}>
                  <RefreshCwIcon aria-hidden />
                  Send again
                </Button>
                <Button type="button" variant="ghost" size="xs" onClick={() => { setEmail(""); setCode(""); go("email") }}>
                  Use another email
                </Button>
              </div>
              {codeSentAgain ? <p role="status" className="text-center text-xs text-success-soft-foreground">A new sample code was sent.</p> : null}
            </FieldGroup>
          </form>
        </StepCard>
      </AuthShell>
    )
  }

  if (step === "password") {
    return (
      <AuthShell>
        <StepCard
          title="Enter your password"
          description={<>Continue as <span className="font-medium text-foreground">{email || SAMPLE_EMAIL}</span>.</>}
          footer={<BackToHub onClick={() => go("hub")} />}
        >
          <form onSubmit={(event) => { event.preventDefault(); if (password.length < 8) setNotice("Use at least eight characters in this review."); else go("success") }}>
            <FieldGroup className="gap-5">
              {notice ? <Alert role="alert" variant="destructive"><AlertTitle>Password not accepted</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert> : null}
              <Field data-invalid={notice ? true : undefined}>
                <FieldLabel htmlFor="auth-review-password">Password</FieldLabel>
                <PasswordInput
                  id="auth-review-password"
                  required
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setNotice(null) }}
                />
              </Field>
              <Button type="submit" className="w-full">Log in</Button>
              <div className="flex items-center justify-center gap-2">
                <Button type="button" variant="link" size="xs" onClick={() => go("recovery")}>Forgot password?</Button>
                <span aria-hidden className="text-border">·</span>
                <Button type="button" variant="link" size="xs" onClick={() => go("code")}>Use a login code</Button>
              </div>
            </FieldGroup>
          </form>
        </StepCard>
      </AuthShell>
    )
  }

  if (step === "recovery" || step === "signup") {
    const signup = step === "signup"
    return (
      <AuthShell>
        <StepCard
          title={signup ? "Create your account" : "Reset your password"}
          description={signup ? "Set up your Fikirtive workspace." : "We'll email a one-time reset link if the account exists."}
          footer={<BackToHub onClick={() => go("hub")} />}
        >
          <form onSubmit={(event) => { event.preventDefault(); requireEmail(signup ? "signup-sent" : "recovery-sent") }}>
            <FieldGroup className="gap-5">
              {notice ? <Alert role="alert" variant="destructive"><AlertTitle>Email needed</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert> : null}
              {signup ? <Field><FieldLabel htmlFor="auth-review-shop">Shop name</FieldLabel><Input id="auth-review-shop" required autoFocus placeholder="Kopi Corner" autoComplete="organization" /></Field> : null}
              <Field data-invalid={notice ? true : undefined}>
                <FieldLabel htmlFor="auth-review-recovery-email">Email</FieldLabel>
                <Input id="auth-review-recovery-email" type="email" required autoFocus={!signup} autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setNotice(null) }} />
              </Field>
              {signup ? <Field><FieldLabel htmlFor="auth-review-new-password">Password</FieldLabel><PasswordInput id="auth-review-new-password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" /></Field> : null}
              <Button type="submit" className="w-full">{signup ? "Create account" : "Email me a reset link"}</Button>
            </FieldGroup>
          </form>
        </StepCard>
      </AuthShell>
    )
  }

  if (step === "recovery-sent" || step === "signup-sent") {
    const signup = step === "signup-sent"
    return (
      <AuthShell>
        <StepCard
          title="Check your email"
          description={signup ? <>We sent a confirmation link to <span className="font-medium text-foreground">{email || SAMPLE_EMAIL}</span>.</> : <>If <span className="font-medium text-foreground">{email || SAMPLE_EMAIL}</span> has an account, a one-time reset link is on its way.</>}
          footer={<BackToHub onClick={() => go("hub")} />}
        >
          <div className="rounded-[var(--radius-control)] bg-success-soft px-4 py-3 text-sm leading-6 text-success-soft-foreground">
            {signup ? "Open the link to confirm your email and finish setup." : "The link expires in one hour. You can safely close this page."}
          </div>
        </StepCard>
      </AuthShell>
    )
  }

  if (step === "provider") {
    return (
      <AuthShell>
        <StepCard
          title="Continue with Google"
          description="In production, Google opens only when the server has enabled this provider."
          footer={<BackToHub onClick={() => go("hub")} />}
        >
          <Alert>
            <GoogleMark />
            <AlertTitle>Provider handoff preview</AlertTitle>
            <AlertDescription>No Google window is opened and no account is accessed in this review fixture.</AlertDescription>
          </Alert>
        </StepCard>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <StepCard
        title="You're signed in"
        description={<>The real journey would now return you to <span className="font-medium text-foreground">{from}</span>.</>}
        footer={<Button type="button" variant="ghost" size="sm" onClick={() => { setCode(""); setPassword(""); go("hub") }}>Review again</Button>}
      >
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-success-soft text-success-soft-foreground"><CheckIcon aria-hidden className="size-6" /></div>
          <Button asChild className="w-full">
            <Link href={from.startsWith("/product-patterns/") ? from : "/product-patterns/create"}>
              Continue to Create
            </Link>
          </Button>
          <FieldDescription>This link stays inside the review environment.</FieldDescription>
        </div>
      </StepCard>
    </AuthShell>
  )
}
