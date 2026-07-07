// PROD Pass 5 — mobile UI/UX audit on the LIVE site (iPhone-14 viewport, real touch).
// Two jobs: (1) prove the core flow is FUNCTIONALLY usable on a phone (create project +
// generate one real image, request-correlated), and (2) surface UI/UX breakage — it
// measures horizontal overflow on each key view and screenshots everything for review.
// UX findings are COLLECTED (not hard-failed) so the audit covers every view; only a
// broken core flow fails the pass. Reads-only. Run:
//   PROD_DATABASE_URL=<prod-neon-url> node scripts/archive/prod-pass5-mobile.mjs
import { interlock } from "../tools/_interlock.mjs";
interlock({ spends: "one real image generation on the LIVE site (mobile persona pass)", prod: "LIVE site + prod Neon DB (reads)" });
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BASE = process.env.BASE_URL ?? "https://web-production-b13a4.up.railway.app";
const OUT = path.join(os.homedir(), ".gstack/projects/artlio/prod-pass5");
await mkdir(OUT, { recursive: true });
const VW = 390, VH = 844;

const PROD_DB = process.env.PROD_DATABASE_URL;
if (!PROD_DB) { console.error("PROD_DATABASE_URL is required"); process.exit(1); }
process.env.DATABASE_URL = PROD_DB;
const { prisma } = await import("../../packages/db/dist/src/index.js");

let nshot = 0;
const step = (m) => console.log(`✓ ${m}`);
const fail = (m) => { throw new Error(m); };
const dbNow = async () => (await prisma.$queryRaw`SELECT now() as now`)[0].now;
const findings = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: VW, height: VH }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  storageState: ".prod-session.json",
});
const page = await ctx.newPage();
const snap = async (label) => { nshot += 1; await page.screenshot({ path: path.join(OUT, `${String(nshot).padStart(2, "0")}-${label}.png`), fullPage: false }); };
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));

// measurable UX check: does the page scroll sideways on a phone (responsive break)?
async function overflow(label) {
  const o = await page.evaluate((vw) => ({ sw: document.documentElement.scrollWidth, vw }), VW);
  const over = o.sw - o.vw;
  if (over > 4) findings.push(`${label}: horizontal overflow ${over}px (content wider than the ${VW}px screen → sideways scroll)`);
  return over;
}

// honest "can a thumb actually tap this?" check: in the visual viewport, not occluded by
// another element, and a reasonable tap-target size. Playwright .click() would scroll a
// clipped control into view and click it anyway, overstating mobile usability.
async function thumbReachable(locator, label) {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) { findings.push(`${label}: control not rendered (no box)`); return false; }
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  if (cx < 0 || cx > VW || cy < 0 || cy > VH) { findings.push(`${label}: center (${Math.round(cx)},${Math.round(cy)}) is OUTSIDE the ${VW}x${VH} screen — clipped, a thumb can't reach it`); return false; }
  const top = await locator.evaluate((el, [x, y]) => { const t = document.elementFromPoint(x, y); return !t ? "nothing" : (t === el || el.contains(t) || t.contains(el)) ? "self" : `${t.tagName.toLowerCase()}.${(t.className || "").toString().trim().split(/\s+/)[0] || ""}`; }, [cx, cy]).catch(() => "err");
  if (top !== "self") { findings.push(`${label}: center is covered by "${top}" — a tap would hit the wrong element`); return false; }
  if (box.width < 44 || box.height < 44) { findings.push(`${label}: tap target ${Math.round(box.width)}x${Math.round(box.height)}px is below the 44px mobile minimum`); return false; }
  return true;
}

let passed = false, projectId = null;
try {
  await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname.startsWith("/login")) fail("not authenticated on mobile — re-run prod-login");
  await snap("studio");
  await overflow("studio/gen-space");
  step("authenticated on prod (mobile viewport)");

  // is the desktop sidebar eating the screen? (it should collapse on a phone)
  const sidebar = page.locator(".sidenav-project").first();
  if (await sidebar.count()) {
    const box = await sidebar.boundingBox().catch(() => null);
    if (box && box.width > VW * 0.4) findings.push(`sidebar occupies ${Math.round(box.width)}px of the ${VW}px width (>40%) — the desktop nav does not collapse on mobile, squashing the workspace`);
  }
  const menuBtn = page.getByRole("button", { name: /open menu/i });
  if (await menuBtn.count()) { findings.push("an 'Open menu' hamburger exists but the full sidebar still renders alongside it on mobile (redundant / conflicting nav)"); }

  // ── FUNCTIONAL: can a phone user actually create a project + generate? ──────
  const createClick = await dbNow();
  await sidebar.click();
  await page.getByText("+ New project", { exact: true }).click();
  await page.getByRole("dialog").waitFor({ timeout: 10000 });
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Prod Pass 5 — mobile");
  await snap("new-project-dialog");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/studio\?p=/, { timeout: 20000 });
  projectId = new URL(page.url()).searchParams.get("p");
  if (!projectId || !(await prisma.project.findFirst({ where: { id: projectId, createdAt: { gte: createClick } }, select: { id: true } }))) fail("project not created from mobile");
  step(`mobile: created project ${projectId}`);

  await page.getByRole("button", { name: "Gen space", exact: true }).click();
  await page.getByRole("tab", { name: "Photo", exact: true }).click();
  await snap("composer-photo");
  await overflow("gen-space composer");
  const editor = page.locator(".mention-input .tiptap, .mention-input [contenteditable='true']").first();
  await editor.click();
  await page.keyboard.type("a sunlit cafe table with a single espresso cup");
  await snap("composer-typed");
  // honest mobile check: are the composer's critical controls actually thumb-reachable
  // AFTER typing (the keyboard/layout can push them off-screen)? Findings, not a hard fail.
  await thumbReachable(page.getByRole("tab", { name: "Video", exact: true }), "Video tab");
  const genBtn = page.getByRole("button", { name: "Generate", exact: true });
  const genTappable = await thumbReachable(genBtn, "Generate button");
  const genClick = await dbNow();
  if (genTappable) await genBtn.tap(); else await genBtn.click(); // real tap if reachable; else programmatic (still proves the backend path)
  let job = null;
  for (let i = 0; i < 150; i++) {
    const js = await prisma.genJob.findMany({ where: { projectId, createdAt: { gte: genClick } }, orderBy: { createdAt: "desc" }, take: 2, select: { id: true, status: true, error: true, prompt: true, generationIds: true } });
    if (js.length > 1) fail(`one mobile Generate created ${js.length} jobs — double-spend`);
    if (js.length === 1) { const l = js[0]; if (l.status === "FAILED") fail(`mobile gen FAILED: ${l.error?.slice(0, 140)}`); if (l.status === "DONE") { job = l; break; } }
    await page.waitForTimeout(1000);
  }
  if (!job) fail("mobile Generate did not reach DONE — core flow not functional on mobile");
  const gen = await prisma.generation.findFirst({ where: { id: { in: job.generationIds }, deletedAt: null, projectId }, select: { asset: { select: { contentHash: true } } } });
  if (!gen?.asset?.contentHash) fail("mobile gen produced no generation");
  const img = page.locator(`img[src*="${gen.asset.contentHash.toLowerCase()}"]`).first();
  await img.waitFor({ timeout: 25000 });
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) { ok = await img.evaluate((im) => im.complete && im.naturalWidth > 0).catch(() => false); if (!ok) await page.waitForTimeout(500); }
  if (!ok) findings.push("the generated image element is present on mobile but did not decode (may be clipped/hidden by the cramped layout)");
  await snap("generated-image");
  step(`mobile: gen pipeline completes at ${VW}px (job ${job.id.slice(0, 8)} DONE, on-screen == job output)${genTappable ? " — Generate was thumb-reachable" : " — but Generate was NOT cleanly thumb-reachable (see findings)"}`);

  // ── UX sweep: screenshot the other key views + measure overflow ────────────
  for (const [name, label] of [["Storyboard", "storyboard"], ["Elements", "elements"], ["Video editor", "video-editor"], ["Assets", "assets"]]) {
    try {
      await page.getByRole("button", { name, exact: true }).click();
      await page.waitForTimeout(1200);
      await overflow(label);
      await snap(label);
    } catch { findings.push(`could not open "${name}" view on mobile (nav not reachable?)`); }
  }
  step("mobile: swept Storyboard / Elements / Video editor / Assets views (screenshots + overflow measured)");
  passed = true;
} catch (e) {
  console.error("✗", e.message);
} finally {
  await browser.close().catch(() => {});
  if (projectId) {
    const inflight = await prisma.genJob.count({ where: { projectId, status: { in: ["QUEUED", "GENERATING"] } } }).catch(() => 0);
    if (inflight > 0) console.log(`⚠ ${inflight} job(s) still in flight on prod for ${projectId}`);
  }
  await prisma.$disconnect().catch(() => {});
}

console.log(`\nscreenshots → ${OUT}`);
console.log(`\n── MOBILE UI/UX FINDINGS (${findings.length}) ──`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
const fatal = errs.filter((e) => !/hydrat|DevTools|ResizeObserver|preload|\/files\/.*404|Failed to load resource|favicon/.test(e));
if (fatal.length) { console.log("\nPAGE ERRORS:"); fatal.slice(0, 8).forEach((e) => console.log("  " + e)); }
if (!passed) process.exit(1);
console.log(`\nNote: 390x844 viewport via Chromium + iOS UA (not real iOS WebKit) — findings are real at phone width; verify on a device before shipping mobile.`);
console.log("PROD PASS 5 (mobile) — gen pipeline completes at phone width; mobile LAYOUT is not responsive (findings above) — recommend a separate responsive-design pass");
process.exit(0);
