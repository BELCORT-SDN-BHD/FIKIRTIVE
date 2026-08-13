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
 * 第三种状态同样重要,而且第一版把它做错过:**比不了**。迁移刚上线时,存量心跳行的两列是
 * NULL,worker 要到下一次心跳(最多 60 秒)才写上。那段时间里「没有可比的东西」被当成了
 * 「比过了,一样」并亮绿——一个正在裂开的部署会被这样的绿盖住。所以现在:任何一侧缺指纹
 * 都只报「还没上报」的中性态,只有两边都有值且相等才说匹配。
 *
 * 第四种状态是 #796 拆分之后才存在的(判官 r3 P1):**worker 不再只有一班**。`compute` 与
 * `wait` 各写各的心跳行,而且各带各的部署身份 —— 一次半成功的部署完全可能只落到其中一班。
 * 所以这里比的不是「那一行」,是**每一个还活着的角色**,任何一班对不上就是红。详见
 * {@link buildDeploySignal}。
 *
 * 纯函数,便于单测。指纹只在鉴权后的 admin 面里出现,不进 /api/health 这类匿名端点。
 */
import { shortSha } from "@fikirtive/core/env-contract";
import { WORKER_STALE_MS, workerStatus } from "@/lib/health";

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

/** 三态比较:两边都有值才谈得上相等或不等;任何一侧缺失一律 unknown,绝不当成相等。 */
type Comparison = "match" | "mismatch" | "unknown";

function compare(a: string | null, b: string | null): Comparison {
  if (!a || !b) return "unknown";
  return a === b ? "match" : "mismatch";
}

const sha = (v: string | null) => shortSha(v) ?? "unknown";
const fp = (v: string | null) => v ?? "not reported";

/**
 * **一班** worker 与 web 的比较。整块面板的结论由 {@link buildDeploySignal} 汇总。
 *
 * @param web    web 进程此刻的身份
 * @param worker 这一班最近一次心跳写下的身份
 */
export function compareDeploySides(web: DeploySide, worker: DeploySide): DeploySignal {
  const code = compare(web.commitSha, worker.commitSha);
  const config = compare(web.configFingerprint, worker.configFingerprint);

  if (code === "mismatch" && config === "mismatch") {
    return {
      status: "Split deploy",
      detail: `Web ${sha(web.commitSha)} · config ${fp(web.configFingerprint)} vs worker ${sha(worker.commitSha)} · config ${fp(worker.configFingerprint)}. Different code AND different configuration — redeploy both services from the same commit and environment.`,
      tone: "danger",
    };
  }

  if (code === "mismatch") {
    return {
      status: "Code mismatch",
      detail: `Web is running ${sha(web.commitSha)}, the worker is running ${sha(worker.commitSha)}. One service did not finish deploying — redeploy the one that is behind.`,
      tone: "danger",
    };
  }

  if (config === "mismatch") {
    // 前半句必须如实描述代码那一侧的状态。判官 r2 P2-2:这里原本一律写「两边都报告 <web 的
    // SHA>」,于是 worker 没上报 sha 时它替 worker 编了一个,web 没上报时它把 "unknown" 说成
    // 两边共同的版本——诊断句张冠李戴,而这一行的全部价值就是让人照着它去处置。
    const codeClause =
      code === "match"
        ? `Both services report ${sha(web.commitSha)}`
        : !web.commitSha && !worker.commitSha
          ? "Neither service reports a deploy commit"
          : !worker.commitSha
            ? `Web reports ${sha(web.commitSha)} and the worker reports no deploy commit`
            : `The worker reports ${sha(worker.commitSha)} and web reports no deploy commit`;
    return {
      status: "Config mismatch",
      detail: `${codeClause}, but their shared configuration differs (web ${fp(web.configFingerprint)} vs worker ${fp(worker.configFingerprint)}). Anything that depends on both sides holding the same value — publishing, stored media — will fail silently until they match.`,
      tone: "danger",
    };
  }

  // 到这里没有任何一项**对不上**,但「没对不上」不等于「对上了」。
  if (config === "unknown") {
    const who =
      !web.configFingerprint && !worker.configFingerprint
        ? "Neither service has"
        : !worker.configFingerprint
          ? "The worker has not"
          : "Web has not";
    return {
      status: "Not yet reported",
      detail: `${who} reported a configuration fingerprint, so web and worker have not actually been compared. A worker that just restarted fills this in on its next heartbeat, within a minute; if it stays empty, that service is running a build from before this check existed.`,
      tone: "info",
    };
  }

  if (code === "unknown") {
    return {
      status: "Config matches, code unknown",
      detail: `Shared configuration matches (${fp(web.configFingerprint)}), but ${web.commitSha ? "the worker" : "web"} reports no deploy commit, so the two code versions have not been compared.`,
      tone: "info",
    };
  }

  return {
    status: "In sync",
    detail: `Web and worker both run ${sha(web.commitSha)} with the same shared configuration (${fp(web.configFingerprint)}).`,
    tone: "success",
  };
}

/** 一行心跳:身份两列 + 是哪一班 + 上一次心跳的时间(判断这一班还算不算数)。 */
export type WorkerHeartbeatRow = DeploySide & {
  id: string;
  at: Date;
};

/** 「最坏的那一班说了算」的排序:红 > 黄 > 蓝 > 绿。 */
const TONE_RANK: Record<DeployTone, number> = { danger: 4, warning: 3, info: 2, neutral: 1, success: 0 };

const ageMinutes = (at: Date, now: Date) => Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));

/**
 * 整块「Deploy identity」面板的结论 —— 判官 r3 P1。
 *
 * #796 之前 worker 只有一个进程、只有 `"worker"` 这一行,所以 admin 直接 `findUnique({id:"worker"})`
 * 就够了。拆开之后写端变成 `worker-compute` / `worker-wait` 两行(见 apps/worker/src/plan.ts 的
 * `heartbeatIdFor`),而读端还盯着旧的那一行 —— 于是:
 *
 *   - 旧 `"worker"` 行**再也没有人写**,它冻在拆分前的那一刻。它的 sha 和指纹恰好与 web 相同
 *     (拆分那次部署两边同版),于是 admin 报 In sync / 绿;
 *   - 与此同时 `worker-wait` 这一班的部署真的落后了或者拿着另一把密钥,发布链在静默失败。
 *
 * 一句话:一行没人写的旧记录把一个正在裂开的部署盖成了绿灯。这个函数从两处断掉它:
 *
 *   1. **读全部角色行**,不是钦定的那一行。任何一班对不上就红 —— 面板只报最坏的那一班。
 *   2. **超窗的行一律不作数**。心跳超过 {@link WORKER_STALE_MS} 没更新,说明写它的进程已经不在了;
 *      一条没人维护的记录既不能证明同步,也不该被当成一次分叉 —— 它只是历史。存量的旧
 *      `"worker"` 行就是这样被处理掉的:拆分后 5 分钟内它自己变 stale 退出判定,不需要谁去清库。
 *      (未拆分的部署里 `all` 角色本来就一直在写 `"worker"`,它是新鲜的,照常参与判定。)
 *
 * @param rows 心跳表里的全部行(admin 直接 `findMany`,与 /api/health 读的是同一批数据)
 * @param now  判断新鲜度的当下时刻
 */
export function buildDeploySignal(web: DeploySide, rows: WorkerHeartbeatRow[], now: Date): DeploySignal {
  if (rows.length === 0) {
    return {
      status: "No worker heartbeat",
      detail: `Web is running ${sha(web.commitSha)} · config ${fp(web.configFingerprint)}. The worker has never written a heartbeat, so there is nothing to compare it against.`,
      tone: "warning",
    };
  }

  const live = rows.filter((row) => workerStatus(row.at, now) === "up");
  const stale = rows.filter((row) => workerStatus(row.at, now) !== "up");
  const staleClause =
    stale.length === 0
      ? ""
      : ` Ignored ${stale.length} stale heartbeat row(s) — ${stale
          .map((row) => `${row.id} (last beat ${ageMinutes(row.at, now)} min ago)`)
          .join(", ")}. A row nobody writes any more proves nothing about the deploy that is running.`;

  if (live.length === 0) {
    return {
      status: "No live worker heartbeat",
      detail: `Web is running ${sha(web.commitSha)} · config ${fp(web.configFingerprint)}. Every worker heartbeat row is older than ${Math.round(WORKER_STALE_MS / 60_000)} minutes, so no running worker can be compared against it.${staleClause}`,
      tone: "warning",
    };
  }

  const judged = live.map((row) => ({ id: row.id, signal: compareDeploySides(web, row) }));
  // 最坏的那一班说了算:一班红,整块就是红 —— 另外几班绿不能把它买回来。
  const worst = judged.reduce((a, b) => (TONE_RANK[b.signal.tone] > TONE_RANK[a.signal.tone] ? b : a));
  const roster = judged.map((j) => `${j.id}: ${j.signal.status}`).join(" · ");

  return {
    status: worst.signal.status,
    detail: `${worst.id} — ${worst.signal.detail} Live worker roles: ${roster}.${staleClause}`,
    tone: worst.signal.tone,
  };
}
