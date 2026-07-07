// LOCAL verification of the GenSpace direct-gen double-spend fixes (local DB → $0,
// no worker needed: the double-spend is about job CREATION, so we assert exactly ONE
// GenJob row is created). Two distinct gaps:
//   Phase 1 — same-FRAME double-click (busyRef guard). The harness Pass 3 caught this
//     creating TWO on prod, pre-fix.
//   Phase 2 — network retry / double-SUBMIT: the SAME startGen request reaching the
//     server twice (flaky net / framework re-POST). busyRef can't catch this — only a
//     stable idempotencyKey on the request can. The keyless GenSpace path was missing it.
// Run:  node scripts/archive/local-doubleclick-verify.mjs
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://fikirtive:fikirtive@localhost:5432/fikirtive";
const { prisma } = await import("../../packages/db/dist/src/index.js");
const BASE = process.env.BASE_URL ?? "http://localhost:3100";

const fail = (m) => { throw new Error(m); };
const dbNow = async () => (await prisma.$queryRaw`SELECT now() as now`)[0].now;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();
const editor = page.locator(".mention-input .tiptap, .mention-input [contenteditable='true']").first();

let passed = false, projectId = null;
try {
  // login (dev magic-link → file)
  await page.goto(BASE + "/login");
  await page.locator('input[type="email"]').fill("tools@belcort.com");
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
  await page.goto((await readFile(".data/last-magic-link.txt", "utf8")).trim());
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });

  await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
  await page.locator(".sidenav-project").click();
  await page.getByText("+ New project", { exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill("DoubleClick verify");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/studio\?p=/, { timeout: 15000 });
  projectId = new URL(page.url()).searchParams.get("p");

  await page.getByRole("button", { name: "Gen space", exact: true }).click();
  await page.getByRole("tab", { name: "Photo", exact: true }).click();
  await editor.click();
  await page.keyboard.type("a quiet harbor at first light, calm water");

  const genBtn = page.getByRole("button", { name: "Generate", exact: true });
  const click = await dbNow();
  await genBtn.evaluate((b) => { b.click(); b.click(); }); // two clicks, ONE synchronous frame

  let ones = 0, twoPlus = 0;
  for (let i = 0; i < 15 && ones < 6; i++) {
    const c = await prisma.genJob.count({ where: { projectId, createdAt: { gte: click } } });
    if (c >= 2) { twoPlus = c; break; }
    ones = c === 1 ? ones + 1 : 0;
    await page.waitForTimeout(1000);
  }
  if (twoPlus >= 2) fail(`FIX FAILED: double-click still created ${twoPlus} jobs`);
  if (ones < 6) fail("no stable single job — did the click register?");
  console.log(`✓ Phase 1 (local): same-frame double-click → exactly 1 GenJob (busyRef guard)`);

  // ── Phase 2: network retry / double-SUBMIT (the gap busyRef can't catch) ──
  // Reload clears busyRef. Fire ONE Generate, capture its startGen server-action POST,
  // then REPLAY that exact POST once from the page origin — a faithful double-submit.
  // Keyless → the replay creates a 2nd paid job. Fixed (stable idempotencyKey) → the
  // server's active-key dedupe returns the in-flight job, so still exactly 1.
  await page.reload({ waitUntil: "networkidle" });
  await editor.click();
  await page.keyboard.type("neon alley reflection at dusk PHASE2");

  let captured = null;
  page.on("request", (req) => {
    if (captured || req.method() !== "POST") return;
    const action = req.headers()["next-action"];
    const body = req.postData();
    if (action && body && body.includes("PHASE2")) {
      captured = { url: req.url(), action, ct: req.headers()["content-type"] || "text/plain;charset=utf-8", body };
    }
  });

  const phase2 = await dbNow();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  for (let i = 0; i < 50 && !captured; i++) await page.waitForTimeout(100);
  if (!captured) fail("phase 2: could not capture the startGen request");

  // Deterministic FIX check: the keyless path sends no key at all.
  if (!captured.body.includes("idempotencyKey")) {
    fail("RED: GenSpace startGen carries NO idempotencyKey — a re-submit will double-spend");
  }

  // Faithful double-submit: replay the captured POST verbatim (same origin → cookies +
  // Origin auto-attached, so Next runs the action again).
  await page.evaluate(async ({ url, action, ct, body }) => {
    await fetch(url, { method: "POST", headers: { "next-action": action, "content-type": ct, accept: "text/x-component" }, body });
  }, captured);

  let p2ones = 0, p2two = 0;
  for (let i = 0; i < 15 && p2ones < 5; i++) {
    const c = await prisma.genJob.count({ where: { projectId, createdAt: { gte: phase2 } } });
    if (c >= 2) { p2two = c; break; }
    p2ones = c === 1 ? p2ones + 1 : 0;
    await page.waitForTimeout(800);
  }
  if (p2two >= 2) fail(`FIX FAILED: replayed startGen (network double-submit) created ${p2two} jobs — idempotencyKey not deduping`);
  if (p2ones < 5) fail("phase 2: no stable single job — did the replay/click register?");
  console.log("✓ Phase 2 (local): replayed startGen (network double-submit) → exactly 1 GenJob (idempotencyKey dedupes)");

  passed = true;
} catch (e) {
  console.error("✗", e.message);
} finally {
  await browser.close().catch(() => {});
  if (projectId) {
    await prisma.genJob.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.generation.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.actionEvent.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
}
if (!passed) process.exit(1);
console.log("LOCAL DOUBLE-CLICK FIX VERIFIED");
process.exit(0);
