// One-time prod login → saves the authenticated session for all test passes to
// reuse (so you click/forward the magic link exactly ONCE). Run:
//   node scripts/tools/prod-login.mjs "<magic-link-url-from-the-email>"
import { interlock } from "./_interlock.mjs";
interlock({ prod: "logs into the LIVE site and saves a real prod session to .prod-session.json" });
import { chromium } from "playwright";

const url = process.argv[2];
if (!url || !url.startsWith("http")) { console.error("usage: node scripts/tools/prod-login.mjs <magic-link-url>"); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });
// the magic link verifies + redirects off /login once the session is set
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {});
const onApp = !new URL(page.url()).pathname.startsWith("/login");
if (!onApp) { console.error(`login did NOT establish a session — landed on ${page.url()} (link expired/used?)`); await browser.close(); process.exit(1); }
await ctx.storageState({ path: ".prod-session.json" });
await browser.close();
console.log(`✓ prod session saved → .prod-session.json (landed on ${page.url()})`);
