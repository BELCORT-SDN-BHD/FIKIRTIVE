"use client";

import { useState } from "react";
import Link from "next/link";

import { AuthStepCard } from "@/components/auth/AuthStepCard";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authDestination, authRouteHref } from "@/lib/auth-journey";
import { authClient } from "@/lib/better-auth/client";

export const MIN_PASSWORD_LENGTH = 8;

/** Self-service registration. Verification returns to the same sanitized destination. */
export function SignupForm({
  from,
  starterCredits,
}: {
  from: string;
  starterCredits: number;
}) {
  const destination = authDestination(from);
  const [shopName, setShopName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const name = shopName.trim();
    const address = email.trim().toLowerCase();
    if (!name) return setError("Enter your shop name.");
    if (!address) return setError("Enter your email address.");
    if (password.length < MIN_PASSWORD_LENGTH) {
      return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
    }

    setBusy(true);
    setError(null);
    const { error: signUpError } = await authClient.signUp.email({
      email: address,
      password,
      name,
      callbackURL: destination,
    });
    setBusy(false);
    if (signUpError) {
      setError("We couldn't create the account. Try again.");
      return;
    }
    setSentTo(address);
  }

  if (sentTo) {
    return (
      <AuthStepCard
        title="Check your email"
        description={
          <>
            We sent a confirmation link to{" "}
            <span className="font-medium text-foreground">{sentTo}</span>.
          </>
        }
        footer={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSentTo(null);
              setPassword("");
            }}
          >
            Try a different email
          </Button>
        }
      >
        <div className="rounded-[var(--radius-control)] bg-success-soft px-4 py-3 text-sm leading-6 text-success-soft-foreground">
          Open the link to confirm your email and finish setting up {shopName.trim()}. Your{" "}
          {starterCredits} starter credits are added after confirmation.
        </div>
      </AuthStepCard>
    );
  }

  return (
    <AuthStepCard
      title="Create your account"
      description="Set up your Fikirtive workspace."
      footer={
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={authRouteHref("/login", destination)}
            className="font-semibold text-foreground underline underline-offset-4"
          >
            Log in
          </Link>
        </p>
      }
    >
      <form onSubmit={submit}>
        <FieldGroup className="gap-5">
          {error ? (
            <Alert role="alert" variant="destructive">
              <AlertTitle>Account could not be created</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Field data-invalid={error === "Enter your shop name." ? true : undefined}>
            <FieldLabel htmlFor="shopName">Shop name</FieldLabel>
            <Input
              id="shopName"
              name="shopName"
              required
              autoFocus
              maxLength={80}
              placeholder="Kopi Corner"
              autoComplete="organization"
              aria-invalid={error === "Enter your shop name." ? true : undefined}
              value={shopName}
              onChange={(event) => {
                setShopName(event.target.value);
                setError(null);
              }}
            />
          </Field>

          <Field data-invalid={error === "Enter your email address." ? true : undefined}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              required
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

          <Field data-invalid={error?.startsWith("Use at least") === true ? true : undefined}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <PasswordInput
              id="password"
              name="password"
              aria-label="Password"
              required
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
            {busy ? "Creating your account…" : "Create account"}
          </Button>
        </FieldGroup>
      </form>
    </AuthStepCard>
  );
}
