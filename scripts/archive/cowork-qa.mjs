// Cowork v1 QA ($0, mock): describe a film in the Storyboard → cowork drafts
// scenes + shots. Asserts shots got created with prompts, grouped into a scene.
import { chromium } from "playwright";
process.env.DATABASE_URL ??= "postgresql://artlio:artlio@localhost:5432/artlio";
const { prisma } = await import("../../packages/db/dist/src/index.js");
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();
const step = (m) => console.log(`✓ ${m}`);
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));

const fs = await import("node:fs/promises");
await page.goto(BASE + "/login");
await page.locator('input[type="email"]').fill("tools@belcort.com");
await page.getByRole("button", { name: "Send magic link" }).click();
await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
await page.goto((await fs.readFile(".data/last-magic-link.txt", "utf8")).trim());
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
await page.locator(".sidenav-project").click();
await page.getByText("+ New project", { exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Cowork QA");
await page.getByRole("button", { name: "Create project", exact: true }).click();
await page.waitForURL(/\/studio\?p=/, { timeout: 15000 });
const projectId = new URL(page.url()).searchParams.get("p");
step(`project ${projectId}`);

// Storyboard → ask cowork to draft
await page.getByRole("button", { name: "Storyboard", exact: true }).click();
await page.waitForTimeout(400);
await page.locator('input[aria-label="Ask cowork"]').fill("a moody coffee ad: a barista crafts a latte at dawn in a quiet cafe");
await page.getByRole("button", { name: "Draft", exact: true }).click();
// shots appear
await page.waitForFunction(() => document.querySelectorAll(".al-mediacard textarea").length >= 3, null, { timeout: 30000 });
const cards = await page.locator(".al-mediacard").count();
step(`cowork drafted the storyboard → ${cards} shot cards`);

await browser.close();

// DB: shots created with prompts, under a scene
const shots = await prisma.shot.findMany({ where: { projectId, deletedAt: null }, orderBy: { number: "asc" } });
if (shots.length < 3) throw new Error(`only ${shots.length} shots created`);
if (shots.some((s) => !s.description?.trim())) throw new Error("a drafted shot has no prompt");
const scenes = new Set(shots.map((s) => s.scene));
step(`DB: ${shots.length} shots across ${scenes.size} scene(s), each with a prompt`);
step(`sample shot prompt: "${shots[0].description.slice(0, 60)}…"`);
await prisma.$disconnect();

const fatal = errs.filter((e) => !/hydrat|DevTools|ResizeObserver|404|preload/.test(e));
if (fatal.length) { console.log("PAGE ERRORS:"); fatal.slice(0, 6).forEach((e) => console.log("  " + e)); process.exit(1); }
console.log("\nCOWORK v1 QA PASSED (storyboard-from-idea, mock $0)");
process.exit(0);
