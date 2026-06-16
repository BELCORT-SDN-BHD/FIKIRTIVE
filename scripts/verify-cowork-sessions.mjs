import { readFileSync } from "node:fs";
const envPath = new URL("../packages/db/.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) { const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
if (process.env.GENERATION_PROVIDER === "fal" || process.env.COWORK_PROVIDER === "fal") { console.error("✗ refusing: fal provider set"); process.exit(1); }
const { prisma } = await import("../packages/db/dist/src/index.js");
const { newId, FOUNDER_OWNER_ID } = await import("../packages/core/dist/index.js");
let failed = false; const check = (l, ok, d) => { console.log(`${ok ? "✓" : "✗"} ${l}`, d ?? ""); if (!ok) failed = true; };
const created = { projects: [] };
try {
  const project = await prisma.project.create({ data: { id: newId(), name: "sessions verify" } });
  created.projects.push(project.id);
  const t = await prisma.chatThread.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId: project.id, title: "orig" } });
  await prisma.chatMessage.create({ data: { id: newId(), threadId: t.id, ownerId: FOUNDER_OWNER_ID, role: "USER", kind: "TEXT", seq: 1, text: "hi" } });
  const genBefore = await prisma.genJob.count();
  const r1 = await prisma.chatThread.updateMany({ where: { id: t.id, ownerId: FOUNDER_OWNER_ID, deletedAt: null }, data: { title: "renamed" } });
  check("owned thread renamed (count=1)", r1.count === 1, r1);
  const r2 = await prisma.chatThread.updateMany({ where: { id: t.id, ownerId: "not-the-owner", deletedAt: null }, data: { title: "hacked" } });
  check("cross-owner rename blocked (count=0)", r2.count === 0, r2);
  const d1 = await prisma.chatThread.updateMany({ where: { id: t.id, ownerId: FOUNDER_OWNER_ID, deletedAt: null }, data: { deletedAt: new Date() } });
  check("owned thread soft-deleted (count=1)", d1.count === 1, d1);
  const live = await prisma.chatThread.count({ where: { projectId: project.id, ownerId: FOUNDER_OWNER_ID, deletedAt: null } });
  check("soft-deleted thread drops out of the live list", live === 0, { live });
  const msgs = await prisma.chatMessage.count({ where: { threadId: t.id } });
  check("messages survive the soft-delete (not cascaded)", msgs === 1, { msgs });
  const genAfter = await prisma.genJob.count();
  check("ZERO GenJob touched (sessions are not a spend path)", genAfter === genBefore, { before: genBefore, after: genAfter });
  if (failed) { console.error("\n✗ sessions verify FAILED"); process.exit(1); }
  console.log("\n✓ sessions: owner-scoped rename/soft-delete, messages survive, $0, no GenJob");
} finally {
  for (const id of created.projects) {
    await prisma.chatMessage.deleteMany({ where: { thread: { projectId: id } } }).catch(() => {});
    await prisma.chatThread.deleteMany({ where: { projectId: id } }).catch(() => {});
    await prisma.project.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect();
}
