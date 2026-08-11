#!/usr/bin/env node
/**
 * #682 文案流等价核对 —— 「换设计有没有把围栏改窄」的取证工具(#834 r4/r5)。
 *
 * 用法(仓库根目录):
 *   node scripts/tools/audit-copy-stream-equivalence.mjs
 *
 * 背景:`apps/web/lib/__tests__/otto-pronoun-consistency.test.ts` 的第二条流
 * (「只有文案、句界落在真句号上」那条)原本是一个手写字符扫描器,连着两轮被判官
 * 从同一个方向抓到逃逸,r4 整类退役,改用 TypeScript 编译器的 AST。
 *
 * 换实现最怕的不是新实现有 bug,是**它悄悄少抓了旧实现抓得到的东西** —— 少抓是静默的,
 * 没有任何东西会因此变红。所以这个脚本把两种实现在**全仓 tracked 源码**上各跑一遍,
 * 逐条比对命中集合,并在「AST 漏掉了旧扫描器抓得到的条目」时以非零码退出。
 *
 * 退役的那个扫描器保留在下面,只作为**比对基线**存在,不是产品路径也不是围栏本体。
 * 围栏本体在测试文件里,只有 AST 那一份。
 *
 * ⚠️ 这个脚本能证明什么、不能证明什么(判官 r4 的原话,值得写在这里):
 *   能:新实现没有丢掉旧实现的覆盖面。
 *   **不能**:两份实现共有的盲区。r4 的模板字符串顺序错就是这样 —— 两边一样乱序,
 *   差集当然是空的,而屏幕上的文案确实带着被禁的代词。共有盲区只能靠人造反例去钉,
 *   那些反例在测试文件的红→绿演练里。
 *
 * #834 r6 补充,同一条道理再走一遍:现役实现已从「一条线性流」换成
 * **「分支组合的集合」**(三元两支、`&&` 的有/无两态各是一条呈现路径,围栏跑在每一条上)。
 * 这个脚本比对的仍是**线性基线**,所以它量得出的只有「线性覆盖面没丢」;
 * 变体模型多抓到的那一类(只在某一支上才相邻的两句)**它按定义就看不见** ——
 * 那一类同样只能靠人造反例,判官 r5 的反例就在测试文件里。
 * 换句话说:差集为 0 是**必要条件,不是充分条件**。两样都要。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { copyPieces, copyVariants, VariantOverflow } from "./copy-stream-model.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
// typescript 是 apps/web 的依赖,不是根依赖 —— 从那里解析,脚本才能在仓库根目录跑。
const ts = createRequire(path.join(REPO_ROOT, "apps/web/package.json"))("typescript");

/** 与测试文件同一份范围定义:产品源码,不含测试与快照。 */
const SCAN_ROOTS = ["apps/web/app", "apps/web/components", "apps/web/lib", "apps/worker/src", "packages"];

function trackedSources() {
  return execFileSync("git", ["ls-files", "-z", ...SCAN_ROOTS], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((relative) => /\.tsx?$/.test(relative))
    .filter((relative) => !/\.test\.tsx?$/.test(relative))
    .filter((relative) => !/(^|\/)(__tests__|__snapshots__|__stubs__)\//.test(relative));
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("//") || trimmed.startsWith("*"));
    })
    .join("\n");
}

const sentencesOf = (text) => text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);

// ── 基线:r3 的手搓扫描器(已退役,只在这里作为比对对象) ──────────────────────
function readStringLiteral(source, start) {
  const quote = source[start];
  let body = "";
  let i = start + 1;
  while (i < source.length && source[i] !== quote) {
    if (source[i] === "\\") {
      body += source[i + 1] ?? "";
      i += 2;
      continue;
    }
    body += source[i];
    i += 1;
  }
  return { body, end: i + 1 };
}

function readExpressionContainer(source, start) {
  let depth = 0;
  let i = start;
  const literals = [];
  let sawAnythingElse = false;
  while (i < source.length) {
    const char = source[i];
    if (char === "<" || char === "\n") return null;
    if (char === "{") { depth += 1; i += 1; continue; }
    if (char === "}") {
      depth -= 1;
      i += 1;
      if (depth === 0) {
        const pure = !sawAnythingElse && literals.length === 1;
        return { value: pure ? literals[0] : ` ${literals.join(" ")} `, end: i };
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const string = readStringLiteral(source, i);
      literals.push(string.body);
      i = string.end;
      continue;
    }
    if (!/\s/.test(char)) sawAnythingElse = true;
    i += 1;
  }
  return null;
}

function readJsxText(source, start) {
  let text = "";
  let i = start;
  while (i < source.length) {
    const char = source[i];
    if (char === "<") return { text, end: i, closed: true };
    if (char === ">" || char === "}") return { text, end: i, closed: false };
    if (char === "{") {
      const container = readExpressionContainer(source, i);
      if (!container) return { text, end: i, closed: false };
      text += container.value;
      i = container.end;
      continue;
    }
    text += char;
    i += 1;
  }
  return { text, end: i, closed: false };
}

function retiredCopyRuns(source) {
  const runs = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === ">") {
      const jsxText = readJsxText(source, i + 1);
      if (jsxText.closed) { runs.push(jsxText.text); i = jsxText.end; } else { i += 1; }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const string = readStringLiteral(source, i);
      runs.push(string.body);
      i = string.end;
      continue;
    }
    i += 1;
  }
  return runs.map((run) => run.trim()).filter((run) => /[A-Za-z]/.test(run));
}

// ── 现役:AST 变体模型 —— 从共用模块导入,脚本不再自己抄一份 ──────────────────
// ── 四条规则:与测试文件逐字一致 ──────────────────────────────────────────────
const MENTIONS_OTTO = /\bOtto\b/;
const GENDERED_PRONOUN = /\b(he|him|his|she|her|hers)\b/i;
const OTTO_ON_ITS_OWN = /\bon its own\b/i;
const OTTO_ITLL = /\bit(?:&apos;|&rsquo;|['’])ll\b/i;
const PRONOUN_SUBJECT_OPENER = /^(?:It|He|She|Its|His|Her)(?:\s|&apos;|&rsquo;|['’])/;

function offencesIn(file, stream) {
  const offences = [];
  const sentences = sentencesOf(stream);
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const previous = i > 0 ? sentences[i - 1] : "";
    const mentionsOtto = MENTIONS_OTTO.test(sentence);
    const push = (rule) => offences.push(`${file} [${rule}] ${sentence.slice(0, 200)}`);

    if (mentionsOtto && GENDERED_PRONOUN.test(sentence)) push("gendered pronoun in an Otto sentence");
    if (mentionsOtto && OTTO_ON_ITS_OWN.test(sentence)) push('"on its own" in an Otto sentence');
    if (mentionsOtto && OTTO_ITLL.test(sentence)) push("\"it'll\" in an Otto sentence");
    if (MENTIONS_OTTO.test(previous) && !mentionsOtto && PRONOUN_SUBJECT_OPENER.test(sentence)) {
      push("a pronoun opens the sentence right after an Otto sentence");
    }
  }
  return offences;
}

const retired = new Set();
const current = new Set();
const overCap = [];
let totalChoices = 0;
let maxChoices = { file: "(none)", count: 0 };
const files = trackedSources();
const startedAt = Date.now();

for (const relative of files) {
  const source = readFileSync(path.join(REPO_ROOT, relative), "utf8");
  const stripped = stripComments(source);
  // 第一条流(整份源码)两边共用,两边都要加进去,差集才只反映第二条流的差别。
  for (const offence of offencesIn(relative, stripped)) {
    retired.add(offence);
    current.add(offence);
  }
  for (const offence of offencesIn(relative, retiredCopyRuns(stripped).join(" "))) retired.add(offence);
  const seen = copyPieces(source, relative).choices;
  totalChoices += seen;
  if (seen > maxChoices.count) maxChoices = { file: relative, count: seen };
  let variants;
  try {
    variants = copyVariants(source, relative);
  } catch (error) {
    if (!(error instanceof VariantOverflow)) throw error;
    overCap.push(relative);
    continue;
  }
  for (const variant of variants) {
    for (const offence of offencesIn(relative, variant)) current.add(offence);
  }
}

const missedByCurrent = [...retired].filter((offence) => !current.has(offence));
const foundOnlyByCurrent = [...current].filter((offence) => !retired.has(offence));

console.log(`files scanned:        ${files.length}`);
console.log(`branching choices:    ${totalChoices} (most in one file: ${maxChoices.count} — ${maxChoices.file})`);
console.log(`over the choice cap:  ${overCap.length}${overCap.length ? ` (${overCap.join(", ")})` : ""}`);
console.log(`elapsed:              ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
console.log(`retired scanner hits: ${retired.size}`);
console.log(`AST scanner hits:     ${current.size}`);
console.log(`missed by AST:        ${missedByCurrent.length}`);
console.log(`found only by AST:    ${foundOnlyByCurrent.length}`);

for (const offence of missedByCurrent) console.log(`  MISSED BY AST  ${offence}`);
for (const offence of foundOnlyByCurrent) console.log(`  NEW WITH AST   ${offence}`);

if (missedByCurrent.length > 0) {
  console.error("\nFAIL: the AST stream lost coverage the retired scanner had.");
  process.exit(1);
}
console.log("\nOK: the AST stream lost nothing the retired scanner caught.");
