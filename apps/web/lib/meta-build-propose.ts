/**
 * proposeAdBuildForOwner — web-side port implementation for proposeAdBuild skill (G7 v2)
 *
 * Validates + persists a BUILD_CARD ChatMessage. Owner-validates the asset, page, ad set,
 * objective, link, and budget, then calls buildAdBuildCard to produce the server-enriched
 * payload (targeting, approval, accountId — the LLM never sets these).
 *
 * NOT "use server" — plain server module, called only from buildOttoContext port injection.
 */
import { prisma, Prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { fetchOwnerPages } from "./meta-pages";
import { fetchOwnerAdObjects, fetchOwnerAdAccounts } from "./meta-objects";
import { buildAdBuildCard, isSupportedObjective, isValidHttpUrl, type AdBuildInput } from "./meta-build-spec";
import { maybeAutoBuild } from "./meta-build-actions";

export { type AdBuildInput };

export async function proposeAdBuildForOwner(
  ownerId: string,
  threadId: string,
  input: AdBuildInput,
): Promise<
  | { cardId: string; autoBuilt: boolean }
  | { notConnected: true }
  | { needsReconnect: true }
  | { needsPageScope: true }
  | { invalid: Array<{ field: string; reason: string }> }
> {
  // 1. Fetch the owner's Facebook Pages (validates Meta connection + page scope)
  const pagesResult = await fetchOwnerPages(ownerId);
  if ("notConnected" in pagesResult) return { notConnected: true };
  if ("needsReconnect" in pagesResult) return { needsReconnect: true };
  if ("needsPageScope" in pagesResult) return { needsPageScope: true };
  const { pages } = pagesResult;

  // 2. Fetch the owner's ad ACCOUNTS to resolve accountId (must come from the account list, not
  //    from ad objects — a brand-new advertiser with zero campaigns has no objects but still has
  //    an account). Pick the first account for v1; multi-account selection is a future refinement.
  const accountsResult = await fetchOwnerAdAccounts(ownerId);
  if ("notConnected" in accountsResult) return { notConnected: true };
  if ("needsReconnect" in accountsResult) return { needsReconnect: true };
  const { accounts } = accountsResult;
  if (accounts.length === 0) {
    return {
      invalid: [{ field: "accountId", reason: "No Meta ad account found — set one up in Meta Ads Manager first." }],
    };
  }
  const accountId = accounts[0].id;

  // 3a. Fetch the owner's ad objects (campaigns/adsets/ads) for adset validation only.
  const objectsResult = await fetchOwnerAdObjects(ownerId);
  // If ad objects can't be fetched, treat as notConnected (same token)
  if ("notConnected" in objectsResult) return { notConnected: true };
  if ("needsReconnect" in objectsResult) return { needsReconnect: true };
  const { objects } = objectsResult;

  // 3. Resolve asset ownership + kind
  // The assetId in input.creative is a Generation id (from the user's library).
  // We look up the Generation owner-scoped, then fetch the Asset's mime to derive kind.
  const generation = await prisma.generation.findFirst({
    where: { id: input.creative.assetId, ownerId, deletedAt: null },
    select: { assetId: true },
  });

  let assetExists = false;
  let assetKind: "image" | "video" = "image";

  if (generation) {
    const asset = await prisma.asset.findUnique({
      where: { id: generation.assetId },
      select: { mime: true },
    });
    if (asset) {
      assetExists = true;
      assetKind = asset.mime.startsWith("video/") ? "video" : "image";
    }
  }

  // 4. Validate flags — collect ALL failures into invalid[] before deciding
  const invalid: Array<{ field: string; reason: string }> = [];

  if (!isSupportedObjective(input.objective)) {
    invalid.push({ field: "objective", reason: `unsupported objective: ${input.objective}` });
  }

  if (!isValidHttpUrl(input.creative.link)) {
    invalid.push({ field: "creative.link", reason: `invalid link: ${input.creative.link}` });
  }

  if (!(input.dailyBudgetMinor > 0)) {
    invalid.push({ field: "dailyBudgetMinor", reason: "dailyBudgetMinor must be > 0" });
  }

  if (!assetExists) {
    invalid.push({ field: "creative.assetId", reason: `unknown asset: ${input.creative.assetId}` });
  } else if (input.creative.kind !== assetKind) {
    invalid.push({
      field: "creative.kind",
      reason: `asset kind mismatch: input says ${input.creative.kind} but asset is ${assetKind}`,
    });
  }

  // pageId must be in owner's pages
  const pageIds = new Set(pages.map((p) => p.id));
  const pageValid = pageIds.has(input.pageId);
  if (!pageValid) {
    invalid.push({ field: "pageId", reason: `page not found: ${input.pageId}` });
  }

  // adset validation for into_existing mode
  const adsetIds = new Set(objects.filter((o) => o.level === "adset").map((o) => o.id));
  const adsetValid = input.mode === "into_existing" ? adsetIds.has(input.intoExisting?.adsetId ?? "") : true;
  if (input.mode === "into_existing" && !adsetValid) {
    invalid.push({
      field: "intoExisting.adsetId",
      reason: `ad set not found: ${input.intoExisting?.adsetId ?? "(missing)"}`,
    });
  }

  // Return all validation failures at once — NO card persisted if any failure
  if (invalid.length > 0) return { invalid };

  // 5. Build the server-side enriched card payload
  let payload: ReturnType<typeof buildAdBuildCard>;
  try {
    payload = buildAdBuildCard(
      input,
      { accountId, assetExists, assetKind, pageValid, adsetValid },
      ownerId,
      new Date().toISOString(),
    );
  } catch (err) {
    return {
      invalid: [{ field: "build", reason: err instanceof Error ? err.message : String(err) }],
    };
  }

  // 6. Persist ONE ChatMessage kind BUILD_CARD (next seq, role AGENT)
  const last = await prisma.chatMessage.findFirst({
    where: { threadId, ownerId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });

  const cardId = newId();
  await prisma.chatMessage.create({
    data: {
      id: cardId,
      threadId,
      ownerId,
      role: "AGENT",
      kind: "BUILD_CARD",
      seq: (last?.seq ?? 0) + 1,
      text: "",
      payload: payload as unknown as Prisma.InputJsonObject,
    },
  });

  // 7. AUTO path: under AUTO mode, build is money-safe → maybeAutoBuild self-builds (all PAUSED).
  //    Wrapped so a build failure NEVER breaks the proposal that already persisted. maybeAutoBuild
  //    re-derives authorization server-side and records buildOutcome onto the card itself.
  let autoBuilt = false;
  try {
    const outcome = await maybeAutoBuild(ownerId, cardId);
    autoBuilt = outcome.built === true;
  } catch {
    autoBuilt = false; // defense in depth — maybeAutoBuild already swallows, but never let a throw escape.
  }
  return { cardId, autoBuilt };
}
