/**
 * Journey 13 — a genuinely new upload reaches storage and becomes a real Asset (#941).
 *
 * WHY THIS EXISTS. Before this ticket the resident e2e suite had ZERO upload coverage — this is
 * the first journey to drive a file through the composer's attach path at all, so there is no
 * prior fixture this one is replacing, and no defect it quietly let through before. `#931` (a
 * production CORS defect in the browser→R2 presigned-PUT path) is the reason uploads are covered
 * at all now, not a bug this suite once missed. `support/upload-fixture.ts`'s header spells out
 * why the fixture salts its bytes anyway (`freshPng()`, a fresh random pixel every call): in
 * short, per-owner key namespacing and CI's local storage driver both already make a static
 * fixture harmless here today, and the salt exists to keep it that way permanently, including
 * against a future e2e run against a real R2/MinIO backend where dedup actually executes.
 *
 * COVERAGE BOUNDARY — read this before treating a green run here as an R2/CORS guarantee.
 * `playwright.config.ts`'s "NO NETWORK" rule means the app under test carries no R2 credential
 * (support/env.ts), so `packages/storage`'s `createStorage()` returns `LocalDiskStorage`
 * (`supportsDirectUpload = false`). Inside `authorizeUpload` (apps/web/lib/upload-actions.ts)
 * the `!storage.supportsDirectUpload` check fires BEFORE the exists/dedup check and
 * unconditionally returns `{kind:"unsupported"}` — so on THIS suite, salted or not, the browser
 * NEVER issues a presigned PUT to object storage. The client (apps/web/lib/direct-upload.ts)
 * falls back to `uploadFileFallback`, a server action that reads the bytes out of the request
 * body itself (the same path dev's local-disk driver has always used).
 *
 * What this journey DOES prove: a brand-new upload — never seeded, never seen by any previous
 * run — reaches the server through the real UI (the composer's attach button, a real file input,
 * a real click), and comes out the other end as the exact rows production writes: an Asset row
 * keyed by the real content hash with the real byte count, and a Generation row pointing at it.
 * What it does NOT prove: that R2's CORS policy (the actual subject of #931) still permits the
 * browser's cross-origin PUT. Re-verifying that requires STORAGE_DRIVER=r2 against a live R2
 * endpoint or the docker-compose MinIO stand-in — infrastructure this resident suite deliberately
 * does not run. Do not read a green run here as a CORS regression guard.
 */
import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import { seedWorkspace, seedThread, readAccount } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { prisma, INTERNAL_PER_DISPLAY } from "../support/db.js";
import { freshPng, freshPngFilename } from "../support/upload-fixture.js";

test("A freshly-uploaded image reaches the server and becomes a real Asset, every run", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "upload",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 50,
  });
  // Puts the merchant straight on the chat composer (attach button included) instead of the
  // "new chat" front door — see support/seed.ts's seedThread.
  await seedThread(ws);

  const bytes = freshPng();
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // The claim this journey exists to make: this exact content has never touched storage before.
  // A fixture that could fail this check would be the exact defect #931 slipped through — a
  // "new" upload that was actually a repeat.
  const before = await prisma.asset.findUnique({
    where: { ownerId_contentHash: { ownerId: ws.orgId, contentHash: sha256 } },
  });
  expect(before).toBeNull();

  await signIn(page, ws, "/otto");

  // The hidden file input Uppy/the attach button drive (apps/web/components/otto/OttoChatStream.tsx)
  // — setInputFiles works on it directly, the same way the visible paperclip button does.
  await page.getByLabel("Attach a file").setInputFiles({
    name: freshPngFilename(),
    mimeType: "image/png",
    buffer: bytes,
  });

  // The merchant's own signal that the upload finished: "attaching…" is replaced by the
  // reference chip.
  await expect(page.getByText("attaching…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove Image ref" })).toBeVisible();

  const asset = await prisma.asset.findUnique({
    where: { ownerId_contentHash: { ownerId: ws.orgId, contentHash: sha256 } },
  });
  expect(asset).not.toBeNull();
  expect(asset?.ownerId).toBe(ws.orgId);
  expect(asset?.ext).toBe("png");
  expect(asset?.mime).toBe("image/png");
  expect(Number(asset?.sizeBytes)).toBe(bytes.length);
  expect(asset?.deletedAt).toBeNull();

  const generation = await prisma.generation.findFirst({
    where: { ownerId: ws.orgId, assetId: asset!.id, source: "UPLOAD" },
  });
  expect(generation).not.toBeNull();
  expect(generation?.projectId).toBe(ws.projectId);

  // Attaching a reference costs nothing — only sending a message to Otto does.
  const account = await readAccount(ws);
  expect(account.balance).toBe(50 * INTERNAL_PER_DISPLAY);
  expect(account.reserved).toBe(0);
});
