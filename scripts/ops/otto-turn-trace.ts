/**
 * **读一轮 Otto 的调试档案**(ENGINE-A2;规格 `docs/specs/otto-engine.md` §7.2②)。
 *
 * ENGINE-A2 的验收是「(工程侧演示)查看任一对话轮的调试档案 → 能看到该轮加载了哪些技能
 * 文件、走了几步、调了哪些工具;不含商家内容明文」。这个脚本就是那个读面 —— 规格明写
 * **不做商家面 UI**,所以只有这一条只读命令。
 *
 * ── 只读 ─────────────────────────────────────────────────────────────────────
 * 它只跑 findUnique / findMany:不写、不改、不删任何一行,也不碰钱。跑错了最坏的后果是
 * 打印一段字。
 *
 * ── 它为什么不打印商家内容 ───────────────────────────────────────────────────
 * 因为库里就没有:`OttoTurnTrace` 在类型层与列层都没有自由文本(见 schema.prisma 上的
 * 长注释与 packages/otto/src/runtime.ts 的 `OttoTurnTraceFacts`)。这个脚本原样打印它读到
 * 的那一行,不去别的表补任何东西 —— 尤其不读 ChatMessage。
 *
 * 跑法(仓库根):
 *
 *   pnpm install && pnpm --filter "./packages/*" build
 *   DATABASE_URL=… node --import ./apps/worker/node_modules/tsx/dist/loader.mjs \
 *     scripts/ops/otto-turn-trace.ts <refId>
 *
 * refId 的三种形状(与账本里 `reserve:<refId>` 的键逐字相同):
 *   otto-stream:<userMessageId>
 *   otto-turn:<userMessageId>
 *   otto-approve:<threadId>:<cardId>:a<n>
 *
 * 不给 refId 时,列出最近 20 行(可用 `--org <orgId>` 限定一个工作区,`--limit <n>` 改条数)。
 *
 * ── 为什么这里的 import 长这样 ──────────────────────────────────────────────
 * `scripts/` 不是 workspace 包,解析不到 `@fikirtive/*` 这样的裸标识符。仓库里既有的做法
 * (`scripts/ops/seed-actor-library.ts`)是按绝对路径动态 import 各包的 `dist/` —— 这里沿用它。
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const distImport = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);

// 一次线性扫描:`--org` / `--limit` 各吃掉后面那个词,剩下的第一个裸词是 refId。
// (用 indexOf 找位置会在重复参数上认错位置,所以这里不用它。)
const argv = process.argv.slice(2);
let refId: string | undefined;
let orgId: string | undefined;
let limit = 20;
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]!;
  if (arg === "--org") { orgId = argv[++i]; continue; }
  if (arg === "--limit") { limit = Number(argv[++i]); continue; }
  if (!arg.startsWith("--") && refId === undefined) refId = arg;
}

type ToolCall = { name: string; calls: number; ok: number; failed: number };
type TraceRow = {
  refId: string;
  orgId: string;
  threadId: string | null;
  surface: string;
  modelId: string;
  steps: number;
  toolCalls: unknown;
  skillFiles: unknown;
  truncated: boolean;
  settledInternal: number | null;
  createdAt: Date;
};

function toolCallsOf(value: unknown): ToolCall[] {
  return Array.isArray(value) ? (value as ToolCall[]) : [];
}
function skillFilesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function printOne(row: TraceRow): void {
  const tools = toolCallsOf(row.toolCalls);
  const files = skillFilesOf(row.skillFiles);
  console.log(`refId            ${row.refId}`);
  console.log(`org              ${row.orgId}`);
  console.log(`thread           ${row.threadId ?? "(none)"}`);
  console.log(`surface          ${row.surface}`);
  console.log(`model            ${row.modelId}`);
  console.log(`steps            ${row.steps}${row.truncated ? "  (TRUNCATED — ran out of steps)" : ""}`);
  console.log(`settled          ${row.settledInternal === null ? "(no finalizer row yet)" : `${row.settledInternal} internal`}`);
  console.log(`at               ${row.createdAt.toISOString()}`);
  console.log(`skill files      ${files.length === 0 ? "(none — the knowledge cabinet lands in §7.2⑥)" : files.join(", ")}`);
  if (tools.length === 0) {
    console.log(`tool calls       (none — the model answered without calling an action)`);
    return;
  }
  console.log(`tool calls       ${tools.reduce((n, t) => n + t.calls, 0)} across ${tools.length} action(s)`);
  for (const t of tools) {
    console.log(`  ${t.name.padEnd(30)} calls=${t.calls} ok=${t.ok} failed=${t.failed}`);
  }
}

async function main(): Promise<void> {
  const { prisma } = (await distImport("packages/db/dist/src/index.js")) as {
    prisma: import("@prisma/client").PrismaClient;
  };
  try {
    if (refId) {
      const row = (await prisma.ottoTurnTrace.findUnique({ where: { refId } })) as TraceRow | null;
      if (!row) {
        // 说实话而不是造一行:这一轮可能跑在这张表上线之前,也可能根本没跑过。
        console.log(`otto-turn-trace: no archive row for "${refId}".`);
        console.log(`  (turns that ran before migration 20260905090000_otto_turn_trace have none — their structural facts were never recorded)`);
        process.exitCode = 1;
        return;
      }
      printOne(row);
      return;
    }
    const rows = (await prisma.ottoTurnTrace.findMany({
      where: orgId ? { orgId } : undefined,
      orderBy: { createdAt: "desc" },
      take: Number.isFinite(limit) && limit > 0 ? limit : 20,
    })) as TraceRow[];
    if (rows.length === 0) {
      console.log(`otto-turn-trace: no rows${orgId ? ` for org ${orgId}` : ""} yet.`);
      return;
    }
    console.log(`otto-turn-trace: ${rows.length} most recent turn(s)${orgId ? ` for org ${orgId}` : ""}\n`);
    for (const row of rows) {
      const tools = toolCallsOf(row.toolCalls);
      console.log(
        `${row.createdAt.toISOString()}  ${row.surface.padEnd(15)} steps=${String(row.steps).padStart(2)}` +
          `${row.truncated ? " TRUNC" : "      "}  tools=${tools.map((t) => `${t.name}×${t.calls}`).join(",") || "-"}  ${row.refId}`,
      );
    }
    console.log(`\nOne turn in full:  node --import ./apps/worker/node_modules/tsx/dist/loader.mjs scripts/ops/otto-turn-trace.ts <refId>`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("otto-turn-trace: read failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
