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
 * 只认**真调用**,不认注释、不认字符串、不认改名导入(判官收尾片定向修三条防绕,各配
 * 一条反例用例钉住,见下面 describe 块):
 *   ① 本仓库大量文档注释里用反引号写着 `requireOwner()` 解释租户口径(例如
 *     `home-layout-store.ts`、`otto-projects-port.ts`),那些文件并不真的调用它;
 *   ② 一个字符串字面量里恰好写着 `runAsUser(` 这几个字符(比如一句 TODO),不该被当成
 *     「已建帧」——那不是代码,是文案;
 *   ③ `import { requireOwner as ro }` 之后调用 `ro()`,字面上找不到 "requireOwner(" 这个
 *     token,但仍是同一个函数的真调用,不该靠改名逃过扫描。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");

const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__"]);

/**
 * 唯一的结构性排除,理由沿用 issue #464 2026-07-26 Founder 本人的规划评论(围栏②立项前的
 * 站点清点),不是本片新造的口径:
 *   · `app/api/meta/authorize/route.ts` —— 「对称,无 DB」:与已建帧的 `meta/callback` 对称的
 *     OAuth 起跳 route,`gate.ownerId` 只签进 OAuth `state` 参数,这个文件里没有第二次
 *     owner-scoped 查询可框。核过仍然真:这个文件今天还是只把 `gate.ownerId` 签进
 *     `signState()`,没有第二次 Prisma 调用。
 *
 * `app/files/[...key]/route.ts` 曾经也在这张名单上,判官收尾片定向修撤销了它:
 * d115332f（2026-09-04,[Creation] 下载改同源附件流）之后,`?download=1` 分支会调
 * `attachmentResponse()`,里面真的有一次 `prisma.asset.findFirst`(`Asset` 在
 * `TENANT_MODELS` 里)——「仅存储」那句判断没跟上这一手改动。已在
 * `app/files/[...key]/route.ts` 补上 `runAsUser`,这里同步把它从排除清单里删掉。
 */
const EXCLUDED_FILES: readonly string[] = [
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

/**
 * 剥掉注释与字符串/模板字面量的"文本内容",只留代码骨架——`requireOwner(`/`runAsUser(`
 * 这两个 token 的判定只该在骨架里做。字符数与换行数不变(内容替换成等长空格,换行原样
 * 保留),纯粹是为了报错时行号还对得上,判定本身不依赖行号。
 *
 * 必须**一次扫描同时认注释和字符串**,分两遍做(不管先后)都会被对方的语法坑骗过去
 * (判官定向修的两个实测反例,见下面 P3-2 的两条用例):
 *   · 先剥注释、字符串在后:字符串里写的 `runAsUser(` 会被判成「已建帧」的假信号
 *     (下面「防绕二」);字符串里恰好有一段 `/* ` 也会被朴素的块注释正则当成注释起点,
 *     从这里一路吃到后面某个不相干的 `*​/`,把中间的真代码(哪怕是真的 `runAsUser(`
 *     调用)吞成空白(下面「防绕三」)。
 *   · 先剥字符串、注释在后:本仓库 JSDoc 大量用反引号包代码
 *     (例如 `` `requireOwner()` ``),不成对的单个反引号会被朴素的模板字面量起点判定
 *     误伤,把它之后的一段真代码当成模板内容吃掉。
 * 一次扫描、按遇到的先后顺序判定(先遇到 `/*`/`//` 就进注释态,先遇到引号/反引号就进
 * 字符串态,两者互斥),两类坑都不成立;模板字面量的 `${...}` 插值仍按代码处理(插值里
 * 也可能写出真调用),只有插值外的文本部分被剥。
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  const templateExprDepth: number[] = [];
  type Mode = "code" | "squote" | "dquote" | "template" | "line-comment" | "block-comment";
  let mode: Mode = "code";
  const blank = (c: string) => (c === "\n" ? "\n" : " ");

  while (i < n) {
    const ch = source[i]!;
    const two = source.slice(i, i + 2);

    if (mode === "code") {
      if (two === "//") { mode = "line-comment"; out += "  "; i += 2; continue; }
      if (two === "/*") { mode = "block-comment"; out += "  "; i += 2; continue; }
      if (ch === "'") { mode = "squote"; out += ch; i++; continue; }
      if (ch === '"') { mode = "dquote"; out += ch; i++; continue; }
      if (ch === "`") { mode = "template"; out += ch; i++; continue; }
      if (templateExprDepth.length > 0) {
        if (ch === "{") {
          templateExprDepth[templateExprDepth.length - 1]!++;
        } else if (ch === "}") {
          templateExprDepth[templateExprDepth.length - 1]!--;
          if (templateExprDepth[templateExprDepth.length - 1] === 0) {
            templateExprDepth.pop();
            out += ch;
            i++;
            mode = "template";
            continue;
          }
        }
      }
      out += ch;
      i++;
      continue;
    }

    if (mode === "line-comment") {
      if (ch === "\n") { mode = "code"; out += "\n"; i++; continue; }
      out += " ";
      i++;
      continue;
    }

    if (mode === "block-comment") {
      if (two === "*/") { mode = "code"; out += "  "; i += 2; continue; }
      out += blank(ch);
      i++;
      continue;
    }

    // squote / dquote
    if (mode === "squote" || mode === "dquote") {
      const quote = mode === "squote" ? "'" : '"';
      if (ch === "\\") {
        out += blank(ch);
        i++;
        if (i < n) { out += blank(source[i]!); i++; }
        continue;
      }
      if (ch === quote) { mode = "code"; out += ch; i++; continue; }
      out += blank(ch);
      i++;
      continue;
    }

    // template
    if (ch === "\\") {
      out += blank(ch);
      i++;
      if (i < n) { out += blank(source[i]!); i++; }
      continue;
    }
    if (ch === "`") { mode = "code"; out += ch; i++; continue; }
    if (ch === "$" && source[i + 1] === "{") {
      templateExprDepth.push(1);
      out += "${";
      i += 2;
      mode = "code";
      continue;
    }
    out += blank(ch);
    i++;
  }
  return out;
}

// 不认 `lib/auth-guard.ts` 自己那一句 `export async function requireOwner(...)` ——
// 声明点长得和调用点一样(`requireOwner(`),负向 lookbehind 把 `function requireOwner(`
// 这个形状排除掉,只留真调用。
const REQUIRE_OWNER_CALL = /(?<!function )\brequireOwner\s*\(/;
const RUN_AS_USER_CALL = /\brunAsUser\s*\(/;
// 防重命名绕过(判官定向修「防绕一」):`import { requireOwner as ro } from "..."`。
const REQUIRE_OWNER_IMPORT_ALIAS = /\brequireOwner\s+as\s+(\w+)\b/g;

/**
 * `requireOwner` 的真调用次数,含改名导入之后的调用——`import { requireOwner as ro }`
 * 之后的 `ro()` 字面上没有 "requireOwner(" 这个 token,但仍是同一个函数。`stripped`
 * 必须已经过 {@link stripComments},否则注释里演示这种改名写法的一句话也会被数进去。
 */
function requireOwnerCallCount(stripped: string): number {
  let count = (stripped.match(new RegExp(REQUIRE_OWNER_CALL, "g")) ?? []).length;
  for (const m of stripped.matchAll(REQUIRE_OWNER_IMPORT_ALIAS)) {
    const alias = m[1]!;
    const aliasCall = new RegExp(`(?<!function )\\b${alias}\\s*\\(`, "g");
    count += (stripped.match(aliasCall) ?? []).length;
  }
  return count;
}

function unframedRequireOwnerFiles(): { rel: string; requireOwnerCount: number }[] {
  const files = sourceFilesUnder(WEB_ROOT);
  const hits: { rel: string; requireOwnerCount: number }[] = [];
  for (const file of files) {
    const rel = file.slice(WEB_ROOT.length + 1);
    if (EXCLUDED_FILES.includes(rel)) continue;
    const stripped = stripComments(readFileSync(file, "utf8"));
    const requireOwnerCount = requireOwnerCallCount(stripped);
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

  it("TENANT-A10 只认真调用(防绕一):requireOwner 改名导入之后的调用仍算真站点", () => {
    // `import { requireOwner as ro }` 之后调 `ro()`——字面上没有 "requireOwner(" 这个
    // token,朴素的 REQUIRE_OWNER_CALL 正则单独看会漏,但 requireOwnerCallCount 认得出来。
    const fixture = `
      import { requireOwner as ro } from "@/lib/auth-guard";
      export async function example() {
        const gate = await ro();
        if ("error" in gate) return gate;
        return gate.ownerId;
      }
    `;
    const stripped = stripComments(fixture);
    expect(REQUIRE_OWNER_CALL.test(stripped)).toBe(false); // 朴素 token 单独看确实漏
    expect(requireOwnerCallCount(stripped)).toBeGreaterThan(0); // 但真实计数认得出来
    expect(RUN_AS_USER_CALL.test(stripped)).toBe(false);
  });

  it("TENANT-A10 只认真调用(防绕二):字符串字面量里写着 runAsUser( 不算已建帧", () => {
    // 一句 TODO 文案里恰好出现 "runAsUser(" 这几个字符,不是代码——朴素正则(不剥字符串)
    // 会把它当成「这个文件已经建过帧」的假信号,而这个文件其实一顶帧都没建。
    const fixture = `
      export async function example() {
        const gate = await requireOwner();
        if ("error" in gate) return gate;
        const hint = "TODO: wrap this with runAsUser( once the frame lands";
        return gate.ownerId;
      }
    `;
    const stripped = stripComments(fixture);
    expect(REQUIRE_OWNER_CALL.test(stripped)).toBe(true);
    expect(RUN_AS_USER_CALL.test(stripped)).toBe(false);
  });

  it("TENANT-A10 只认真调用(防绕三):字符串字面量里的 /* 不会吞掉后面的真代码", () => {
    // 字符串里恰好写着一段 "/* " 又没有配对的 "*​/"——朴素的块注释正则(不剥字符串)会从
    // 这里一路吃到后面某个不相干的 "*​/"(或者根本没有,吃到文件结尾),把中间真正的
    // requireOwner/runAsUser 调用都吞成空白,导致这个文件被误判成「一个站点都没有」。
    const fixture = `
      export async function example() {
        const gate = await requireOwner();
        if ("error" in gate) return gate;
        const note = "a fake /* comment start living inside a string";
        const principal = await resolveUserPrincipal(gate);
        return runAsUser(principal, () => gate.ownerId);
      }
    `;
    const stripped = stripComments(fixture);
    expect(REQUIRE_OWNER_CALL.test(stripped)).toBe(true);
    expect(RUN_AS_USER_CALL.test(stripped)).toBe(true);
  });

  it("TENANT-A10 唯一的结构性排除仍然存在,且仍是它被排除时的形状", () => {
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
