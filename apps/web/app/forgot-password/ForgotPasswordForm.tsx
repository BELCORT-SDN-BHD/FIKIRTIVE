"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { AuthStepCard } from "@/components/auth/AuthStepCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authDestination, authRouteHref } from "@/lib/auth-journey";
import { authClient } from "@/lib/better-auth/client";

/** Password-reset request. Its result is neutral and preserves the original destination. */
export function ForgotPasswordForm({ from = "/" }: { from?: string }) {
  const destination = authDestination(from);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const address = email.trim().toLowerCase();
    if (!address) return setError("Enter your email address.");

    setBusy(true);
    setError(null);
    const { error: requestError } = await authClient.requestPasswordReset({
      email: address,
      redirectTo: authRouteHref("/reset-password", destination),
    });
    setBusy(false);
    if (requestError) {
      setError("We couldn't send the link. Try again.");
      return;
    }
    setSent(true);
  }

  const backToLogin = (
    <Link
      href={authRouteHref("/login", destination)}
      className={buttonVariants({ variant: "ghost", size: "sm" })}
    >
      <ArrowLeftIcon aria-hidden />
      Back to login
    </Link>
  );

  if (sent) {
    return (
      <AuthStepCard
        title="Check your email"
        description={
          <>
            If <span className="font-medium text-foreground">{email.trim()}</span> has an account, a
            one-time reset link is on its way.
          </>
        }
        footer={backToLogin}
      >
        <div className="rounded-[var(--radius-control)] bg-success-soft px-4 py-3 text-sm leading-6 text-success-soft-foreground">
          The link expires in one hour. You can safely close this page.
        </div>
      </AuthStepCard>
    );
  }

  return (
    <AuthStepCard
      title="Reset your password"
      description="We'll email a one-time reset link if the account exists."
      footer={backToLogin}
    >
      <form onSubmit={submit}>
        <FieldGroup className="gap-5">
          {error ? (
            <Alert role="alert" variant="destructive">
              <AlertTitle>Reset link could not be sent</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field data-invalid={error === "Enter your email address." ? true : undefined}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoFocus
              placeholder="you@yourbrand.com"
              autoComplete="email"
              aria-invalid={error === "Enter your email address." ? true : undefined}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError(null);
              }}
            />
          </Field>
          <Button type="submit" disabled={busy} className="w-full">
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? "Sending…" : "Email me a reset link"}
          </Button>
        </FieldGroup>
      </form>
    </AuthStepCard>
  );
}
