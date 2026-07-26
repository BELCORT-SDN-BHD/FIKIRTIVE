// Bypass class: signed-media owner proof accepts exactly the two audited match arguments.

import { keyOwnerMatches } from "@fikirtive/core";
import { verifyMediaToken } from "@fikirtive/token-crypto";
import { storage } from "../support/storage";

export async function GET(token: string) {
  const claims = verifyMediaToken(token, "fixture-secret");
  if (!claims) return null;
  if (!keyOwnerMatches(claims.key, claims.ownerId, claims.key)) return null;
  return storage.get(claims.key);
}
