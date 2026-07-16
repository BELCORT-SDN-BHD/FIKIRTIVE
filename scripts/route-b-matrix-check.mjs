#!/usr/bin/env node
/**
 * route-b-matrix-check.mjs — B0 发布契约的双向机器校验（docs/ops/route-b/）。
 *
 * 单向校验（矩阵内部）：ID 唯一；列非空（TBD-B<n> 合法、空白违规）；六级状态/存量现状 ∈ 闭集。
 * 双向校验（防债项与矩阵脱钩）：
 *   - parity：packages/otto/src/parity-manifest.ts 的每条 todoSkill 债在 parity-debt.md 恰好出现一次；
 *     并做真 bijection——矩阵 Otto 列 missing(debt-…) 引用的每个编号必须在 parity-debt.md 存在，
 *     parity-debt.md 每条 debt-NN 的「归属行」必须真实存在于矩阵、且该行 Otto 列确有反向引用。
 *   - 冻结锁（签署对象②，语义级）：matrix/frozen-ids.json 记录每个冻结行的「块归属」与
 *     「能力单元格哈希（去尾注〔〕）」、每个冻结留痕的「处置 kind」。校验器断言：冻结 ID 仍存在
 *     + 仍在同块 + 能力 hash 未变 + 留痕 kind 未变；任一漂移=红，提示「语义修改须 current GitHub Founder Resolution 后重跑 --freeze」。
 *
 * 用法：
 *   node scripts/route-b-matrix-check.mjs           校验（exit 0 = 全绿）
 *   node scripts/route-b-matrix-check.mjs --freeze   以当前矩阵为基线重生成 frozen-ids.json 快照
 *                                                     （仅在 current GitHub Founder Resolution 授权语义修改后使用；
 *                                                      若矩阵存在结构性违规则拒绝生成）
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const RB = join(ROOT, "docs/ops/route-b");
const errors = [];
const warn = [];
const FREEZE = process.argv.includes("--freeze");

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

// 能力单元格去尾注〔…〕后取 sha256 前 8 位——尾注是补充说明，允许改；能力本身改了才算漂移。
function stripCapAnnotation(cap) {
  return cap.replace(/〔[^〕]*〕$/u, "").trim();
}
function capSha8(cap) {
  return createHash("sha256").update(stripCapAnnotation(cap), "utf8").digest("hex").slice(0, 8);
}

// ── 1. 块矩阵文件 ──
const matrixDir = join(RB, "matrix");
const blockFiles = readdirSync(matrixDir).filter((f) => /^\d{2}-B\d+\.md$/.test(f));
const allIds = new Map(); // id -> file
const blockRows = [];
const blockRowsById = new Map(); // id -> { f, block, cap, otto, gate }
for (const f of blockFiles) {
  const blkNum = f.match(/-B(\d+)\.md$/)[1];
  const block = `B${blkNum}`;
  for (const r of parseTable(join(matrixDir, f), 10)) {
    const [id, cap, src, entry, otto, gate, test, report, six, legacy] = r.cells;
    if (allIds.has(id)) errors.push(`${f}: ID 重复 ${id}（已见于 ${allIds.get(id)}）`);
    allIds.set(id, f);
    blockRows.push({ id, f, block, cap, otto, gate });
    blockRowsById.set(id, { f, block, cap, otto, gate });
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
const ledgerRows = new Map(); // id -> kind（处置）
for (const f of ["OUT.md", "EVIDENCE.md"]) {
  const p = join(matrixDir, f);
  if (!existsSync(p)) { errors.push(`缺 ${f}`); continue; }
  for (const r of parseTable(p, 5)) {
    const [id, , kind, , reason] = r.cells;
    if (allIds.has(id)) errors.push(`${f}: ${id} 同时出现在块矩阵与留痕文件`);
    allIds.set(id, f);
    ledgerRows.set(id, kind);
    if (!OUT_KINDS.has(kind)) errors.push(`${f}:${id} 处置「${kind}」不在闭集`);
    if (!reason) errors.push(`${f}:${id} 理由/出处空白（不在本程不是回收站）`);
  }
}

// ── 3. parity 债闭合（真源 = parity-manifest.ts）──
const manifest = readFileSync(join(ROOT, "packages/otto/src/parity-manifest.ts"), "utf8");
const debtKeys = [...manifest.matchAll(/"([^"]+)":\s*\{\s*todoSkill:\s*true/g)].map((m) => m[1]);
const debtDocPath = join(RB, "parity-debt.md");
const debtDoc = existsSync(debtDocPath) ? readFileSync(debtDocPath, "utf8") : "";
if (!debtDoc) errors.push("缺 parity-debt.md");
for (const k of debtKeys) {
  const n = debtDoc.split("`" + k + "`").length - 1;
  if (n === 0) errors.push(`parity-debt.md 缺债条目 ${k}`);
  if (n > 1) errors.push(`parity-debt.md 债条目 ${k} 出现 ${n} 次（须恰好一次）`);
}

// parity-debt.md 结构化解析：债号 → { key, rowId, block }
const debtByNo = new Map(); // number -> { key, rowId, block, line }
for (const line of debtDoc.split("\n")) {
  const m = line.match(/^\|\s*debt-(\d+)\s*\|\s*`([^`]*)`\s*\|\s*([A-Za-z0-9-]+)\s*\|\s*([A-Za-z0-9]+)\s*\|/);
  if (m) debtByNo.set(Number(m[1]), { key: m[2], rowId: m[3], block: m[4] });
}

// 矩阵 Otto 列 missing(debt-…) 提取全部编号（原正则只认得第一个，逗号后的编号被漏检）
function debtNumbersFromOtto(otto) {
  const nos = [];
  for (const m of otto.matchAll(/missing\(([^)]*)\)/g)) {
    for (const tok of m[1].split(",")) {
      const mm = tok.trim().match(/^(?:debt-)?(\d+)$/);
      if (mm) nos.push(Number(mm[1]));
    }
  }
  return nos;
}

// 3a. 矩阵 → parity-debt.md：Otto 列引用的每个编号必须在债表存在
for (const { id, f, otto } of blockRows) {
  for (const no of debtNumbersFromOtto(otto)) {
    if (!debtByNo.has(no)) errors.push(`${f}:${id} 引用 debt-${String(no).padStart(2, "0")} 但 parity-debt.md 无此编号`);
  }
}
// 3b. parity-debt.md → 矩阵：每条 debt-NN 的归属行必须存在，且该行 Otto 列必须反向引用 NN（真 bijection）
for (const [no, { rowId }] of debtByNo) {
  const tag = `debt-${String(no).padStart(2, "0")}`;
  if (!allIds.has(rowId)) { errors.push(`parity-debt.md ${tag} 归属行 ${rowId} 不存在于矩阵`); continue; }
  const row = blockRowsById.get(rowId);
  if (!row) { errors.push(`parity-debt.md ${tag} 归属行 ${rowId} 不是块矩阵行（落在留痕文件，非法归属）`); continue; }
  if (!debtNumbersFromOtto(row.otto).includes(no)) {
    errors.push(`parity-debt.md ${tag} 归属行 ${rowId}，但该行 Otto 列未反向引用 ${tag}（非双向闭合）`);
  }
}

// ── 3.5 冻结 ID 锁 v2（签署对象②：语义级——存在 + 同块 + 能力哈希 + 留痕 kind 未变）──
const frozenPath = join(matrixDir, "frozen-ids.json");
if (FREEZE) {
  if (errors.length) {
    console.error(`❌ 结构性违规 ${errors.length} 处，拒绝生成冻结快照（先修好再 --freeze）:\n` + errors.map((e) => "  - " + e).join("\n"));
    process.exit(1);
  }
  const rows = {};
  for (const id of [...blockRowsById.keys()].sort((a, b) => a.localeCompare(b))) {
    const r = blockRowsById.get(id);
    rows[id] = { block: r.block, cap_sha8: capSha8(r.cap) };
  }
  const ledger = {};
  for (const id of [...ledgerRows.keys()].sort((a, b) => a.localeCompare(b))) {
    ledger[id] = { kind: ledgerRows.get(id) };
  }
  let sha = "unknown";
  try { sha = execSync("git rev-parse --short=8 HEAD", { cwd: ROOT }).toString().trim(); } catch { /* 非 git 环境，保留 unknown */ }
  const now = new Date();
  const frozenAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const snapshot = {
    frozen_at: frozenAt,
    baseline: `main@${sha}`,
    rows,
    ledger,
  };
  writeFileSync(frozenPath, JSON.stringify(snapshot, null, 1) + "\n");
  console.log(`✅ 冻结快照已重生成: ${Object.keys(rows).length} 行 + ${Object.keys(ledger).length} 留痕 → ${frozenPath}`);
  process.exit(0);
} else if (!existsSync(frozenPath)) {
  errors.push("缺 matrix/frozen-ids.json（冻结快照；用 --freeze 生成）");
} else {
  const frozen = JSON.parse(readFileSync(frozenPath, "utf8"));
  for (const [id, meta] of Object.entries(frozen.rows ?? {})) {
    const cur = blockRowsById.get(id);
    if (!cur) { errors.push(`冻结行 ${id} 已从矩阵消失（行集只增不减；语义修改须 current GitHub Founder Resolution 后重跑 --freeze）`); continue; }
    if (cur.block !== meta.block) {
      errors.push(`冻结行 ${id} 块归属漂移 ${meta.block}→${cur.block}（语义修改须 current GitHub Founder Resolution 后重跑 --freeze）`);
    }
    const sha = capSha8(cur.cap);
    if (sha !== meta.cap_sha8) {
      errors.push(`冻结行 ${id} 能力单元格哈希漂移（内容被改；语义修改须 current GitHub Founder Resolution 后重跑 --freeze）`);
    }
  }
  for (const [id, meta] of Object.entries(frozen.ledger ?? {})) {
    const kind = ledgerRows.get(id);
    if (!kind) { errors.push(`冻结留痕 ${id} 已从留痕文件消失（语义修改须 current GitHub Founder Resolution 后重跑 --freeze）`); continue; }
    if (kind !== meta.kind) {
      errors.push(`冻结留痕 ${id} 处置(kind) 漂移 ${meta.kind}→${kind}（语义修改须 current GitHub Founder Resolution 后重跑 --freeze）`);
    }
  }
}

// ── 报告 ──
const counts = {};
for (const f of allIds.values()) counts[f] = (counts[f] || 0) + 1;
console.log(`行分布: ${JSON.stringify(counts)}`);
console.log(`债条目: ${debtKeys.length}（结构化归属行 ${debtByNo.size}）`);
if (warn.length) console.log("WARN:\n" + warn.map((w) => "  - " + w).join("\n"));
if (errors.length) {
  console.error(`❌ ${errors.length} 处违规:\n` + errors.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}
console.log("✅ route-b matrix 校验全绿");
