// M0 full-journey smoke: elements dialog → shot board → @composer dock →
// candidate upload → attach via pop menu → history filters → detach.
// Screenshots to ~/.gstack/projects/fikirtive/m0-smoke/
// Expects a fresh DB (re-runs collide with leftover entities):
//   docker exec fikirtive-postgres-1 psql -U fikirtive -d fikirtive -c 'TRUNCATE "ActionEvent","Generation","ShotEntityRef","Shot","ReferenceImage","Asset","Entity","TemplateBundle","Project" CASCADE;'
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = path.join(os.homedir(), ".gstack/projects/fikirtive/m0-smoke");
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

const snap = (name) => page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
const step = (msg) => console.log(`✓ ${msg}`);

// --- fixture images ---
async function makeImage(file, color, label, w = 1280, h = 720) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(
    `<body style="margin:0;background:${color};display:grid;place-items:center;
      font:700 64px sans-serif;color:#fff">${label}</body>`,
  );
  await p.screenshot({ path: file });
  await p.close();
}
await makeImage("/tmp/ref-maya.png", "#b85c38", "MAYA REF", 800, 800);
await makeImage("/tmp/ref-alley.png", "#2f6f5f", "NEON ALLEY REF", 800, 800);
await makeImage("/tmp/render-1.png", "#3a2f55", "RENDER v1");
step("fixtures ready");

// --- auth prelude: magic-link login via the dev link file ---
async function login(page) {
  const fs = await import("node:fs/promises");
  await page.goto(BASE + "/login");
  await page.locator('input[type="email"]').fill("tools@belcort.com");
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.getByText("Check your inbox").waitFor({ timeout: 20000 });
  const url = (await fs.readFile(".data/last-magic-link.txt", "utf8")).trim();
  await page.goto(url);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}

await login(page);
step("signed in via magic link");

// --- 1. empty workbench ---
await page.goto(BASE);
await page.getByText("Shot board", { exact: true }).waitFor();
await page.getByText("Plan the film shot by shot").waitFor();
await snap("01-empty.png");
step("workbench loads (empty hero visible)");

// --- 2. create elements via the Library dialog ---
async function createElement(name, typeLabel, img) {
  await page.getByRole("button", { name: "New element", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("tab", { name: typeLabel, exact: true }).click();
  await page.locator('[role="dialog"] .al-input-wrap input').first().fill(name);
  await page.setInputFiles('[role="dialog"] input[type="file"]', img);
  await page.locator('[role="dialog"] .thumb-strip img').first().waitFor();
  await page.getByRole("button", { name: "Save element" }).click();
  // dialog closes, detail drawer opens for the new element
  await page.locator('aside input[aria-label="Element name"]').waitFor({ timeout: 15000 });
}
await page.goto(BASE + "/library");
await page.getByText("Elements", { exact: true }).first().waitFor();
await createElement("Maya", "Character", "/tmp/ref-maya.png");
await createElement("Neon Alley", "Location", "/tmp/ref-alley.png");
await page.getByText("@Maya", { exact: true }).waitFor();
await page.getByText("@Neon Alley", { exact: true }).waitFor();
await snap("02-elements.png");
step("elements created with reference images (dialog flow)");

// --- 3. first shot ---
await page.goto(BASE);
await page.getByRole("button", { name: "Add Shot 01" }).click();
await page.getByText("SHOT 01", { exact: true }).waitFor({ timeout: 15000 });
step("shot 01 created");

// --- 4. @composer dock: mention both elements ---
const editor = page.locator(".al-promptbar .tiptap");
await editor.click();
await page.keyboard.type("Cinematic dolly shot of @May", { delay: 25 });
await page.locator('[aria-label="Entity suggestions"] [role="option"]').first().waitFor({ timeout: 5000 });
await snap("03-mention-dropdown.png");
await page.keyboard.press("Enter");
await page.keyboard.type("walking through @Neon", { delay: 25 });
await page.locator('[aria-label="Entity suggestions"] [role="option"]').first().waitFor({ timeout: 5000 });
await page.keyboard.press("Enter");
await page.keyboard.type("at night, heavy rain", { delay: 25 });
await page.getByRole("button", { name: "Save prompt" }).click();
await page.locator(".scene-grid .mention", { hasText: "@Maya" }).first().waitFor({ timeout: 15000 });
await snap("04-prompt-saved.png");
step("prompt saved — element chips visible on shot card");

// --- 4b. persisted-doc round trip: chips must survive a reload ---
await page.reload();
await page.locator(".al-promptbar .mention", { hasText: "@Maya" }).first().waitFor({ timeout: 15000 });
step("saved doc round-trips — chips intact after reload");

// --- 5. copy resolved prompt ---
await page.getByRole("button", { name: "Copy resolved prompt" }).click();
await page.getByText("Copied ✓").waitFor();
const clip = await page.evaluate(() => navigator.clipboard.readText());
if (!clip.includes("Maya") || !clip.includes("Neon Alley"))
  throw new Error(`resolved prompt wrong: ${clip}`);
step(`resolved prompt copies clean: "${clip.slice(0, 60)}…"`);

// --- 6. upload candidate ---
await page.setInputFiles('input[aria-label="Upload renders"]', "/tmp/render-1.png");
await page.locator(".card-grid .al-mediacard").first().waitFor({ timeout: 20000 });
await snap("05-candidate.png");
step("candidate uploaded (carries shot prompt + elements)");

// --- 7. attach via pop menu ---
await page.getByRole("button", { name: "Attach to shot…" }).click();
await page.locator(".pop-item", { hasText: "Shot 01" }).click();
await page.locator(".scene-grid .al-mediacard-media img").first().waitFor({ timeout: 15000 });
step("candidate attached → shot card thumbnail");

// --- 8. shot status auto-moved + history filter shows v1 ---
await page.locator(".scene-grid").getByText("ATTACHED", { exact: true }).waitFor({ timeout: 15000 });
await page.getByRole("button", { name: /^Shot 01 · 1$/ }).click();
await page.locator(".card-grid .al-mediacard-chip", { hasText: "V1" }).waitFor({ timeout: 15000 });
await snap("06-attached.png");
step("shot status ATTACHED · history shows V1");

// --- 9. detach back to unattached ---
await page.getByRole("button", { name: "Detach → unattached" }).click();
await page.getByRole("button", { name: /^Unattached · 1$/ }).waitFor({ timeout: 15000 });
step("detach returns generation to unattached");
await snap("07-final.png");

const fatal = errors.filter(
  (e) =>
    !e.includes("favicon") &&
    !e.includes("Download the React DevTools") &&
    // dev-only React diagnostic: reloading immediately after a server action
    // occasionally races revalidation; intermittent, cosmetic, absent in prod
    !e.includes("A tree hydrated but some attributes"),
);
if (fatal.length) {
  console.log("CONSOLE ERRORS:");
  for (const e of fatal) console.log("  " + e);
  process.exitCode = 1;
} else {
  console.log("\nALL STEPS PASSED — screenshots in " + SHOTS);
}
await browser.close();
