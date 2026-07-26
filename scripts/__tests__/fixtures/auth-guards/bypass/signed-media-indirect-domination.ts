// Bypass class: a stored boolean is not direct lexical domination by the exact owner match.

import { keyOwnerMatches } from "@fikirtive/core";
import { verifyMediaToken } from "@fikirtive/token-crypto";
import { storage } from "../support/storage";

export async function GET(token: string) {
  const claims = verifyMediaToken(token, "fixture-secret");
  if (!claims) return null;
  const matched = keyOwnerMatches(claims.key, claims.ownerId);
  if (!matched) return null;
  return storage.get(claims.key);
}
