/**
 * understanding-disclosure — MONEY-A9(规格 §7.3):**披露先于扣费**。
 *
 * Founder 2026-08-31 把「素材理解」从平台自费改成商家照算之后,每一张上传的图、每一段上传的
 * 视频都会自动产生一笔扣费。这一票钉的不是那笔扣费怎么走账(那是 worker 侧的验收),而是
 * **商家在按下选择文件之前有没有被告知**。一笔没被告知的扣费,是商家唯一不会原谅的钱 bug。
 *
 * 四条钉板:
 *   ① 三类价必须逐条出现在那一行小字里,而且是**现算**的 —— 测试自己也调
 *      `pricedUnderstandingCredits` 算期望值,不手抄一个数;两边同源,涨价当天一起动。
 *   ② 组件源码里**一个手抄的价钱都不许有**(源码文本断言)。手抄的那一刻,披露就变成了陷阱:
 *      成本钉点一动,界面上的数字会安静地开始撒谎。
 *   ③ 上传入口挂的是**同一个**组件,而且入口清单是**普查出来的,不是手抄的**:测试自己扫
 *      `source: "UPLOAD"` 的写点、扫谁调了那些写点动作,任一侧多出一个而披露没跟上就红。
 *      连**动作名本身**都是从写点文件里推导的(手抄的动作名会让新增一支 uploadHeroImage()
 *      的整套围栏照样全绿),入口再按**调用点计数**钉一层:同一个文件里多一个上传调用点,
 *      计数就对不上,评审者必须先确认披露覆盖了它才能改登记。
 *      这套推导用的是 **TypeScript 编译器**(`ts.createSourceFile` + `ts.forEachChild`),
 *      不是正则:文本匹配没有语法,`const upload = async file => {}`、`source: 'UPLOAD'`
 *      单引号、`import { x as y }` 别名、注释与字符串里的假写点,四种常见写法各能绕过
 *      一条正则围栏,而补一个洞就换一种写法绕过去。语法树把这四件一次答完。
 *      §7.3 明写「施工首件事用 grep 复核入口清单」—— 手抄的清单只在抄它的那一天是对的,
 *      而漏挂一个入口的代价,是商家被收一笔他从没在任何屏幕上见过的钱(顾问复审 2026-09-02
 *      就是这样抓到 Canvas 拖放与裁剪保存两个漏网入口的)。EditDesk 单列豁免:只收音频,
 *      音频不在收费的三类里。
 *   ④ 级联说明必须在(计费四则②):一张图被认出是菜单/价目表时会**再收一次**,
 *      只报第一段价是「真话,但仍然是骗人」。
 *
 * 另外两面:billing 价目区(同源、措辞更详)与 Otto 的 URL 导入(无 UI,披露走动作前报价)。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

import {
  UNDERSTANDING_PRICED_INTERNAL,
  displayCredits,
  pricedUnderstandingCredits,
} from "@fikirtive/core/spend";
import { creditsLabel } from "@/lib/credit-format";
import {
  UNDERSTANDING_COST_HINT_TITLE,
  UnderstandingCostHint,
} from "@/components/otto/UnderstandingCostHint";

const WEB_ROOT = process.cwd();
const codeOf = (rel: string) => readFileSync(path.join(WEB_ROOT, rel), "utf8");

/** 一件某类素材的报价,**按测试自己现算的口径** —— 与被测代码同一个函数,不是同一份字面量。 */
const priceOf = (kind: keyof typeof UNDERSTANDING_PRICED_INTERNAL) =>
  creditsLabel(displayCredits(pricedUnderstandingCredits(kind)));

/** 「12 credits」「0.1 credit」这类**手抄的钱数**。className 里的 `text-[0.75rem]` 不会命中
 *  (它后面跟的是 rem,不是 credit),命中的只有真的把价钱写死在文案里的那种写法。 */
const HAND_TYPED_CREDITS = /\d[\d,.]*\s*credits?\b/i;

/** 只扫**会被商家读到的那部分**:注释里举例说明「0.1 credits 是怎么来的」是文档,不是文案,
 *  而且它正是我们希望留在源码里的解释。手抄的价钱如果藏在注释里,一个商家也看不见。 */
function copyLines(src: string): string[] {
  return src
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .map((line) => line.trim());
}

// ────────────────────────── 入口普查(结构性围栏) ──────────────────────────
// 手抄的入口清单是这一票的病根本身:②段照 §7.3 点名的三处挂完就收工,而 Canvas 拖放
// (FlowCanvas → uploadReference)和素材详情的裁剪保存(DetailPanel → saveCroppedGeneration)
// 一直在落同样会被理解计费的 UPLOAD 素材,没人再去数一遍。下面两张表都由测试**当场扫出来**,
// 只有「为什么豁免」这一栏是人写的。

/** `apps/web` 里递归列出源码文件(跳过测试与 node_modules)。 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(WEB_ROOT, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name.startsWith(".")) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(rel, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

// ══════════════════ 围栏用 TypeScript 编译器解析,不用正则 ══════════════════
// 上一版整套围栏是正则拼的,Codex 复核当场列出四类常见写法能静默绕过它:
//   · `export const upload = async file => {…}`(无括号箭头)不匹配「export function」;
//   · 返回类型 `Promise<{ \n ok: true }>` 里换行的 `{` 被当成函数体起点,函数体整段读错;
//   · 注释或字符串里的 `source: "UPLOAD"` 被当成真写点;
//   · `import { finalizeCandidateUploads as finalize }` 之后的 `finalize(...)` 一次都不计,
//     而行尾注释里出现的同名文本反倒计了一次;并且只认双引号那一种写法。
// 这些不是「正则再写细一点」能修的:文本匹配没有语法,补一个洞就换一种写法绕过去。
// 所以整套改成 AST —— `ts.createSourceFile` + `ts.forEachChild`,注释与字符串天然不参与,
// 引号形式、别名、箭头写法都由语法树自己回答。仓库本来就依赖 typescript,零新增依赖。

/** 剥掉 `as const` / `satisfies` / 括号这类包装,露出里面真正的表达式。
 *  写点现场就是 `source: "UPLOAD" as const`,不剥就认不出来。 */
function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  for (;;) {
    if (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e)) {
      e = e.expression;
      continue;
    }
    return e;
  }
}

/** 字符串字面量的**值**:双引号、单引号、以及无插值的反引号 `` `UPLOAD` `` 都算。
 *  `.text` 拿到的是**解码后**的值,所以带 Unicode 转义的写法一样命中:源码里写
 *  `"\u0055PLOAD"`,`.text` 直接就是 `UPLOAD`。转义**不是**边界,是覆盖到了 ——
 *  下面「写点语法覆盖」那条测试把这一点也钉住了。 */
function literalTextOf(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** 对象字面量里一个属性的键名:`source`、`"source"`、以及计算键 `["source"]`。 */
function propertyKeyText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name)) return name.text;
  const direct = literalTextOf(name);
  if (direct !== null) return direct;
  if (ts.isComputedPropertyName(name)) return literalTextOf(unwrap(name.expression));
  return null;
}

/**
 * 写点本身:对象字面量里 `source` 这一项、值是字符串 `UPLOAD`。
 *
 * 覆盖到的写法:`source:` / `"source":` / `["source"]:` 三种键;值为双引号、单引号、
 * 无插值反引号,以及带转义的字面量(`.text` 是解码后的值);`as const` / `satisfies` /
 * 多层括号包装都会先剥掉。
 *
 * **已知边界(穷举,不假装覆盖)** —— 下面这些今天在写点文件里都不存在,一旦有人这么写,
 * 围栏会漏掉它,所以列在这里而不是留给下一个人去发现:
 *   1. 常量或枚举引用:`source: GenerationSource.UPLOAD`、`source: UPLOAD`。
 *      语法树只看得见一个标识符,看不见它的值 —— 要判它得跑类型检查器,不是解析器。
 *   2. 带插值的模板:`source: `UPLO${x}D``(TemplateExpression 没有静态值)。
 *   3. 属性简写 `{ source }`:值藏在同名变量里,同上。
 *   4. 展开写法 `{ ...uploadDefaults }`:属性根本没出现在这个对象字面量里。
 *   5. 非字面量键:`{ [keyVar]: "UPLOAD" }`。
 *   6. Prisma 之外的落盘路径(裸 SQL、`$executeRaw`)完全不经过对象字面量。
 */
function isUploadWrite(node: ts.Node): boolean {
  if (!ts.isPropertyAssignment(node)) return false;
  if (propertyKeyText(node.name) !== "source") return false;
  return literalTextOf(unwrap(node.initializer)) === "UPLOAD";
}

/** 一个节点如果是「有名字的函数」,返回那个名字。五种都认:
 *  `function f(){}`、类/对象里的 `f(){}`、`const f = ... => {}`(含无括号箭头)、
 *  对象字面量里的 `f: () => {}`、类字段 `f = () => {}`。 */
function functionNameOf(node: ts.Node): string | undefined {
  const isFunctionValue = (expr: ts.Expression | undefined): boolean => {
    if (!expr) return false;
    const inner = unwrap(expr);
    return ts.isArrowFunction(inner) || ts.isFunctionExpression(inner);
  };
  if (ts.isFunctionDeclaration(node)) return node.name?.text;
  if (ts.isMethodDeclaration(node)) return propertyKeyText(node.name) ?? undefined;
  if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
    if (!isFunctionValue(node.initializer) || !ts.isIdentifier(node.name)) return undefined;
    return node.name.text;
  }
  if (ts.isPropertyAssignment(node)) {
    return isFunctionValue(node.initializer) ? propertyKeyText(node.name) ?? undefined : undefined;
  }
  return undefined;
}

/** 文件对外暴露的名字 → 它在文件内的本地名。`export { a as b }` 记成 b → a。 */
function exportedNames(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const st of sf.statements) {
    const exported =
      ts.canHaveModifiers(st) &&
      (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(st) && exported && st.name) out.set(st.name.text, st.name.text);
    if (ts.isVariableStatement(st) && exported) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) out.set(d.name.text, d.name.text);
      }
    }
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) out.set(el.name.text, (el.propertyName ?? el.name).text);
    }
  }
  return out;
}

/** 调用图上的一个节点 = **一处具体的函数声明**,不是一个名字。
 *  以名字为键会把两个作用域里同名的 `persist` 当成同一个节点(串线);以声明为键就不会。 */
interface FnNode {
  name: string;
  /** 词法上最近的有名字的外层函数;null = 模块作用域。 */
  parent: number | null;
  /** callee 是裸标识符的调用 —— 按**词法可见性**解析到具体声明。 */
  callsIdent: Set<string>;
  /** callee 是 `obj.m()` / `this.m()` 的调用 —— 只能按名字对齐,见下方边界说明。 */
  callsMember: Set<string>;
  writes: boolean;
}

/**
 * 一个文件的「谁会落 UPLOAD 素材」闭包。
 *
 * 写点归给**最近的有名字的外层函数**(写点常躺在 `$transaction(async (tx) => …)` 这种匿名
 * 回调里,归给匿名箭头等于没归),再按调用关系做传递闭包:调了 writer 的也是 writer。
 * 导出的 writer(含传递)= 上传动作。上一版靠一份手写的 `WRITE_HELPERS` 名单才认得出
 * 「动作自己不写行、交给 helper 写」这一层,那份名单本身就是漏洞;闭包取代了它。
 *
 * 两类调用边,精度不同,如实分开:
 *   · `f()` 裸标识符 —— 从调用处的作用域逐层向外找同名声明,**词法解析**,不串线;
 *   · `obj.m()` / `this.m()` —— 解析器不做类型推断,不知道 `obj` 是谁,所以退化成
 *     「文件里所有叫 m 的声明」。这会多连边(误报),不会少连边(漏报)——
 *     围栏宁可红了让人看一眼,也不能绿着放过一条计费路径。
 *
 * **已知边界(穷举)**:
 *   1. 跨文件包装:别的模块 import 了动作、再导出一个包装函数,本文件的闭包看不见它。
 *      入口侧的「文件 → 调用点数量」登记表是这一条的兜底 —— 那个包装文件一旦被 UI 调用,
 *      它自己会以新入口的身份出现在入口普查里。
 *   2. 间接调用:把动作塞进变量、数组、对象属性或回调再调用(`const g = upload; g()`)。
 *   3. 动态调用:`obj[nameVar]()`、`eval`、`Function`。
 *   4. 跨文件同名方法:`obj.m()` 的名字对齐只在**本文件内**做,不会跨文件乱连。
 */
function uploadWritersOf(sf: ts.SourceFile): { hasWritePoint: boolean; exportedWriters: string[] } {
  const nodes: FnNode[] = [];
  const byScope = new Map<number | null, Map<string, number[]>>();
  const byName = new Map<string, number[]>();
  let hasWritePoint = false;

  const declare = (scope: number | null, name: string, index: number): void => {
    let inScope = byScope.get(scope);
    if (!inScope) byScope.set(scope, (inScope = new Map()));
    inScope.set(name, [...(inScope.get(name) ?? []), index]);
    byName.set(name, [...(byName.get(name) ?? []), index]);
  };

  const visit = (node: ts.Node, enclosing: number | null): void => {
    const name = functionNameOf(node);
    let current = enclosing;
    if (name !== undefined) {
      const index = nodes.length;
      nodes.push({ name, parent: enclosing, callsIdent: new Set(), callsMember: new Set(), writes: false });
      declare(enclosing, name, index);
      current = index;
    }
    if (isUploadWrite(node)) {
      hasWritePoint = true;
      if (current !== null) nodes[current].writes = true;
    }
    if (ts.isCallExpression(node) && current !== null) {
      const callee = unwrap(node.expression);
      if (ts.isIdentifier(callee)) nodes[current].callsIdent.add(callee.text);
      else if (ts.isPropertyAccessExpression(callee)) nodes[current].callsMember.add(callee.name.text);
    }
    ts.forEachChild(node, (child) => visit(child, current));
  };
  ts.forEachChild(sf, (child) => visit(child, null));

  /** 从 `from` 这个声明所在的位置向外逐层找同名声明 —— 词法可见性,不是全文件同名。 */
  const resolveIdent = (from: number, name: string): number[] => {
    let scope: number | null = from;
    for (;;) {
      const hit = byScope.get(scope)?.get(name);
      if (hit) return hit;
      if (scope === null) return [];
      scope = nodes[scope].parent;
    }
  };

  const writers = new Set<number>();
  nodes.forEach((node, index) => {
    if (node.writes) writers.add(index);
  });
  for (let changed = true; changed; ) {
    changed = false;
    nodes.forEach((node, index) => {
      if (writers.has(index)) return;
      const targets = [
        ...[...node.callsIdent].flatMap((name) => resolveIdent(index, name)),
        ...[...node.callsMember].flatMap((name) => byName.get(name) ?? []),
      ];
      if (targets.some((target) => writers.has(target))) {
        writers.add(index);
        changed = true;
      }
    });
  }

  const moduleScope = byScope.get(null) ?? new Map<string, number[]>();
  const exportedWriters: string[] = [];
  for (const [external, local] of exportedNames(sf)) {
    if ((moduleScope.get(local) ?? []).some((index) => writers.has(index))) exportedWriters.push(external);
  }
  return { hasWritePoint, exportedWriters };
}

/** 解析一次就够(全仓 526 个源码文件解析实测约 340ms,所以下面不再做任何文本预筛)。 */
const parseCache = new Map<string, ts.SourceFile>();
function parseFile(rel: string): ts.SourceFile {
  let cached = parseCache.get(rel);
  if (!cached) {
    parseCache.set(
      rel,
      (cached = ts.createSourceFile(
        rel,
        codeOf(rel),
        ts.ScriptTarget.Latest,
        /* setParentNodes */ false,
        rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      )),
    );
  }
  return cached;
}

const analysisCache = new Map<string, { hasWritePoint: boolean; exportedWriters: string[] }>();
function analyze(rel: string): { hasWritePoint: boolean; exportedWriters: string[] } {
  let cached = analysisCache.get(rel);
  if (!cached) analysisCache.set(rel, (cached = uploadWritersOf(parseFile(rel))));
  return cached;
}

/** 真的写 UPLOAD 素材的文件。**没有文本预筛** —— 全部解析,判据一律是 AST。
 *  预筛曾经是围栏上最后一处文本匹配:大小写、分隔符、拼接写法都能骗过它,
 *  而全量解析只要 340ms,省这一下换来的风险不划算。
 *  于是注释和字符串里的 `source: "UPLOAD"` 天然不算写点 —— `lib/otto-media-port.ts`
 *  正是这种:只在注释里提,自己不写行,转手给 finalizeCandidateUploads。 */
let writePointFilesCache: string[] | null = null;
function writePointFiles(): string[] {
  if (writePointFilesCache) return writePointFilesCache;
  const all = sourceFiles("lib").concat(sourceFiles("app"), sourceFiles("components"));
  return (writePointFilesCache = all.filter((f) => analyze(f).hasWritePoint).sort());
}

/** 写点所在的文件。多一个文件开始写 UPLOAD 素材,这里当场红 —— 那意味着有一条新的计费路径,
 *  而它的 UI 入口还没有人问过「商家看得见价目吗」。 */
const WRITE_POINT_FILES: Record<string, string> = {
  "lib/actions.ts": "ingestFile → createEntity / addReferenceImages / uploadCandidates / uploadReference",
  "lib/asset-actions.ts": "saveCroppedGeneration —— 裁剪保存落一条全新的 UPLOAD 素材",
  "lib/upload-actions.ts": "finalizeCandidateUploads —— 直传落盘的唯一权威(Otto 的 URL 导入也走它)",
};

/** 会落 image/video UPLOAD 素材的导出动作 —— 从语法树推导,没有任何一份手抄名单。 */
let uploadActionsCache: string[] | null = null;
function uploadActionNames(): string[] {
  if (uploadActionsCache) return uploadActionsCache;
  const names = new Set<string>();
  for (const file of writePointFiles()) {
    for (const action of analyze(file).exportedWriters) names.add(action);
  }
  return (uploadActionsCache = [...names].sort());
}

/** 源码扩展名。`import … from "./x.js"` 在 ESM 里指的就是 `x.ts` —— 两侧都剥掉扩展名,
 *  `x` / `x.ts` / `x.tsx` / `x.js` 才会归一到同一个模块。不剥的话,一个写成 `.js` 的
 *  新入口会安静地不命中模块集合,整条入口普查对它全绿。 */
const SOURCE_EXTENSION = /\.(?:m|c)?[jt]sx?$/;

/** 写点文件在 import 里长什么样(`@/lib/actions` 与 `../../lib/actions.js` 是同一个模块)。 */
function moduleIdOf(rel: string): string {
  return rel.replace(SOURCE_EXTENSION, "");
}

/** 把 import 说明符解析成仓库内相对路径(已剥扩展名);第三方包返回 null。 */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/")) return moduleIdOf(spec.slice(2));
  if (spec.startsWith(".")) {
    return moduleIdOf(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec)));
  }
  return null;
}

/** 这个 UI 文件从动作模块 import 进来的**本地名**(含 `as` 别名)。
 *  别名是正则版的另一个洞:`import { finalizeCandidateUploads as finalize }` 之后
 *  代码里一个 `finalizeCandidateUploads(` 都不会出现,而 `finalize(...)` 才是真调用。 */
function importedActionLocals(file: string, sf: ts.SourceFile): Set<string> {
  const actions = new Set(uploadActionNames());
  const modules = new Set(writePointFiles().map(moduleIdOf));
  const locals = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const resolved = resolveSpecifier(file, st.moduleSpecifier.text);
    if (!resolved || !modules.has(resolved)) continue;
    const bindings = st.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if (actions.has((el.propertyName ?? el.name).text)) locals.add(el.name.text);
    }
  }
  return locals;
}

/** 一个 UI 文件里对上传动作的**调用点数量**(同样没有文本预筛)。
 *  注释与字符串里出现同名文本不会计数(它们根本不是 CallExpression),`await f(...)` 会计数。
 *  已知边界:把动作传给变量或回调再间接调用,这里数不到 —— 与写点侧同一条边界。 */
function callSiteCount(file: string): number {
  const sf = parseFile(file);
  const locals = importedActionLocals(file, sf);
  if (locals.size === 0) return 0;
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && locals.has(node.expression.text)) count++;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return count;
}

/** 调了任何一个上传动作的 UI 文件 —— 这就是「上传入口」的定义,不是谁记得住的那三处。 */
function uploadEntryFiles(): string[] {
  return sourceFiles("app")
    .concat(sourceFiles("components"))
    .filter((f) => callSiteCount(f) > 0)
    .sort();
}

/**
 * 必须挂披露的入口:文件 → 说明 → **该文件里的上传调用点数量**。
 *
 * 计数这一栏是围栏语义,不是逐点证明:grep 证不了「第 3 个调用点旁边有没有披露」,
 * 但它能证「调用点数量变了」。变了就红,评审者必须先确认披露仍然覆盖那个新调用点、
 * 再来更新这个数字 —— 也就是把「在 OttoChatStream 里再塞一个不披露的上传弹层」
 * 从一次静默的合并,变成一次必须有人签字的改动。
 */
const MOUNTS = [
  ["components/asset/DetailPanel.tsx", "素材详情的裁剪保存(saveCroppedGeneration)", 1],
  ["components/canvas/FlowCanvas.tsx", "Canvas 拖放上传(uploadReference)", 1],
  ["components/otto/OttoChatStream.tsx", "Otto 对话的附件入口", 3],
  ["components/otto/TemplateModal.tsx", "模板的产品图上传", 1],
  ["components/otto/stuff/AddAssetDialog.tsx", "素材库的多图上传", 2],
] as const;

/** 明示豁免。豁免要有理由,而且理由要能当场核 —— 不写理由的豁免就是漏挂。
 *  豁免也数调用点:EditDesk 今天只收音频,它哪天多接一个收图的入口,这里同样会红。 */
const EXEMPT: Record<string, { reason: string; callSites: number }> = {
  "components/otto/edit/EditDesk.tsx": {
    reason: "只收音频;audio 不在收费的三类里(§7.3 单列)",
    callSites: 1,
  },
};

describe("MONEY-A9 披露先于扣费:上传入口的价目小字", () => {
  const markup = renderToStaticMarkup(createElement(UnderstandingCostHint));

  it("三类价逐条出现,且与报价函数同源(测试自己现算期望值,不手抄)", () => {
    for (const kind of Object.keys(UNDERSTANDING_PRICED_INTERNAL) as (keyof typeof UNDERSTANDING_PRICED_INTERNAL)[]) {
      expect(markup, `${kind} 的价没有出现在披露行里`).toContain(priceOf(kind));
    }
  });

  it("第四类理解上线时,这句话必须跟着改(枚举长度即闸)", () => {
    // 这一行不是形式主义:三类价是**三个句子槽**,加第四类而不改文案,商家读到的就是一份
    // 缺一档的价目表 —— 而缺的那一档照样扣钱。枚举一变长,这里当场红。
    expect(
      Object.keys(UNDERSTANDING_PRICED_INTERNAL),
      "理解档多了一类:披露行要多一个槽,billing 价目区同样",
    ).toHaveLength(3);
  });

  it("级联说明在(计费四则②:菜单/价目表会被再读一次,两段价一并披露)", () => {
    expect(markup).toContain("menu or price list");
    expect(markup).toContain(priceOf("doc-extract"));
  });

  it("title 说清了什么时候扣、按哪一天的价(四则①:按上传时刻的快照价)", () => {
    expect(markup).toContain(UNDERSTANDING_COST_HINT_TITLE);
    expect(UNDERSTANDING_COST_HINT_TITLE.toLowerCase()).toContain("when you upload");
  });

  it("组件源码里没有手抄的价钱 —— 数值只能来自推导", () => {
    const src = codeOf("components/otto/UnderstandingCostHint.tsx");
    const offenders = copyLines(src).filter((line) => HAND_TYPED_CREDITS.test(line));
    expect(offenders, "披露文案里出现了手抄的钱数").toEqual([]);
    expect(src).toContain("pricedUnderstandingCredits");
  });

  it("样式照抄现成的成本小字(FlowCanvas 的那一行),不是第三种长相", () => {
    expect(markup).toContain("text-[0.75rem] text-muted-foreground");
    expect(codeOf("components/canvas/FlowCanvas.tsx")).toContain(
      'className="text-[0.75rem] text-muted-foreground"',
    );
  });

  it.each(MOUNTS)("%s 挂的是同一个共享组件", (file) => {
    const src = codeOf(file);
    expect(src, `${file} 没有 import 披露组件`).toContain("UnderstandingCostHint");
    expect(src, `${file} import 了却没有渲染`).toContain("<UnderstandingCostHint />");
  });

  it("EditDesk 不挂 —— 它今天只收音频,音频不在收费的三类里(§7.3 单列)", () => {
    expect(codeOf("components/otto/edit/EditDesk.tsx")).not.toContain("UnderstandingCostHint");
  });

  // ── 围栏:两侧各扫一遍,任一侧动了而另一侧没跟上就红 ────────────────────────────
  it("写点普查:落 UPLOAD 素材的文件就是登记的这几个(多一个=多一条没人问过披露的计费路径)", () => {
    expect(
      writePointFiles(),
      "有文件开始写 source:\"UPLOAD\":先追它的 UI 面,再决定挂披露还是写进豁免",
    ).toEqual(Object.keys(WRITE_POINT_FILES).sort());
  });

  it("写点普查:转调内部 helper 的导出动作也算上传动作(闭包取代了手抄的 helper 名单)", () => {
    // createEntity 自己一个 source:"UPLOAD" 都没写,它调 ingestFile。上一版靠一份手写的
    // WRITE_HELPERS 名单才认得出这一层,而那份名单本身就是个漏洞:在写点文件里新增一个
    // 非导出的 persistUpload() 再由新动作转调,名单不更新就全绿。现在由调用闭包保证。
    const actions = uploadActionNames();
    expect(actions, "createEntity 只通过 helper 落盘,闭包必须认出它").toContain("createEntity");
    expect(actions, "addReferenceImages 同样只通过 helper 落盘").toContain("addReferenceImages");
    // 而 helper 自己不导出,不会被当成「UI 该去调的动作」漏进入口侧
    expect(actions, "ingestFile 是非导出 helper,不该出现在动作表里").not.toContain("ingestFile");
  });

  it("写点语法覆盖:该认的都认,注释里列的已知边界确实不认(边界清单可核)", () => {
    // 边界清单写在 isUploadWrite 的注释里。清单和实现各说各话是最坏的一种文档:
    // 读的人以为覆盖了,实际没有。所以两边在这里对表 —— 清单改了、实现没跟上,当场红。
    const detects = (objectLiteral: string): boolean => {
      const sf = ts.createSourceFile(
        "probe.ts",
        `const probe = ${objectLiteral};`,
        ts.ScriptTarget.Latest,
        false,
        ts.ScriptKind.TS,
      );
      let hit = false;
      const visit = (node: ts.Node): void => {
        if (isUploadWrite(node)) hit = true;
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(sf, visit);
      return hit;
    };

    for (const form of [
      '{ source: "UPLOAD" }',
      "{ source: 'UPLOAD' }",
      "{ source: `UPLOAD` }",
      '{ "source": "UPLOAD" }',
      '{ ["source"]: "UPLOAD" }',
      '{ source: "UPLOAD" as const }',
      '{ source: ("UPLOAD") }',
      '{ source: "\\u0055PLOAD" }',
    ]) {
      expect(detects(form), `这种写法没被认成写点:${form}`).toBe(true);
    }

    for (const form of [
      "{ source: GenerationSource.UPLOAD }",
      "{ source: UPLOAD }",
      "{ source: `UPLO${x}D` }",
      "{ source }",
      "{ ...uploadDefaults }",
      '{ [keyVar]: "UPLOAD" }',
      '{ source: "DOWNLOAD" }',
    ]) {
      expect(detects(form), `边界清单说不认,实现却认了 —— 清单该更新:${form}`).toBe(false);
    }
  });

  it("写点普查:注释与字符串里的 source:\"UPLOAD\" 不是写点(AST 天然不看注释)", () => {
    // otto-media-port 在注释里写了 `Generation(source:"UPLOAD")` 来解释它的下游成本,
    // 它自己不写行 —— 转手给 finalizeCandidateUploads。正则版靠「滤掉注释行」勉强躲开,
    // 换成字符串常量就会误判;AST 版根本不会去看注释和字符串。
    expect(codeOf("lib/otto-media-port.ts")).toContain('source:"UPLOAD"');
    expect(
      writePointFiles(),
      "otto-media-port 只在注释里提 UPLOAD,不该被当成写点文件",
    ).not.toContain("lib/otto-media-port.ts");
  });

  it("动作普查:上传动作名由源码推导,登记表只用来核对(新增一支写 UPLOAD 的导出动作当场红)", () => {
    expect(
      uploadActionNames(),
      "写点文件里的上传动作集合变了:先追它的 UI 面,再决定挂披露还是写进豁免",
    ).toEqual([
      "addReferenceImages",
      "createEntity",
      "finalizeCandidateUploads",
      "saveCroppedGeneration",
      "uploadCandidates",
      "uploadReference",
    ]);
  });

  it("入口普查:调上传动作的 UI 文件 = 挂点表 + 豁免表(新入口漏挂当场红)", () => {
    const declared = [...MOUNTS.map(([file]) => file), ...Object.keys(EXEMPT)].sort();
    expect(
      uploadEntryFiles(),
      "有 UI 开始调上传动作:要么挂 <UnderstandingCostHint />,要么进 EXEMPT 并写明理由",
    ).toEqual(declared);
  });

  it.each(MOUNTS)("%s 的上传调用点数量 = 登记值(多一个调用点=强制人工复核披露)", (file, _note, callSites) => {
    expect(
      callSiteCount(file),
      `${file} 的上传调用点数量变了:先确认披露仍覆盖新的调用点,再来更新这个数字`,
    ).toBe(callSites);
  });

  it("入口普查:挂点表与豁免表不重叠,豁免每条都带理由,豁免的调用点数量也钉住", () => {
    for (const [file] of MOUNTS) {
      expect(EXEMPT[file], `${file} 同时出现在挂点表和豁免表`).toBeUndefined();
    }
    for (const [file, { reason, callSites }] of Object.entries(EXEMPT)) {
      expect(reason.length, `${file} 的豁免没写理由`).toBeGreaterThan(10);
      expect(codeOf(file), `${file} 被豁免了却挂着披露`).not.toContain("UnderstandingCostHint");
      expect(
        callSiteCount(file),
        `${file} 的上传调用点数量变了:豁免的理由(只收音频)可能已经不成立`,
      ).toBe(callSites);
    }
  });
});

describe("MONEY-A9 披露先于扣费:billing 页价目区", () => {
  it("Auto-understanding 一节在,三类价同源,级联与上传时刻价都说了", async () => {
    vi.resetModules();
    vi.doMock("@/lib/account-actions", () => ({
      getMyAccount: async () => ({ error: "not signed in" }),
    }));
    vi.doMock("@/lib/billing-actions", () => ({ listCreditPacks: async () => ({ packs: [] }) }));
    vi.doMock("@/lib/spend-history-data", () => ({
      getSpendOverview: async () => ({ error: "unavailable" }),
    }));
    const { default: BillingPage } = await import("@/app/billing/page");

    const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Auto-understanding");
    for (const kind of Object.keys(UNDERSTANDING_PRICED_INTERNAL) as (keyof typeof UNDERSTANDING_PRICED_INTERNAL)[]) {
      expect(html, `${kind} 的价没有出现在 billing 价目区`).toContain(priceOf(kind));
    }
    expect(html).toContain("menu or a price list");
    // 四则①:结算按上传时刻的快照价,所以价目区不能只报价、不说这笔价什么时候锁。
    expect(html.toLowerCase()).toContain("price shown when you upload");
    vi.doUnmock("@/lib/account-actions");
    vi.doUnmock("@/lib/billing-actions");
    vi.doUnmock("@/lib/spend-history-data");
  });

  it("billing 页的数字也是现算的,不是页面里另抄的一份", () => {
    const src = codeOf("app/billing/page.tsx");
    expect(src).toContain("pricedUnderstandingCredits");
    const understandingCopy = copyLines(src).filter(
      (line) => /understanding/i.test(line) && HAND_TYPED_CREDITS.test(line),
    );
    expect(understandingCopy, "价目区出现了手抄的钱数").toEqual([]);
  });
});

describe("MONEY-A9 披露先于扣费:Otto 的 URL 导入走动作前报价", () => {
  const port = codeOf("lib/otto-media-port.ts");

  it("「$0 by construction」的旧说法已废止 —— 导入落的是会被理解计费的 UPLOAD 素材", () => {
    expect(port).not.toContain("$0 by construction");
    expect(port).toContain("MONEY-A9");
  });

  it("成功结果带一句报价,而且是现算的(无 UI 面,披露只能走动作层)", () => {
    expect(port).toContain("pricedUnderstandingCredits");
    expect(port).toContain("creditsLabel");
    expect(port).toContain("note: importUnderstandingQuote(");
    const offenders = copyLines(port).filter((line) => HAND_TYPED_CREDITS.test(line));
    expect(offenders, "导入报价里出现了手抄的钱数").toEqual([]);
  });

  it("级联那一句只给图片 —— 视频不会触发 doc-extract,承诺它就是另一句假话", () => {
    expect(port).toContain('kind === "image-caption"');
  });

  it("**动作前**那一半真的在动作层:Otto 的说明书与 importMedia 工具描述都带着现算的价", async () => {
    // 上面三条钉的是 port 回来那一句(**事后**报价)。规格 §7.3 要的是「动作前报价」——
    // 事后才告诉商家花了多少,正是这一票开头写的那种「商家唯一不会原谅的钱 bug」。
    // 这条把另一半也钉住:模型在**伸手去调这个工具之前**读到的两处文本里都有那个价。
    const { ottoInstructions, skillCatalog } = await import("@fikirtive/otto");
    const importMedia = skillCatalog.find((s) => s.name === "importMedia");
    expect(importMedia, "importMedia 不在 Otto 的动作表里").toBeDefined();

    for (const kind of Object.keys(UNDERSTANDING_PRICED_INTERNAL) as (keyof typeof UNDERSTANDING_PRICED_INTERNAL)[]) {
      const amount = `${displayCredits(pricedUnderstandingCredits(kind))} credits`;
      expect(ottoInstructions, `Otto 说明书缺 ${kind} 的价`).toContain(amount);
      expect(importMedia!.description, `importMedia 描述缺 ${kind} 的价`).toContain(amount);
    }
    // 先报价、再导入 —— 顺序本身就是这条验收
    expect(ottoInstructions).toContain("Say that price BEFORE you import, never after");
    expect(importMedia!.description).toContain("BEFORE CALLING THIS");
  });
});
