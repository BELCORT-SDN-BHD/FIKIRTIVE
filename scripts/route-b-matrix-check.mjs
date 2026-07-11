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
    if (!line.startsWith("|")) continue;
    // 表头/分隔行豁免；其余以 | 开头的行必须是合法行——ID 打错不得静默逃逸
    if (/^\|\s*(功能ID|ID|---)/.test(line) || /^\|[-\s|]+\|?$/.test(line)) continue;
    if (!/^\|\s*(?:E\d|AF1|I1|B0|OUT|EV|MG|SP|CC)[A-Za-z0-9]*-[A-Za-z0-9]+/.test(line)) {
      errors.push(`${file}: 表内行无法识别 ID（坏行不得静默跳过）: ${line.slice(0, 60)}…`);
      continue;
    }
    const cells = line.split("|").map((c) => c.trim()).slice(1, -1);
    if (cells.length !== expectCells) {
      errors.push(`${file}: 行 ${cells[0] ?? "?"} 列数 ${cells.length} ≠ ${expectCells}`);
      continue;
    }
    for (const c of cells) {
      if (c.endsWith("\\")) errors.push(`${file}:${cells[0]} 单元格以反斜杠结尾（疑似撕裂）`);
      if (c.includes("\\|")) errors.push(`${file}:${cells[0]} 单元格含未处理的转义管道符`);
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
    const blkNum = f.match(/-B(\d+)\.md$/)[1];
    for (const [name, v] of [["能力", cap], ["批准来源", src], ["人工入口", entry], ["Otto", otto], ["闸", gate], ["测试", test], ["报告", report]]) {
      if (!v) errors.push(`${f}:${id} 「${name}」列空白（占位必须是显式 TBD-B<n>）`);
      // TBD 格式强制：以 TBD 开头就必须是 TBD-B<n> 且 n=本块号（"-"/"待定"混不过去）
      if (v && v.startsWith("TBD")) {
        if (!TBD.test(v)) errors.push(`${f}:${id} 「${name}」占位「${v}」不符 TBD-B<n> 格式`);
        else if (v !== `TBD-B${blkNum}`) errors.push(`${f}:${id} 「${name}」占位 ${v} 与所在块 B${blkNum} 不符`);
      }
      if (v === "-" || v === "待定" || v === "TBD") errors.push(`${f}:${id} 「${name}」用了模糊占位「${v}」`);
    }
    // 💰 行的花费闸必须是实义（非 TBD）——合同 §三 的机器强制
    if (cap.includes("💰") && (gate.startsWith("TBD") || gate.length < 8)) {
      errors.push(`${f}:${id} 💰行的权限/花费闸列必须非 TBD 且实义`);
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

// ── 3.5 冻结 ID 锁（签署对象②：只增不减，删行必红）──
const frozenPath = join(RB, "coverage-audit/frozen-ids.json");
if (!existsSync(frozenPath)) {
  errors.push("缺 coverage-audit/frozen-ids.json（冻结 ID 快照）");
} else {
  const frozen = JSON.parse(readFileSync(frozenPath, "utf8"));
  for (const id of [...(frozen.block_row_ids ?? []), ...(frozen.ledger_ids ?? [])]) {
    if (!allIds.has(id)) errors.push(`冻结 ID ${id} 已从矩阵消失（行集只增不减；改判须走留痕+决策日志）`);
  }
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
