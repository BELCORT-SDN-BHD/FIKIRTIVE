/**
 * tenant-requireowner-frame-scan.test.ts —— TENANT-A10 的机器计数（requireOwner 半题）。
 *
 * 规格 docs/specs/tenant-isolation.md（已冻结 · v1，#1369）验收表 TENANT-A10:
 * 「apps/web 生产代码里文件内零 runAsUser 的 requireOwner 站点数 = 0」。
 *
 * 本文件只交付 A10 的**这一半**——`requireOwner` 站点建帧。A10 的另一半（`requireRole`
 * 后台 staff 站点未建帧数 = 0、守卫里的迁移期挡位从代码中删除）留给最后一片，占位仍在
 * `packages/db/src/tenant-isolation-later-slices.test.ts`。
 *
 * 判据是**文件级**的,不是「这次调用有没有真碰数据库」:一个 `requireOwner()` 调用点,
 * 只要它所在的文件里同时出现 `runAsUser(`(哪怕帧只是把「过了门之后的工作」整体收进来,
 * 见 settings/connections 那一类 page.tsx),就算已建帧——与围栏②③④切片的既有口径一致
 * (`apps/web/lib/__tests__/tenant-action-cross-tenant-slice2.test.ts` 等)。
 *
 * 只认**真调用**,不认注释:本仓库大量文档注释里用反引号写着 `requireOwner()` 解释租户
 * 口径(例如 `home-layout-store.ts`、`otto-projects-port.ts`),那些文件并不真的调用它——
 * 先剥注释再找 `requireOwner(`/`runAsUser(` 这两个 token,避免把「解释这条规矩的文件」
 * 误判成「站点」。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");

const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__"]);

/**
 * 两处已明示排除,理由沿用 issue #464 2026-07-26 Founder 本人的规划评论(围栏②立项前的
 * 站点清点),不是本片新造的口径:
 *   · `app/files/[...key]/route.ts` —— 「仅存储、显式排除」:这条路由自己按
 *     `keyOwnerMatches()` 做跨租户比对(不经 `tenant-guard.ts`),`requireOwner()` 只是登录墙,
 *     不是它自己动数据库的那道闸。
 *   · `app/api/meta/authorize/route.ts` —— 「对称,无 DB」:与已建帧的 `meta/callback` 对称的
 *     OAuth 起跳 route,`gate.ownerId` 只签进 OAuth `state` 参数,这个文件里没有第二次
 *     owner-scoped 查询可框。
 */
const EXCLUDED_FILES: readonly string[] = [
  "app/files/[...key]/route.ts",
  "app/api/meta/authorize/route.ts",
];

function isTestFile(name: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(name);
}

function sourceFilesUnder(dir: string, out: string[] = []): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    let stat: import("node:fs").Stats;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      sourceFilesUnder(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !isTestFile(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 注释里的 `requireOwner()` / `runAsUser()` 不是真调用 —— 剥掉,保留其余字符不变。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (all, keep: string) => keep + " ".repeat(all.length - keep.length));
}

// 不认 `lib/auth-guard.ts` 自己那一句 `export async function requireOwner(...)` ——
// 声明点长得和调用点一样(`requireOwner(`),负向 lookbehind 把 `function requireOwner(`
// 这个形状排除掉,只留真调用。
const REQUIRE_OWNER_CALL = /(?<!function )\brequireOwner\s*\(/;
const RUN_AS_USER_CALL = /\brunAsUser\s*\(/;

function unframedRequireOwnerFiles(): { rel: string; requireOwnerCount: number }[] {
  const files = sourceFilesUnder(WEB_ROOT);
  const hits: { rel: string; requireOwnerCount: number }[] = [];
  for (const file of files) {
    const rel = file.slice(WEB_ROOT.length + 1);
    if (EXCLUDED_FILES.includes(rel)) continue;
    const stripped = stripComments(readFileSync(file, "utf8"));
    const requireOwnerCount = (stripped.match(new RegExp(REQUIRE_OWNER_CALL, "g")) ?? []).length;
    if (requireOwnerCount === 0) continue;
    if (RUN_AS_USER_CALL.test(stripped)) continue;
    hits.push({ rel, requireOwnerCount });
  }
  return hits.sort((a, b) => a.rel.localeCompare(b.rel));
}

describe("TENANT-A10 机器计数（requireOwner 半题）", () => {
  it("TENANT-A10 apps/web 生产代码里文件内零 runAsUser 的 requireOwner 站点数 = 0", () => {
    const hits = unframedRequireOwnerFiles();
    expect(
      hits,
      `这些文件调用了 requireOwner() 但文件内没有 runAsUser(),尚未建帧:\n${hits
        .map((h) => `  ${h.rel}（requireOwner x${h.requireOwnerCount}）`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("TENANT-A10 围栏抓得住:把一个无帧 requireOwner 调用点塞回扫描范围,必须命中", () => {
    // 围栏最坏的失败方式是「什么都没扫到,于是永远绿」—— 直接对提取逻辑自证,不依赖文件系统。
    const fixture = `
      export async function example() {
        const gate = await requireOwner();
        if ("error" in gate) return gate;
        return gate.ownerId;
      }
    `;
    const stripped = stripComments(fixture);
    expect(REQUIRE_OWNER_CALL.test(stripped)).toBe(true);
    expect(RUN_AS_USER_CALL.test(stripped)).toBe(false);
  });

  it("TENANT-A10 只认真调用:注释里提到 requireOwner() 不算站点", () => {
    const fixture = `
      /** 租户口径:ownerId 只经 \`requireOwner()\` 解析,调用方不传、也传不进来。 */
      export function helper(ownerId: string) {
        return ownerId;
      }
    `;
    const stripped = stripComments(fixture);
    expect(REQUIRE_OWNER_CALL.test(stripped)).toBe(false);
  });

  it("TENANT-A10 两处结构性排除仍然存在,且各自仍是它们被排除时的形状", () => {
    for (const rel of EXCLUDED_FILES) {
      const full = join(WEB_ROOT, rel);
      expect(statSync(full).isFile(), `${rel} 已不存在,排除清单该更新了`).toBe(true);
      expect(
        readFileSync(full, "utf8"),
        `${rel} 已经不再调用 requireOwner(),排除清单该删了`,
      ).toMatch(REQUIRE_OWNER_CALL);
    }
  });
});
