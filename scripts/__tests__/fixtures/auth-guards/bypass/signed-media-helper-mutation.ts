// Bypass class: same-package helper mutation revokes verified signed-media key authority.

import { keyOwnerMatches } from "@fikirtive/core";
import { verifyMediaToken } from "@fikirtive/token-crypto";
import { poisonClaims } from "../support/mutate-claims";
import { storage } from "../support/storage";

export async function GET(token: string, attackerKey: string) {
  const claims = verifyMediaToken(token, "fixture-secret");
  if (!claims) return null;
  if (!keyOwnerMatches(claims.key, claims.ownerId)) return null;
  poisonClaims(claims, attackerKey);
  return storage.get(claims.key);
}
