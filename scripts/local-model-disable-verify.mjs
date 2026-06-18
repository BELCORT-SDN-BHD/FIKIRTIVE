// LOCAL: a ModelRegistryOverlay row narrows the resolved enabled set; garbage rows
// ignored; empty table = full typed menu. $0, no worker. Mirrors the resolveDisabled
// logic against the real DB (no "use server" import — drives core + a raw prisma read).
// Run: node scripts/local-model-disable-verify.mjs
process.env.DATABASE_URL ??= "postgresql://artlio:artlio@localhost:5432/artlio";
const { prisma } = await import("../packages/db/dist/src/index.js");
const { newId, FOUNDER_OWNER_ID, GEN_VIDEO_MODELS, enabledVideoModels, isModelDisabled } =
  await import("../packages/core/dist/index.js");

const fail = (m) => { throw new Error(m); };
const resolveDisabled = async () => new Set(
  (await prisma.modelRegistryOverlay.findMany({ where: { ownerId: FOUNDER_OWNER_ID, enabled: false }, select: { modelId: true } })).map((r) => r.modelId),
);

try {
  await prisma.modelRegistryOverlay.deleteMany({ where: { ownerId: FOUNDER_OWNER_ID, modelId: { in: ["kling", "not-a-model"] } } });

  // empty → full typed menu
  let d = await resolveDisabled();
  if (enabledVideoModels(d).length !== GEN_VIDEO_MODELS.length) fail("empty table should give the full typed menu");
  console.log("✓ empty overlay → full typed video menu");

  // disable kling → narrowed by one, kling reported disabled
  await prisma.modelRegistryOverlay.upsert({
    where: { ownerId_modelId: { ownerId: FOUNDER_OWNER_ID, modelId: "kling" } },
    create: { id: newId(), ownerId: FOUNDER_OWNER_ID, modelId: "kling", enabled: false },
    update: { enabled: false },
  });
  d = await resolveDisabled();
  if (enabledVideoModels(d).includes("kling")) fail("kling should be filtered out");
  if (!isModelDisabled("kling", d)) fail("kling should report disabled");
  if (enabledVideoModels(d).length !== GEN_VIDEO_MODELS.length - 1) fail("exactly one model should be removed");
  console.log("✓ disabled kling → narrowed by one (additive narrowing)");

  // a garbage/unknown disabled row can't change the typed menu
  await prisma.modelRegistryOverlay.upsert({
    where: { ownerId_modelId: { ownerId: FOUNDER_OWNER_ID, modelId: "not-a-model" } },
    create: { id: newId(), ownerId: FOUNDER_OWNER_ID, modelId: "not-a-model", enabled: false },
    update: { enabled: false },
  });
  d = await resolveDisabled();
  for (const m of enabledVideoModels(d)) if (!GEN_VIDEO_MODELS.includes(m)) fail("enabled set must stay a subset of the typed menu");
  console.log("✓ garbage disabled row ignored — enabled set stays a subset of the typed menu");

  console.log("\n✓ model-disable resolves: empty=full, disable narrows, garbage ignored");
} finally {
  await prisma.modelRegistryOverlay.deleteMany({ where: { ownerId: FOUNDER_OWNER_ID, modelId: { in: ["kling", "not-a-model"] } } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
}
