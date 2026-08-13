/**
 * The resident E2E suite (#799, 债 #9 降级版).
 *
 * WHAT THIS IS FOR. The layer a merchant's hands actually touch had no automated verification at
 * all: the client components were only ever driven by throwaway scripts written for one walkthrough
 * and deleted afterwards. These journeys are the first batch that stays — the money trunk (balance,
 * hold, charge, refund, top-up shelf) and the exits (the wall, deleting your own work, the consent
 * gate in front of a broadcast).
 *
 * THE THREE RULES THAT KEEP IT HONEST, because a flaky resident suite is worse than none — it
 * trains everybody to ignore a red:
 *
 *   - NO WALL CLOCK. Every fixture timestamp is a fixed instant and every assertion is about rows
 *     the journey itself seeded. Nothing waits "long enough"; nothing asserts on "today".
 *   - NO NETWORK. The app under test has no provider credential, no mail key and no Stripe key
 *     (support/env.ts, enforced in global-setup.ts), so there is nothing off-machine to be down.
 *   - NO RETRIES. `retries: 0` on purpose: a retry turns a flake into a green and hides exactly
 *     the defect this suite is most likely to grow. A journey that cannot pass three times in a
 *     row is not finished.
 *
 * SERIAL BY CONSTRUCTION (`workers: 1`). One Next server, one Postgres, one browser at a time. The
 * suite is minutes long, and parallelism here buys seconds at the price of the one failure mode
 * nobody can reproduce.
 */
import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL, appEnv } from "./support/env.js";

export default defineConfig({
  testDir: "./journeys",
  outputDir: "./.artifacts",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "./.report", open: "never" }]],
  use: {
    baseURL: E2E_BASE_URL,
    // A failed journey has to be diagnosable from the CI artifact alone — nobody can attach a
    // debugger to last night's run.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    locale: "en-US",
    // Fixed, and the same zone every seeded workspace carries: rendered charge times then come
    // from the workspace setting rather than from wherever the runner happens to be.
    timezoneId: "Asia/Kuala_Lumpur",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The BUILT app, not `next dev`: production is what merchants get, and a dev server's
    // first-request compile is the single largest source of timing noise in a suite like this.
    command: "pnpm --filter @fikirtive/web start",
    cwd: "..",
    // Liveness only — it answers 200 as soon as the process can serve, and never depends on a
    // downstream (apps/web/app/api/health/route.ts).
    url: `${E2E_BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: appEnv(),
    stdout: "pipe",
    stderr: "pipe",
  },
});
