#!/usr/bin/env node
/**
 * route-b-matrix-check.mjs — B0 发布契约的双向机器校验（docs/ops/route-b/）。
 *
 * 单向校验（矩阵内部）：ID 唯一；列非空（TBD-B<n> 合法、空白违规）；六级状态/存量现状 ∈ 闭集。
 * 双向校验（防「源里有、矩阵没有」）：
 *   - parity：packages/otto/src/parity-manifest.ts 的每条 todoSkill 债在 parity-debt.md 恰好出现一次；
 *   - coverage：coverage-audit/adjudication.json 里每条 MISSING 裁决必须闭合到一个存在的矩阵行或 OUT 条目。
 * 用法：node scripts/route-b-matrix-check.mjs   （exit 0 = 全绿）
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const RB = join(ROOT, "docs/ops/route-b");
const errors = [];
const warn = [];

const SIX = new Set([
  "listed", "spec-ready", "code-complete", "sandbox-verified",
  "review-submitted", "live-verified", "release-certified",
]);
const LEGACY = new Set(["integrated", "implemented", "ui-shell", "schema", "absent", "partial", "unknown", "na"]);
const OUT_KINDS = new Set(["OUT-charter", "OUT-superseded", "OUT-deferred", "MERGED", "SPLIT", "EVIDENCE", "CROSSCUT"]);
const TBD = /^TBD-B\d+$/;

function parseTable(file, expectCells) {
  const rows = [];
  const lines = readFileSync(file, "utf8").split("\n");
  for (const line of lines) {
    if (!/^\|\s*(?:E\d|AF1|I1|B0|OUT|EV|MG|SP|CC)[A-Za-z0-9]*-[A-Za-z0-9]+/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim()).slice(1, -1);
    if (cells.length !== expectCells) {
      errors.push(`${file}: 行 ${cells[0] ?? "?"} 列数 ${cells.length} ≠ ${expectCells}`);
      continue;
    }
    rows.push({ file, cells });
  }
  return rows;
}

// ── 1. 块矩阵文件 ──
const matrixDir = join(RB, "matrix");
const blockFiles = readdirSync(matrixDir).filter((f) => /^\d{2}-B\d+\.md$/.test(f));
const allIds = new Map(); // id -> file
const blockRows = [];
for (const f of blockFiles) {
  for (const r of parseTable(join(matrixDir, f), 10)) {
    const [id, cap, src, entry, otto, gate, test, report, six, legacy] = r.cells;
    if (allIds.has(id)) errors.push(`${f}: ID 重复 ${id}（已见于 ${allIds.get(id)}）`);
    allIds.set(id, f);
    blockRows.push({ id, f, otto, gate });
    for (const [name, v] of [["能力", cap], ["批准来源", src], ["人工入口", entry], ["Otto", otto], ["闸", gate], ["测试", test], ["报告", report]]) {
      if (!v) errors.push(`${f}:${id} 「${name}」列空白（占位必须是显式 TBD-B<n>）`);
    }
    if (!SIX.has(six)) errors.push(`${f}:${id} 六级状态「${six}」不在闭集`);
    if (!LEGACY.has(legacy)) errors.push(`${f}:${id} 存量现状「${legacy}」不在闭集`);
  }
}
if (blockRows.length === 0) errors.push("matrix/ 下没有解析到任何块矩阵行");

// ── 2. OUT / EVIDENCE 留痕文件 ──
for (const f of ["OUT.md", "EVIDENCE.md"]) {
  const p = join(matrixDir, f);
  if (!existsSync(p)) { errors.push(`缺 ${f}`); continue; }
  for (const r of parseTable(p, 5)) {
    const [id, , kind, , reason] = r.cells;
    if (allIds.has(id)) errors.push(`${f}: ${id} 同时出现在块矩阵与留痕文件`);
    allIds.set(id, f);
    if (!OUT_KINDS.has(kind)) errors.push(`${f}:${id} 处置「${kind}」不在闭集`);
    if (!reason) errors.push(`${f}:${id} 理由/出处空白（不在本程不是回收站）`);
  }
}

// ── 3. parity 债闭合（真源 = parity-manifest.ts）──
const manifest = readFileSync(join(ROOT, "packages/otto/src/parity-manifest.ts"), "utf8");
const debtKeys = [...manifest.matchAll(/"([^"]+)":\s*\{\s*todoSkill:\s*true/g)].map((m) => m[1]);
const debtDoc = existsSync(join(RB, "parity-debt.md")) ? readFileSync(join(RB, "parity-debt.md"), "utf8") : "";
if (!debtDoc) errors.push("缺 parity-debt.md");
for (const k of debtKeys) {
  const n = debtDoc.split("`" + k + "`").length - 1;
  if (n === 0) errors.push(`parity-debt.md 缺债条目 ${k}`);
  if (n > 1) errors.push(`parity-debt.md 债条目 ${k} 出现 ${n} 次（须恰好一次）`);
}
// Otto 列的 missing(debt-nn) 标注必须能在 parity-debt.md 找到对应行号
for (const { id, f, otto } of blockRows) {
  const m = otto.match(/missing\(debt-(\d+)[-–~\d]*\)/);
  if (m && !debtDoc.includes(`debt-${m[1]}`)) errors.push(`${f}:${id} 引用 debt-${m[1]} 但 parity-debt.md 无此编号`);
}

// ── 4. coverage 裁决闭合 ──
const adjPath = join(RB, "coverage-audit/adjudication.json");
if (!existsSync(adjPath)) {
  errors.push("缺 coverage-audit/adjudication.json");
} else {
  const adj = JSON.parse(readFileSync(adjPath, "utf8"));
  for (const src of adj.sources ?? []) {
    for (const it of src.items ?? []) {
      if (it.verdict !== "MISSING") continue;
      const res = it.resolution;
      if (!res) { errors.push(`adjudication[${src.source}] MISSING「${it.item}」无裁决`); continue; }
      if (res.row_id && !allIds.has(res.row_id)) errors.push(`adjudication[${src.source}]「${it.item}」裁决指向不存在的行 ${res.row_id}`);
      if (!res.row_id && !res.out_id) errors.push(`adjudication[${src.source}]「${it.item}」裁决既无 row_id 也无 out_id`);
      if (res.out_id && !allIds.has(res.out_id)) errors.push(`adjudication[${src.source}]「${it.item}」out_id ${res.out_id} 不存在于留痕文件`);
    }
  }
}

// ── 报告 ──
const counts = {};
for (const f of allIds.values()) counts[f] = (counts[f] || 0) + 1;
console.log(`行分布: ${JSON.stringify(counts)}`);
console.log(`债条目: ${debtKeys.length}`);
if (warn.length) console.log("WARN:\n" + warn.map((w) => "  - " + w).join("\n"));
if (errors.length) {
  console.error(`❌ ${errors.length} 处违规:\n` + errors.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}
console.log("✅ route-b matrix 校验全绿");
