import type { Prisma } from "@fikirtive/db";
import type { CrmLifecycleStage } from "./crm-identity";

export type OwnedContactsFilter = {
  lifecycleStage?: CrmLifecycleStage;
  query?: string;
};

/**
 * #715 — the single predicate deciding which Contact rows belong to an owner.
 *
 * The contacts list (crm-view-data) reads a page of these rows and counts the same
 * predicate for its total; the segment evaluator (segment-actions) reads all of them.
 * Sharing the predicate is what keeps the two pages from answering "how many customers
 * do I have" with two different numbers. The ownerId fence is part of the predicate and
 * is never optional.
 */
export function ownedContactsWhere(
  ownerId: string,
  filter: OwnedContactsFilter = {},
): Prisma.ContactWhereInput {
  const query = filter.query;
  return {
    ownerId,
    deletedAt: null,
    ...(filter.lifecycleStage ? { lifecycleStage: filter.lifecycleStage } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            {
              identities: {
                some: {
                  ownerId,
                  deletedAt: null,
                  externalId: { contains: query, mode: "insensitive" as const },
                },
              },
            },
            {
              identities: {
                some: {
                  ownerId,
                  deletedAt: null,
                  handle: { contains: query, mode: "insensitive" as const },
                },
              },
            },
          ],
        }
      : {}),
  };
}
