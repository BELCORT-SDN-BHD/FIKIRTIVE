// One-time STAGING login for a second merchant account (tenant B) → saves the
// browser session so an automated run can act as that account without anyone
// typing a code into an agent. The Founder runs it ONCE, from the repo root,
// with the "Log in" URL from the code e-mail (the code rides in the URL
// fragment; SIGNIN-A5):
//   node scripts/tools/staging-login.mjs "<Log in URL from the e-mail>"
// Run with no argument and it asks for the link on stdin instead.
// Output: .staging-tenant-b-session.json (chmod 600, gitignored) — override
// with STAGING_SESSION_OUT. Allowed account: STAGING_TENANT_B_EMAIL.
// Never prints the code or the cookie; on failure it echoes only the allowed address
// or the login page's own fixed alert text.
import { chromium } from "playwright";
import { chmodSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

// The storageState file below is a credential: never let it exist world-readable, not even
// for the sub-second between Playwright writing it and the chmod at the end of this file.
process.umask(0o077);

const OUT = process.env.STAGING_SESSION_OUT ?? ".staging-tenant-b-session.json";
const STAGING = "https://web-staging-7901.up.railway.app";
// Guard: only the tenant-B test merchant may be exported here — never the Founder's own account.
const TENANT_B = (process.env.STAGING_TENANT_B_EMAIL ?? "tools+e2e20260908@belcort.com").toLowerCase();

let url = process.argv[2];
if (!url) {
  const rl = createInterface({ input: stdin, output: stdout });
  url = (await rl.question("Paste the Log in link from the e-mail, then press Enter: ")).trim();
  rl.close();
}
if (!url || !url.startsWith(STAGING + "/login")) {
  console.error(`That is not a staging login link (it must start with ${STAGING}/login). Nothing was done.`);
  process.exit(1);
}
const fragEmail = new URLSearchParams(new URL(url).hash.replace(/^#/, "")).get("email") ?? "";
if (fragEmail.toLowerCase() !== TENANT_B) {
  console.error(`This link is for a different account, not ${TENANT_B}. Request a code for ${TENANT_B} and run again. Nothing was done.`);
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });
// SIGNIN-A5: address + code are prefilled from the fragment; the merchant presses Continue once.
const form = page.locator('form:has(input[name="code"])');
await form.waitFor({ timeout: 20000 });
const submit = form.locator('button[type="submit"]');
await submit.waitFor({ timeout: 10000 });
await submit.click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {});
const landed = new URL(page.url());
if (landed.pathname.startsWith("/login")) {
  const alert = await page.locator('[role="alert"]').first().textContent().catch(() => null);
  console.error(`login did NOT establish a session — still on ${landed.pathname}${alert ? ` (${alert.trim().slice(0, 120)})` : ""}. Ask for a new code and run again.`);
  await browser.close();
  process.exit(1);
}
await ctx.storageState({ path: OUT });
chmodSync(OUT, 0o600);
await browser.close();
console.log(`OK — tenant B session saved (landed on ${landed.pathname}); file: ${OUT}`);
