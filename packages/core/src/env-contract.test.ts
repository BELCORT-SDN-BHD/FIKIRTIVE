/**
 * env-contract.test.ts — 双向对账(#797,债 #8)。
 *
 * 这个文件是契约真正的执行者。上面三份清单必须逐字对齐,任何一方漂移就在这里红:
 *
 *   ① 产品源码里读的 env      ← 扫描 apps/ 与 packages/(排除测试与本契约自身)
 *   ② ENV_CONTRACT            ← packages/core/src/env-contract.ts
 *   ③ .env.example            ← 仓库根
 *
 * 为什么要扫源码而不是信任人:整份债 #8 的病因就是「文档说的」和「代码做的」各走各的。
 * 只要还有一步靠自觉,漂移就会在某个部署夜里重新长出来。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ENV_CONTRACT,
  ENV_CONTRACT_BY_NAME,
  FINGERPRINT_VARS,
  bootEnvDecision,
  checkEnv,
  commitShaFrom,
  configFingerprint,
  documentedVars,
  formatEnvProblems,
  renderEnvExampleLines,
  shortSha,
} from "./env-contract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

/** 本契约文件自己逐字列出了所有变量名,扫描时必须排除,否则「源码里出现过」永远为真。 */
const CONTRACT_FILE = path.join("packages", "core", "src", "env-contract.ts");

const SCAN_ROOTS = ["apps/web", "apps/worker", "packages"];
const SKIP_DIR = new Set(["node_modules", "dist", ".next", "__tests__", "migrations", ".git"]);

function collectSourceFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const rel = path.relative(REPO_ROOT, full);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIR.has(entry)) continue;
      collectSourceFiles(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    if (rel === CONTRACT_FILE) continue;
    out.push(full);
  }
}

const sourceFiles = (() => {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) collectSourceFiles(path.join(REPO_ROOT, root), files);
  return files;
})();

const sourceText = sourceFiles.map((f) => readFileSync(f, "utf8")).join("\n");

/** 源码里以 process.env.X 或 const { X, Y } = process.env 形式读到的变量名。 */
function envNamesReadInSource(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
    const name = m[1];
    if (name) names.add(name);
  }
  for (const m of text.matchAll(/const\s*\{([^}]*)\}\s*=\s*process\.env/g)) {
    for (const piece of (m[1] ?? "").split(",")) {
      const name = (piece.split(":")[0] ?? "").trim();
      if (/^[A-Z][A-Z0-9_]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

const readInSource = envNamesReadInSource(sourceText);

/** .env.example 里出现的变量名(`NAME=` 或注释掉的 `# NAME=`)。 */
function envNamesInExample(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^\s*#?\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m?.[1]) names.add(m[1]);
  }
  return names;
}

const envExampleText = readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
const inExample = envNamesInExample(envExampleText);

describe("env contract ↔ source ↔ .env.example (#797 债#8)", () => {
  it("scans a plausible number of source files (guards against a broken walker)", () => {
    expect(sourceFiles.length).toBeGreaterThan(100);
    expect(readInSource.size).toBeGreaterThan(30);
  });

  it("every env var the product source reads is declared in ENV_CONTRACT", () => {
    const undeclared = [...readInSource].filter((name) => !ENV_CONTRACT_BY_NAME.has(name)).sort();
    expect(
      undeclared,
      undeclared.length === 0
        ? ""
        : `These variables are read by product code but are not in ENV_CONTRACT. Declare them ` +
          `(packages/core/src/env-contract.ts) so the boot check and .env.example can see them:\n` +
          undeclared.map((n) => `  • ${n}`).join("\n"),
    ).toEqual([]);
  });

  it("every declared var is actually read somewhere — or says honestly that it is not", () => {
    const wrong: string[] = [];
    for (const spec of ENV_CONTRACT) {
      const appearsInSource = sourceText.includes(spec.name);
      if (spec.readBy === "code" && !appearsInSource) {
        wrong.push(`${spec.name}: readBy="code" but the name appears nowhere in product source`);
      }
      if (spec.readBy === "none" && appearsInSource) {
        wrong.push(`${spec.name}: readBy="none" but the name DOES appear in product source`);
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("every documented var appears in .env.example", () => {
    const missing = documentedVars().filter((spec) => !inExample.has(spec.name));
    expect(
      missing.map((s) => s.name),
      missing.length === 0
        ? ""
        : `.env.example is missing these. Paste this block in (generated from the contract):\n\n` +
          renderEnvExampleLines(missing) +
          `\n`,
    ).toEqual([]);
  });

  it("every var in .env.example is declared in the contract", () => {
    const stray = [...inExample].filter((name) => !ENV_CONTRACT_BY_NAME.has(name)).sort();
    expect(
      stray,
      stray.length === 0
        ? ""
        : `.env.example documents variables the contract does not know about. Either declare them ` +
          `in ENV_CONTRACT or delete the stale lines:\n` + stray.map((n) => `  • ${n}`).join("\n"),
    ).toEqual([]);
  });

  it("declarations are internally consistent", () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const spec of ENV_CONTRACT) {
      if (seen.has(spec.name)) problems.push(`${spec.name}: declared twice`);
      seen.add(spec.name);
      if (spec.format === "enum" && (!spec.values || spec.values.length === 0)) {
        problems.push(`${spec.name}: format "enum" without values`);
      }
      if (spec.requirement === "conditional" && (!spec.requiredWhen || !spec.when)) {
        problems.push(`${spec.name}: conditional without both requiredWhen and when`);
      }
      if (spec.requirement !== "conditional" && spec.requiredWhen) {
        problems.push(`${spec.name}: requiredWhen on a non-conditional variable`);
      }
      // 指纹只对「两侧都读」的变量有意义。
      if (spec.shared && spec.surface !== "both") {
        problems.push(`${spec.name}: shared=true but surface is "${spec.surface}" — one side would never carry it`);
      }
      if (!spec.summary.trim()) problems.push(`${spec.name}: empty summary`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

/** 生产上一个真正能用的最小环境。注意它必须带对象存储——见 STORAGE_DRIVER 那一组测试。 */
const REMOTE_STORAGE = {
  STORAGE_DRIVER: "r2",
  R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  R2_ACCESS_KEY_ID: "id",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "fikirtive-prod",
};

const CORE = {
  DATABASE_URL: "postgresql://u:p@host:5432/db",
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "https://app.example.com",
  // 整顿 C1a 起,报警不再是可选装饰:没有 DSN 的生产进程收不到任何错误报警,
  // 所以它属于「最小能用的生产环境」的一部分。
  SENTRY_DSN: "https://key@o1.ingest.sentry.io/2",
};

describe("checkEnv", () => {
  const good = { ...CORE, ...REMOTE_STORAGE };

  it("passes a minimal production web env", () => {
    expect(checkEnv(good, { surface: "web", production: true })).toEqual([]);
  });

  it("outside production, missing required vars are not problems", () => {
    expect(checkEnv({}, { surface: "web", production: false })).toEqual([]);
  });

  it("in production, a missing required var is a problem", () => {
    const problems = checkEnv({ ...good, BETTER_AUTH_SECRET: undefined }, { surface: "web", production: true });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ name: "BETTER_AUTH_SECRET", kind: "missing" });
  });

  it("a malformed value is a problem in EVERY environment", () => {
    const problems = checkEnv({ TOKEN_ENCRYPTION_KEY: "abcd" }, { surface: "worker", production: false });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ name: "TOKEN_ENCRYPTION_KEY", kind: "invalid" });
  });

  it("half-configured generation is caught: byteplus selected with no key", () => {
    const problems = checkEnv({ ...good, GENERATION_PROVIDER: "byteplus" }, { surface: "worker", production: true });
    expect(problems.map((p) => p.name)).toContain("BYTEPLUS_API_KEY");
    expect(problems.find((p) => p.name === "BYTEPLUS_API_KEY")?.kind).toBe("conditional-missing");
  });

  it("half-configured storage is caught: r2 selected with three of four vars", () => {
    const { R2_BUCKET: _dropped, ...threeOfFour } = REMOTE_STORAGE;
    const problems = checkEnv({ ...CORE, ...threeOfFour }, { surface: "web", production: true });
    expect(problems.map((p) => p.name)).toEqual(["R2_BUCKET"]);
  });

  it("fully unset optional groups stay silent — inert is a legitimate state", () => {
    const problems = checkEnv(good, { surface: "worker", production: true });
    expect(problems.map((p) => p.name)).not.toContain("MEDIA_PROXY_SECRET");
    expect(problems.map((p) => p.name)).not.toContain("TAVILY_API_KEY");
  });

  it("an unrecognized enum value is rejected rather than silently ignored", () => {
    const problems = checkEnv({ GENERATION_PROVIDER: "byteplsu" }, { surface: "worker", production: false });
    expect(problems.map((p) => p.name)).toEqual(["GENERATION_PROVIDER"]);
  });

  it("a variable read by a third-party SDK is never reported as missing — the SDK reports that better", () => {
    const problems = checkEnv(good, { surface: "web", production: true });
    expect(problems.map((p) => p.name)).not.toContain("ANTHROPIC_API_KEY");
  });

  it("web is not asked for worker-only variables and vice versa", () => {
    const webProblems = checkEnv({ ...good, GENERATION_PROVIDER: "byteplus" }, { surface: "web", production: true });
    expect(webProblems.map((p) => p.name)).not.toContain("BYTEPLUS_API_KEY");
  });

  it("never echoes a value, only names and rules", () => {
    const secret = "0".repeat(63); // 63 chars — wrong length on purpose
    const problems = checkEnv({ TOKEN_ENCRYPTION_KEY: secret }, { surface: "worker", production: false });
    const report = formatEnvProblems(problems, "worker");
    expect(report).toContain("TOKEN_ENCRYPTION_KEY");
    expect(report).not.toContain(secret);
  });
});

/**
 * 判官 r1 P1-2:第一版把 STORAGE_DRIVER 设成 optional 且放行 local,于是一个生产进程可以
 * 一个问题都不报地跑在 LocalDiskStorage 上——商家的图和视频写进容器自己的盘,换一次容器就
 * 全没了,而且 web 与 worker 各写各的盘、看不见对方的文件。那正是这张票声称要消灭的生产形状。
 *
 * 格式合法与生产可用是两件事,所以契约里分成 values(格式)与 productionValues(生产档位),
 * 这一组把三格钉住:生产+local=红、生产+远端=绿、开发+local=绿。
 */
describe("STORAGE_DRIVER must be a remote driver in production (#797 r2 P1-2)", () => {
  for (const surface of ["web", "worker"] as const) {
    it(`production + local = RED (${surface})`, () => {
      const problems = checkEnv({ ...CORE, STORAGE_DRIVER: "local" }, { surface, production: true });
      const storage = problems.find((p) => p.name === "STORAGE_DRIVER");
      expect(storage, "local disk in production must be fatal").toBeTruthy();
      expect(storage?.kind).toBe("not-production-safe");
      expect(storage?.message).toContain("r2");
      // 报错要说清楚为什么,否则没法照着修。
      expect(storage?.message).toMatch(/scatters|ephemeral|dev-only/);
    });

    it(`production + remote = GREEN (${surface})`, () => {
      const problems = checkEnv({ ...CORE, ...REMOTE_STORAGE }, { surface, production: true });
      expect(problems).toEqual([]);
    });

    it(`development + local = GREEN (${surface}) — dev machines legitimately use the disk`, () => {
      const problems = checkEnv({ ...CORE, STORAGE_DRIVER: "local" }, { surface, production: false });
      expect(problems).toEqual([]);
    });
  }

  it("production with STORAGE_DRIVER unset is RED — unset resolves to local disk in the factory", () => {
    const problems = checkEnv(CORE, { surface: "web", production: true });
    const storage = problems.find((p) => p.name === "STORAGE_DRIVER");
    expect(storage?.kind).toBe("missing");
  });

  it("a production process refuses to start on local disk", () => {
    const decision = bootEnvDecision(
      { ...CORE, NODE_ENV: "production", STORAGE_DRIVER: "local" },
      { surface: "worker", production: true },
    );
    expect(decision.action).toBe("exit");
  });

  it("the declared production values are a subset of the declared format values", () => {
    for (const spec of ENV_CONTRACT) {
      if (!spec.productionValues) continue;
      expect(spec.productionReason, `${spec.name}: productionValues without a reason`).toBeTruthy();
      if (spec.format === "enum") {
        for (const v of spec.productionValues) {
          expect(spec.values ?? [], `${spec.name}: "${v}" is not one of the declared values`).toContain(v);
        }
      }
    }
  });
});

/**
 * 整顿 C1a —— 报警渠道必须真的在。
 *
 * 它以前是 optional,而那个取值的失效形状是这一族里最糟的一种:没配 DSN 时 `Sentry.init`
 * 从不运行,`captureException`/`captureMessage` 全部静默 no-op,于是**每一条错误报警都不响**
 * ——包括钱路上那几条「商家付了钱什么都没拿到,需要 founder 裁决」。而开机检查一个字都不说,
 * 「装了监控」和「监控在响」被当成同一件事。
 *
 * 三格钉住:生产缺 = 拒绝启动(两侧都是);开发缺 = 照常绿;逃生门仍然开着。
 */
describe("SENTRY_DSN is required in production (整顿 C1a)", () => {
  for (const surface of ["web", "worker"] as const) {
    it(`production without a DSN is RED (${surface}) — the alert pipeline would be silent`, () => {
      const { SENTRY_DSN: _dropped, ...noDsn } = CORE;
      const problems = checkEnv({ ...noDsn, ...REMOTE_STORAGE }, { surface, production: true });
      const dsn = problems.find((p) => p.name === "SENTRY_DSN");
      expect(dsn, "a production process with no error monitoring must not pass the contract").toBeTruthy();
      expect(dsn?.kind).toBe("missing");
    });

    it(`a production process REFUSES TO START without it (${surface})`, () => {
      const { SENTRY_DSN: _dropped, ...noDsn } = CORE;
      const decision = bootEnvDecision({ NODE_ENV: "production", ...noDsn, ...REMOTE_STORAGE }, { surface, production: true });
      expect(decision.action).toBe("exit");
      expect(decision.action === "exit" && decision.report).toContain("SENTRY_DSN");
    });
  }

  it("development without a DSN is GREEN — local machines legitimately run with no monitoring", () => {
    const { SENTRY_DSN: _dropped, ...noDsn } = CORE;
    expect(checkEnv({ ...noDsn, ...REMOTE_STORAGE }, { surface: "web", production: false })).toEqual([]);
  });

  it("the escape hatch still opens: FIKIRTIVE_ENV_CONTRACT=warn starts anyway", () => {
    const { SENTRY_DSN: _dropped, ...noDsn } = CORE;
    const decision = bootEnvDecision(
      { NODE_ENV: "production", FIKIRTIVE_ENV_CONTRACT: "warn", ...noDsn, ...REMOTE_STORAGE },
      { surface: "worker", production: true },
    );
    expect(decision.action).toBe("warn");
  });

  it("the Telegram alert channel stays OPTIONAL — the bot has to be created by a human first", () => {
    // 半配(有 token 没 chat id)也不许变成开机错误:发送器要求两个齐才发,缺一个
    // 与全空同义,都只是「这条通道没开」。
    const problems = checkEnv({ ...CORE, ...REMOTE_STORAGE, TELEGRAM_BOT_TOKEN: "123:AA" }, { surface: "worker", production: true });
    expect(problems).toEqual([]);
  });
});

describe("bootEnvDecision", () => {
  const goodProd = { NODE_ENV: "production", ...CORE, ...REMOTE_STORAGE };

  it("ok when the environment satisfies the contract", () => {
    expect(bootEnvDecision(goodProd, { surface: "web", production: true })).toEqual({ action: "ok" });
  });

  it("production with a missing required var exits — that is the fail-fast", () => {
    const d = bootEnvDecision({ ...goodProd, DATABASE_URL: undefined }, { surface: "web", production: true });
    expect(d.action).toBe("exit");
  });

  it("outside production a missing var is not even a problem — dev boots with an empty env", () => {
    const d = bootEnvDecision({}, { surface: "web", production: false });
    expect(d.action).toBe("ok");
  });

  it("outside production a MALFORMED value still warns — a typo is a typo everywhere", () => {
    const d = bootEnvDecision({ TOKEN_ENCRYPTION_KEY: "abcd" }, { surface: "web", production: false });
    expect(d.action).toBe("warn");
    expect(d.action === "warn" && d.report).toContain("TOKEN_ENCRYPTION_KEY");
  });

  it("FIKIRTIVE_ENV_CONTRACT=warn downgrades production to a warning (the escape hatch)", () => {
    const d = bootEnvDecision(
      { ...goodProd, DATABASE_URL: undefined, FIKIRTIVE_ENV_CONTRACT: "warn" },
      { surface: "web", production: true },
    );
    expect(d.action).toBe("warn");
  });

  it("an unrecognized escape-hatch value does NOT downgrade — only the exact word does", () => {
    const d = bootEnvDecision(
      { ...goodProd, DATABASE_URL: undefined, FIKIRTIVE_ENV_CONTRACT: "yes-please" },
      { surface: "web", production: true },
    );
    // 值本身也不合法(enum),所以它自己也是一条问题;关键是没有换来降级。
    expect(d.action).toBe("exit");
  });
});

describe("configFingerprint", () => {
  const base = {
    TOKEN_ENCRYPTION_KEY: "a".repeat(64),
    MEDIA_PROXY_SECRET: "b".repeat(64),
    STORAGE_DRIVER: "r2",
    R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
    R2_BUCKET: "fikirtive-prod",
  };

  it("is 8 hex characters", () => {
    expect(configFingerprint(base)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is stable for the same config", () => {
    expect(configFingerprint(base)).toBe(configFingerprint({ ...base }));
  });

  it("ignores variables outside the shared set", () => {
    expect(configFingerprint({ ...base, GOOGLE_CLIENT_SECRET: "anything" })).toBe(configFingerprint(base));
  });

  it("changes when a shared SECRET differs — the #569 shape (web and worker holding different keys)", () => {
    expect(configFingerprint({ ...base, TOKEN_ENCRYPTION_KEY: "c".repeat(64) })).not.toBe(configFingerprint(base));
  });

  it("changes when a shared switch differs", () => {
    expect(configFingerprint({ ...base, R2_BUCKET: "fikirtive-staging" })).not.toBe(configFingerprint(base));
  });

  it("changes when one side sets a shared var and the other does not", () => {
    const { MEDIA_PROXY_SECRET: _dropped, ...withoutOne } = base;
    expect(configFingerprint(withoutOne)).not.toBe(configFingerprint(base));
  });

  it("never contains a raw secret", () => {
    const fp = configFingerprint(base);
    expect(base.TOKEN_ENCRYPTION_KEY).not.toContain(fp);
    expect(fp.length).toBe(8);
  });

  it("the shared set is exactly the variables both services must agree on", () => {
    expect([...FINGERPRINT_VARS]).toEqual([
      "MEDIA_PROXY_SECRET",
      "R2_BUCKET",
      "R2_ENDPOINT",
      "STORAGE_DRIVER",
      "TOKEN_ENCRYPTION_KEY",
    ]);
  });
});

describe("commit sha", () => {
  it("reads the platform-injected sha", () => {
    expect(commitShaFrom({ RAILWAY_GIT_COMMIT_SHA: "abc123def456" })).toBe("abc123def456");
  });

  it("returns null rather than inventing one", () => {
    expect(commitShaFrom({})).toBeNull();
    expect(commitShaFrom({ RAILWAY_GIT_COMMIT_SHA: "  " })).toBeNull();
    expect(shortSha(null)).toBeNull();
  });

  it("shortens for display", () => {
    expect(shortSha("abc123def4567890")).toBe("abc123de");
  });
});
