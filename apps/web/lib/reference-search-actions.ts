"use server";

import { isReferenceType, type ReferenceType } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { searchReferences } from "./reference-search";
import { REFERENCE_PAGE_LIMIT, type ReferenceSearchPage } from "./reference-search-model";

/**
 * The `@` reference picker's one call into the server (spec §7.3③, FRONT-A10).
 *
 * The client sends a query, a type filter and a cursor. It does NOT send an owner: the tenant
 * comes from `requireOwner()` — the authenticated principal — exactly as every other tenant read
 * in this app does, so a hand-written request cannot ask about another workspace's library.
 *
 * An unauthenticated or unresolvable caller gets an empty page rather than an error string: this
 * is a type-ahead menu, and the honest behaviour when there is no tenant is "no references", not a
 * message inside a dropdown. Every surface that uses it already sits behind the auth wall.
 */
export async function searchReferencesAction(raw: unknown): Promise<ReferenceSearchPage> {
  const owner = await requireOwner();
  if ("error" in owner) return { items: [], nextCursor: null };

  const input = (raw ?? {}) as { query?: unknown; types?: unknown; cursor?: unknown; limit?: unknown };
  // A merchant cannot type a 4 KB name; cap the string rather than hand an unbounded LIKE to Postgres.
  const query = typeof input.query === "string" ? input.query.slice(0, 64) : "";
  const types = Array.isArray(input.types)
    ? input.types.filter((type): type is ReferenceType => typeof type === "string" && isReferenceType(type))
    : undefined;
  const cursor = typeof input.cursor === "string" ? input.cursor : null;
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit) ? input.limit : REFERENCE_PAGE_LIMIT;

  return searchReferences(owner.ownerId, { query, types, cursor, limit });
}
