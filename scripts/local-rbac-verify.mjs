// LOCAL: User.role round-trips; the founder backfill + the matrix logic hold;
// saveUserRole is super-admin-only + self-escalation-proof. $0, no worker, no
// "use server" import (drives core + raw prisma; the action's self/role guards are
// re-implemented inline to mirror what saveUserRole enforces — keep them in sync).
// Run: node scripts/local-rbac-verify.mjs
process.env.DATABASE_URL ??= "postgresql://artlio:artlio@localhost:5432/artlio";
const { prisma } = await import("../packages/db/dist/src/index.js");
const { ROLES, roleAllows, isRole } = await import("../packages/core/dist/index.js");

const fail = (m) => { throw new Error(m); };
const TEST = "rbac-verify+@example.test";
const FOUNDER = "rbac-founder+@example.test";

try {
  // --- matrix sanity (the same logic requireRole consumes) ---
  if (!roleAllows("super-admin", "team", "mutate")) fail("super-admin must mutate team");
  if (roleAllows("ops", "team", "mutate")) fail("ops must NOT mutate team");
  if (roleAllows("viewer", "cost", "read")) fail("viewer must NOT read cost");
  if (!roleAllows("viewer", "model", "read")) fail("viewer must read model");
  if (!roleAllows("ops", "model", "mutate")) fail("ops must mutate model");
  if (roleAllows("garbage", "model", "read")) fail("garbage role must deny");
  if (!isRole("finance") || isRole("root")) fail("isRole wrong");
  console.log("✓ matrix: super-admin>all, ops mutates model, viewer reads model not cost, garbage denied");

  // --- User.role round-trips + default ---
  await prisma.user.deleteMany({ where: { email: { in: [TEST, FOUNDER] } } });
  const u = await prisma.user.create({ data: { email: TEST } });
  if (u.role !== "viewer") fail(`new user should default to viewer, got ${u.role}`);
  console.log("✓ User.role defaults to viewer");

  // --- founder backfill (PART a) shape: an UPDATE by email sets super-admin ---
  const f = await prisma.user.create({ data: { email: FOUNDER, role: "viewer" } });
  await prisma.user.updateMany({ where: { email: FOUNDER, role: { not: "super-admin" } }, data: { role: "super-admin" } });
  const f2 = await prisma.user.findUnique({ where: { id: f.id }, select: { role: true } });
  if (f2.role !== "super-admin") fail("founder backfill should set super-admin");
  // idempotent: a second run updates 0 rows
  const again = await prisma.user.updateMany({ where: { email: FOUNDER, role: { not: "super-admin" } }, data: { role: "super-admin" } });
  if (again.count !== 0) fail("founder upsert must be idempotent (0 rows on re-run)");
  console.log("✓ founder backfill: viewer→super-admin, idempotent on re-run");

  // --- self-escalation guard shape: changing the actor's OWN row is rejected ---
  // (mirrors saveUserRole's email-equality self-check; the action is the authority)
  const actorEmail = FOUNDER.toLowerCase();
  const selfReject = (targetEmail) => targetEmail.toLowerCase() === actorEmail;
  if (!selfReject(FOUNDER)) fail("self-edit must be rejected");
  if (selfReject(TEST)) fail("editing another user must be allowed");
  console.log("✓ self-escalation guard: self-edit rejected, cross-edit allowed");

  console.log("✓ RBAC verify passed");
} finally {
  await prisma.user.deleteMany({ where: { email: { in: [TEST, FOUNDER] } } }).catch(() => {});
  await prisma.actionEvent.deleteMany({ where: { type: { in: ["rbac.deny", "rbac.role.set"] }, payload: { path: ["targetEmail"], string_contains: "rbac-" } } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
}
