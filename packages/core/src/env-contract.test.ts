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

describe("checkEnv", () => {
  const good = {
    DATABASE_URL: "postgresql://u:p@host:5432/db",
    BETTER_AUTH_SECRET: "s".repeat(32),
    BETTER_AUTH_URL: "https://app.example.com",
  };

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
    const problems = checkEnv(
      { ...good, DATABASE_URL: good.DATABASE_URL, GENERATION_PROVIDER: "byteplus" },
      { surface: "worker", production: true },
    );
    expect(problems.map((p) => p.name)).toContain("BYTEPLUS_API_KEY");
    expect(problems.find((p) => p.name === "BYTEPLUS_API_KEY")?.kind).toBe("conditional-missing");
  });

  it("half-configured storage is caught: r2 selected with three of four vars", () => {
    const problems = checkEnv(
      {
        ...good,
        STORAGE_DRIVER: "r2",
        R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
        R2_ACCESS_KEY_ID: "id",
        R2_SECRET_ACCESS_KEY: "secret",
      },
      { surface: "web", production: true },
    );
    expect(problems.map((p) => p.name)).toEqual(["R2_BUCKET"]);
  });

  it("fully unset optional groups stay silent — inert is a legitimate state", () => {
    const problems = checkEnv(good, { surface: "worker", production: true });
    expect(problems.map((p) => p.name)).not.toContain("MEDIA_PROXY_SECRET");
    expect(problems.map((p) => p.name)).not.toContain("R2_BUCKET");
  });

  it("an unrecognized enum value is rejected rather than silently ignored", () => {
    const problems = checkEnv({ GENERATION_PROVIDER: "byteplsu" }, { surface: "worker", production: false });
    expect(problems.map((p) => p.name)).toEqual(["GENERATION_PROVIDER"]);
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

describe("bootEnvDecision", () => {
  const goodProd = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://u:p@host:5432/db",
    BETTER_AUTH_SECRET: "s".repeat(32),
    BETTER_AUTH_URL: "https://app.example.com",
  };

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
