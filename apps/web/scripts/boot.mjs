/**
 * apps/web/scripts/boot.mjs — web 容器的启动顺序(#796:滚动发布风险)。
 *
 * 以前的启动命令是 `migrate deploy && next start`,`&&` 就是全部的错误处理:迁移一失败,
 * 容器立刻退出,Railway 重启,再失败,再重启 —— **整个网站进入 crash loop**,而且每一轮
 * 都拿一次迁移去砸已经不舒服的数据库。多副本时是 N 倍。
 *
 * 现在:
 *   1. 迁移最多试 3 次,中间退避 —— 连接池抖一下、pooler 重启这类**瞬时**故障自己就过去了。
 *   2. 三次都失败:**照样把网站起起来**,并把这件事说清楚 —— 日志一行醒目的告警、
 *      Sentry 一条(配了 DSN 的话)、`/api/health` 的 body 里带 `"migrations":"failed"`。
 *
 * 为什么失败了还要起:因为「旧 schema 上的网站」比「没有网站」强得多。商家还能登录、
 * 还能看自己的东西;只有真正依赖新字段的那部分会报错。而 crash loop 是全线 100% 不可用。
 *
 * 这条选择的代价必须写在这里,不许含糊:一次**滚动发布**里,迁移失败但容器仍然健康,
 * Railway 就会用新代码替换掉旧版本,于是新代码跑在旧 schema 上。所以 `"migrations":"failed"`
 * 不是装饰 —— 它是这条选择的安全带,监控必须盯着它(告警接线是 #793 的活)。
 */
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/** 迁移最多试几次。3 次 ≈ 8 秒,够盖住一次 pooler 抖动,又不至于让健康的部署白等。 */
export const MIGRATION_ATTEMPTS = 3;

/** 第 n 次失败后等多久再试(指数退避,毫秒)。 */
export function migrationRetryDelayMs(attempt) {
  return 2000 * 2 ** (attempt - 1); // 2s, 4s
}

/**
 * 启动脚本写给 web 进程的那个变量名 —— `/api/health` 读的就是它。
 * **同一个字符串也写在 `apps/web/lib/boot-status.ts`**(这里是纯 .mjs,进不来 TypeScript);
 * `lib/__tests__/web-boot.test.ts` 断言两边一致,名字对不上等于健康检查永远报「一切正常」。
 */
export const MIGRATION_STATUS_ENV = "WEB_BOOT_MIGRATION_STATUS";

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", (err) => resolve({ code: 1, error: err }));
    child.on("close", (code) => resolve({ code: code ?? 1 }));
  });
}

/**
 * 跑迁移,带有限次重试。返回 `"applied"` 或 `"failed"` —— **从不抛**:这个脚本存在的
 * 全部意义就是「迁移的失败不能变成整站的失败」。
 */
export async function runMigrations({ exec = run, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let attempt = 1; attempt <= MIGRATION_ATTEMPTS; attempt++) {
    const result = await exec("pnpm", ["--filter", "@fikirtive/db", "migrate:deploy"]);
    if (result.code === 0) return "applied";
    console.error(`[web:boot] prisma migrate deploy failed (attempt ${attempt}/${MIGRATION_ATTEMPTS})${result.error ? `: ${result.error.message}` : ""}`);
    if (attempt < MIGRATION_ATTEMPTS) await sleep(migrationRetryDelayMs(attempt));
  }
  return "failed";
}

/** 迁移失败时打给人看的那段话。刻意长、刻意难忽略 —— 它描述的是一个正在带病运行的站点。 */
export function migrationFailureBanner() {
  return [
    "[web:boot] ############################################################",
    "[web:boot] # DATABASE MIGRATIONS DID NOT APPLY.                       #",
    "[web:boot] # Starting the web server anyway on the CURRENT schema —   #",
    "[web:boot] # a site on an old schema beats a crash loop with no site. #",
    "[web:boot] # /api/health now reports \"migrations\":\"failed\".           #",
    "[web:boot] # Anything that needs the new schema WILL error until this #",
    "[web:boot] # is fixed. Treat it as an incident, not a warning.        #",
    "[web:boot] ############################################################",
  ].join("\n");
}

async function main() {
  const status = await runMigrations();
  if (status === "failed") {
    console.error(migrationFailureBanner());
    // Best-effort Sentry: the web process reports its own errors, but this one happens
    // BEFORE that process exists, so it would otherwise be logs-only.
    if (process.env.SENTRY_DSN) {
      try {
        const Sentry = await import("@sentry/node");
        Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0, environment: process.env.NODE_ENV });
        Sentry.captureMessage("web boot: prisma migrate deploy failed; serving on the previous schema", "error");
        await Sentry.flush(2000);
      } catch (err) {
        console.error("[web:boot] could not report the migration failure to Sentry:", err instanceof Error ? err.message : err);
      }
    }
  }

  const child = spawn("pnpm", ["--filter", "@fikirtive/web", "start"], {
    stdio: "inherit",
    env: { ...process.env, [MIGRATION_STATUS_ENV]: status },
  });
  // Forward shutdown signals so Railway's graceful stop reaches Next, not just this wrapper.
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("close", (code) => process.exit(code ?? 1));
  child.on("error", (err) => {
    console.error("[web:boot] failed to start the web server:", err);
    process.exit(1);
  });
}

// Only run when executed directly — the test imports this module for its pure parts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
