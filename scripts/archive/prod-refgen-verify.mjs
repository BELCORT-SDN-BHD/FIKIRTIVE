// PROD verification of the ref-gen double-click guard (Library GenerateRefsBlock,
// submittingRef), REAL fal on the LIVE site. A same-frame double-click on "Generate"
// must create exactly ONE RefGenJob (pre-fix: two = double-spend). count=1 keeps spend to
// ~$0.04. Reads-only; reuses .prod-session.json. Run:
//   PROD_DATABASE_URL=<prod-neon-url> node scripts/archive/prod-refgen-verify.mjs
import { interlock } from "../tools/_interlock.mjs";
interlock({ spends: "~$0.04 — one refgen image on the LIVE site", prod: "LIVE site + prod Neon DB (reads)" });
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BASE = process.env.BASE_URL ?? "https://web-production-b13a4.up.railway.app";
const OUT = path.join(os.homedir(), ".gstack/projects/artlio/prod-refgen");
await mkdir(OUT, { recursive: true });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const PROD_DB = process.env.PROD_DATABASE_URL;
if (!PROD_DB) { console.error("PROD_DATABASE_URL is required"); process.exit(1); }
process.env.DATABASE_URL = PROD_DB;
const { prisma } = await import("../../packages/db/dist/src/index.js");

const charName = "RefGen" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const fail = (m) => { throw new Error(m); };
const dbNow = async () => (await prisma.$queryRaw`SELECT now() as now`)[0].now;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 }, storageState: ".prod-session.json" });
const page = await ctx.newPage();
let nshot = 0;
const snap = async (l) => { nshot += 1; await page.screenshot({ path: path.join(OUT, `${String(nshot).padStart(2, "0")}-${l}.png`) }); };

let passed = false, projectId = null, entityId = null;
try {
  await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname.startsWith("/login")) fail("not authenticated — re-run prod-login");
  const createClick = await dbNow();
  await page.locator(".sidenav-project").click();
  await page.getByText("+ New project", { exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Prod refgen verify");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/studio\?p=/, { timeout: 20000 });
  projectId = new URL(page.url()).searchParams.get("p");
  if (!projectId || !(await prisma.project.findFirst({ where: { id: projectId, createdAt: { gte: createClick } }, select: { id: true } }))) fail("project not created this run");

  // create a CHARACTER with a reference → its EntityDetail drawer opens (GenerateRefsBlock)
  await page.getByRole("button", { name: "Elements", exact: true }).click();
  await page.getByRole("button", { name: "New element", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("tab", { name: "Character", exact: true }).click();
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill(charName);
  await page.locator('input[aria-label="Source images"]').setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: PNG });
  await page.locator('[role="dialog"] .ref-thumb').first().waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Save element", exact: true }).click();
  await page.locator(".ref-thumb").first().waitFor({ timeout: 25000 });
  for (let i = 0; i < 20 && !entityId; i++) { entityId = (await prisma.entity.findFirst({ where: { ownerId: "founder", name: charName, deletedAt: null }, select: { id: true } }))?.id; if (!entityId) await page.waitForTimeout(500); }
  if (!entityId) fail("character entity not created");

  // the refgen panel is in the open drawer; ensure it's visible
  const promptBox = page.locator('textarea[aria-label="Generation prompt"]').first();
  if (!(await promptBox.count())) { await page.locator(".al-mediacard", { hasText: charName }).first().click().catch(() => {}); }
  await promptBox.waitFor({ timeout: 8000 });
  await page.locator('select[aria-label="Number of images"]').first().selectOption("1"); // minimize spend
  await snap("refgen-panel");

  // double-click "Generate 1" → must create EXACTLY ONE RefGenJob
  const genBtn = page.getByRole("button", { name: /Generate 1\b/ }).first();
  await genBtn.waitFor({ timeout: 6000 });
  const dcAt = await dbNow();
  await genBtn.evaluate((b) => { b.click(); b.click(); }); // two clicks, one synchronous frame
  let ones = 0, twoPlus = 0;
  for (let i = 0; i < 30 && ones < 6; i++) {
    const c = await prisma.refGenJob.count({ where: { entityId, createdAt: { gte: dcAt } } });
    if (c >= 2) { twoPlus = c; break; }
    ones = c === 1 ? ones + 1 : 0;
    await page.waitForTimeout(1000);
  }
  if (twoPlus >= 2) { await snap("refgen-DOUBLE-SPEND"); fail(`REFGEN double-spend on prod: ${twoPlus} RefGenJobs from one double-click`); }
  if (ones < 6) fail("REFGEN: no stable single RefGenJob — did the click register?");
  await snap("refgen-one-job");
  console.log(`✓ PROD REFGEN: same-frame double-click → exactly 1 RefGenJob (real fal, no double-spend)`);
  passed = true;
} catch (e) {
  console.error("✗", e.message);
} finally {
  await browser.close().catch(() => {});
  if (entityId) {
    const inflight = await prisma.refGenJob.count({ where: { entityId, status: { in: ["QUEUED", "GENERATING"] } } }).catch(() => 0);
    if (inflight > 0) console.log(`⚠ ${inflight} RefGenJob(s) still in flight for entity ${entityId}`);
  }
  await prisma.$disconnect().catch(() => {});
}
console.log(`screenshots → ${OUT}`);
if (!passed) process.exit(1);
console.log("PROD REFGEN double-click FIX VERIFIED on the live site");
process.exit(0);
