/**
 * deploy-fingerprint — admin「web 与 worker 是不是同一个部署」这一行(#797,债 #6)。
 *
 * web 在请求时算一次自己的身份(commit sha + 配置指纹),和 worker 最近一次心跳写下的那份比。
 * 两份对不上,就说清楚是哪一种对不上——它们的处置完全不同:
 *
 *   代码不同版  → 一次半成功的部署。重新部署落后的那一个服务。
 *   配置不同    → 两个服务的共享变量不是同一份。这一类最贵:进程都活着,业务在某条路径上
 *                 静默失败(#569:worker 的 TOKEN_ENCRYPTION_KEY 不是 web 那把,于是每一次
 *                 发布都在解密那一步失败,商家只看到一个说不出原因的 NEEDS_ATTENTION)。
 *
 * 纯函数,便于单测。指纹只在鉴权后的 admin 面里出现,不进 /api/health 这类匿名端点。
 */
import { shortSha } from "@fikirtive/core/env-contract";

export type DeployTone = "neutral" | "info" | "success" | "warning" | "danger";

export type DeploySignal = {
  status: string;
  detail: string;
  tone: DeployTone;
};

export type DeploySide = {
  commitSha: string | null;
  configFingerprint: string | null;
};

const sha = (v: string | null) => shortSha(v) ?? "unknown";

/**
 * @param web    web 进程此刻的身份
 * @param worker worker 最近一次心跳写下的身份;心跳行不存在时传 null
 */
export function buildDeploySignal(web: DeploySide, worker: DeploySide | null): DeploySignal {
  if (!worker) {
    return {
      status: "no worker heartbeat",
      detail: `Web is running ${sha(web.commitSha)} · config ${web.configFingerprint ?? "unknown"}. The worker has never written a heartbeat, so there is nothing to compare it against.`,
      tone: "warning",
    };
  }

  const codeKnown = Boolean(web.commitSha && worker.commitSha);
  const codeMismatch = codeKnown && web.commitSha !== worker.commitSha;
  const configMismatch =
    Boolean(web.configFingerprint && worker.configFingerprint) && web.configFingerprint !== worker.configFingerprint;

  if (codeMismatch && configMismatch) {
    return {
      status: "split deploy",
      detail: `Web ${sha(web.commitSha)} · config ${web.configFingerprint} vs worker ${sha(worker.commitSha)} · config ${worker.configFingerprint}. Different code AND different configuration — redeploy both services from the same commit and environment.`,
      tone: "danger",
    };
  }

  if (codeMismatch) {
    return {
      status: "code mismatch",
      detail: `Web is running ${sha(web.commitSha)}, the worker is running ${sha(worker.commitSha)}. One service did not finish deploying — redeploy the one that is behind.`,
      tone: "danger",
    };
  }

  if (configMismatch) {
    return {
      status: "config mismatch",
      detail: `Both services run ${sha(web.commitSha)}, but their shared configuration differs (web ${web.configFingerprint} vs worker ${worker.configFingerprint}). Anything that depends on both sides holding the same value — publishing, stored media — will fail silently until they match.`,
      tone: "danger",
    };
  }

  if (!codeKnown) {
    return {
      status: "config matches",
      detail: `Shared configuration matches (${web.configFingerprint ?? "unknown"}), but no deploy commit is available on ${web.commitSha ? "the worker" : "web"}, so the code versions cannot be compared.`,
      tone: "info",
    };
  }

  return {
    status: "in sync",
    detail: `Web and worker both run ${sha(web.commitSha)} with the same shared configuration (${web.configFingerprint ?? "unknown"}).`,
    tone: "success",
  };
}
