/**
 * boot-env — worker 进程的开机 env 契约检查(#797,债 #8)。
 *
 * 与 apps/web/lib/env-boot.ts 是同一份决策(packages/core 的 bootEnvDecision),只是宿主不同:
 * worker 没有构建阶段那一层区分,NODE_ENV=production 就是在生产跑。
 *
 * 与既有的 publishChainWarning 的分工:那一条是 fail-SOFT 的产品判断(发布链上线前刻意 inert,
 * 半配才警告,永不退出);这一条是 fail-FAST 的配置判断(生产缺必需项直接退出)。两者都保留,
 * 因为它们回答的是不同的问题。
 *
 * RELY-A10:备份 cron(`apps/worker/src/backup-cron.ts`)复用这同一个函数,传
 * `{ process: "backup-cron" }`——它与 worker 主进程共用一份契约,但会跳过标了 `cronExempt`
 * 的变量的存在性判定(今天只有 GENERATION_PROVIDER:cron 从不碰生成引擎,见
 * packages/core/src/env-contract.ts 里 `cronExempt` 字段自己的注释)。
 */
import { bootEnvDecision, type CheckEnvOptions } from "@fikirtive/core/env-contract";

type Env = Record<string, string | undefined>;

export function assertWorkerEnv(env: Env = process.env, opts: { process?: CheckEnvOptions["process"] } = {}): void {
  const decision = bootEnvDecision(env, { surface: "worker", production: env.NODE_ENV === "production", process: opts.process });
  if (decision.action === "ok") return;
  if (decision.action === "warn") {
    console.warn(decision.report);
    return;
  }
  console.error(decision.report);
  const who = opts.process === "backup-cron" ? "backup-cron" : "worker";
  console.error(`[env-contract] ${who} refusing to start with an incomplete production environment. Set FIKIRTIVE_ENV_CONTRACT=warn to start anyway (money-invariant violations stay fatal — see the ⚠️ lines above).`);
  process.exit(1);
}
