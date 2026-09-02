import { sanitizeCallbackURL } from "@/lib/safe-redirect";

export const DEFAULT_AUTH_DESTINATION = "/";

export type LoginStep = "hub" | "email" | "code" | "password";

export function authDestination(from: string | undefined | null): string {
  return sanitizeCallbackURL(from) || DEFAULT_AUTH_DESTINATION;
}

/** Carries one sanitized destination through every public Auth route. */
export function authRouteHref(path: string, from: string | undefined | null): string {
  const destination = authDestination(from);
  if (destination === DEFAULT_AUTH_DESTINATION) return path;
  const params = new URLSearchParams({ from: destination });
  return `${path}?${params.toString()}`;
}

export function loginStepHref(step: LoginStep, from: string | undefined | null): string {
  const destination = authDestination(from);
  const params = new URLSearchParams();
  if (step !== "hub") params.set("step", step);
  if (destination !== DEFAULT_AUTH_DESTINATION) params.set("from", destination);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}

export function parseLoginStep(value: string | undefined | null): LoginStep {
  return value === "email" || value === "code" || value === "password" ? value : "hub";
}
