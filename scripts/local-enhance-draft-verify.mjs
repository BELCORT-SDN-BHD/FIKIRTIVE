// LOCAL verification of the Enhance + Draft double-click guards (enhancingRef / draftingRef).
// Mock cowork + local DB → $0: counts audit events, since each enhance/draft writes one
// cowork.enhance / cowork.draft ActionEvent. A same-frame double-click must produce exactly
// ONE audit (pre-fix it produced two). Run:  node scripts/local-enhance-draft-verify.mjs
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://artlio:artlio@localhost:5432/artlio";
const { prisma } = await import("../packages/db/dist/src/index.js");
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const fail = (m) => { throw new Error(m); };
const dbNow = async () => (await prisma.$queryRaw`SELECT now() as now`)[0].now;
const auditCount = (projectId, type, ts) => prisma.actionEvent.count({ where: { projectId, type, createdAt: { gte: ts } } });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();
const editor = page.locator(".mention-input .tiptap, .mention-input [contenteditable='true']").first();

let passed = false, projectId = null;
try {
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
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Enhance/Draft verify");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/studio\?p=/, { timeout: 15000 });
  projectId = new URL(page.url()).searchParams.get("p");

  // ── ENHANCE double-click → exactly 1 cowork.enhance audit ──────────────────
  await page.getByRole("button", { name: "Gen space", exact: true }).click();
  await page.getByRole("tab", { name: "Photo", exact: true }).click();
  await editor.click();
  await page.keyboard.type("a quiet harbor at first light");
  const enhBtn = page.getByRole("button", { name: "Enhance prompt" });
  const enhAt = await dbNow();
  await enhBtn.evaluate((b) => { b.click(); b.click(); }); // two clicks, one frame
  let eOnes = 0, eTwo = 0;
  for (let i = 0; i < 20 && eOnes < 6; i++) { const c = await auditCount(projectId, "cowork.enhance", enhAt); if (c >= 2) { eTwo = c; break; } eOnes = c === 1 ? eOnes + 1 : 0; await page.waitForTimeout(500); }
  if (eTwo >= 2) fail(`ENHANCE FIX FAILED: double-click wrote ${eTwo} cowork.enhance audits (double-spend)`);
  if (eOnes < 6) fail("ENHANCE: no stable single audit — did the click register?");
  console.log("✓ ENHANCE: same-frame double-click → exactly 1 cowork.enhance audit (no double-spend)");

  // ── DRAFT double-click → exactly 1 cowork.draft audit ──────────────────────
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.locator('input[aria-label="Ask cowork"]').fill("a short coffee ad at dawn");
  const draftBtn = page.getByRole("button", { name: "Draft", exact: true });
  const draftAt = await dbNow();
  await draftBtn.evaluate((b) => { b.click(); b.click(); });
  let dOnes = 0, dTwo = 0;
  for (let i = 0; i < 20 && dOnes < 6; i++) { const c = await auditCount(projectId, "cowork.draft", draftAt); if (c >= 2) { dTwo = c; break; } dOnes = c === 1 ? dOnes + 1 : 0; await page.waitForTimeout(500); }
  if (dTwo >= 2) fail(`DRAFT FIX FAILED: double-click wrote ${dTwo} cowork.draft audits (double-spend)`);
  if (dOnes < 6) fail("DRAFT: no stable single audit — did the click register?");
  console.log("✓ DRAFT: same-frame double-click → exactly 1 cowork.draft audit (no double-spend)");
  passed = true;
} catch (e) {
  console.error("✗", e.message);
} finally {
  await browser.close().catch(() => {});
  if (projectId) {
    await prisma.shotEntityRef.deleteMany({ where: { shot: { projectId } } }).catch(() => {});
    await prisma.shot.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.actionEvent.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
}
if (!passed) process.exit(1);
console.log("LOCAL ENHANCE + DRAFT FIX VERIFIED");
process.exit(0);
