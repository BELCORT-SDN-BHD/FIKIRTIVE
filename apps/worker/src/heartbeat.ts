/**
 * heartbeat — worker 的存活信号,现在还带部署身份(#797,债 #6)。
 *
 * 原本这一行只回答「worker 还活着吗」。它答不了另一个每次部署都会咬人的问题:
 * **web 和 worker 是不是同一个部署?** 两个服务各自构建、各自重启,任何一次半成功的部署都
 * 会留下「web 是新的、worker 还是旧的」,或者更隐蔽的「两边代码同版,但 worker 的
 * TOKEN_ENCRYPTION_KEY 不是 web 那把」(#569 的形状:发布链每次都在解密那一步静默失败)。
 * 这种状态今天没有任何地方看得见。
 *
 * 所以心跳多写两列:
 *   commitSha         — 平台注入的 git sha。没有就写 null,绝不假造。
 *   configFingerprint — 两侧必须同值的那批变量的 8 位摘要(密钥先 HMAC,原值不进库)。
 *
 * web 在 admin 面里算一次自己的,和这一行比。对不上就亮红,并说清是代码不同版还是配置不同。
 * 心跳写失败照旧只记日志、绝不拖垮 worker——健康度退化成 "stale" 本身就是信号。
 */
import { prisma } from "@fikirtive/db";
import { runAsSystem } from "@fikirtive/db/principal";
import { commitShaFrom, configFingerprint } from "@fikirtive/core/env-contract";

/**
 * 写一次心跳。#463:WorkerHeartbeat 是平台级单行表(没有 tenant),写入必须挂名系统身份。
 *
 * `id` 来自 #796 的角色计划(`plan.heartbeatId`):未拆分的 `all` 仍写 `"worker"`,拆开的两班
 * 各写各的行,否则活着的那半会替死掉的那半把行刷新,/api/health 继续说 "up"。默认值保持
 * `"worker"`,让「单进程」这个今天的现实不必在调用点重复声明。
 */
export function beatOnce(env: NodeJS.ProcessEnv = process.env, id = "worker"): Promise<unknown> {
  const at = new Date();
  const commitSha = commitShaFrom(env);
  const fingerprint = configFingerprint(env);
  return runAsSystem("worker-heartbeat", () =>
    prisma.workerHeartbeat
      .upsert({
        where: { id },
        create: { id, at, commitSha, configFingerprint: fingerprint },
        update: { at, commitSha, configFingerprint: fingerprint },
      })
      .catch((e) => console.warn("[worker] heartbeat write failed:", e instanceof Error ? e.message : e)),
  );
}
