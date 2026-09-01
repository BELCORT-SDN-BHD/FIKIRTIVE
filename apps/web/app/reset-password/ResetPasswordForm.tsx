"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { MIN_PASSWORD_LENGTH } from "@/app/signup/SignupForm";
import { AuthStepCard } from "@/components/auth/AuthStepCard";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { authDestination, authRouteHref } from "@/lib/auth-journey";
import { authClient } from "@/lib/better-auth/client";

/** Consumes a one-time reset token. Reset does not mint a session. */
export function ResetPasswordForm({ token, from = "/" }: { token: string; from?: string }) {
  const destination = authDestination(from);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
    }

    setBusy(true);
    setError(null);
    const { error: resetError } = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setBusy(false);
    if (resetError) {
      setError("We couldn't set that password. Request a new link and try again.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <AuthStepCard
        title="Password updated"
        description="Log in with your new password."
        footer={
          <Link
            href={authRouteHref("/login", destination)}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Back to login
          </Link>
        }
      >
        <Link
          href={authRouteHref("/login", destination)}
          className={buttonVariants({ className: "w-full" })}
        >
          Continue to login
        </Link>
      </AuthStepCard>
    );
  }

  return (
    <AuthStepCard
      title="Set a new password"
      description="Choose a new password for your account."
      footer={
        <Link
          href={authRouteHref("/login", destination)}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeftIcon aria-hidden />
          Back to login
        </Link>
      }
    >
      <form onSubmit={submit}>
        <FieldGroup className="gap-5">
          {error ? (
            <Alert role="alert" variant="destructive">
              <AlertTitle>Password could not be updated</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field data-invalid={error?.startsWith("Use at least") === true ? true : undefined}>
            <FieldLabel htmlFor="newPassword">New password</FieldLabel>
            <PasswordInput
              id="newPassword"
              name="newPassword"
              aria-label="New password"
              required
              autoFocus
              minLength={MIN_PASSWORD_LENGTH}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              autoComplete="new-password"
              aria-invalid={error?.startsWith("Use at least") === true ? true : undefined}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
            />
          </Field>
          <Button type="submit" disabled={busy} className="w-full">
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? "Saving…" : "Save new password"}
          </Button>
        </FieldGroup>
      </form>
    </AuthStepCard>
  );
}
