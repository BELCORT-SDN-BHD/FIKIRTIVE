export const AUTH_REVIEW_STEPS = [
  "hub",
  "email",
  "code",
  "password",
  "recovery",
  "recovery-sent",
  "signup",
  "signup-sent",
  "provider",
  "success",
] as const

export type AuthReviewStep = (typeof AUTH_REVIEW_STEPS)[number]

export function isAuthReviewStep(value: string | undefined): value is AuthReviewStep {
  return AUTH_REVIEW_STEPS.includes(value as AuthReviewStep)
}
