/**
 * smoke-script.test.ts — scripts/ops/smoke.sh 的自测(#797)。
 *
 * 部署后烟测的价值全在「坏的时候它真的红」。一个只在健康环境里跑过的烟测脚本,和没有烟测
 * 是一回事——它会在真正出事那天安静地返回 0。所以这里起一个本地 HTTP 服务器,喂给它
 * 各种坏形状(健康检查 503、数据库不通、匿名页 500、worker 心跳过期),逐个断言退出码。
 *
 * 全程只打 127.0.0.1 上的临时端口,不碰任何真实环境。
 */
import { describe, it, expect, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = path.resolve(HERE, "../../../../scripts/ops/smoke.sh");

type Canned = {
  healthStatus: number;
  healthBody: string;
  loginStatus: number;
};

const servers: Server[] = [];

async function serve(canned: Canned): Promise<string> {
  const server = createServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(canned.healthStatus, { "content-type": "application/json" });
      res.end(canned.healthBody);
      return;
    }
    if (req.url === "/login") {
      res.writeHead(canned.loginStatus, { "content-type": "text/html" });
      res.end("<html>sign in</html>");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no port");
  return `http://127.0.0.1:${address.port}`;
}

type Run = { status: number | null; stdout: string; stderr: string };

/**
 * 必须是异步 spawn,不能是 spawnSync:烟测的服务器就跑在这个进程里,spawnSync 会把事件循环
 * 堵死,于是服务器一个连接也接不上,每条用例都变成「连不上 → 全红」的假证据。
 */
function run(args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn("bash", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

/** --attempts 1 --interval 0 so a failing case does not sit through the retry budget. */
function runSmoke(base: string, extra: string[] = []): Promise<Run> {
  return run([SMOKE, base, "--attempts", "1", "--interval", "0", ...extra]);
}

afterAll(() => {
  for (const s of servers) s.close();
});

const HEALTHY = '{"ok":true,"db":"up","worker":"up"}';

describe("scripts/ops/smoke.sh (#797)", () => {
  it("passes against a healthy deployment", async () => {
    const base = await serve({ healthStatus: 200, healthBody: HEALTHY, loginStatus: 200 });
    const result = await runSmoke(base);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("/api/health answered 200");
    expect(result.stdout).toContain("anonymous page /login answered 200");
  });

  it("fails when /api/health does not answer 200", async () => {
    const base = await serve({ healthStatus: 503, healthBody: '{"ok":false,"db":"down","worker":"unknown"}', loginStatus: 200 });
    const result = await runSmoke(base);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("never answered 200");
  });

  it("fails when web answers but the database is unreachable", async () => {
    const base = await serve({ healthStatus: 200, healthBody: '{"ok":false,"db":"down","worker":"unknown"}', loginStatus: 200 });
    const result = await runSmoke(base);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("does not report a reachable database");
  });

  it("fails when the anonymous page does not render — an API-only check would have missed this", async () => {
    const base = await serve({ healthStatus: 200, healthBody: HEALTHY, loginStatus: 500 });
    const result = await runSmoke(base);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("/login answered HTTP 500");
  });

  it("a stale worker is reported but not fatal by default", async () => {
    const base = await serve({ healthStatus: 200, healthBody: '{"ok":true,"db":"up","worker":"stale"}', loginStatus: 200 });
    const result = await runSmoke(base);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("worker heartbeat: stale");
  });

  it("--require-worker makes a stale worker fatal", async () => {
    const base = await serve({ healthStatus: 200, healthBody: '{"ok":true,"db":"up","worker":"stale"}', loginStatus: 200 });
    const result = await runSmoke(base, ["--require-worker"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('worker heartbeat is "stale"');
  });

  it("fails loudly when nothing is listening at all", async () => {
    // 一个确定没人监听的端口:先起再关,端口号保留。
    const base = await serve({ healthStatus: 200, healthBody: HEALTHY, loginStatus: 200 });
    await new Promise<void>((resolve) => servers[servers.length - 1]!.close(() => resolve()));
    const result = await runSmoke(base);
    expect(result.status).toBe(1);
  });

  it("refuses to run without an explicit base URL", async () => {
    const result = await run([SMOKE]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage:");
  });

  it("refuses a base URL that is not http(s)", async () => {
    const result = await run([SMOKE, "app.example.com"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("must start with http:// or https://");
  });
});
