// Camera-preset QA ($0, mock): selecting a camera motion appends it to the
// video generation prompt (Gen space + Storyboard). Verifies the GenJob prompt.
import { chromium } from "playwright";
process.env.DATABASE_URL ??= "postgresql://fikirtive:fikirtive@localhost:5432/fikirtive";
const { prisma } = await import("../../packages/db/dist/src/index.js");
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();
const step = (m) => console.log(`✓ ${m}`);

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
await page.locator('[role="dialog"] .al-input-wrap input').first().fill("Camera QA");
await page.getByRole("button", { name: "Create project", exact: true }).click();
await page.waitForURL(/\/studio\?p=/, { timeout: 15000 });
const projectId = new URL(page.url()).searchParams.get("p");
step(`project ${projectId}`);

// Gen space video mode → pick a camera preset → generate
await page.getByRole("tab", { name: "Video", exact: true }).click();
await page.locator('select[aria-label="Camera motion"]').selectOption({ label: "Dolly in" });
await page.locator('input[aria-label="Describe the shot"]').fill("a city street at night");
await page.getByRole("button", { name: "Generate", exact: true }).click();
await page.locator(".screen video").first().waitFor({ timeout: 60000 });
step("Gen space: generated video with a camera preset");

await browser.close();

// the GenJob's prompt must carry the camera phrase
const job = await prisma.genJob.findFirst({ where: { projectId, kind: "VIDEO" }, orderBy: { createdAt: "desc" } });
if (!job) throw new Error("no video job found");
if (!/dolly in/i.test(job.prompt)) throw new Error(`camera not appended to prompt: "${job.prompt}"`);
step(`camera appended to prompt → "${job.prompt}"`);
await prisma.$disconnect();
console.log("\nCAMERA PRESET QA PASSED ($0)");
process.exit(0);
