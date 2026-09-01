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

/**
 * 扫哪些树(C3)。原来只有前三个,于是两整片会读 env 的代码在契约眼里根本不存在:
 * ops 脚本(`scripts/`,连同 `apps/web/scripts/`)与 e2e 夹具(`e2e/`)。
 *
 * `scripts/` 里一个 .ts 文件都没有(71 个 .mjs、12 个 .sh),所以只把目录加进来是**假的补全**
 * ——走查器的扩展名过滤会把它整片跳过。要真的看见它,扩展名必须一并带上 `.mjs`,
 * 这同时也把 `apps/web/scripts/boot.mjs`(容器的启动命令,web 的真实第一个进程)拉进了视野。
 */
const SCAN_ROOTS = ["apps/web", "apps/worker", "packages", "scripts", "e2e"];
const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  ".next",
  "__tests__",
  "migrations",
  ".git",
  // `scripts/archive/` 是一次性 QA 脚本的墓地(留档用,永不再跑)。它读的名字里有整批
  // 已经被裁掉的东西(FAL_KEY 之类),扫进来只会让契约替死人背账。
  //
  // ⚠️ 这是**裸目录名**,对全部扫描根生效。今天全仓只有 scripts/archive 这一个
  // (`find apps packages e2e scripts -type d -name archive` 只出它),所以是安全的;
  // 但将来谁在 apps/ 或 packages/ 下建一个叫 archive 的**业务**目录,那片代码读的 env
  // 就会对契约整片隐身——而且不会有任何一条测试红。真到那天,把这条改成带路径前缀的
  // 判断(只跳过 scripts/archive),别扩大这个裸名。
  "archive",
]);

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
    if (!/\.(ts|tsx|mjs)$/.test(entry)) continue;
    if (/\.test\.(tsx?|mjs)$/.test(entry)) continue;
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

/**
 * 部署进程之外读到的 env(C3)。
 *
 * 把 `scripts/` 与 `e2e/` 扫进来之后,新暴露出一批变量:它们真的被读,但读它们的东西
 * 不是 web / worker / backup-cron 里的任何一个,而是**开发者手上的工具**。契约描述的是
 * 部署进程的环境——把 e2e 的端口号和脚本的确认锁塞进 ENV_CONTRACT,只会让 .env.example
 * 越来越不像一份可以照着配的生产配置。
 *
 * 但它们必须被**点名**:一个哪里都没登记的 env 读取,正是这张票要消灭的东西。所以这张
 * 名单本身也被断言(见下面两条测试)——名字必须仍然真的被读到,并且不许同时出现在契约里。
 * 想把其中一个转成生产变量,删掉这里的一行就会立刻红。
 */
const NON_DEPLOY_ENV: Readonly<Record<string, string>> = {
  CI: "e2e 夹具判断自己是不是在 CI 上跑(e2e/playwright.config.ts)。由 GitHub Actions 注入。",
  E2E_BASE_URL: "e2e 打哪个站点(e2e/support/env.ts)。",
  E2E_PORT: "e2e 自己起 web 时用的端口(e2e/support/env.ts)。",
  BASE_URL: "ops 追踪脚本打哪个站点(scripts/tools/*-tracer.mjs)。",
  WEB_ORIGIN: "同上,另一半脚本用的名字。",
  ALLOW_LIVE:
    "apps/web/scripts/create-credit-packs.mjs 的第二道确认:拿 live Stripe key 跑必须显式 ALLOW_LIVE=1。",
  I_UNDERSTAND_THIS_SPENDS: "scripts/tools/_interlock.mjs 的花钱确认锁。",
  I_UNDERSTAND_THIS_TOUCHES_PROD: "scripts/tools/_interlock.mjs 的碰生产确认锁。",
};

/** .env.example 里出现的变量名(`NAME=` 或注释掉的 `# NAME=`)。 */
function envNamesInExample(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^\s*#?\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m?.[1]) names.add(m[1]);
  }
  return names;
}

/**
 * 「这个名字真的在源码里出现过吗」——词边界,不是裸子串(C3)。
 *
 * 旧写法是 `sourceText.includes(name)`。它在 `FOO_BAR` 上对 `FOO` 返回真,于是一个早已
 * 没人读的变量,只要还有一个同前缀(或同后缀)的兄弟活着,就能永远冒充 readBy="code",
 * 而这条本该抓死变量的检查会静静地一直绿。契约里这样的家族一抓一大把:
 * DATABASE_URL / DATABASE_URL_POOLED、SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN、
 * R2_BUCKET / R2_BACKUP_BUCKET、BETTER_AUTH_URL / NEXT_PUBLIC_BETTER_AUTH_URL、
 * ASSET_UNDERSTANDING / ASSET_UNDERSTANDING_DAILY_BUDGET_USD。
 *
 * 变量名的字符集是 [A-Z][A-Z0-9_]*,全部落在 \w 里,所以 \b 正好卡在「前后不是字母、
 * 数字或下划线」的位置:`FOO_BAR` 与 `MY_FOO` 都不再命中 `FOO`。同一个理由也意味着
 * 名字里没有任何正则元字符,不需要转义(下面有一条测试把这个前提钉住)。
 */
function appearsAsWholeName(name: string, text: string): boolean {
  return new RegExp(String.raw`\b${name}\b`).test(text);
}

const envExampleText = readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
const inExample = envNamesInExample(envExampleText);

describe("env contract ↔ source ↔ .env.example (#797 债#8)", () => {
  it("scans a plausible number of source files (guards against a broken walker)", () => {
    expect(sourceFiles.length).toBeGreaterThan(100);
    expect(readInSource.size).toBeGreaterThan(30);
  });

  it("every env var the product source reads is declared in ENV_CONTRACT", () => {
    const undeclared = [...readInSource]
      .filter((name) => !ENV_CONTRACT_BY_NAME.has(name) && !(name in NON_DEPLOY_ENV))
      .sort();
    expect(
      undeclared,
      undeclared.length === 0
        ? ""
        : `These variables are read by product code but are not in ENV_CONTRACT. Declare them ` +
          `(packages/core/src/env-contract.ts) so the boot check and .env.example can see them — ` +
          `or, if a deployed process never reads them, add them to NON_DEPLOY_ENV in this file with a reason:\n` +
          undeclared.map((n) => `  • ${n}`).join("\n"),
    ).toEqual([]);
  });

  // 两条断言刻意分成两个 it:同一个 it 里第一条失败会中止那个 it,第二条再坏也看不见。
  // 名单烂掉与名单重复是两种不同的坏法,要能同时看见。
  it("the non-deploy exemption list cannot rot — every name on it is still read", () => {
    const stale = Object.keys(NON_DEPLOY_ENV).filter((name) => !readInSource.has(name)).sort();
    expect(
      stale,
      stale.length === 0
        ? ""
        : `NON_DEPLOY_ENV exempts these, but nothing reads them any more. Delete the lines:\n` +
          stale.map((n) => `  • ${n}`).join("\n"),
    ).toEqual([]);
  });

  it("no name is exempted as non-deploy AND declared in the contract — one name, one truth", () => {
    const bothPlaces = Object.keys(NON_DEPLOY_ENV).filter((name) => ENV_CONTRACT_BY_NAME.has(name)).sort();
    expect(
      bothPlaces,
      bothPlaces.length === 0
        ? ""
        : `These are exempted as non-deploy AND declared in the contract — two truths about the same name:\n` +
          bothPlaces.map((n) => `  • ${n}`).join("\n"),
    ).toEqual([]);
  });

  it("every declared var is actually read somewhere — or says honestly that it is not", () => {
    const wrong: string[] = [];
    for (const spec of ENV_CONTRACT) {
      const appearsInSource = appearsAsWholeName(spec.name, sourceText);
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
      // 逐面覆盖只有在那一面真的读它时才有意义(C3)。给一个 web-only 的变量写
      // worker 覆盖,是一条永远不会生效、却看起来像在生效的规则。
      for (const [surface, requirement] of Object.entries(spec.requirementBySurface ?? {})) {
        if (spec.surface !== "both" && spec.surface !== surface) {
          problems.push(`${spec.name}: requirementBySurface names "${surface}" but surface is "${spec.surface}"`);
        }
        if (requirement === "conditional" && !spec.requiredWhen) {
          problems.push(`${spec.name}: requirementBySurface."${surface}" is conditional without requiredWhen`);
        }
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

// ── 钱路 M1-c(审计 P1):OTTO_LLM_MARGIN 的下限守卫 ────────────────────────────
// 与 STORAGE_DRIVER 同一族「格式合法但配置是错的」,只是危险取值长成一个完全合法的数。
// 分工:运行时钳位(llm-prices.ts)保证不会亏着卖,这里保证**有人被告知**。
describe("OTTO_LLM_MARGIN 下限守卫(钱路审计 P1)", () => {
  for (const surface of ["web", "worker"] as const) {
    it(`0.5(每卖一单亏一单)= RED,dev 与生产一视同仁 (${surface})`, () => {
      for (const production of [true, false]) {
        const env = production ? { ...CORE, ...REMOTE_STORAGE, OTTO_LLM_MARGIN: "0.5" } : { OTTO_LLM_MARGIN: "0.5" };
        const problems = checkEnv(env, { surface, production });
        const margin = problems.find((p) => p.name === "OTTO_LLM_MARGIN");
        expect(margin, `production=${production} 下必须报错`).toBeTruthy();
        expect(margin?.kind).toBe("invalid");
        expect(margin?.message).toContain("2.06");
        // 报错要说清楚为什么,否则没法照着修。
        expect(margin?.message).toMatch(/below the provider|sell at a loss|less than the provider|under the floor/i);
      }
    });

    it(`2.06 / 2.5 / 10 = GREEN —— 守卫只拦调低,不拦调高 (${surface})`, () => {
      for (const ok of ["2.06", "2.5", "10"]) {
        const problems = checkEnv({ ...CORE, ...REMOTE_STORAGE, OTTO_LLM_MARGIN: ok }, { surface, production: true });
        expect(problems.filter((p) => p.name === "OTTO_LLM_MARGIN"), `OTTO_LLM_MARGIN=${ok}`).toEqual([]);
      }
    });

    // MONEY-A2:验收表点名的 [1.0, 1.82) 区间。这些值在旧下限 1.0 下**全是绿的**,
    // 而 CI 毛利闸读的是代码默认值 —— 生产按 1.5 在卖,没有任何一处会响。
    it(`[1.0, 1.82) 区间的费率覆盖现在一律 RED —— #1047 生产值盲区 (${surface})`, () => {
      for (const bad of ["1", "1.0", "1.5", "1.81", "2", "2.05"]) {
        const problems = checkEnv({ ...CORE, ...REMOTE_STORAGE, OTTO_LLM_MARGIN: bad }, { surface, production: true });
        expect(problems.filter((p) => p.name === "OTTO_LLM_MARGIN"), `OTTO_LLM_MARGIN=${bad}`).toHaveLength(1);
      }
    });
  }

  it("不设(用默认 2.06)照旧 GREEN —— 这是个可选变量", () => {
    const problems = checkEnv({ ...CORE, ...REMOTE_STORAGE }, { surface: "web", production: true });
    expect(problems.filter((p) => p.name === "OTTO_LLM_MARGIN")).toEqual([]);
  });

  it("一个生产进程不会带着 0.5 的 margin 起来", () => {
    const decision = bootEnvDecision(
      { ...CORE, ...REMOTE_STORAGE, NODE_ENV: "production", OTTO_LLM_MARGIN: "0.5" },
      { surface: "worker", production: true },
    );
    expect(decision.action).toBe("exit");
  });
});

/**
 * MONEY-A2 —— **钱路不变量对 warn 免疫**(Founder 2026-09-01,money-engine.md §7.2)。
 *
 * 逃生门 `FIKIRTIVE_ENV_CONTRACT=warn` 是给**可用性**开的:半夜缺一条监控 DSN 不该把发布线
 * 钉死。问题是它一刀切 —— 打开之后,「看不见错误」和「每一笔研究都在破地板卖」被当成同一件
 * 事降级。这三条把新的分界钉死:钱路问题在生产照旧 exit,普通问题照旧被降级,dev 一律 warn。
 */
describe("钱路不变量对 FIKIRTIVE_ENV_CONTRACT=warn 免疫(MONEY-A2)", () => {
  const prodWarn = { NODE_ENV: "production", ...CORE, ...REMOTE_STORAGE, FIKIRTIVE_ENV_CONTRACT: "warn" };

  it("MONEY-A2:生产 + warn + OTTO_LLM_MARGIN=1.5 → 照旧 exit(warn 模式下毛利违规照红)", () => {
    const d = bootEnvDecision({ ...prodWarn, OTTO_LLM_MARGIN: "1.5" }, { surface: "worker", production: true });
    expect(d.action).toBe("exit");
    expect(d.action === "exit" && d.report).toContain("OTTO_LLM_MARGIN");
    // 判词必须说清楚「逃生门救不了它」,否则运维只会以为逃生门坏了。
    expect(d.action === "exit" && d.report).toContain("钱路不变量");
  });

  it("生产 + warn + 普通问题(缺 SENTRY_DSN)→ 仍然 warn,逃生门没有被顺手关掉", () => {
    const { SENTRY_DSN: _dropped, ...noDsn } = CORE;
    const d = bootEnvDecision(
      { NODE_ENV: "production", ...noDsn, ...REMOTE_STORAGE, FIKIRTIVE_ENV_CONTRACT: "warn" },
      { surface: "worker", production: true },
    );
    expect(d.action).toBe("warn");
  });

  it("非生产 + 同样的钱路问题 → 只 warn(dev 不砖:开发机上配错费率不花任何人的钱)", () => {
    const d = bootEnvDecision({ OTTO_LLM_MARGIN: "1.5" }, { surface: "worker", production: false });
    expect(d.action).toBe("warn");
    expect(d.action === "warn" && d.report).toContain("OTTO_LLM_MARGIN");
  });

  it("免疫名单是**具名**的,不是「所有带 minimum 的变量」—— 今天只有 OTTO_LLM_MARGIN", () => {
    const flagged = ENV_CONTRACT.filter((s) => s.moneyInvariant).map((s) => s.name);
    expect(flagged).toEqual(["OTTO_LLM_MARGIN"]);
    // 打了标记就必须有理由可说(minimum/productionValues 至少一样),否则标记会退化成装饰。
    for (const spec of ENV_CONTRACT.filter((s) => s.moneyInvariant)) {
      expect(typeof spec.minimum === "number" || Boolean(spec.productionValues), `${spec.name}`).toBe(true);
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

/**
 * C3 —— 契约说的和代码做的对齐的那几处。每一条都是先被实证抓到「文档说 A、代码做 B」,
 * 再钉一格测试,而不是反过来。
 */
describe("env 契约修真(C3)", () => {
  describe("扫描器认名字,不认子串", () => {
    it("a name is not 'read' just because a longer sibling contains it", () => {
      const text = "const a = process.env.FOO_BAR; const b = process.env.MY_FOO;";
      expect(appearsAsWholeName("FOO_BAR", text)).toBe(true);
      expect(appearsAsWholeName("MY_FOO", text)).toBe(true);
      // 裸子串会把这两条都判成真,于是一个死掉的 FOO 可以永远冒充「还在被读」。
      expect(text.includes("FOO")).toBe(true);
      expect(appearsAsWholeName("FOO", text)).toBe(false);
    });

    it("the real families in this contract are the ones the substring check would have hidden", () => {
      const text = "process.env.DATABASE_URL_POOLED + process.env.NEXT_PUBLIC_SENTRY_DSN";
      expect(appearsAsWholeName("DATABASE_URL", text)).toBe(false);
      expect(appearsAsWholeName("SENTRY_DSN", text)).toBe(false);
      expect(appearsAsWholeName("DATABASE_URL_POOLED", text)).toBe(true);
    });

    it("every declared name is regex-safe, so the matcher needs no escaping", () => {
      for (const spec of ENV_CONTRACT) {
        expect(spec.name, `${spec.name}: env names must be [A-Z][A-Z0-9_]*`).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    });
  });

  describe("BETTER_AUTH_URL:web 硬要求,worker 只是兜底", () => {
    const { BETTER_AUTH_URL: _dropped, ...noAuthUrl } = CORE;

    it("web without it is RED — sessions, callbacks and Stripe return URLs all bind to it", () => {
      const problems = checkEnv({ ...noAuthUrl, ...REMOTE_STORAGE }, { surface: "web", production: true });
      expect(problems.find((p) => p.name === "BETTER_AUTH_URL")?.kind).toBe("missing");
    });

    it("a worker carrying only PUBLIC_BASE_URL is GREEN — the old declaration refused to start it", () => {
      const problems = checkEnv(
        { ...noAuthUrl, ...REMOTE_STORAGE, PUBLIC_BASE_URL: "https://app.example.com" },
        { surface: "worker", production: true },
      );
      expect(problems, "the boot check must not invent an outage the code does not have").toEqual([]);
    });

    it("a malformed value is still fatal on BOTH sides — the override is about strength, not format", () => {
      for (const surface of ["web", "worker"] as const) {
        const problems = checkEnv({ BETTER_AUTH_URL: "app.example.com" }, { surface, production: false });
        expect(problems.map((p) => p.name)).toEqual(["BETTER_AUTH_URL"]);
      }
    });
  });

  describe("DATABASE_URL_POOLED 两侧都读", () => {
    it("the worker now validates it too — it reads it in index.ts and in the nightly backup", () => {
      const problems = checkEnv({ ...CORE, ...REMOTE_STORAGE, DATABASE_URL_POOLED: "not-a-url" }, {
        surface: "worker",
        production: true,
      });
      expect(problems.map((p) => p.name)).toEqual(["DATABASE_URL_POOLED"]);
    });

    it("staying unset is fine on both sides — it is a preference, never a requirement", () => {
      for (const surface of ["web", "worker"] as const) {
        expect(checkEnv({ ...CORE, ...REMOTE_STORAGE }, { surface, production: true })).toEqual([]);
      }
    });
  });

  describe("素材理解的两个开关(平台掏钱的那一路)", () => {
    it("both stay optional — unset is the shipped shape (ON, $5/day)", () => {
      expect(checkEnv({ ...CORE, ...REMOTE_STORAGE }, { surface: "worker", production: true })).toEqual([]);
    });

    it("a mistyped budget is caught at boot instead of silently reverting to the default", () => {
      const problems = checkEnv({ ...CORE, ...REMOTE_STORAGE, ASSET_UNDERSTANDING_DAILY_BUDGET_USD: "5usd" }, {
        surface: "worker",
        production: true,
      });
      expect(problems.map((p) => p.name)).toEqual(["ASSET_UNDERSTANDING_DAILY_BUDGET_USD"]);
    });

    it("\"0\" is legal — a deliberate full stop is not a typo", () => {
      const problems = checkEnv({ ...CORE, ...REMOTE_STORAGE, ASSET_UNDERSTANDING_DAILY_BUDGET_USD: "0" }, {
        surface: "worker",
        production: true,
      });
      expect(problems).toEqual([]);
    });

    // 判官 P3-3:负数与非数字在消费方走同一条静默回落(`n >= 0 ? n : 默认 5`)。
    // 只拦非数字就只拦了一半——想写「停掉」写成 -1 的人会拿到每天 5 美元照跑。
    it("a negative budget is rejected too — in the reader it silently becomes $5/day, not a stop", () => {
      for (const value of ["-1", "-0.5"]) {
        const problems = checkEnv({ ...CORE, ...REMOTE_STORAGE, ASSET_UNDERSTANDING_DAILY_BUDGET_USD: value }, {
          surface: "worker",
          production: true,
        });
        expect(problems.map((p) => p.name), `${value} must be refused`).toEqual([
          "ASSET_UNDERSTANDING_DAILY_BUDGET_USD",
        ]);
        expect(problems[0]?.message).toContain("negative");
      }
    });

    it("a legitimate fractional budget still passes", () => {
      const problems = checkEnv({ ...CORE, ...REMOTE_STORAGE, ASSET_UNDERSTANDING_DAILY_BUDGET_USD: "12.5" }, {
        surface: "worker",
        production: true,
      });
      expect(problems).toEqual([]);
    });

    it("web is never asked about them — only the worker runs the understand queue", () => {
      const spec = ENV_CONTRACT_BY_NAME.get("ASSET_UNDERSTANDING");
      expect(spec?.surface).toBe("worker");
      expect(ENV_CONTRACT_BY_NAME.get("ASSET_UNDERSTANDING_DAILY_BUDGET_USD")?.surface).toBe("worker");
    });
  });

  describe("WEB_BOOT_MIGRATION_STATUS:活的,而且只有两个合法值", () => {
    it("accepts exactly what the boot script writes", () => {
      for (const value of ["applied", "failed"]) {
        expect(checkEnv({ ...CORE, ...REMOTE_STORAGE, WEB_BOOT_MIGRATION_STATUS: value }, {
          surface: "web",
          production: true,
        })).toEqual([]);
      }
    });

    it("rejects anything else — every other value is read as \"applied\", i.e. as a healthy lie", () => {
      const problems = checkEnv({ ...CORE, ...REMOTE_STORAGE, WEB_BOOT_MIGRATION_STATUS: "ok" }, {
        surface: "web",
        production: true,
      });
      expect(problems.map((p) => p.name)).toEqual(["WEB_BOOT_MIGRATION_STATUS"]);
    });
  });

  describe("META_GRAPH_MOCK 的文档说真话", () => {
    it("the summary names the value the code actually compares against, and never the old \"1\"", () => {
      const summary = ENV_CONTRACT_BY_NAME.get("META_GRAPH_MOCK")?.summary ?? "";
      expect(summary).toContain("fixture");
      expect(summary.toLowerCase()).toContain("production");
    });
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
