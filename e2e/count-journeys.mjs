#!/usr/bin/env node
/**
 * 旅程编号计数与撞车检测(#1354)。
 *
 * `e2e/journeys/` 每个 spec 文件名前缀一个编号(`NN-`)。这个前缀曾经两次被撞——15 号三个文件、
 * 23 号两个文件同日各自认领——「旅程一共几条」只能靠 ls 数,数出来的答案还三个人三个数。
 *
 * 这份脚本是那句话唯一的口径:数出 spec 文件总数、按编号打印逐个清单、发现同一个编号被
 * 多个文件占用就非零退出。挂在 `.github/workflows/e2e.yml` 里真正跑旅程的那一步之前——
 * 下一次谁再撞号,CI 在浏览器打开之前就先红,不必等所有旅程跑完才发现。
 *
 * 用法: `pnpm e2e:count`(或直接 `node e2e/count-journeys.mjs`)。
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const journeysDir = join(dirname(fileURLToPath(import.meta.url)), "journeys");
const files = readdirSync(journeysDir)
  .filter((f) => f.endsWith(".spec.ts"))
  .sort();

const byNumber = new Map();
const unnumbered = [];

for (const file of files) {
  const m = file.match(/^(\d+)-/);
  if (!m) {
    unnumbered.push(file);
    continue;
  }
  const n = m[1];
  if (!byNumber.has(n)) byNumber.set(n, []);
  byNumber.get(n).push(file);
}

console.log(`e2e/journeys/ 共 ${files.length} 个 spec 文件。\n`);
console.log("逐号清单:");
for (const n of [...byNumber.keys()].sort((a, b) => Number(a) - Number(b))) {
  for (const f of byNumber.get(n)) {
    console.log(`  ${n} — ${f}`);
  }
}
if (unnumbered.length > 0) {
  console.log("\n无编号(未来加旅程时也要给编号——这份清单不该有下一行):");
  for (const f of unnumbered) console.log(`  · ${f}`);
}

const collisions = [...byNumber.entries()].filter(([, fs]) => fs.length > 1);
if (collisions.length > 0) {
  console.error("\n撞车 —— 以下编号被多个文件占用,必须重新编号后再跑:");
  for (const [n, fs] of collisions) {
    console.error(`  ${n}: ${fs.join(", ")}`);
  }
  process.exit(1);
}

console.log(`\nOK — ${files.length} 个 spec 文件,编号无重复。`);
