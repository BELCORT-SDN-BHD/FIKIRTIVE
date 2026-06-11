// Phase 2 refgen tracer (mock provider, $0): enqueue a reference generation
//   → worker MockProvider produces N PNGs → stored content-addressed
//   → attached to the entity as ReferenceImages → job DONE.
// Also proves conditioning: an entity WITH an existing ref (a "logo") passes
// it to the provider, and the mock's output hash reflects the conditioning.
// Run from repo root with worker + MinIO + postgres up (GENERATION_PROVIDER
// unset/mock — never touches fal).
import { createRequire } from "node:module";
const require = createRequire(new URL("../apps/worker/package.json", import.meta.url));
const { PgBoss } = await import(require.resolve("pg-boss"));
const { prisma } = await import("../packages/db/dist/src/index.js");
const { createStorage } = await import("../packages/storage/dist/index.js");
const { REFGEN_QUEUE, REFGEN_DLQ, REFGEN_QUEUE_POLICY, storageKey, newId } = await import(
  "../packages/core/dist/index.js"
);

const DB = process.env.DATABASE_URL ?? "postgresql://artlio:artlio@localhost:5432/artlio";
process.env.DATABASE_URL = DB;
// match the worker's storage backend (MinIO) so exists()/put() hit the same bucket
process.env.STORAGE_DRIVER = "r2";
process.env.R2_ENDPOINT ??= "http://localhost:9000";
process.env.R2_ACCESS_KEY_ID ??= "minioadmin";
process.env.R2_SECRET_ACCESS_KEY ??= "minioadmin";
process.env.R2_BUCKET ??= "artlio";
const storage = createStorage("/tmp/unused");
const step = (m) => console.log(`✓ ${m}`);
const OWNER = "founder";

const boss = new PgBoss({ connectionString: DB, schema: "pgboss", supervise: false, schedule: false, max: 2 });
await boss.start();
await boss.createQueue(REFGEN_DLQ).catch(() => {});
await boss.createQueue(REFGEN_QUEUE, { ...REFGEN_QUEUE_POLICY }).catch(() => {});

async function runGen({ withLogo }) {
  // a PRODUCT entity; optionally seed a "logo" reference to condition on
  const entity = await prisma.entity.create({
    data: { id: newId(), ownerId: OWNER, type: "PRODUCT", name: withLogo ? "Logo Hoodie" : "Plain Hoodie" },
  });
  if (withLogo) {
    // plant a tiny valid PNG as the entity's existing reference (the logo)
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const { contentHash } = await storage.put(OWNER, new Uint8Array(png), "png");
    const asset = await prisma.asset.create({
      data: { id: newId(), ownerId: OWNER, contentHash, ext: "png", mime: "image/png", sizeBytes: BigInt(png.length), source: "UPLOAD" },
    });
    await prisma.referenceImage.create({
      data: { id: newId(), ownerId: OWNER, entityId: entity.id, assetId: asset.id, position: 0 },
    });
  }
  const refsBefore = await prisma.referenceImage.count({ where: { entityId: entity.id, deletedAt: null } });

  const job = await prisma.refGenJob.create({
    data: { id: newId(), ownerId: OWNER, entityId: entity.id, prompt: "a red hoodie with the logo", count: 4, model: "seedream" },
  });
  await boss.send(REFGEN_QUEUE, { refGenJobId: job.id });

  let row;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    row = await prisma.refGenJob.findUnique({ where: { id: job.id } });
    if (row.status === "DONE" || row.status === "FAILED") break;
  }
  if (row.status !== "DONE") throw new Error(`job ended ${row.status}: ${row.error}`);
  if (row.outputAssetIds.length !== 4) throw new Error(`expected 4 outputs, got ${row.outputAssetIds.length}`);

  // 4 new ReferenceImages attached, all GENERATED assets, all objects present
  const refsAfter = await prisma.referenceImage.findMany({
    where: { entityId: entity.id, deletedAt: null },
    orderBy: { position: "asc" },
    include: { asset: true },
  });
  if (refsAfter.length !== refsBefore + 4) throw new Error(`expected ${refsBefore + 4} refs, got ${refsAfter.length}`);
  const generated = refsAfter.filter((r) => r.asset.source === "GENERATED");
  if (generated.length !== 4) throw new Error(`expected 4 GENERATED refs, got ${generated.length}`);
  for (const r of generated) {
    const key = storageKey(r.asset.ownerId, r.asset.contentHash, r.asset.ext);
    if (!(await storage.exists(key))) throw new Error(`generated object missing: ${key}`);
  }
  const hashes = new Set(generated.map((r) => r.asset.contentHash));
  if (hashes.size !== 4) throw new Error(`generated outputs not distinct: ${hashes.size}/4`);
  step(`${withLogo ? "conditioned" : "text-to-image"}: 4 distinct GENERATED refs attached + stored (refs ${refsBefore}→${refsAfter.length})`);
  return [...hashes][0];
}

const plainHash = await runGen({ withLogo: false });
const logoHash = await runGen({ withLogo: true });
// conditioning changes the provider input → mock seed → different output bytes
if (plainHash === logoHash) throw new Error("conditioning had no effect on output (mock seed ignored inputs)");
step("conditioning changes the generated output (logo ref fed to provider)");

// idempotency: re-delivering the same DONE job must not double-attach
{
  const done = await prisma.refGenJob.findFirst({ where: { status: "DONE" }, orderBy: { createdAt: "desc" } });
  const before = await prisma.referenceImage.count({ where: { entityId: done.entityId, deletedAt: null } });
  await boss.send(REFGEN_QUEUE, { refGenJobId: done.id });
  await new Promise((r) => setTimeout(r, 4000));
  const after = await prisma.referenceImage.count({ where: { entityId: done.entityId, deletedAt: null } });
  if (after !== before) throw new Error(`re-delivery double-attached: ${before}→${after}`);
  step("re-delivering a DONE job is a no-op (idempotent attach)");
}

await boss.stop();
await prisma.$disconnect();
console.log("REFGEN TRACER PASSED (mock provider, $0)");
process.exit(0);
