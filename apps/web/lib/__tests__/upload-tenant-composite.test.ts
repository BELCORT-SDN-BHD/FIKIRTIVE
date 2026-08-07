/**
 * #698 — merchant image upload across the tenant boundary.
 *
 * Two real organizations, the real Prisma guard, the real `createEntity` server action.
 * Three properties are pinned here:
 *  1. a merchant uploading their OWN image lands an Asset + ReferenceImage (the走查 500),
 *  2. an Asset write whose compound unique key names ANOTHER tenant is still refused,
 *  3. an upload that fails part-way leaves NO half-built Entity behind, and the merchant
 *     gets an explicit error instead of a silent empty Library tile.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const { storageFailure } = vi.hoisted(() => ({ storageFailure: { on: false } }));

// Same session/allowlist seam the other two-tenant suites use: auth() is controllable
// per-test and the allowlist is env-driven (inlined, no DB).
const mockAuth = vi.fn();
vi.mock("@/lib/better-auth/compat", () => ({ auth: mockAuth }));
vi.mock("@/lib/allowlist", () => {
  function allowed(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = `${process.env.FOUNDER_ADMIN_EMAILS ?? ""},${process.env.AUTH_ALLOWED_EMAILS ?? ""}`
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  function isFounderAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    const list = (process.env.FOUNDER_ADMIN_EMAILS ?? "")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(email.toLowerCase());
  }
  return { allowed, isFounderAdmin, isAllowedEmail: allowed };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The REAL local-disk driver, with one injectable fault: `storageFailure.on` turns the
// next `put` into the operational failure that used to strand a nameless Entity row.
// A Proxy (not a spread) so the driver keeps its prototype methods and `this`.
vi.mock("@/lib/storage", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/storage")>();
  const real = mod.storage;
  return {
    ...mod,
    storage: new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "put") {
          return async (...args: Parameters<typeof real.put>) => {
            if (storageFailure.on) throw new Error("storage unavailable (injected)");
            return real.put(...args);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  };
});

const A_EMAIL = `up698A-${randomUUID()}@fikirtive.test`;
const B_EMAIL = `up698B-${randomUUID()}@fikirtive.test`;
beforeAll(() => {
  process.env.AUTH_ALLOWED_EMAILS = `${A_EMAIL},${B_EMAIL}`;
  process.env.FOUNDER_ADMIN_EMAILS = "noone@fikirtive.test";
});

const { requireOwner } = await import("@/lib/auth-guard");
const { prisma } = await import("@fikirtive/db");
const { runAsTenant } = await import("@fikirtive/db/principal");
const { createEntity } = await import("@/lib/actions");

// A 1x1 PNG: valid magic + IHDR + IDAT, so the byte-derived mime resolves to image/png.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x44, 0x41, 0x54, 0x00, 0x00, 0x00, 0x00,
]);

function pngFile(name: string, salt: string): File {
  // salt the bytes so each test gets its own content hash (Asset dedupes on owner+hash)
  const bytes = new Uint8Array([...PNG, ...new TextEncoder().encode(salt)]);
  return new File([bytes as unknown as BlobPart], name, { type: "image/png" });
}

function entityForm(name: string, files: File[]): FormData {
  const fd = new FormData();
  fd.set("name", name);
  fd.set("type", "CHARACTER");
  for (const f of files) fd.append("files", f);
  return fd;
}

async function asUser(email: string) {
  mockAuth.mockResolvedValue({ user: { email } });
}

let orgA: string, orgB: string;
let bAssetHash: string;

beforeAll(async () => {
  for (const email of [A_EMAIL, B_EMAIL]) {
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { id: `usr_${randomUUID()}`, email },
    });
  }
  await asUser(A_EMAIL);
  const a = await requireOwner();
  if ("error" in a) throw new Error(a.error);
  orgA = a.ownerId;
  await asUser(B_EMAIL);
  const b = await requireOwner();
  if ("error" in b) throw new Error(b.error);
  orgB = b.ownerId;
  expect(orgA).not.toBe(orgB);

  // B's own asset — the row a cross-tenant compound key would reach for.
  bAssetHash = randomUUID().replace(/-/g, "").repeat(2);
  await prisma.asset.create({
    data: {
      id: `ast_${randomUUID()}`, ownerId: orgB, contentHash: bAssetHash,
      ext: "png", mime: "image/png", sizeBytes: BigInt(10),
      originalFilename: "b-private.png", source: "UPLOAD",
    },
  });
});

afterAll(async () => {
  storageFailure.on = false;
  for (const org of [orgA, orgB].filter(Boolean)) {
    await prisma.referenceImage.deleteMany({ where: { ownerId: org } });
    await prisma.entity.updateMany({ where: { ownerId: org }, data: { baseAssetId: null } });
    await prisma.entity.deleteMany({ where: { ownerId: org } });
    await prisma.asset.deleteMany({ where: { ownerId: org } });
    await prisma.actionEvent.deleteMany({ where: { ownerId: org } });
  }
});

describe("#698 — a merchant uploading their own image", () => {
  it("lands the Asset and the ReferenceImage instead of a tenant-guard refusal", async () => {
    await asUser(A_EMAIL);
    const res = await createEntity(entityForm("Kopi cup", [pngFile("kopi.png", "own-upload")]));
    expect(res).toMatchObject({ id: expect.any(String) });
    const entityId = (res as { id: string }).id;

    const refs = await prisma.referenceImage.findMany({ where: { ownerId: orgA, entityId } });
    expect(refs).toHaveLength(1);
    const asset = await prisma.asset.findFirst({ where: { ownerId: orgA, id: refs[0]!.assetId } });
    expect(asset).toMatchObject({ ownerId: orgA, ext: "png", originalFilename: "kopi.png" });
    const entity = await prisma.entity.findFirst({ where: { ownerId: orgA, id: entityId } });
    expect(entity?.baseAssetId).toBe(refs[0]!.assetId);
  });

  it("dedupes the same image picked twice into one reference", async () => {
    await asUser(A_EMAIL);
    const twice = [pngFile("same.png", "dup"), pngFile("same.png", "dup")];
    const res = await createEntity(entityForm("Twice", twice));
    expect(res).toMatchObject({ id: expect.any(String) });
    const entityId = (res as { id: string }).id;
    const refs = await prisma.referenceImage.findMany({ where: { ownerId: orgA, entityId } });
    expect(refs).toHaveLength(1);
  });
});

describe("#698 — the compound unique key is not an escape hatch", () => {
  it("refuses an Asset upsert whose compound key names another tenant, and leaves that row intact", async () => {
    await expect(
      runAsTenant(orgA, async () =>
        prisma.asset.upsert({
          // the tenant lives INSIDE the compound key — the guard must read it there
          where: { ownerId_contentHash: { ownerId: orgB, contentHash: bAssetHash } },
          update: { originalFilename: "taken-over.png" },
          create: {
            id: `ast_${randomUUID()}`, ownerId: orgA, contentHash: bAssetHash,
            ext: "png", mime: "image/png", sizeBytes: BigInt(10),
            originalFilename: "taken-over.png", source: "UPLOAD",
          },
        }),
      ),
    ).rejects.toThrow(/tenant-guard/);

    const victim = await prisma.asset.findFirst({ where: { ownerId: orgB, contentHash: bAssetHash } });
    expect(victim?.originalFilename).toBe("b-private.png");
    const forged = await prisma.asset.findFirst({ where: { ownerId: orgA, contentHash: bAssetHash } });
    expect(forged).toBeNull();
  });
});

describe("#698 — a failed upload leaves nothing behind", () => {
  it("returns an explicit error and creates no Entity when the file can't be stored", async () => {
    await asUser(A_EMAIL);
    const before = await prisma.entity.count({ where: { ownerId: orgA } });
    storageFailure.on = true;
    let res: unknown;
    try {
      res = await createEntity(entityForm("Ghost cup", [pngFile("ghost.png", "fail")]));
    } finally {
      storageFailure.on = false;
    }
    expect(res).toMatchObject({ error: expect.any(String) });
    expect(await prisma.entity.count({ where: { ownerId: orgA } })).toBe(before);
    expect(await prisma.entity.findFirst({ where: { ownerId: orgA, name: "Ghost cup" } })).toBeNull();
  });
});
