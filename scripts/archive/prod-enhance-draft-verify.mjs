// PROD verification of the Enhance + Draft double-click guards, REAL fal on the LIVE site.
// A same-frame double-click on each must write exactly ONE audit (cowork.enhance /
// cowork.draft) — pre-fix it wrote two = double-spend. Reads-only; reuses .prod-session.json.
// Cost if fixed: 1 enhance + 1 draft (cents). Run:
//   PROD_DATABASE_URL=<prod-neon-url> node scripts/archive/prod-enhance-draft-verify.mjs
import { interlock } from "../tools/_interlock.mjs";
interlock({ spends: "1 enhance + 1 draft (cents) on the LIVE site", prod: "LIVE site + prod Neon DB (reads)" });
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "https://web-production-b13a4.up.railway.app";
const PROD_DB = process.env.PROD_DATABASE_URL;
if (!PROD_DB) { console.error("PROD_DATABASE_URL is required"); process.exit(1); }
process.env.DATABASE_URL = PROD_DB;
const { prisma } = await import("../../packages/db/dist/src/index.js");

const fail = (m) => { throw new Error(m); };
const dbNow = async () => (await prisma.$queryRaw`SELECT now() as now`)[0].now;
const auditCount = (projectId, type, ts) => prisma.actionEvent.count({ where: { projectId, type, createdAt: { gte: ts } } });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 }, storageState: ".prod-session.json" });
const page = await ctx.newPage();
const editor = page.locator(".mention-input .tiptap, .mention-input [contenteditable='true']").first();

let passed = false, projectId = null;
try {
  await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname.startsWith("/login")) fail("not authenticated — re-run prod-login");
  const createClick = await dbNow();
  await page.locator(".sidenav-project").click();
  await page.getByText("+ New project", { exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Prod double-click verify");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/studio\?p=/, { timeout: 20000 });
  projectId = new URL(page.url()).searchParams.get("p");
  if (!projectId || !(await prisma.project.findFirst({ where: { id: projectId, createdAt: { gte: createClick } }, select: { id: true } }))) fail("project not created this run");

  // ENHANCE double-click → exactly 1 cowork.enhance audit (real fal)
  await page.getByRole("button", { name: "Gen space", exact: true }).click();
  await page.getByRole("tab", { name: "Photo", exact: true }).click();
  await editor.click();
  await page.keyboard.type("a quiet harbor at first light, soft mist");
  const enhAt = await dbNow();
  await page.getByRole("button", { name: "Enhance prompt" }).evaluate((b) => { b.click(); b.click(); });
  let eOnes = 0, eTwo = 0;
  for (let i = 0; i < 40 && eOnes < 6; i++) { const c = await auditCount(projectId, "cowork.enhance", enhAt); if (c >= 2) { eTwo = c; break; } eOnes = c === 1 ? eOnes + 1 : 0; await page.waitForTimeout(500); }
  if (eTwo >= 2) fail(`ENHANCE double-spend on prod: ${eTwo} cowork.enhance audits from one double-click`);
  if (eOnes < 6) fail("ENHANCE: no stable single audit on prod");
  console.log("✓ PROD ENHANCE: same-frame double-click → exactly 1 cowork.enhance audit (real fal, no double-spend)");

  // DRAFT double-click → exactly 1 cowork.draft audit (real fal)
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.locator('input[aria-label="Ask cowork"]').fill("a short coffee ad at dawn, three shots");
  const draftAt = await dbNow();
  await page.getByRole("button", { name: "Draft", exact: true }).evaluate((b) => { b.click(); b.click(); });
  let dOnes = 0, dTwo = 0;
  for (let i = 0; i < 40 && dOnes < 6; i++) { const c = await auditCount(projectId, "cowork.draft", draftAt); if (c >= 2) { dTwo = c; break; } dOnes = c === 1 ? dOnes + 1 : 0; await page.waitForTimeout(500); }
  if (dTwo >= 2) fail(`DRAFT double-spend on prod: ${dTwo} cowork.draft audits from one double-click`);
  if (dOnes < 6) fail("DRAFT: no stable single audit on prod");
  console.log("✓ PROD DRAFT: same-frame double-click → exactly 1 cowork.draft audit (real fal, no double-spend)");
  passed = true;
} catch (e) {
  console.error("✗", e.message);
} finally {
  await browser.close().catch(() => {});
  await prisma.$disconnect().catch(() => {});
}
if (!passed) process.exit(1);
console.log("PROD ENHANCE + DRAFT double-click FIX VERIFIED on the live site");
process.exit(0);
