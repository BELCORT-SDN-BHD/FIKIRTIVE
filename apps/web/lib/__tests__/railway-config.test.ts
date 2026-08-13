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
    expect(cfg.deploy?.healthcheckPath).toBe("/api/health");
    expect(existsSync(path.join(REPO_ROOT, "apps/web/app/api/health/route.ts"))).toBe(true);
  });

  it("web's healthcheck path is public — a gated path would fail every deploy", () => {
    const proxy = readFileSync(path.join(REPO_ROOT, "apps/web/proxy.ts"), "utf8");
    expect(proxy).toContain("api/health");
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
