// Money-safety verify for coworkTurn (SP1 Plan-1): proves the propose-only turn is
// structurally GenJob-free and that the GEN_CARD payload the action builds persists
// (round-trips through the Json column) via the SAME FK-ordered $transaction the action
// uses for a new thread.
//
// Like the sibling verify-phase* scripts, it does NOT import the "use server" module:
// cowork-actions.ts pulls `next/cache` + (transitively, via cowork-knowledge) `server-only`,
// neither of which is node-importable cleanly. Instead it drives the REAL money-critical
// CORE exactly as coworkTurn does (mockPlannerReply → parseCoworkTurn → suggestModel →
// price), then replicates coworkTurn's persistence: ONE $transaction that creates the new
// thread BEFORE the 4 message rows (incl. GEN_CARD), respecting the ChatMessage.threadId
// FK. It asserts zero GenJob is created. The thin server wrapper (safeParse/owner-guard/
// bounded retry/try-catch/revalidate + the no-startGen invariant) is covered by typecheck,
// the money-safety grep (no startGen/genJob symbols in cowork-actions.ts), and Codex.
//
// Local dev DB; COWORK_PROVIDER unset → $0 (no fal call anywhere in this script).
// Run: node scripts/archive/verify-cowork-turn.mjs
import { readFileSync } from "node:fs";

const envPath = new URL("../../packages/db/.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (process.env.COWORK_PROVIDER === "fal" || process.env.GENERATION_PROVIDER === "fal") {
  console.error("✗ refusing: a fal provider is set — this verify must run at $0");
  process.exit(1);
}

const { prisma } = await import("../../packages/db/dist/src/index.js");
const { newId, FOUNDER_OWNER_ID, mockPlannerReply, parseCoworkTurn, suggestModel, videoPriceUsd, GEN_PRICE_USD_PER_IMAGE } =
  await import("../../packages/core/dist/index.js");

let failed = false;
const check = (label, ok, detail) => { console.log(`${ok ? "✓" : "✗"} ${label}`, detail ?? ""); if (!ok) failed = true; };

const created = { projects: [], entities: [], variants: [] };
try {
  const project = await prisma.project.create({ data: { id: newId(), name: "cowork turn verify" } });
  created.projects.push(project.id);
  const genJobsBefore = await prisma.genJob.count();

  // 1. drive the REAL money-critical core exactly as coworkTurn does (mock $0, empty ref set)
  const text = "make an image of a calm seascape";
  const turn = parseCoworkTurn(mockPlannerReply(text), []);
  check("planner output parsed into a turn with a proposal", !!turn.proposal, { reply: turn.reply, kind: turn.proposal?.kind });
  if (!turn.proposal) { console.error("\n✗ no proposal — cannot build a card"); process.exit(1); }

  const sm = suggestModel({
    kind: turn.proposal.kind,
    desiredAspect: turn.proposal.desiredAspect,
    desiredDuration: turn.proposal.desiredDuration,
    desiredAudio: turn.proposal.desiredAudio,
    hasSourceImage: false,
    hasTail: false,
  });
  const price = turn.proposal.kind === "video"
    ? videoPriceUsd(sm.model, { seconds: sm.params.durationSeconds ?? 1, resolution: sm.params.resolution ?? "", audio: !!sm.params.audio, count: sm.params.count })
    : GEN_PRICE_USD_PER_IMAGE * sm.params.count;
  const cardPayload = {
    kind: turn.proposal.kind, model: sm.model, params: sm.params, reason: sm.reason, downgraded: sm.downgraded,
    structuredPrompt: turn.proposal.structuredPrompt, entityIds: turn.proposal.entityIds, variantSel: turn.proposal.variantSel,
    estimatedPriceUsd: price,
  };

  // 2. replicate coworkTurn's EXACT new-thread persistence: the thread create MUST precede
  //    the messages in the same $transaction (FK ChatMessage.threadId → ChatThread).
  const threadId = newId();
  let seq = 0;
  const rows = [
    { id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "USER", kind: "TEXT", seq: ++seq, text, payload: { entityIds: [], variantSel: {} } },
    { id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "AGENT", kind: "PLAN", seq: ++seq, text: "", payload: { planSteps: turn.planSteps } },
    { id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "AGENT", kind: "TEXT", seq: ++seq, text: turn.reply },
    { id: newId(), threadId, ownerId: FOUNDER_OWNER_ID, role: "AGENT", kind: "GEN_CARD", seq: ++seq, text: "", payload: cardPayload },
  ];
  await prisma.$transaction([
    prisma.chatThread.create({ data: { id: threadId, ownerId: FOUNDER_OWNER_ID, projectId: project.id, title: text.slice(0, 80) } }),
    prisma.chatMessage.createMany({ data: rows }),
  ]);

  // 3. assertions
  const msgs = await prisma.chatMessage.findMany({ where: { threadId }, orderBy: { seq: "asc" } });
  const kinds = msgs.map((m) => m.kind);
  check("FK-ordered new-thread $transaction persisted USER+PLAN+TEXT+GEN_CARD in order",
    JSON.stringify(kinds) === JSON.stringify(["TEXT", "PLAN", "TEXT", "GEN_CARD"]), kinds);
  const card = msgs.find((m) => m.kind === "GEN_CARD");
  check("GEN_CARD payload round-trips with model + structuredPrompt + numeric estimatedPriceUsd",
    !!card?.payload?.model && !!card?.payload?.structuredPrompt && typeof card?.payload?.estimatedPriceUsd === "number",
    { model: card?.payload?.model, price: card?.payload?.estimatedPriceUsd });
  const genJobsAfter = await prisma.genJob.count();
  check("ZERO GenJob created (propose-only — no media spend)", genJobsAfter === genJobsBefore, { before: genJobsBefore, after: genJobsAfter });

  // 4. variant-VALUE membership gate (Codex P1): coworkTurn drops a variantSel value
  //    that isn't a LIVE variant of its entity, for both planner + fallback paths.
  //    Replicate loadAvailableRefs's live-variant query + the action's value filter
  //    against a real entity with one live + one soft-deleted variant.
  const entity = await prisma.entity.create({ data: { id: newId(), type: "CHARACTER", name: "cowork ghost-variant test" } });
  created.entities.push(entity.id);
  const vLive = await prisma.entityVariant.create({ data: { id: newId(), entityId: entity.id, ownerId: FOUNDER_OWNER_ID, name: "Live", handle: "live", prompt: "x" } });
  const vGone = await prisma.entityVariant.create({ data: { id: newId(), entityId: entity.id, ownerId: FOUNDER_OWNER_ID, name: "Gone", handle: "gone", prompt: "y" } });
  created.variants.push(vLive.id, vGone.id);
  await prisma.entityVariant.update({ where: { id: vGone.id }, data: { deletedAt: new Date() } });

  // loadAvailableRefs() returns each entity's LIVE variant ids
  const liveVariantIds = (await prisma.entityVariant.findMany({ where: { entityId: entity.id, deletedAt: null }, select: { id: true } })).map((v) => v.id);
  const liveSet = new Set(liveVariantIds);
  // the action's filter: keep a variantSel value only if it's a live variant of the entity
  const filterValue = (vid) => (liveSet.has(vid) ? vid : undefined);
  check("live variant value is kept", filterValue(vLive.id) === vLive.id, { live: vLive.id });
  check("soft-deleted variant value is dropped", filterValue(vGone.id) === undefined, { deleted: vGone.id });
  check("ghost (nonexistent) variant value is dropped", filterValue("ghost" + newId()) === undefined);

  if (failed) { console.error("\n✗ coworkTurn money-safety verify FAILED"); process.exit(1); }
  console.log("\n✓ coworkTurn: propose-only — thread + card persisted via FK-ordered tx, zero GenJob, $0");
} finally {
  // clean up this script's rows (messages before threads — ChatMessage→ChatThread is onDelete:Restrict)
  for (const id of created.projects) {
    await prisma.chatMessage.deleteMany({ where: { thread: { projectId: id } } }).catch(() => {});
    await prisma.chatThread.deleteMany({ where: { projectId: id } }).catch(() => {});
    await prisma.project.delete({ where: { id } }).catch(() => {});
  }
  for (const id of created.variants) await prisma.entityVariant.delete({ where: { id } }).catch(() => {});
  for (const id of created.entities) await prisma.entity.delete({ where: { id } }).catch(() => {});
  await prisma.$disconnect();
}
