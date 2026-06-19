import { Prisma } from "../generated/prisma/client.js";

/** The owner-scoped models. findMany/findFirst/updateMany/deleteMany on these MUST carry an
 *  ownerId filter (the repository convention). This extension is a BACKSTOP, not the sole
 *  guarantee — documented blind spots (raw SQL, nested writes, findUnique-by-unique-key,
 *  aggregate/groupBy) are owned by the explicit filters + the 2-org isolation test. */
const TENANT_MODELS = new Set([
  "Project", "Entity", "EntityVariant", "ReferenceImage", "Asset", "Shot", "ShotEntityRef",
  "Generation", "RenderJob", "GenJob", "RefGenJob", "ChatThread", "ChatMessage",
  "CaptionJob", "Transcript",
]);

// Operations we check (those that take a `where`). findUnique is exempt (unique-key access),
// aggregate/groupBy/count are exempt (admin platform-wide reads use them intentionally).
const CHECKED_OPS = new Set(["findMany", "findFirst", "updateMany", "deleteMany"]);

function whereHasOwnerId(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  // `ownerId: undefined` is NOT a filter — Prisma drops undefined keys — so require a
  // defined value, not mere key presence, before treating the query as owner-scoped.
  if ((where as Record<string, unknown>).ownerId !== undefined) return true;
  // allow ownerId nested under a top-level AND
  const and = (where as { AND?: unknown }).AND;
  if (Array.isArray(and)) return and.some((c) => whereHasOwnerId(c));
  return false;
}

/** Apply to the PrismaClient. In production it WARNS (never throws — a false positive must
 *  not 500 a live request); under test it THROWS so the isolation suite catches an unscoped
 *  query. Result shape is never modified. */
export function withTenantGuard<T extends object>(client: T): T {
  const strict = process.env.NODE_ENV === "test";
  return (client as any).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          if (TENANT_MODELS.has(model) && CHECKED_OPS.has(operation) && !whereHasOwnerId(args?.where)) {
            const msg = `[tenant-guard] ${model}.${operation} has no ownerId filter — possible cross-tenant leak`;
            if (strict) throw new Error(msg);
            console.warn(msg);
          }
          return query(args);
        },
      },
    },
  }) as T;
}

// `Prisma` is imported to anchor the extension types to the generated client version.
void Prisma;
