import "server-only";
import Stripe from "stripe";

// Build-safe: constructing with an empty key does NOT throw (Stripe only errors on an API
// call). Warn loudly in production so a misconfigured deploy is obvious in logs, mirroring
// the better-auth secret guard. The key is test or live depending on what's set in env.
const key = process.env.STRIPE_SECRET_KEY ?? "";
if (process.env.NODE_ENV === "production" && !key) {
  console.error("[stripe] STRIPE_SECRET_KEY is missing — billing endpoints will fail.");
}

export const stripe = new Stripe(key);
