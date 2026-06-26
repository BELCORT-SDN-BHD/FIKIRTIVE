import "server-only";
import Stripe from "stripe";

// Lazily construct on first USE so importing this module never throws at build/boot when the
// key is absent — Stripe's constructor DOES throw on an empty key. The real key is present at
// runtime when an endpoint calls the API. In production a missing key surfaces a clear error
// at call time (and the build, which never calls the API, stays green).
let _client: Stripe | null = null;
function client(): Stripe {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set — billing is unavailable.");
  _client = new Stripe(key);
  return _client;
}

// Proxy defers construction to the first property access (e.g. `stripe.checkout`, `stripe.webhooks`).
// Importing the module constructs nothing → build/boot safe.
export const stripe = new Proxy({} as Stripe, {
  get(_t, prop) {
    return (client() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
