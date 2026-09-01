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
 *      作用域按**块**分(不只按函数),所以块内同名声明不会遮蔽块外的写点;动作身份是
 *      **(模块, 导出名)** 并做**跨文件传递闭包**,所以 UI → wrapper/barrel → 写点模块
 *      这条链整支都在围栏里,而不是只看直接来自写点文件的 import。模块键还归一了
 *      目录入口(`lib/foo/index.ts` 与 `@/lib/foo` 是同一个模块)与具名重导出,
 *      这两种写法仓库里都有现成的。
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

/** 扫描要跳过的目录。测试与夹具里到处都是假的写点和假的动作调用 —— 把它们算进普查,
 *  围栏就会被自己的样例数据喂出一堆不存在的计费路径,然后逼人去更新登记表。 */
const SKIPPED_DIRECTORIES = new Set(["node_modules", "__tests__", "__mocks__", "__fixtures__", "fixtures"]);

/** 测试文件本身(与目录无关,`foo.test.ts` 摆在源码目录里一样跳过)。 */
const TEST_FILE = /\.(?:test|spec)\.tsx?$/;

/** `apps/web` 里递归列出**产品源码**文件。 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(WEB_ROOT, dir), { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(rel, out);
    else if (/\.tsx?$/.test(entry.name) && !TEST_FILE.test(entry.name)) out.push(rel);
  }
  return out;
}

/** 普查的扫描面:动作定义在 `lib`,入口在 `app` / `components`。 */
function scannedSourceFiles(): string[] {
  return sourceFiles("lib").concat(sourceFiles("app"), sourceFiles("components"));
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

/** 调用图上的一个节点 = **一处具体的函数声明**,不是一个名字。 */
interface FnNode {
  name: string;
  /** 这个函数体自己的作用域 id。 */
  bodyScope: number;
  writes: boolean;
}

/** 词法作用域。函数体是作用域,`{}` 块、for、switch、catch 也是 ——
 *  少了块级这一层,`if (flag) { const persist = () => {} }` 里的声明会被登记到整个函数上,
 *  把函数体后面那句 `persist()` 错误地遮蔽掉,外层真正写 UPLOAD 的那支就此漏报。 */
interface Scope {
  parent: number | null;
  decls: Map<string, number[]>;
}

/** 块级作用域节点。`ts.isBlock` 覆盖函数体与裸块,其余是自带作用域的语句形式。 */
function isBlockScope(node: ts.Node): boolean {
  return (
    ts.isBlock(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isCaseBlock(node) ||
    ts.isCaseClause(node) ||
    ts.isDefaultClause(node) ||
    ts.isCatchClause(node) ||
    ts.isModuleBlock(node)
  );
}

/** 一处函数声明的名字,以及它是**词法绑定**还是**成员**。
 *  分开是必要的:`const store = { persist(){} }` 里的 `persist` 只能通过 `store.persist()`
 *  够到,它不该出现在裸标识符 `persist()` 的作用域表里(否则会误连)。 */
function functionDeclarationOf(node: ts.Node): { name: string; member: boolean } | undefined {
  const isFunctionValue = (expr: ts.Expression | undefined): boolean => {
    if (!expr) return false;
    const inner = unwrap(expr);
    return ts.isArrowFunction(inner) || ts.isFunctionExpression(inner);
  };
  if (ts.isFunctionDeclaration(node)) {
    return node.name ? { name: node.name.text, member: false } : undefined;
  }
  if (ts.isVariableDeclaration(node)) {
    if (!isFunctionValue(node.initializer) || !ts.isIdentifier(node.name)) return undefined;
    return { name: node.name.text, member: false };
  }
  if (ts.isMethodDeclaration(node)) {
    const name = propertyKeyText(node.name);
    return name === null ? undefined : { name, member: true };
  }
  if (ts.isPropertyDeclaration(node)) {
    if (!isFunctionValue(node.initializer)) return undefined;
    const name = propertyKeyText(node.name);
    return name === null ? undefined : { name, member: true };
  }
  if (ts.isPropertyAssignment(node)) {
    if (!isFunctionValue(node.initializer)) return undefined;
    const name = propertyKeyText(node.name);
    return name === null ? undefined : { name, member: true };
  }
  return undefined;
}

/** 一次调用,连同它发生的作用域 —— 解析要等整棵树走完(函数声明会提升)。 */
interface CallRecord {
  from: number;
  scope: number;
  name: string;
  member: boolean;
}

/**
 * 一个模块的「谁会落 UPLOAD 素材」闭包。
 *
 * 种子有两类:①函数体里直接有写点;②函数调用了 `knownActionLocals` 里的名字 ——
 * 那是**从别的模块 import 进来的、已知会落 UPLOAD 的动作**,跨文件包装就是靠这一条接上的。
 * 然后按调用关系做传递闭包,导出的 writer(含传递)就是这个模块对外的上传动作。
 *
 * 两类调用边,精度不同,如实分开:
 *   · `f()` 裸标识符 —— 从调用点所在作用域沿**块链**逐层向外找同名词法声明,不串线、不误连;
 *   · `obj.m()` / `this.m()` —— 解析器不做类型推断,不知道 `obj` 是谁,退化成
 *     「本文件里所有叫 m 的**成员**声明」。这会多连边(误报),不会少连边(漏报)。
 *
 * **已知边界(穷举)**:
 *   1. 间接调用:把动作塞进变量、数组、对象属性或回调再调用(`const g = upload; g()`)。
 *   2. 返回函数:导出函数 return 一个内部调了动作的闭包(端口工厂就是这形状),
 *      调用发生在返回值上,本模块的调用图连不上去。
 *   3. 动态调用:`obj[nameVar]()`、`eval`、`Function`。
 *   4. 跨文件同名成员:`obj.m()` 的名字对齐只在本文件内做,不会跨文件乱连。
 *   5. 星号重导出 `export * from "…"`:星号没有名字可对,跟不了。**具名**重导出
 *      (`export { a as b } from "…"`,以及 import 之后再 `export { a }`)已经认了,
 *      见 `reexportEdges`。
 *
 * 这五条各有一条负向断言钉着(「闭包边界逐条对表」那条测试),说了认不到就得真的认不到 ——
 * 哪天某条被意外覆盖,那里会红,该更新的是这份清单,不是默默删掉断言。
 */
function uploadWritersOf(
  sf: ts.SourceFile,
  knownActionLocals: ReadonlySet<string>,
): { hasWritePoint: boolean; exportedWriters: string[] } {
  const scopes: Scope[] = [{ parent: null, decls: new Map() }];
  const nodes: FnNode[] = [];
  const members = new Map<string, number[]>();
  const callRecords: CallRecord[] = [];
  let hasWritePoint = false;

  const pushScope = (parent: number): number => {
    scopes.push({ parent, decls: new Map() });
    return scopes.length - 1;
  };
  const append = (table: Map<string, number[]>, name: string, index: number): void => {
    table.set(name, [...(table.get(name) ?? []), index]);
  };

  const visit = (node: ts.Node, scope: number, fn: number | null): void => {
    let childScope = scope;
    let childFn = fn;
    const declaration = functionDeclarationOf(node);
    if (declaration) {
      const index = nodes.length;
      const bodyScope = pushScope(scope);
      nodes.push({ name: declaration.name, bodyScope, writes: false });
      if (declaration.member) append(members, declaration.name, index);
      else append(scopes[scope].decls, declaration.name, index);
      childScope = bodyScope;
      childFn = index;
    } else if (isBlockScope(node)) {
      childScope = pushScope(scope);
    }
    if (isUploadWrite(node)) {
      hasWritePoint = true;
      if (childFn !== null) nodes[childFn].writes = true;
    }
    if (ts.isCallExpression(node) && childFn !== null) {
      const callee = unwrap(node.expression);
      if (ts.isIdentifier(callee)) {
        callRecords.push({ from: childFn, scope: childScope, name: callee.text, member: false });
      } else if (ts.isPropertyAccessExpression(callee)) {
        callRecords.push({ from: childFn, scope: childScope, name: callee.name.text, member: true });
      }
    }
    ts.forEachChild(node, (child) => visit(child, childScope, childFn));
  };
  ts.forEachChild(sf, (child) => visit(child, 0, null));

  /** 沿作用域链(块级也算一层)向外找同名**词法**声明。 */
  const resolveLexical = (scope: number, name: string): number[] => {
    let current: number | null = scope;
    while (current !== null) {
      const hit = scopes[current].decls.get(name);
      if (hit) return hit;
      current = scopes[current].parent;
    }
    return [];
  };

  const writers = new Set<number>();
  nodes.forEach((node, index) => {
    if (node.writes) writers.add(index);
  });
  const edges = new Map<number, Set<number>>();
  for (const record of callRecords) {
    const targets = record.member
      ? members.get(record.name) ?? []
      : resolveLexical(record.scope, record.name);
    if (targets.length === 0) {
      // 本文件里找不到这个名字 —— 如果它是 import 进来的已知动作,这一支就是 writer。
      if (!record.member && knownActionLocals.has(record.name)) writers.add(record.from);
      continue;
    }
    let outgoing = edges.get(record.from);
    if (!outgoing) edges.set(record.from, (outgoing = new Set()));
    for (const target of targets) outgoing.add(target);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const [from, targets] of edges) {
      if (writers.has(from)) continue;
      for (const target of targets) {
        if (writers.has(target)) {
          writers.add(from);
          changed = true;
          break;
        }
      }
    }
  }

  const exportedWriters: string[] = [];
  for (const [external, local] of exportedNames(sf)) {
    if ((scopes[0].decls.get(local) ?? []).some((index) => writers.has(index))) {
      exportedWriters.push(external);
    }
  }
  return { hasWritePoint, exportedWriters };
}

/** 解析一次就够。全仓源码文件全量 AST 扫描是毫秒级的量级,所以下面不做任何文本预筛。 */
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

/** 写点所在的文件。多一个文件开始写 UPLOAD 素材,这里当场红 —— 那意味着有一条新的计费路径,
 *  而它的 UI 入口还没有人问过「商家看得见价目吗」。 */
const WRITE_POINT_FILES: Record<string, string> = {
  "lib/actions.ts": "ingestFile → createEntity / addReferenceImages / uploadCandidates / uploadReference",
  "lib/asset-actions.ts": "saveCroppedGeneration —— 裁剪保存落一条全新的 UPLOAD 素材",
  "lib/upload-actions.ts": "finalizeCandidateUploads —— 直传落盘的唯一权威(Otto 的 URL 导入也走它)",
};

/** 源码扩展名。`import … from "./x.js"` 在 ESM 里指的就是 `x.ts` —— 两侧都剥掉扩展名,
 *  `x` / `x.ts` / `x.tsx` / `x.js` 才会归一到同一个模块 id。 */
const SOURCE_EXTENSION = /\.(?:m|c)?[jt]sx?$/;

/** 目录入口。`lib/email/index.ts` 这个文件和 `import … from "@/lib/email"` 这个说明符
 *  指的是同一个模块 —— 不把尾部 `/index` 也归一掉,写点定义在 `lib/foo/index.ts` 的模块
 *  会得到 `lib/foo/index#upload` 这个键,而 UI 那边算出来的是 `lib/foo#upload`,对不上,
 *  整个入口漏报。仓库里现成就有这写法:`lib/better-auth/sender.ts` 从 `@/lib/email` 导入,
 *  真实文件是 `lib/email/index.ts`。 */
const INDEX_SUFFIX = /\/index$/;

function moduleIdOf(rel: string): string {
  return rel.replace(SOURCE_EXTENSION, "").replace(INDEX_SUFFIX, "");
}

/** 把 import/export 说明符解析成仓库内模块 id(已剥扩展名与 `/index`);第三方包返回 null。 */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/")) return moduleIdOf(spec.slice(2));
  if (spec.startsWith(".")) {
    return moduleIdOf(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec)));
  }
  return null;
}

/** 一个动作的身份是**(模块, 导出名)**,不是光一个名字 ——
 *  跨文件闭包会让同名导出出现在不同模块里,只比名字会张冠李戴。 */
function actionKey(moduleId: string, exportName: string): string {
  return `${moduleId}#${exportName}`;
}

/**
 * 普查的输入面。真实项目从磁盘读,夹具从内存读 —— **同一条链路,不是两套实现**。
 * 夹具走的是 `computeCensus` → `knownActionLocalsOf` → 模块键 → 不动点 → `countCallSites`
 * 的完整流程,而不是手工把「已知动作」注进去;注进去的夹具只能证明最后一格,
 * 证不了前面那几格接得上。
 */
interface Sources {
  /** 写点扫描面:哪些文件里可能有 `source: "UPLOAD"`。 */
  allFiles: string[];
  /**
   * 跨文件闭包的迭代面 —— **只有 `lib/**`**,不含 UI。
   *
   * 这不是为了省时间,是语义:UI 组件调了上传动作是**入口**,不是**动作**。
   * 把 `components/` 也放进闭包,`FlowCanvas` 这种组件会因为「调了 uploadReference」
   * 而自己变成一个动作,动作表里就混进一堆组件名 —— 动作表是「谁会落 UPLOAD 素材」,
   * 组件属于「谁该挂披露」,两张表混了,两边都读不懂。
   */
  moduleFiles: string[];
  /** UI 入口候选。 */
  entryFiles: string[];
  parse(rel: string): ts.SourceFile;
}

/** 一个文件里 `import { a as b } from "…"` 的绑定:本地名 → (源模块, 原名)。类型导入不算。 */
function importBindings(file: string, sf: ts.SourceFile): Map<string, { module: string; name: string }> {
  const bindings = new Map<string, { module: string; name: string }>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (st.importClause?.isTypeOnly) continue;
    const moduleId = resolveSpecifier(file, st.moduleSpecifier.text);
    if (!moduleId) continue;
    const named = st.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const el of named.elements) {
      if (el.isTypeOnly) continue;
      bindings.set(el.name.text, { module: moduleId, name: (el.propertyName ?? el.name).text });
    }
  }
  return bindings;
}

/** 这个文件从**已知动作模块**import 进来的本地名(含 `as` 别名)。 */
function knownActionLocalsOf(file: string, sf: ts.SourceFile, actions: ReadonlySet<string>): Set<string> {
  const locals = new Set<string>();
  for (const [local, origin] of importBindings(file, sf)) {
    if (actions.has(actionKey(origin.module, origin.name))) locals.add(local);
  }
  return locals;
}

/**
 * 具名重导出的**别名边**:`(本模块#导出名) ← (源模块#原名)`。
 *
 * 两种写法都要认,而且仓库里两种都有现成的:
 *   · `export { upload as wrap } from "./actions"` —— 带 specifier(`lib/rate-limit-gates.ts`);
 *   · `import { upload } from "./actions"; export { upload };` —— 不带 specifier,
 *     按本地导入绑定解析(`lib/email/index.ts` 是同一族的 barrel 写法)。
 * barrel 转出去的动作还是同一个动作;不认这条边,UI 从 barrel 导入就整支漏报。
 * `export * from "…"` 维持边界:星号没有名字可对,见闭包边界清单第 5 条。
 */
function reexportEdges(
  file: string,
  sf: ts.SourceFile,
): { exported: string; from: { module: string; name: string } }[] {
  const bindings = importBindings(file, sf);
  const edges: { exported: string; from: { module: string; name: string } }[] = [];
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || st.isTypeOnly) continue;
    if (!st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
    const viaModule =
      st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)
        ? resolveSpecifier(file, st.moduleSpecifier.text)
        : null;
    for (const el of st.exportClause.elements) {
      if (el.isTypeOnly) continue;
      const original = (el.propertyName ?? el.name).text;
      if (viaModule) {
        edges.push({ exported: el.name.text, from: { module: viaModule, name: original } });
        continue;
      }
      const bound = bindings.get(original);
      if (bound) edges.push({ exported: el.name.text, from: bound });
    }
  }
  return edges;
}

/**
 * 上传动作的**跨文件传递闭包**,迭代到不动点。
 *
 *   第 0 轮:每个写点文件里的导出 writer = 动作。
 *   第 n 轮:任何模块,只要 ①具名重导出了一个已知动作,或者 ②import 了已知动作且某个
 *           导出函数(经模块内闭包)调到了它 —— 那个导出就成为新动作。
 *
 * 上一版只认「直接来自写点文件的 import」,于是 UI → barrel/wrapper → 写点模块这条链
 * 整支漏报:barrel 的导出压根不会被认成入口。
 */
function computeCensus(src: Sources): { writePointFiles: string[]; actions: Set<string> } {
  const writePointFiles: string[] = [];
  const actions = new Set<string>();
  const noImportedActions: ReadonlySet<string> = new Set();

  for (const file of src.allFiles) {
    const { hasWritePoint, exportedWriters } = uploadWritersOf(src.parse(file), noImportedActions);
    if (!hasWritePoint) continue;
    writePointFiles.push(file);
    for (const name of exportedWriters) actions.add(actionKey(moduleIdOf(file), name));
  }

  for (let changed = true; changed; ) {
    changed = false;
    for (const file of src.moduleFiles) {
      const sf = src.parse(file);
      const moduleId = moduleIdOf(file);
      const add = (exportName: string): void => {
        const key = actionKey(moduleId, exportName);
        if (actions.has(key)) return;
        actions.add(key);
        changed = true;
      };
      for (const edge of reexportEdges(file, sf)) {
        if (actions.has(actionKey(edge.from.module, edge.from.name))) add(edge.exported);
      }
      const locals = knownActionLocalsOf(file, sf, actions);
      if (locals.size === 0) continue;
      for (const name of uploadWritersOf(sf, locals).exportedWriters) add(name);
    }
  }
  return { writePointFiles: writePointFiles.sort(), actions };
}

/** 一个 UI 文件里对上传动作的**调用点数量**。
 *  注释与字符串里出现同名文本不会计数(它们根本不是 CallExpression),`await f(...)` 会计数。
 *  已知边界:把动作传给变量或回调再间接调用,这里数不到 —— 与写点侧同一条边界。 */
function countCallSites(src: Sources, file: string, actions: ReadonlySet<string>): number {
  const sf = src.parse(file);
  const locals = knownActionLocalsOf(file, sf, actions);
  if (locals.size === 0) return 0;
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && locals.has(node.expression.text)) count++;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return count;
}

/** 内存源码面 —— 夹具用。走的函数和真实项目一模一样。 */
function virtualSources(files: Record<string, string>): Sources {
  const all = Object.keys(files).sort();
  const cache = new Map<string, ts.SourceFile>();
  return {
    allFiles: all,
    moduleFiles: all.filter((f) => f.startsWith("lib/")),
    entryFiles: all.filter((f) => f.startsWith("app/") || f.startsWith("components/")),
    parse(rel) {
      let cached = cache.get(rel);
      if (!cached) {
        cache.set(
          rel,
          (cached = ts.createSourceFile(
            rel,
            files[rel] ?? "",
            ts.ScriptTarget.Latest,
            false,
            rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
          )),
        );
      }
      return cached;
    },
  };
}

/** 真实项目的源码面。 */
let realSourcesCache: Sources | null = null;
function realSources(): Sources {
  if (realSourcesCache) return realSourcesCache;
  return (realSourcesCache = {
    allFiles: scannedSourceFiles(),
    moduleFiles: sourceFiles("lib"),
    entryFiles: sourceFiles("app").concat(sourceFiles("components")),
    parse: parseFile,
  });
}

let censusCache: { writePointFiles: string[]; actions: Set<string> } | null = null;
function actionCensus(): { writePointFiles: string[]; actions: Set<string> } {
  if (!censusCache) censusCache = computeCensus(realSources());
  return censusCache;
}

function writePointFiles(): string[] {
  return actionCensus().writePointFiles;
}

/** 会落 image/video UPLOAD 素材的动作,`模块#导出名`,从语法树推导,没有任何手抄名单。 */
function uploadActionKeys(): string[] {
  return [...actionCensus().actions].sort();
}

function callSiteCount(file: string): number {
  return countCallSites(realSources(), file, actionCensus().actions);
}

/** 调了任何一个上传动作的 UI 文件 —— 这就是「上传入口」的定义,不是谁记得住的那三处。 */
function uploadEntryFiles(): string[] {
  return realSources()
    .entryFiles.filter((f) => callSiteCount(f) > 0)
    .sort();
}

/** 登记的动作集合(`模块#导出名`)。跨文件包装也在里面 —— 集合变了就红。 */
const EXPECTED_ACTION_KEYS = [
  "lib/actions#addReferenceImages",
  "lib/actions#createEntity",
  "lib/actions#uploadCandidates",
  "lib/actions#uploadReference",
  "lib/asset-actions#saveCroppedGeneration",
  "lib/upload-actions#finalizeCandidateUploads",
];

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
    const actions = uploadActionKeys();
    expect(actions, "createEntity 只通过 helper 落盘,闭包必须认出它").toContain("lib/actions#createEntity");
    expect(actions, "addReferenceImages 同样只通过 helper 落盘").toContain("lib/actions#addReferenceImages");
    // 而 helper 自己不导出,不会被当成「UI 该去调的动作」漏进入口侧
    expect(actions, "ingestFile 是非导出 helper,不该出现在动作表里").not.toContain("lib/actions#ingestFile");
  });

  /** 用一段合成源码跑一遍模块闭包 —— 夹具比探针值钱:探针跑完就没了,夹具会一直在。 */
  const writersOf = (source: string, imported: string[] = []): string[] =>
    uploadWritersOf(
      ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS),
      new Set(imported),
    ).exportedWriters.sort();

  it("块级作用域:块里的同名声明不该遮蔽块外的写点(否则外层 writer 整支漏报)", () => {
    // `if (flag) { const persist = … }` 里的 persist 出了这个块就不存在了,
    // 后面那句 persist() 指的是模块级那支 —— 而模块级那支写 UPLOAD。
    // 只按函数分作用域的话,块内声明会被登记到整个函数上,把这句调用错误遮蔽掉。
    expect(
      writersOf(`
        function persist() { return { source: "UPLOAD" }; }
        export function upload(flag) {
          if (flag) { const persist = () => null; void persist; }
          return persist();
        }
      `),
      "块内声明遮蔽了块外的写点 —— 作用域链缺了块级这一层",
    ).toEqual(["upload"]);

    // 反向:同一个函数体里的遮蔽是真遮蔽,不能因为加了块级就连这个也认错。
    expect(
      writersOf(`
        function persist() { return { source: "UPLOAD" }; }
        export function upload() {
          const persist = () => null;
          return persist();
        }
      `),
      "同作用域的遮蔽是真遮蔽,不该再连到模块级那支",
    ).toEqual([]);
  });

  it("裸标识符不误连对象方法:成员只能通过 obj.m() 够到", () => {
    // `store.persist()` 要连上;而一个裸的 `persist()` 在这个文件里根本没有词法声明,
    // 它指的是别处的东西 —— 把对象方法登记进裸标识符作用域表就会把它错连成 writer。
    expect(
      writersOf(`
        const store = { persist() { return { source: "UPLOAD" }; } };
        export function memberCall() { return store.persist(); }
        export function bareCall() { return persist(); }
      `),
      "成员调用没连上,或裸标识符被误连到了对象方法",
    ).toEqual(["memberCall"]);
  });

  /** 整条链跑一遍真实普查:`computeCensus` → 模块键 → 不动点 → `countCallSites`。
   *  只有源码在内存里,函数一个都没换 —— 手工把「已知动作」注进去的夹具只能证明最后一格。 */
  const censusOf = (files: Record<string, string>) => {
    const project = virtualSources(files);
    const census = computeCensus(project);
    return {
      actions: [...census.actions].sort(),
      writePoints: census.writePointFiles,
      count: (file: string) => countCallSites(project, file, census.actions),
    };
  };

  it("跨文件包装:UI → wrapper → 写点模块,整条链走真实普查", () => {
    const result = censusOf({
      "lib/actions.ts": 'export function upload(p) { return { id: p, source: "UPLOAD" }; }',
      "lib/wrapper.ts": 'import { upload } from "./actions";\nexport function wrap(p) { return upload(p); }',
      "components/Ui.tsx": 'import { wrap } from "@/lib/wrapper";\nexport function Ui() { return () => wrap("p"); }',
    });
    expect(result.actions, "包装函数没有继承上游动作的身份 —— 跨文件闭包断了").toEqual([
      "lib/actions#upload",
      "lib/wrapper#wrap",
    ]);
    expect(result.count("components/Ui.tsx"), "UI 经 wrapper 的调用没被计到").toBe(1);
  });

  it("目录入口归一:写点在 lib/foo/index.ts,UI 从 @/lib/foo 导入也要算入口", () => {
    // 仓库里现成就有这写法:lib/better-auth/sender.ts 从 "@/lib/email" 导入,
    // 真实文件是 lib/email/index.ts。不归一 `/index`,两边的模块键对不上,整支漏报。
    const result = censusOf({
      "lib/foo/index.ts": 'export function upload(p) { return { id: p, source: "UPLOAD" }; }',
      "components/Ui.tsx": 'import { upload } from "@/lib/foo";\nexport function Ui() { return () => upload("p"); }',
    });
    expect(result.actions, "lib/foo/index.ts 的动作键没有归一到 lib/foo").toEqual(["lib/foo#upload"]);
    expect(result.count("components/Ui.tsx"), "从目录入口导入的调用没被计到").toBe(1);
  });

  it("具名重导出:barrel 两种写法都要把动作转出去(export…from 与 import 后再 export)", () => {
    const viaFrom = censusOf({
      "lib/actions.ts": 'export function upload(p) { return { id: p, source: "UPLOAD" }; }',
      "lib/barrel.ts": 'export { upload as wrap } from "./actions";',
      "components/Ui.tsx": 'import { wrap } from "@/lib/barrel";\nexport function Ui() { return () => wrap("p"); }',
    });
    expect(viaFrom.actions, "`export { x as y } from` 的别名边没接上").toContain("lib/barrel#wrap");
    expect(viaFrom.count("components/Ui.tsx"), "从 barrel 导入的调用没被计到").toBe(1);

    const viaLocal = censusOf({
      "lib/actions.ts": 'export function upload(p) { return { id: p, source: "UPLOAD" }; }',
      "lib/barrel.ts": 'import { upload } from "./actions";\nexport { upload };',
      "components/Ui.tsx": 'import { upload } from "@/lib/barrel";\nexport function Ui() { return () => upload("p"); }',
    });
    expect(viaLocal.actions, "`import 后 export { x }` 的绑定边没接上").toContain("lib/barrel#upload");
    expect(viaLocal.count("components/Ui.tsx"), "从 barrel 导入的调用没被计到").toBe(1);
  });

  it("闭包边界逐条对表:注释里列的五条,这里逐条断言「认不到就是预期」", () => {
    // 边界不是借口,是承诺:说了认不到,就得真的认不到。哪天某条被意外覆盖了,
    // 这里会红 —— 那时该更新的是注释清单,而不是默默把断言删掉。
    expect(
      writersOf(`
        function persist() { return { source: "UPLOAD" }; }
        const alias = persist;
        export function f() { return alias(); }
      `),
      "边界①间接调用:被意外覆盖了,清单该更新",
    ).toEqual([]);

    expect(
      writersOf(`
        function persist() { return { source: "UPLOAD" }; }
        export function makePort() { return { run: () => persist() }; }
      `),
      "边界②返回函数(端口工厂形状):被意外覆盖了,清单该更新",
    ).toEqual([]);

    expect(
      writersOf(`
        const store = { persist() { return { source: "UPLOAD" }; } };
        export function f(key) { return store[key](); }
      `),
      "边界③动态调用:被意外覆盖了,清单该更新",
    ).toEqual([]);

    const crossFile = censusOf({
      "lib/a.ts": 'const store = { persist() { return 1; } };\nexport function fa() { return store.persist(); }',
      "lib/b.ts": 'const other = { persist() { return { source: "UPLOAD" }; } };\nexport function fb() { return other.persist(); }',
    });
    expect(crossFile.actions, "边界④跨文件同名成员:名字对齐越界了,只该在文件内对齐").toEqual([
      "lib/b#fb",
    ]);

    const star = censusOf({
      "lib/actions.ts": 'export function upload(p) { return { id: p, source: "UPLOAD" }; }',
      "lib/star.ts": 'export * from "./actions";',
      "components/Ui.tsx": 'import { upload } from "@/lib/star";\nexport function Ui() { return () => upload("p"); }',
    });
    expect(star.actions, "边界⑤export *:被意外覆盖了,清单该更新").toEqual(["lib/actions#upload"]);
    expect(star.count("components/Ui.tsx"), "边界⑤export *:星号重导出不该被计到").toBe(0);
  });

  it("模块键唯一:两个源码文件不许归一到同一个模块 id(否则动作会张冠李戴)", () => {
    // `lib/foo.ts` 与 `lib/foo/index.ts` 同时存在就会撞键。今天没有,撞了要当场知道。
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const file of scannedSourceFiles()) {
      const id = moduleIdOf(file);
      const previous = seen.get(id);
      if (previous) collisions.push(`${previous} ⇄ ${file} → ${id}`);
      else seen.set(id, file);
    }
    expect(collisions, "两个文件归一到了同一个模块 id").toEqual([]);
  });

  it("扫描范围:普查不看测试文件,也不看 fixtures / __mocks__(样例数据不是计费路径)", () => {
    const offenders = scannedSourceFiles().filter(
      (f) => /\.(?:test|spec)\.tsx?$/.test(f) || /(?:^|\/)(?:fixtures|__fixtures__|__mocks__|__tests__)\//.test(f),
    );
    expect(offenders, "测试或夹具文件混进了普查扫描面").toEqual([]);
    expect(scannedSourceFiles().length, "扫描面空了 —— 目录名或过滤器写错了").toBeGreaterThan(100);
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
      '{ source: "UPLOAD" satisfies string }',
      '{ source: ((("UPLOAD" as const))) }',
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
      "prisma.$executeRaw`INSERT INTO gen(source) VALUES(\'UPLOAD\')`",
    ]) {
      expect(detects(form), `边界清单说不认,实现却认了 —— 清单该更新:${form}`).toBe(false);
    }

    // 这一条不是边界,是**值不对**:`source: "DOWNLOAD"` 本来就不是写点,
    // 认不出它是正确行为,不该跟上面那些「想认但认不到」的混在一起。
    expect(detects('{ source: "DOWNLOAD" }'), "非 UPLOAD 的值被当成了写点").toBe(false);
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
      uploadActionKeys(),
      "上传动作集合变了(含跨文件包装):先追它的 UI 面,再决定挂披露还是写进豁免",
    ).toEqual(EXPECTED_ACTION_KEYS);
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
