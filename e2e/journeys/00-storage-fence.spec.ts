/**
 * 围栏自检 —— 跑道拿不到对象存储（#1052）。
 *
 * 不是一条商家旅程，是这套件对自己的检查，所以排在 00：Playwright 按文件名排序，它先跑。
 * 它住在 journeys/ 是因为 `testDir` 只有这一个目录（playwright.config.ts），而这份证据必须
 * 每天跟着 e2e 一起跑，不能只活在某个人的本机。
 *
 * 它钉的是什么：`STORAGE_DRIVER` 与 `R2_*` 全族既没被 `appEnv()` 说出来、也不在
 * `OFF_MACHINE_CREDENTIAL_NAMES` 里，于是开发机 shell 里一份真 R2 配置会原样继承进
 * webServer（Playwright 对未列名的变量是 `{...process.env, ...options.env}` 直接合并），
 * journey 13 的那张假图就真的写进生产桶。两道口子分别对应两条继承路径，所以两道都要堵：
 *
 *   · 进程环境这条 —— `global-setup.ts` 的拒跑名单看得见它，开浏览器之前就红；
 *   · `apps/web/.env.local` 这条 —— 拒跑名单看不见（那份文件不在 runner 的 process.env 里），
 *     只有 `appEnv()` 里一个**说出来的空值**能压住它（`next start` 的 .env 加载不覆盖已存在
 *     的键，DATABASE_URL_POOLED 用的正是这一条）。
 */
import { test, expect } from "@playwright/test";
import { appEnv, offMachineCredentialsPresent, OFF_MACHINE_CREDENTIAL_NAMES } from "../support/env.js";

/**
 * 一台配着真 R2 的机器长什么样。手抄一份，不从被测模块 import——两份名单对不上时这条测试才会红，
 * 从源头 import 会让它变成同义反复。
 */
const A_MACHINE_WITH_REAL_R2 = {
  STORAGE_DRIVER: "r2",
  R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  R2_ACCESS_KEY_ID: "real-access-key-id",
  R2_SECRET_ACCESS_KEY: "real-secret-access-key",
  R2_BUCKET: "fikirtive-prod",
  R2_FORCE_PATH_STYLE: "false",
  R2_BACKUP_ACCESS_KEY_ID: "real-backup-access-key-id",
  R2_BACKUP_SECRET_ACCESS_KEY: "real-backup-secret-access-key",
  R2_BACKUP_BUCKET: "fikirtive-prod-backups",
  R2_BACKUP_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
} as const;

/** 这一族里真正「打得出这台机器」的那些——桶与端点也算：写错地方的对象一样是远端副作用。 */
const REACHES_OFF_MACHINE = [
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_BACKUP_ACCESS_KEY_ID",
  "R2_BACKUP_SECRET_ACCESS_KEY",
  "R2_BACKUP_BUCKET",
  "R2_BACKUP_ENDPOINT",
] as const;

test("#1052 — 带真 R2 环境时 webServer 收到的存储变量全是空值", () => {
  // Playwright 起 webServer 时做的事，逐字照抄：父进程环境在下，appEnv() 叠在上面。
  const whatTheWebServerGets: Record<string, string | undefined> = {
    ...process.env,
    ...A_MACHINE_WITH_REAL_R2,
    ...appEnv(),
  };

  for (const name of Object.keys(A_MACHINE_WITH_REAL_R2)) {
    expect(whatTheWebServerGets[name], `${name} 被原样继承进了 webServer`).toBe("");
  }
  // 结论写出来：`createStorage()` 看到的不是 "r2"，所以它落回 LocalDiskStorage
  // （packages/storage/src/index.ts 的 `process.env.STORAGE_DRIVER === "r2"`）。
  expect(whatTheWebServerGets.STORAGE_DRIVER).not.toBe("r2");
});

test("#1052 — 环境里带一个真 R2 凭据，套件开跑前就拒跑", () => {
  for (const name of REACHES_OFF_MACHINE) {
    expect(
      offMachineCredentialsPresent({ [name]: A_MACHINE_WITH_REAL_R2[name] }),
      `${name} 不在拒跑名单里`,
    ).toEqual([name]);
  }
  // 名单是「凭据」名单，不是「所有存储变量」名单：STORAGE_DRIVER=local 是开发机的正常配置，
  // 拿它拒跑是一条误伤的红。它由上面那个说出来的空值管，不由这里管。
  expect(offMachineCredentialsPresent({ STORAGE_DRIVER: "local" })).toEqual([]);
  expect(OFF_MACHINE_CREDENTIAL_NAMES).not.toContain("STORAGE_DRIVER");

  // 对照组：这条守卫本来就该看见的那些，一个都没丢。
  expect(offMachineCredentialsPresent({ STRIPE_SECRET_KEY: "sk_live_x" })).toEqual(["STRIPE_SECRET_KEY"]);
  expect(offMachineCredentialsPresent({})).toEqual([]);
});
