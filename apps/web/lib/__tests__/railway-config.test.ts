/**
 * railway-config.test.ts — 生产形状进仓库之后,得有人看着它别再漂走(#797,债 #6)。
 *
 * 配置即代码只解决了一半问题:文件在仓库里,可以 review、可以回滚。另一半是它描述的东西
 * 会变——健康检查路径指向一条已经被改名的路由,Railway 会把每一次部署都判成不健康,而
 * 仓库里那份 JSON 看起来完全正常。所以这里把声明和它描述的代码钉在一起。
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");

type RailwayConfig = {
  build?: { builder?: string; dockerfilePath?: string };
  deploy?: {
    healthcheckPath?: string;
    healthcheckTimeout?: number;
    restartPolicyType?: string;
    restartPolicyMaxRetries?: number;
    numReplicas?: number;
  };
};

const read = (rel: string): RailwayConfig => JSON.parse(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

/**
 * The HTTP status codes a route handler actually ANSWERS with, distinct and sorted.
 *
 * C1b ②: both probe routes spend paragraphs of comment explaining 503 — why this one returns it,
 * why that one stopped. So "does the file contain 503" is a question about prose, and a route
 * that had lost its refusing branch entirely would still answer yes. `{ status: <n> }` is the
 * shape a `Response.json` second argument actually takes here, so that is what gets counted.
 */
function statusCodesAnswered(routeFile: string): number[] {
  const source = readFileSync(routeFile, "utf8");
  const codes = new Set<number>();
  for (const match of source.matchAll(/\bstatus:\s*(\d{3})\b/g)) codes.add(Number(match[1]));
  return [...codes].sort((a, b) => a - b);
}

const SERVICES = [
  { name: "web", config: "apps/web/railway.json" },
  { name: "worker", config: "apps/worker/railway.json" },
] as const;

describe("railway config as code (#797)", () => {
  it.each(SERVICES)("$name declares a Dockerfile build that actually exists", ({ config }) => {
    const cfg = read(config);
    expect(cfg.build?.builder).toBe("DOCKERFILE");
    const dockerfile = cfg.build?.dockerfilePath;
    expect(dockerfile, "dockerfilePath must be declared").toBeTruthy();
    // 路径相对仓库根,因为两个 Dockerfile 都从仓库根 COPY(pnpm workspace),
    // 所以服务的 root directory 必须是 /。
    expect(existsSync(path.join(REPO_ROOT, dockerfile!)), `${dockerfile} does not exist`).toBe(true);
  });

  it.each(SERVICES)("$name restarts on failure with a bounded retry count", ({ config }) => {
    const cfg = read(config);
    expect(cfg.deploy?.restartPolicyType).toBe("ON_FAILURE");
    expect(cfg.deploy?.restartPolicyMaxRetries).toBeGreaterThan(0);
  });

  it("web's healthcheck path points at a route that exists", () => {
    const cfg = read("apps/web/railway.json");
    expect(cfg.deploy?.healthcheckPath).toBe("/api/ready");
    expect(existsSync(path.join(REPO_ROOT, "apps/web/app/api/ready/route.ts"))).toBe(true);
  });

  it("web's healthcheck path is public — a gated path would fail every deploy", () => {
    const proxy = readFileSync(path.join(REPO_ROOT, "apps/web/proxy.ts"), "utf8");
    expect(proxy).toContain("api/ready");
  });

  /**
   * C1b ② — THE DEPLOY GATE MUST POINT AT AN ENDPOINT THAT CAN ANSWER "NO".
   *
   * #796 split liveness from readiness and wrote down which probe each one is for:
   * `/api/health` is the RESTART probe and answers 200 unconditionally; `/api/ready` is the
   * DEPLOY/LOAD probe and answers 503 when migrations did not apply or the database is
   * unreachable (docs/ops/worker-services.md). Railway has exactly one probe in this file, and
   * `healthcheckPath` is the DEPLOY gate — Railway holds traffic on the old deployment until
   * this path answers 2xx.
   *
   * It pointed at `/api/health`. So the gate was wired to the one endpoint in the repository
   * that is DESIGNED never to fail, and #796's promise — "migrations not applied ⇒ the new
   * container takes no traffic, the old deployment keeps serving" — was a sentence in a
   * document that no configuration implemented. A container that booted onto a failed migration
   * passed the gate and was handed production traffic.
   *
   * The pin below is the part that keeps this from silently regressing: it is not enough to
   * name the right path, because the reason the wrong one was wrong is that it cannot say no.
   * So the test READS the endpoint the config names and requires it to have a non-2xx branch,
   * and separately requires `/api/health` to keep having none. Re-point the gate at the
   * liveness probe and this fails on the property, not on the string.
   */
  it("the deploy gate names an endpoint that is CAPABLE of refusing a bad deployment", () => {
    const cfg = read("apps/web/railway.json");
    const probePath = cfg.deploy?.healthcheckPath;
    expect(probePath, "web must declare a deploy healthcheck").toBeTruthy();
    const routeFile = path.join(REPO_ROOT, "apps/web/app", `${probePath}`.replace(/^\//, ""), "route.ts");
    expect(existsSync(routeFile), `${probePath} has no route file at ${routeFile}`).toBe(true);
    // A gate whose endpoint has no failing status code is not a gate. Read the CODE's status
    // codes, not the file's text: both routes discuss 503 at length in their own comments, and a
    // test that accepted prose would pass on an endpoint that had lost the branch entirely.
    expect(
      statusCodesAnswered(routeFile),
      `${probePath} never answers a non-2xx status — it cannot gate a deployment`,
    ).toContain(503);
  });

  it("/api/health stays unconditionally 200 — which is exactly why it is not the deploy gate", () => {
    // Liveness is a restart question, and answering it with the database's health is what
    // produced #796's restart loop. If someone ever teaches this endpoint to fail, the reasoning
    // behind BOTH this pin and the gate above has changed and both deserve re-reading.
    expect(statusCodesAnswered(path.join(REPO_ROOT, "apps/web/app/api/health/route.ts"))).toEqual([200]);
    const cfg = read("apps/web/railway.json");
    expect(cfg.deploy?.healthcheckPath).not.toBe("/api/health");
  });

  it("the worker declares no healthcheck — it serves no HTTP", () => {
    const cfg = read("apps/worker/railway.json");
    expect(cfg.deploy?.healthcheckPath).toBeUndefined();
  });

  it("neither config carries a secret value", () => {
    for (const { config } of SERVICES) {
      const raw = readFileSync(path.join(REPO_ROOT, config), "utf8");
      expect(raw).not.toMatch(/password|secret|api[_-]?key|token/i);
    }
  });
});
