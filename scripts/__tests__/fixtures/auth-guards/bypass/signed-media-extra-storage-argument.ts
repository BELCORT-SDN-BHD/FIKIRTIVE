// Bypass class: signed-media authority permits only the exact claims.key storage argument.

import { keyOwnerMatches } from "@fikirtive/core";
import { verifyMediaToken } from "@fikirtive/token-crypto";
import { storage } from "../support/storage";

export async function GET(token: string) {
  const claims = verifyMediaToken(token, "fixture-secret");
  if (!claims) return null;
  if (!keyOwnerMatches(claims.key, claims.ownerId)) return null;
  return storage.get(claims.key, claims.ownerId);
}
