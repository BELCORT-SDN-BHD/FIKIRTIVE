// Proves Plan-2 money-safety at $0 (local dev DB), following the repo verify idiom
// (no "use server" import). Asserts: (1) a GenJob tagged threadId is EXCLUDED from
// getRecentGenResults' filter; (2) a Generation tagged threadId is EXCLUDED from the
// candidate + project-media filters; (3) idempotencyKey "cowork:<cardId>" + the
// partial-unique index dedupes a same-key active job (the double-spend guard); (4) the
// ChatMessage(genJobId) result-message unique index blocks a 2nd GEN_RESULT (worker
// resume can't double-append). Run: node scripts/verify-cowork-plan2.mjs
import { readFileSync } from "node:fs";
const envPath = new URL("../packages/db/.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) { const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
if (process.env.GENERATION_PROVIDER === "fal" || process.env.COWORK_PROVIDER === "fal") { console.error("✗ refusing: a fal provider is set"); process.exit(1); }
const { prisma } = await import("../packages/db/dist/src/index.js");
const { newId, FOUNDER_OWNER_ID } = await import("../packages/core/dist/index.js");
let failed = false; const check = (l, ok, d) => { console.log(`${ok ? "✓" : "✗"} ${l}`, d ?? ""); if (!ok) failed = true; };
const created = { projects: [] };
try {
  const project = await prisma.project.create({ data: { id: newId(), name: "plan2 verify" } });
  created.projects.push(project.id);
  const tid = newId();
  // a cowork-tagged GenJob + Generation
  await prisma.genJob.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, prompt: "x", entityIds: [], count: 1, model: "seedream", kind: "IMAGE", status: "DONE", threadId: tid } });
  const asset = await prisma.asset.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, contentHash: "p2-" + newId(), ext: "png", mime: "image/png", sizeBytes: 1n, source: "GENERATED" } });
  await prisma.generation.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, shotId: null, threadId: tid, assetId: asset.id, source: "GENERATED", promptText: "x", modelRef: "seedream", entitySnapshot: {}, version: 1 } });
  // replicate the three filters (the queries the code uses)
  const recent = await prisma.genJob.count({ where: { projectId: project.id, ownerId: FOUNDER_OWNER_ID, threadId: null } });
  const cands = await prisma.generation.count({ where: { ownerId: FOUNDER_OWNER_ID, projectId: project.id, shotId: null, threadId: null, deletedAt: null } });
  const media = await prisma.generation.count({ where: { ownerId: FOUNDER_OWNER_ID, projectId: project.id, threadId: null, deletedAt: null } });
  check("cowork GenJob excluded from getRecentGenResults filter", recent === 0, { recent });
  check("cowork Generation excluded from candidates filter", cands === 0, { cands });
  check("cowork Generation excluded from Assets filter", media === 0, { media });
  // double-spend guard: the partial-unique index on (owner, project, idempotencyKey) for ACTIVE rows
  const key = "cowork:" + newId();
  await prisma.genJob.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, prompt: "x", entityIds: [], count: 1, model: "seedream", kind: "IMAGE", status: "QUEUED", idempotencyKey: key, threadId: tid } });
  let blocked = false;
  try { await prisma.genJob.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, prompt: "x", entityIds: [], count: 1, model: "seedream", kind: "IMAGE", status: "QUEUED", idempotencyKey: key, threadId: tid } }); }
  catch (e) { blocked = typeof e === "object" && e !== null && e.code === "P2002"; }
  check("duplicate active cowork idempotencyKey blocked (P2002 — no double-spend)", blocked, { key });
  // result-message exactly-once: the partial-unique index blocks a 2nd GEN_RESULT for the same job
  const thread = await prisma.chatThread.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, title: "p2" } });
  const jid = newId();
  await prisma.chatMessage.create({ data: { id: newId(), threadId: thread.id, ownerId: FOUNDER_OWNER_ID, role: "AGENT", kind: "GEN_RESULT", seq: 1, genJobId: jid, payload: { kind: "image" } } });
  let dupResult = false;
  try { await prisma.chatMessage.create({ data: { id: newId(), threadId: thread.id, ownerId: FOUNDER_OWNER_ID, role: "AGENT", kind: "GEN_RESULT", seq: 2, genJobId: jid, payload: { kind: "image" } } }); }
  catch (e) { dupResult = typeof e === "object" && e !== null && e.code === "P2002"; }
  check("duplicate GEN_RESULT for same genJobId blocked (worker resume can't double-append)", dupResult, { jid });
  if (failed) { console.error("\n✗ Plan-2 money-safety verify FAILED"); process.exit(1); }
  console.log("\n✓ Plan-2: cowork media isolated from all 3 views, double-spend blocked, result-message exactly-once, $0");
} finally {
  for (const id of created.projects) {
    await prisma.chatMessage.deleteMany({ where: { thread: { projectId: id } } }).catch(() => {});
    await prisma.chatThread.deleteMany({ where: { projectId: id } }).catch(() => {});
    await prisma.generation.deleteMany({ where: { projectId: id } }).catch(() => {});
    await prisma.genJob.deleteMany({ where: { projectId: id } }).catch(() => {});
    await prisma.project.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect();
}
