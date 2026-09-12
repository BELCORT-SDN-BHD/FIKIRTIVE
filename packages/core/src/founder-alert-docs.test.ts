/**
 * founder-alert-docs.test.ts —— RELY-A11(docs/specs/fail-closed-reliability.md §2,issue #1384)。
 *
 * 验收原话:「打开 docs/ops/telegram-alerts.md 与 docs/ops/incident-visibility.md | 列出的
 * 告警 key 与代码里的 founderAlert key 逐条对得上（当场 grep 比对）；两份文档里没有把明文
 * token 写进命令行的示例」。
 *
 * 两条判定都是字面意义上的「grep 比对」,不解析 TypeScript AST:
 *   ① 从两份文档里,把反引号包住、形似 `xxx.yyy` 的告警 key 抠出来,逐个在真的会调用
 *      founderAlert 的源码文件里 grep 一遍 —— 抠出来的每一个都必须在源码里逐字找得到,
 *      否则文档在讲一个已经改名/删除/从未存在的 key,读到它的人会去代码里找一个不存在的东西。
 *   ② 两份文档的全文里都不许出现 `bot<TOKEN>` 这个旧形状(token 占位符被直接拼进一条会被
 *      复制粘贴执行的命令 URL)—— 安全形状是先用 `read -rs` 读进 shell 变量,再用 `${TOKEN}`
 *      引用,token 从不出现在命令行原文里。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const DOC_FILES = ["docs/ops/telegram-alerts.md", "docs/ops/incident-visibility.md"];

/**
 * 真的会调用 founderAlert 的源码文件,找法就是标题说的「当场 grep」:
 *   /usr/bin/grep -rln "founderAlert(" apps/worker/src apps/web/app apps/web/lib packages/core/src
 * 列成一份显式清单(而不是在测试里再跑一次同样的 grep),这样文件被删除或改名时,少了
 * 一处 founderAlert 调用点会让这条测试报"读不到文件"而不是悄悄漏掉一整个来源。
 */
const FOUNDER_ALERT_SOURCE_FILES = [
  "apps/worker/src/jobs/gen.ts",
  "apps/worker/src/jobs/refgen.ts",
  "apps/worker/src/jobs/stripe-reconcile.ts",
  "apps/worker/src/jobs/ledger-conservation.ts",
  "apps/worker/src/jobs/understand.ts",
  "apps/web/app/api/stripe/webhook/route.ts",
  "apps/web/lib/media-proxy-access.ts",
  "apps/web/lib/refund-actions.ts",
  "apps/web/lib/reconcile-actions.ts",
  "apps/web/lib/finance-limit-seam.ts",
];

/** 反引号里形似 `word.word`(允许多段)的片段 —— 告警 key 的形状,不是文件路径或函数名。 */
const BACKTICKED_DOTTED_TOKEN = /`([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)`/g;

/** 这份文档已知会用到的其它「word.word」形状的反引号内容,不是告警 key(白名单,防止假阳性)。 */
const NOT_ALERT_KEYS = new Set<string>(["key.name"]);

function readRepoFile(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

describe("RELY-A11 §2 — 两份运维文档里的告警 key 与代码里的 founderAlert key 逐条对得上", () => {
  const sourceText = FOUNDER_ALERT_SOURCE_FILES.map(readRepoFile).join("\n");

  for (const doc of DOC_FILES) {
    it(`${doc} 里提到的每一个告警 key 都能在 founderAlert 调用点的源码里逐字 grep 到`, () => {
      const text = readRepoFile(doc);
      const found = new Set<string>();
      for (const m of text.matchAll(BACKTICKED_DOTTED_TOKEN)) found.add(m[1]!);
      const candidateAlertKeys = [...found].filter(
        (k) => /^(gen|stripe|refgen|credits|understanding|media_proxy|finance|reconcile)\./.test(k) && !NOT_ALERT_KEYS.has(k),
      );
      expect(candidateAlertKeys.length, `${doc} 应该至少点名一个可核对的告警 key`).toBeGreaterThan(0);
      for (const key of candidateAlertKeys) {
        expect(
          sourceText.includes(`"${key}"`),
          `${doc} 提到的 key \`${key}\` 在 founderAlert 调用点的源码里找不到 —— 文档在讲一个不存在(或已改名/已删除)的 key`,
        ).toBe(true);
      }
    });
  }

  it("telegram-alerts.md 点名的两条主线 key 确实是今天真实存在的 founderAlert key", () => {
    // 反向锚:上面那条测试只保证「文档说的都是真的」,不保证「文档没有漏说」。这里钉住
    // 这两条本票关心的主线(RELY-A7/A9)确实还在,不是本票改动的副作用把它们改名漏掉了。
    expect(sourceText).toContain('"gen.paid_for_nothing"');
    expect(sourceText).toContain('"stripe.paid_session_unusable_metadata"');
    expect(sourceText).toContain('"stripe.paid_session_pack_mismatch"');
  });

  it("两份文档里都不许出现把 bot token 明文拼进命令行的旧形状(bot<TOKEN>)", () => {
    for (const doc of DOC_FILES) {
      const text = readRepoFile(doc);
      expect(text, `${doc} 不许教「把 token 直接拼进 URL 跑」这种明文贴密钥的步骤`).not.toMatch(/bot<TOKEN>/);
    }
  });

  it("telegram-alerts.md 的取 token 步骤改用不回显的 shell 变量,而不是命令行字面量", () => {
    const text = readRepoFile("docs/ops/telegram-alerts.md");
    // 安全形状:先 `read -rs ... TOKEN`(不回显、不留在 shell 历史),再用 `${TOKEN}` 引用。
    expect(text).toMatch(/read -rs[a-z]* .*TOKEN/);
    expect(text).toContain("bot${TOKEN}");
  });
});
