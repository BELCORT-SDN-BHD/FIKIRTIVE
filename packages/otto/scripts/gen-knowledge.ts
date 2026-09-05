/**
 * 技能文件柜的生成器（`docs/specs/otto-engine.md` §7.0 拍板三 · §7.2⑥）。
 *
 *   pnpm --filter @fikirtive/otto run knowledge          写 src/knowledge-cabinet.generated.ts
 *   pnpm --filter @fikirtive/otto run knowledge:check    产物过期即非零退出（CI 闸）
 *
 * **为什么是 build 期产物、不是运行期读文件**：`packages/otto/tsconfig.json` 的 `include` 只有
 * `["src"]`，包根的 markdown 本来就不进 dist；而 `readFileSync(new URL(...))` 在 Next/Turbopack
 * 的 fs shim 下运行期会炸（单体说明书的文件头记着这条实测）。所以柜里的 markdown 在**构建之前**
 * 被抄成一个 TS 常量表，四个运行时（web / worker / dist / vitest）读到的是同一份字节。
 *
 * 本文件只做 I/O：走目录、读盘、写盘、比对。解析与渲染的纯逻辑在 `../src/knowledge-cabinet.ts`
 * ——与 `gen-catalog.ts` ↔ `../src/catalog.ts` 同形，也因此那几条规则有真的行为测试。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { orderCabinetPaths, parseCabinetFile, renderCabinetModule } from "../src/knowledge-cabinet.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CABINET = join(HERE, "..", "knowledge");
const OUT = join(HERE, "..", "src", "knowledge-cabinet.generated.ts");

/** 递归列出柜里的 markdown，柜内路径正斜杠。 */
function listCabinetFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".md")) out.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return orderCabinetPaths(out);
}

const next = renderCabinetModule(
  listCabinetFiles(CABINET).map((p) => parseCabinetFile(p, readFileSync(join(CABINET, p), "utf8"))),
);

if (process.argv.includes("--check")) {
  const cur = readFileSync(OUT, "utf8");
  if (cur !== next) {
    console.error(
      "knowledge-cabinet.generated.ts is stale. Run: pnpm --filter @fikirtive/otto run knowledge",
    );
    process.exit(1);
  }
  console.log("knowledge cabinet is fresh.");
} else {
  writeFileSync(OUT, next);
  console.log("Wrote " + OUT);
}
