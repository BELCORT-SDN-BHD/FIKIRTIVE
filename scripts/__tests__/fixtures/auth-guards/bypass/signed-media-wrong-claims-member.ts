// Bypass class: only claims.ownerId may bind the verified claims.key.

import { keyOwnerMatches } from "@fikirtive/core";
import { verifyMediaToken } from "@fikirtive/token-crypto";
import { storage } from "../support/storage";

export async function GET(token: string) {
  const claims = verifyMediaToken(token, "fixture-secret");
  if (!claims) return null;
  if (!keyOwnerMatches(claims.key, claims.audience)) return null;
  return storage.get(claims.key);
}
