import { sanitizeCallbackURL } from "@/lib/safe-redirect";

export const DEFAULT_AUTH_DESTINATION = "/";

/** SIGNIN-A4 —— 密码那一步随密码退役（docs/specs/sign-in.md 已冻结 · v1）：`"password"` 从这里
 *  拿掉之后，`/login?step=password` 这种旧链接由 `parseLoginStep` 归到 hub，而不是走到一个
 *  再也没有人渲染的分支。 */
export type LoginStep = "hub" | "email" | "code";

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
  return value === "email" || value === "code" ? value : "hub";
}
