/**
 * env-contract-storage-consistency.test.ts — 判官 r2 P1-1。
 *
 * 判官发现的洞:契约按 trim 后的值判断,而 `packages/storage` 按原值严格比较
 * (`process.env.STORAGE_DRIVER === "r2"`)。于是 `STORAGE_DRIVER=" r2 "` 在契约里零问题,
 * 工厂却落回 LocalDiskStorage——开机检查刚说完一切正常,商家的文件就开始写进容器自己的盘。
 * 一个声称「说的必须等于做的」的检查,自己成了说的与做的不一致的那一处。
 *
 * 所以光修 trim 不够,得让「契约怎么说」与「工厂怎么做」在同一个 env 值上被同时执行、当场对账。
 * 这个文件就是那道对账,住在 apps/web 是因为只有它同时依赖 @fikirtive/core 与 @fikirtive/storage。
 *
 * 核心不变量,一句话:**契约在生产判绿 ⇒ 工厂产出的不是本地盘。**
 */
import { describe, it, expect, afterEach } from "vitest";
import { checkEnv } from "@fikirtive/core/env-contract";
import { createStorage, LocalDiskStorage } from "@fikirtive/storage";

const R2_CREDS = {
  R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  R2_ACCESS_KEY_ID: "id",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "fikirtive-prod",
};

const CORE = {
  DATABASE_URL: "postgresql://u:p@host:5432/db",
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "https://app.example.com",
};

const TOUCHED = ["STORAGE_DRIVER", ...Object.keys(R2_CREDS), ...Object.keys(CORE)] as const;
const saved = new Map<string, string | undefined>();

/** 工厂读的是真的 process.env,所以只能装环境后再调用它;每个用例结束原样还回去。 */
function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  for (const key of TOUCHED) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    const next = env[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  return fn();
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

/** 工厂在这个 env 下会不会给出本地盘?(r2 配置不全时它按设计抛,那也不是本地盘。) */
function factoryUsesLocalDisk(env: Record<string, string | undefined>): boolean {
  return withEnv(env, () => {
    try {
      return createStorage("/tmp/fikirtive-consistency-probe") instanceof LocalDiskStorage;
    } catch {
      return false; // 抛 = 半配的 r2,响亮地失败,不是静默落本地盘
    }
  });
}

const contractProblems = (env: Record<string, string | undefined>) =>
  checkEnv(env, { surface: "web", production: true }).map((p) => `${p.name}:${p.kind}`);

describe("contract ⇄ storage factory agree on the same value (#797 r3 P1-1)", () => {
  const cases = [
    { label: 'exactly "r2"', driver: "r2", creds: true, contractGreen: true },
    { label: '" r2 " — a value pasted with padding', driver: " r2 ", creds: true, contractGreen: false },
    { label: '"r2 " — one trailing space', driver: "r2 ", creds: true, contractGreen: false },
    { label: '"\\nr2" — a leading newline', driver: "\nr2", creds: true, contractGreen: false },
    { label: '"R2" — wrong case', driver: "R2", creds: true, contractGreen: false },
    { label: '"local"', driver: "local", creds: false, contractGreen: false },
    { label: '"" — empty string', driver: "", creds: false, contractGreen: false },
    { label: '"   " — whitespace only', driver: "   ", creds: false, contractGreen: false },
    { label: "unset", driver: undefined, creds: false, contractGreen: false },
  ] as const;

  for (const c of cases) {
    it(`${c.label}: contract ${c.contractGreen ? "green" : "red"} ⇔ factory ${c.contractGreen ? "remote" : "local disk"}`, () => {
      const env = { ...CORE, ...(c.creds ? R2_CREDS : {}), STORAGE_DRIVER: c.driver };
      const problems = contractProblems(env);
      const local = factoryUsesLocalDisk(env);

      if (c.contractGreen) {
        expect(problems, "contract should have nothing to say about this env").toEqual([]);
        expect(local, "…and the factory must NOT be on local disk").toBe(false);
      } else {
        expect(problems.length, "contract must object to this env").toBeGreaterThan(0);
        expect(problems.some((p) => p.startsWith("STORAGE_DRIVER:")), `expected a STORAGE_DRIVER problem, got ${problems.join(", ")}`).toBe(true);
        expect(local, "…and this is exactly the env where the factory falls back to local disk").toBe(true);
      }
    });
  }

  /**
   * 上面逐格断言,这里断言那条不变量本身:凡是契约在生产判绿的 env,工厂都不许给出本地盘。
   * 判官那条 " r2 " 就是从这条不变量的裂缝里钻进来的。
   */
  it("THE INVARIANT: a production env the contract passes never yields local disk", () => {
    for (const c of cases) {
      const env = { ...CORE, ...(c.creds ? R2_CREDS : {}), STORAGE_DRIVER: c.driver };
      if (contractProblems(env).length > 0) continue;
      expect(factoryUsesLocalDisk(env), `contract passed ${JSON.stringify(c.driver)} but the factory chose local disk`).toBe(false);
    }
  });

  it("the padded value is reported as whitespace, not as some unrelated complaint", () => {
    const problems = checkEnv({ ...CORE, ...R2_CREDS, STORAGE_DRIVER: " r2 " }, { surface: "web", production: true });
    const storage = problems.find((p) => p.name === "STORAGE_DRIVER");
    expect(storage?.message).toMatch(/whitespace/);
    // 而且要说清后果,否则「去掉空格」这件事看起来像吹毛求疵。
    expect(storage?.message).toMatch(/raw value/);
  });

  it("whitespace is rejected for every variable, not just this one", () => {
    const problems = checkEnv({ ...CORE, ...R2_CREDS, STORAGE_DRIVER: "r2", GENERATION_PROVIDER: " byteplus " }, { surface: "worker", production: true });
    expect(problems.map((p) => p.name)).toContain("GENERATION_PROVIDER");
    expect(problems.find((p) => p.name === "GENERATION_PROVIDER")?.message).toMatch(/whitespace/);
  });
});
