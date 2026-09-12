/**
 * What has to be true before the first journey runs (#799).
 *
 *   1. NOTHING THAT REACHES OFF THIS MACHINE IS CONFIGURED. A resident suite runs unattended,
 *      every night; a provider credential leaking into its environment would mean it generates
 *      for real and bills a merchant's workspace, or mails a real address, or writes its fixture
 *      bytes into the production R2 bucket, or files this suite's own deliberate failures as
 *      production errors. Checked here, before a browser exists, and fatal.
 *
 *      THE OTHER HALF OF THE FENCE cannot be enforced here (#1052): Playwright starts the
 *      webServer BEFORE globalSetup runs, and `apps/web/.env.local` is loaded by `next start`
 *      where this process cannot see it. `support/env.ts`'s `appEnv()` carries that half — an
 *      explicit empty value for every fenced name, which wins over both. What CAN be enforced
 *      here is that the half still exists: `assertAppEnvBlanksEverything()` below reads nothing
 *      but `appEnv()`'s own output and refuses the whole run if a blank went missing.
 *   2. THE DATABASE IS THE SUITE'S OWN, AND IT IS EMPTY. The `_test` name check lives in
 *      support/env.ts and runs first; the truncate below is what makes a journey's assertions
 *      about counts and history mean anything. Leftovers from a previous run are the classic way
 *      a suite goes green on the wrong evidence.
 *
 * Deliberately NOT here: seeding. Each journey seeds its own workspace, so no journey can be made
 * to pass or fail by another journey's fixtures.
 */
import {
  appEnv,
  e2eDatabaseUrl,
  offMachineCredentialsPresent,
  OFF_MACHINE_CREDENTIAL_NAMES,
} from "./support/env.js";
import { prisma } from "./support/db.js";

/**
 * 每一个必须在 `appEnv()` 产物里被**说出来**为空串的名字。
 *
 * 名单本身（`OFF_MACHINE_CREDENTIAL_NAMES`）加上两个开关：`STORAGE_DRIVER` 与
 * `R2_FORCE_PATH_STYLE` 不是凭据，拿它们拒跑是误伤（`STORAGE_DRIVER=local` 是开发机的正当
 * 配置），所以它们不在名单里 —— 但 `.env.local` 那条路只有空值堵得住，于是它们必须在这里。
 */
const MUST_BE_BLANK_IN_APP_ENV: readonly string[] = [
  ...OFF_MACHINE_CREDENTIAL_NAMES,
  "STORAGE_DRIVER",
  "R2_FORCE_PATH_STYLE",
];

/**
 * 「检测 ≠ 阻止」的收口：`00-storage-fence.spec.ts` 里那条同样的断言只是一条**测试**，它红的
 * 时候 journey 13 已经跑过了 —— 同一套件里，一条失败的测试拦不住另一条旅程。这里是同一条断言
 * 长在拦路的位置上：纯 `appEnv()` 自检，不读环境、不碰网络，缺一个空值就抛，整套不跑。
 */
function assertAppEnvBlanksEverything(): void {
  const env = appEnv();
  const leaks = MUST_BE_BLANK_IN_APP_ENV.filter((name) => env[name] !== "");
  if (leaks.length > 0) {
    throw new Error(
      `e2e: appEnv() no longer says an explicit empty value for ${leaks.join(", ")}. That empty value is the only half of the fence that reaches apps/web/.env.local — without it a real credential there is inherited by the app under test. Restore it in e2e/support/env.ts before running.`,
    );
  }
}

async function truncateEverything(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) {
    throw new Error(
      "e2e: the database has no tables — run `pnpm --filter @fikirtive/db exec prisma migrate deploy` against it first.",
    );
  }
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export default async function globalSetup(): Promise<void> {
  const configured = offMachineCredentialsPresent(process.env);
  if (configured.length > 0) {
    throw new Error(
      `e2e: refusing to run with ${configured.join(", ")} in the environment. This suite must never be able to spend real money, send real mail, write into a real storage bucket, or report into a real error stream; unset them and run again.`,
    );
  }
  assertAppEnvBlanksEverything(); // the other half of the fence, checked before a browser exists
  e2eDatabaseUrl(); // name check, before anything is destroyed
  await truncateEverything();
  await prisma.$disconnect();
}
