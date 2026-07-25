// Bypass class: the mixed carrier stays untrusted across a one-deep imported helper hop.
"use server";

import { requireOwner } from "../support/auth-guard";
import { loadMixedCarrier } from "../support/mixed-principal-carrier-helper";

export async function leakMixedCarrierImported(input: { ownerId: string }) {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  return loadMixedCarrier({ session: gate, ownerId: input.ownerId });
}
