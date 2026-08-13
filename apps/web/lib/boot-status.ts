/**
 * boot-status — 启动脚本留给 web 进程的一句话:这次启动的数据库迁移到底跑成了没有。
 *
 * 写的一端是 `apps/web/scripts/boot.mjs`(容器的启动命令),读的一端是 `/api/health`。
 * 两端是两个进程,唯一的信道就是这个环境变量。变量名在两个文件里各写了一次(启动脚本是
 * 纯 .mjs,进不来 TypeScript),`lib/__tests__/web-boot.test.ts` 断言两边一致 —— 名字对不上
 * 的后果是健康检查永远报「一切正常」,那正是这个字段要消灭的谎。
 */
export const MIGRATION_STATUS_ENV = "WEB_BOOT_MIGRATION_STATUS";

export type BootMigrationStatus = "applied" | "failed";

/**
 * 默认 `"applied"` 是有意的:本地 `next dev`、测试、以及任何不经启动脚本的跑法都没有这个
 * 变量,而那些场景下迁移本来就不由启动脚本负责。只有启动脚本**明确**写了 `failed`,
 * 才报 failed —— 缺省从不制造假警报,而唯一会写它的地方只在真失败时写。
 */
export function bootMigrationStatus(env: NodeJS.ProcessEnv): BootMigrationStatus {
  return env[MIGRATION_STATUS_ENV] === "failed" ? "failed" : "applied";
}
