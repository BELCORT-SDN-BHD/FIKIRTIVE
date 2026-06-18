// LOCAL: a DONE GenJob/RefGenJob gets the correct record-only spentUsd via the pure
// helper + the real prisma write path. $0 — inserts fake rows + invokes genSpentUsd/
// refgenSpentUsd directly (NO provider, NO worker, NO queue). Proves the math + write.
// Run: node scripts/local-spend-snapshot-verify.mjs
process.env.DATABASE_URL ??= "postgresql://artlio:artlio@localhost:5432/artlio";
const { prisma } = await import("../packages/db/dist/src/index.js");
const {
  newId, FOUNDER_OWNER_ID,
  genSpentUsd, refgenSpentUsd,
  GEN_PRICE_USD_PER_IMAGE, REFGEN_PRICE_USD_PER_IMAGE, videoPriceUsd, videoDefaults,
} = await import("../packages/core/dist/index.js");

const fail = (m) => { throw new Error(m); };
const created = { genJobs: [], refGenJobs: [], projects: [], entities: [] };

try {
  const project = await prisma.project.create({ data: { id: newId(), name: "spend snapshot verify" } });
  created.projects.push(project.id);
  const entity = await prisma.entity.create({ data: { id: newId(), type: "CHARACTER", name: "spend verify entity" } });
  created.entities.push(entity.id);

  // 1. IMAGE GenJob — expect GEN_PRICE_USD_PER_IMAGE * count
  const imgExpected = GEN_PRICE_USD_PER_IMAGE * 4;
  if (genSpentUsd({ kind: "IMAGE", model: "seedream", count: 4, videoOptions: null }) !== imgExpected) fail("image helper math");
  const imgJob = await prisma.genJob.create({ data: {
    id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, prompt: "x", kind: "IMAGE", model: "seedream", count: 4, status: "DONE",
    spent: true, spentUsd: genSpentUsd({ kind: "IMAGE", model: "seedream", count: 4, videoOptions: null }),
  }, select: { id: true, spentUsd: true } });
  created.genJobs.push(imgJob.id);
  if (imgJob.spentUsd !== imgExpected) fail(`image GenJob.spentUsd persisted ${imgJob.spentUsd}, want ${imgExpected}`);
  console.log(`✓ image GenJob.spentUsd = ${imgJob.spentUsd} (GEN_PRICE × 4)`);

  // 2. VIDEO GenJob — expect videoPriceUsd over the job's options
  const vo = { seconds: 5, resolution: "1080p", audio: true };
  const vidExpected = videoPriceUsd("veo3.1-fast", { seconds: 5, resolution: "1080p", audio: true, count: 1 });
  if (genSpentUsd({ kind: "VIDEO", model: "veo3.1-fast", count: 1, videoOptions: vo }) !== vidExpected) fail("video helper math");
  const vidJob = await prisma.genJob.create({ data: {
    id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, prompt: "x", kind: "VIDEO", model: "veo3.1-fast", count: 1, videoOptions: vo, status: "DONE",
    spent: true, spentUsd: genSpentUsd({ kind: "VIDEO", model: "veo3.1-fast", count: 1, videoOptions: vo }),
  }, select: { id: true, spentUsd: true } });
  created.genJobs.push(vidJob.id);
  if (vidJob.spentUsd !== vidExpected) fail(`video GenJob.spentUsd persisted ${vidJob.spentUsd}, want ${vidExpected}`);
  console.log(`✓ video GenJob.spentUsd = ${vidJob.spentUsd} (videoPriceUsd)`);

  // 3. VIDEO with null videoOptions — must fall back to defaults, never NaN/null
  const fbExpected = videoPriceUsd("kling", { ...videoDefaults("kling"), count: 1 });
  const fbJob = await prisma.genJob.create({ data: {
    id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, prompt: "x", kind: "VIDEO", model: "kling", count: 1, status: "DONE",
    spent: true, spentUsd: genSpentUsd({ kind: "VIDEO", model: "kling", count: 1, videoOptions: null }),
  }, select: { id: true, spentUsd: true } });
  created.genJobs.push(fbJob.id);
  if (fbJob.spentUsd !== fbExpected || !Number.isFinite(fbJob.spentUsd)) fail(`video-fallback spentUsd ${fbJob.spentUsd}, want ${fbExpected}`);
  console.log(`✓ video GenJob (null options) → defaults = ${fbJob.spentUsd}`);

  // 4. RefGenJob — expect REFGEN_PRICE_USD_PER_IMAGE * count (its OWN constant)
  const refExpected = REFGEN_PRICE_USD_PER_IMAGE * 3;
  if (refgenSpentUsd({ model: "seedream", count: 3 }) !== refExpected) fail("refgen helper math");
  const refJob = await prisma.refGenJob.create({ data: {
    id: newId(), ownerId: FOUNDER_OWNER_ID, entityId: entity.id, prompt: "x", model: "seedream", count: 3, mode: "REFSHEET", status: "DONE",
    outputAssetIds: [newId(), newId(), newId()], spentUsd: refgenSpentUsd({ model: "seedream", count: 3 }),
  }, select: { id: true, spentUsd: true } });
  created.refGenJobs.push(refJob.id);
  if (refJob.spentUsd !== refExpected) fail(`RefGenJob.spentUsd persisted ${refJob.spentUsd}, want ${refExpected}`);
  console.log(`✓ RefGenJob.spentUsd = ${refJob.spentUsd} (REFGEN_PRICE × 3)`);

  // 5. the cost view's read sums them (record-only aggregation)
  const sum = (await prisma.genJob.aggregate({ where: { id: { in: created.genJobs } }, _sum: { spentUsd: true } }))._sum.spentUsd ?? 0;
  const refSum = (await prisma.refGenJob.aggregate({ where: { id: { in: created.refGenJobs } }, _sum: { spentUsd: true } }))._sum.spentUsd ?? 0;
  const want = imgExpected + vidExpected + fbExpected + refExpected;
  if (Math.abs((sum + refSum) - want) > 1e-9) fail(`aggregate ${sum + refSum} != ${want}`);
  console.log(`✓ cost-view aggregate = ${(sum + refSum).toFixed(4)} (the per-day/total sum the page reads)`);

  console.log("\n✓ spend snapshot: helper math + persisted spentUsd + aggregate all correct ($0, no provider)");
} finally {
  for (const id of created.genJobs) await prisma.genJob.delete({ where: { id } }).catch(() => {});
  for (const id of created.refGenJobs) await prisma.refGenJob.delete({ where: { id } }).catch(() => {});
  for (const id of created.entities) await prisma.entity.delete({ where: { id } }).catch(() => {});
  for (const id of created.projects) await prisma.project.delete({ where: { id } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
}
