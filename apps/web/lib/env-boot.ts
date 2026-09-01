/**
 * env-boot — web 进程的开机 env 契约检查(#797,债 #8)。
 *
 * 契约本身在 packages/core/src/env-contract.ts,决策也在那里(bootEnvDecision)。这里只做
 * 宿主该做的三件事:判断这是不是「真的在生产跑」、打印、必要时退出。
 *
 * 「真的在生产跑」不等于 NODE_ENV=production —— `next build` 也在 NODE_ENV=production 下
 * 运行。构建机器上没有生产密钥是完全正常的,如果构建期也 fail-fast,CI 会因为「没有生产
 * 配置」而红,那是一条与代码质量无关的假红。所以构建阶段(NEXT_PHASE=phase-production-build)
 * 一律降级为警告。
 */
import { bootEnvDecision } from "@fikirtive/core/env-contract";

type Env = Record<string, string | undefined>;

/** 这一次运行是不是「正在对外服务的生产进程」。 */
export function isServingProduction(env: Env): boolean {
  if (env.NODE_ENV !== "production") return false;
  if (env.NEXT_PHASE === "phase-production-build") return false; // 构建期,不是服务期
  return true;
}

/**
 * 开机检查。通过则静默;不通过则打印一份只含变量名的报告,并在生产退出(退出后由平台重启,
 * 于是「配置没修好」表现为持续重启,而不是一个看起来活着、实则每条业务路径都会怪病的进程)。
 */
export function assertWebEnv(env: Env = process.env): void {
  const decision = bootEnvDecision(env, { surface: "web", production: isServingProduction(env) });
  if (decision.action === "ok") return;
  if (decision.action === "warn") {
    console.warn(decision.report);
    return;
  }
  console.error(decision.report);
  console.error("[env-contract] refusing to serve with an incomplete production environment. Set FIKIRTIVE_ENV_CONTRACT=warn to start anyway (money-invariant violations stay fatal — see the ⚠️ lines above).");
  process.exit(1);
}
