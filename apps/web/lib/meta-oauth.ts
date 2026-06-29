import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export const META_GRAPH_VERSION = "v21.0";
const STATE_TTL_MS = 10 * 60 * 1000;

function stateSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set");
  return s;
}
function hmac(data: string): string {
  return createHmac("sha256", stateSecret()).update(data).digest("base64url");
}

/** Signed CSRF state: base64url({o,n,t}) + "." + HMAC. */
export function signState(ownerId: string, now: number = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ o: ownerId, n: randomBytes(8).toString("hex"), t: now }),
  ).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

/** Verify the state's HMAC + TTL; returns { ownerId } or null. Constant-time signature compare. */
export function verifyState(state: string, now: number = Date.now()): { ownerId: string } | null {
  const dot = state.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: { o?: string; t?: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed.o || typeof parsed.t !== "number") return null;
  if (now - parsed.t > STATE_TTL_MS) return null;
  return { ownerId: parsed.o };
}

/** The Meta OAuth consent URL — requests ads + page scopes (user may decline individual ones). */
export function buildAuthorizeUrl(appId: string, redirectUri: string, state: string): string {
  const u = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", "ads_read,ads_management,pages_show_list,business_management");
  u.searchParams.set("response_type", "code");
  return u.toString();
}
