/**
 * upload-write-census —— 「谁会落 `source: "UPLOAD"` 素材」这件事的**唯一**一份普查实现(家规 §7.3)。
 *
 * 两道围栏问的是同一件事的两半,所以它们读的必须是同一张普查表:
 *   · `understanding-disclosure.test.ts` —— 这些动作的**披露**有没有人签过字;
 *   · `ingest-dispatch-single-authority.test.ts` —— 这些动作落完行有没有**当场派 ingest**。
 *
 * 普查此前只写在前者的文件体里,后者够不到,于是它退而按**文件**比对 —— 在一个已经登记过的
 * 写点文件里新长一支不派工的上传函数,那道围栏纹丝不动(R3-F25 复审 P2 用一支 `uploadReferenceV2`
 * 当场实证)。收到这里之后,两边按**函数**读同一张表:多一支、少一支、改个名,两边一起红。
 *
 * 这个文件不是测试(文件名不含 `.test.`),vitest 的 `include` 不会把它当测试跑;它住在
 * `__tests__/` 底下,而 `__tests__` 就在 `SKIPPED_DIRECTORIES` 里,所以普查也扫不到它自己
 * (否则下面那些讲解写法的注释与字面量会把它自己算成一条计费路径)。
 *
 * 实现说明、逐条已知边界、以及「为什么用语法树不用正则」全部原样留在各函数的注释里,
 * 从 `understanding-disclosure.test.ts` 一个字没改地搬过来。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** `apps/web`。vitest 的 root 就是这个包,所以 `process.cwd()` 与它同一个目录。 */
export const WEB_ROOT = process.cwd();
export const codeOf = (rel: string) => readFileSync(path.join(WEB_ROOT, rel), "utf8");

// ────────────────────────── 入口普查(结构性围栏) ──────────────────────────
// 手抄的入口清单是这一票的病根本身:②段照 §7.3 点名的三处挂完就收工,而 Canvas 拖放
// (FlowCanvas → uploadReference)和素材详情的裁剪保存(DetailPanel → saveCroppedGeneration)
// 一直在落同样会被理解计费的 UPLOAD 素材,没人再去数一遍。下面两张表都由测试**当场扫出来**,
// 只有「为什么豁免」这一栏是人写的。

/** 扫描要跳过的目录。测试与夹具里到处都是假的写点和假的动作调用 —— 把它们算进普查,
 *  围栏就会被自己的样例数据喂出一堆不存在的计费路径,然后逼人去更新登记表。 */
export const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "__tests__",
  "__mocks__",
  "__fixtures__",
  "fixtures",
  "public",
  ".next",
]);

/** 测试文件本身(与目录无关,`foo.test.ts` 摆在源码目录里一样跳过)。 */
export const TEST_FILE = /\.(?:test|spec)\.tsx?$/;

/** `apps/web` 里递归列出**产品源码**文件。 */
export function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(WEB_ROOT, dir), { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(rel, out);
    else if (/\.tsx?$/.test(entry.name) && !TEST_FILE.test(entry.name)) out.push(rel);
  }
  return out;
}

/**
 * `apps/web` 下的**全部产品源码目录**,当场列出来而不是写死三个。
 *
 * 写死 `lib` / `app` / `components` 会留下一个大洞:一次再常规不过的「把上传逻辑抽成
 * `hooks/useUpload.ts`」就能让整条链跑到扫描面之外 —— 那个文件不在任何一张表里,
 * UI 调它的包装函数计零,三张表纹丝不动,静默全绿。目录是长出来的,所以这里得会长。
 */
export function productDirectories(): string[] {
  return readdirSync(WEB_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .filter((dir) => sourceFiles(dir).length > 0)
    .sort();
}

/** 普查的扫描面:`apps/web` 下所有产品源码。 */
export function scannedSourceFiles(): string[] {
  return productDirectories().flatMap((dir) => sourceFiles(dir));
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
export function unwrap(expr: ts.Expression): ts.Expression {
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
export function literalTextOf(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** 对象字面量里一个属性的键名:`source`、`"source"`、以及计算键 `["source"]`。 */
export function propertyKeyText(name: ts.PropertyName): string | null {
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
export function isUploadWrite(node: ts.Node): boolean {
  if (!ts.isPropertyAssignment(node)) return false;
  if (propertyKeyText(node.name) !== "source") return false;
  return literalTextOf(unwrap(node.initializer)) === "UPLOAD";
}

/**
 * 文件对外暴露的名字 → 它在文件内的本地名。
 *
 * `default` 也是一个导出名,而且是最容易被漏掉的那个:`export default function upload(){}`
 * 对外叫 `default`(导入方写 `import anything from "…"`),照 `upload` 记就跟上游对不上,
 * `export { default as x } from "…"` 这条边永远接不到东西。四种写法统一成键 `模块#default`:
 *   · `export default function upload(){}`      · `export default upload;`
 *   · `export { x as default }`                 · `export { default as x } from "…"`(在 reexportEdges)
 * 匿名默认导出 `export default function(){}` / `export default () => {}` 也认:它们没有**本地**名,
 * 但对外的名字就是 `default`,所以按合成名 `default` 进表(见 functionDeclarationOf)。
 */
export function exportedNames(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const st of sf.statements) {
    const modifiers = ts.canHaveModifiers(st) ? ts.getModifiers(st) ?? [] : [];
    const exported = modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(st) && exported) {
      if (st.name) out.set(isDefault ? "default" : st.name.text, st.name.text);
      // 匿名默认导出:对外名与本地合成名都是 default。
      else if (isDefault) out.set("default", "default");
    }
    if (ts.isVariableStatement(st) && exported) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) out.set(d.name.text, d.name.text);
      }
    }
    if (ts.isExportAssignment(st) && !st.isExportEquals) {
      const value = unwrap(st.expression);
      if (ts.isIdentifier(value)) out.set("default", value.text);
      // `export default () => {}` —— 合成名 default(见 functionDeclarationOf)。
      else if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) out.set("default", "default");
    }
    if (ts.isExportDeclaration(st) && !st.isTypeOnly && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        if (el.isTypeOnly) continue;
        out.set(el.name.text, (el.propertyName ?? el.name).text);
      }
    }
  }
  return out;
}

/** 调用图上的一个节点 = **一处具体的函数声明**,不是一个名字。 */
export interface FnNode {
  name: string;
  /** 这个函数体自己的作用域 id。 */
  bodyScope: number;
  writes: boolean;
}

/** 词法作用域。函数体是作用域,`{}` 块、for、switch、catch 也是 ——
 *  少了块级这一层,`if (flag) { const persist = () => {} }` 里的声明会被登记到整个函数上,
 *  把函数体后面那句 `persist()` 错误地遮蔽掉,外层真正写 UPLOAD 的那支就此漏报。 */
export interface Scope {
  parent: number | null;
  decls: Map<string, number[]>;
}

/** 块级作用域节点。`ts.isBlock` 覆盖函数体与裸块,其余是自带作用域的语句形式。 */
export function isBlockScope(node: ts.Node): boolean {
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

/** 这个声明带着 `export default` 吗。 */
export function isDefaultExported(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node) ?? [];
  return (
    modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
    modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
  );
}

/** 一处函数声明的名字,以及它是**词法绑定**还是**成员**。
 *  分开是必要的:`const store = { persist(){} }` 里的 `persist` 只能通过 `store.persist()`
 *  够到,它不该出现在裸标识符 `persist()` 的作用域表里(否则会误连)。 */
export function functionDeclarationOf(node: ts.Node): { name: string; member: boolean } | undefined {
  const isFunctionValue = (expr: ts.Expression | undefined): boolean => {
    if (!expr) return false;
    const inner = unwrap(expr);
    return ts.isArrowFunction(inner) || ts.isFunctionExpression(inner);
  };
  if (ts.isFunctionDeclaration(node)) {
    if (node.name) return { name: node.name.text, member: false };
    // 匿名默认导出 `export default function (…) {}`:没有本地名,但它对外**有**名字 ——
    // 就叫 default。给它这个合成名,它才能进调用图、进闭包、配出 `模块#default` 动作键。
    return isDefaultExported(node) ? { name: "default", member: false } : undefined;
  }
  // `export default () => {}` / `export default function () {}`(表达式形态)同理。
  if (ts.isExportAssignment(node) && !node.isExportEquals) {
    const value = unwrap(node.expression);
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
      return { name: "default", member: false };
    }
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
export interface CallRecord {
  from: number;
  scope: number;
  name: string;
  member: boolean;
  /** `ns.upload()` 里的 `ns` —— 用来分辨「命名空间导入的动作」与「本文件的对象方法」。 */
  objectName?: string;
}

/** 一个文件里「哪些名字调用起来等于调了已知动作」。 */
export interface ImportedActions {
  /** 裸标识符:`import { upload }` / `import upload from` / 别名。 */
  locals: Set<string>;
  /** 命名空间本地名 → 该模块里已知是动作的导出名(`import * as ns` / `await import()`)。 */
  namespaces: Map<string, Set<string>>;
}

export const NO_IMPORTED_ACTIONS: ImportedActions = { locals: new Set(), namespaces: new Map() };

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
 *      (`export { a as b } from "…"`、import 之后再 `export { a }`、
 *      `export { default as a } from "…"`)都已经认了,见 `reexportEdges`。
 *
 * 导入/导出侧另有两条,列在 `moduleBindingsOf`:动态说明符不是静态字符串、把命名空间解构后
 * 再调用。
 *
 * 这七条各有一条负向断言钉着(「闭包边界逐条对表」与「导入/导出的已知边界」两条测试),
 * 说了认不到就得真的认不到 —— 哪天某条被意外覆盖,那里会红,该更新的是这份清单,
 * 不是默默删掉断言。
 */
export function uploadWritersOf(
  sf: ts.SourceFile,
  imported: ImportedActions,
  /**
   * 「什么算**种子**」这一格是参数,不是写死的 —— 图是同一张,问的问题有两个(R3-F25 复审 P2):
   *   · 披露普查问「谁落 UPLOAD 素材」,种子 = `isUploadWrite`(默认值,行为一字未变);
   *   · ingest 围栏问「谁够得到 `dispatchIngest`」,种子 = 无(`() => false`),只靠
   *     `imported` 那一条边把跨模块的那个函数接进来,于是答案是**本模块内传递闭包**之后
   *     真正调得到它的那些导出 —— `finalizeCandidateUploads` 经 `…InFrame` 转一手也算。
   * 两个问题共用同一套作用域解析与不动点,所以它们的精度与已知边界永远一致。
   */
  seed: (node: ts.Node) => boolean = isUploadWrite,
): { hasWritePoint: boolean; writePointFunctions: number; exportedWriters: string[] } {
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
    if (seed(node)) {
      hasWritePoint = true;
      if (childFn !== null) nodes[childFn].writes = true;
    }
    if (ts.isCallExpression(node) && childFn !== null) {
      const callee = unwrap(node.expression);
      if (ts.isIdentifier(callee)) {
        callRecords.push({ from: childFn, scope: childScope, name: callee.text, member: false });
      } else if (ts.isPropertyAccessExpression(callee)) {
        const object = unwrap(callee.expression);
        callRecords.push({
          from: childFn,
          scope: childScope,
          name: callee.name.text,
          member: true,
          objectName: ts.isIdentifier(object) ? object.text : undefined,
        });
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
    // `ns.upload()`:命名空间绑定优先于本文件的同名成员 —— 它指的是另一个模块的导出。
    if (record.member && record.objectName) {
      const viaNamespace = imported.namespaces.get(record.objectName);
      if (viaNamespace?.has(record.name)) {
        writers.add(record.from);
        continue;
      }
    }
    const targets = record.member
      ? members.get(record.name) ?? []
      : resolveLexical(record.scope, record.name);
    if (targets.length === 0) {
      // 本文件里找不到这个名字 —— 如果它是 import 进来的已知动作,这一支就是 writer。
      if (!record.member && imported.locals.has(record.name)) writers.add(record.from);
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
  return {
    hasWritePoint,
    // **写点函数**的个数(函数体里直接写 UPLOAD 的那些,不含只是转调的)。
    // 只比文件名集合不够:在既有写点文件里再加一支写 UPLOAD 的函数,文件集合纹丝不动。
    writePointFunctions: nodes.filter((node) => node.writes).length,
    exportedWriters,
  };
}

/** 解析一次就够。全仓源码文件全量 AST 扫描是毫秒级的量级,所以下面不做任何文本预筛。 */
const parseCache = new Map<string, ts.SourceFile>();
export function parseFile(rel: string): ts.SourceFile {
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

/** 源码扩展名。`import … from "./x.js"` 在 ESM 里指的就是 `x.ts` —— 两侧都剥掉扩展名,
 *  `x` / `x.ts` / `x.tsx` / `x.js` 才会归一到同一个模块 id。 */
export const SOURCE_EXTENSION = /\.(?:m|c)?[jt]sx?$/;

/** 目录入口。`lib/email/index.ts` 这个文件和 `import … from "@/lib/email"` 这个说明符
 *  指的是同一个模块 —— 不把尾部 `/index` 也归一掉,写点定义在 `lib/foo/index.ts` 的模块
 *  会得到 `lib/foo/index#upload` 这个键,而 UI 那边算出来的是 `lib/foo#upload`,对不上,
 *  整个入口漏报。仓库里现成就有这写法:`lib/better-auth/sender.ts` 从 `@/lib/email` 导入,
 *  真实文件是 `lib/email/index.ts`。 */
export const INDEX_SUFFIX = /\/index$/;

export function moduleIdOf(rel: string): string {
  return rel.replace(SOURCE_EXTENSION, "").replace(INDEX_SUFFIX, "");
}

/** 把 import/export 说明符解析成仓库内模块 id(已剥扩展名与 `/index`);第三方包返回 null。 */
export function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/")) return moduleIdOf(spec.slice(2));
  if (spec.startsWith(".")) {
    return moduleIdOf(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec)));
  }
  return null;
}

/** 一个动作的身份是**(模块, 导出名)**,不是光一个名字 ——
 *  跨文件闭包会让同名导出出现在不同模块里,只比名字会张冠李戴。 */
export function actionKey(moduleId: string, exportName: string): string {
  return `${moduleId}#${exportName}`;
}

/**
 * 普查的输入面。真实项目从磁盘读,夹具从内存读 —— **同一条链路,不是两套实现**。
 * 夹具走的是 `computeCensus` → `importedActionsOf` → 模块键 → 不动点 → `countCallSites`
 * 的完整流程,而不是手工把「已知动作」注进去;注进去的夹具只能证明最后一格,
 * 证不了前面那几格接得上。
 */
export interface Sources {
  /** 写点扫描面:哪些文件里可能有 `source: "UPLOAD"`。 */
  allFiles: string[];
  /** 跨文件闭包的迭代面 —— **全部产品源码**,包括将来才长出来的目录(hooks/ 之类)。 */
  moduleFiles: string[];
  /** UI 入口候选。 */
  entryFiles: string[];
  parse(rel: string): ts.SourceFile;
}

/** 一个文件里的模块绑定:本地名 → 它到底指向哪个模块的哪个导出。 */
export interface ModuleBindings {
  /** 裸标识符绑定。`import { a as b }` → b→(m,a);`import x from` → x→(m,"default")。 */
  named: Map<string, { module: string; name: string }>;
  /** 命名空间绑定。`import * as ns` / `const m = await import()` / `import().then(m => …)`。 */
  namespaces: Map<string, string>;
}

/** `import("…")` / `await import("…")` 的目标模块(说明符必须是静态字符串)。 */
export function dynamicImportModuleOf(file: string, expr: ts.Expression | undefined): string | null {
  if (!expr) return null;
  let inner = unwrap(expr);
  if (ts.isAwaitExpression(inner)) inner = unwrap(inner.expression);
  if (!ts.isCallExpression(inner) || inner.expression.kind !== ts.SyntaxKind.ImportKeyword) return null;
  const arg = inner.arguments[0];
  return arg && ts.isStringLiteral(arg) ? resolveSpecifier(file, arg.text) : null;
}

/**
 * 收集一个文件的模块绑定。
 *
 * 静态 import 只看 statements 就够;动态 import 得走全树,两种常见形态各认一种:
 *   · `const m = await import("./actions"); m.upload();`
 *   · `import("./actions").then((m) => m.upload());`
 * 命名空间绑定按**文件**记(不按作用域)—— 这会多连边不会少连边,与成员对齐同一个方向。
 * **已知边界(穷举)**:
 *   1. 说明符不是静态字符串的动态 import(`import(pathVar)`)—— 解析器不知道它指向哪。
 *   2. 把命名空间解构或转手(`const { upload } = await import(…)`、`const f = ns.upload`)。
 *   3. `require()` / `module.exports` 这类 CJS 写法(仓库全 ESM,今天不存在)。
 * 前两条各有一条负向断言钉着(「导入/导出的已知边界」那条测试)。
 * (匿名默认导出曾在这份清单里,现已认 —— 见「匿名默认导出也是动作」那条正向夹具。)
 */
export function moduleBindingsOf(file: string, sf: ts.SourceFile): ModuleBindings {
  const named = new Map<string, { module: string; name: string }>();
  const namespaces = new Map<string, string>();

  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (st.importClause?.isTypeOnly) continue;
    const moduleId = resolveSpecifier(file, st.moduleSpecifier.text);
    if (!moduleId) continue;
    const clause = st.importClause;
    if (!clause) continue;
    if (clause.name) named.set(clause.name.text, { module: moduleId, name: "default" });
    const bindings = clause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.set(bindings.name.text, moduleId);
      continue;
    }
    for (const el of bindings.elements) {
      if (el.isTypeOnly) continue;
      named.set(el.name.text, { module: moduleId, name: (el.propertyName ?? el.name).text });
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const moduleId = dynamicImportModuleOf(file, node.initializer);
      if (moduleId) namespaces.set(node.name.text, moduleId);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const access = node.expression;
      if (access.name.text === "then") {
        const moduleId = dynamicImportModuleOf(file, access.expression);
        const handler = node.arguments[0];
        if (moduleId && handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
          const param = handler.parameters[0];
          if (param && ts.isIdentifier(param.name)) namespaces.set(param.name.text, moduleId);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  return { named, namespaces };
}

/** 这个文件里「调用起来等于调了已知动作」的名字。 */
export function importedActionsOf(file: string, sf: ts.SourceFile, actions: ReadonlySet<string>): ImportedActions {
  const bindings = moduleBindingsOf(file, sf);
  const locals = new Set<string>();
  for (const [local, origin] of bindings.named) {
    if (actions.has(actionKey(origin.module, origin.name))) locals.add(local);
  }
  const namespaces = new Map<string, Set<string>>();
  for (const [local, moduleId] of bindings.namespaces) {
    const prefix = `${moduleId}#`;
    const exportNames = new Set<string>();
    for (const key of actions) {
      if (key.startsWith(prefix)) exportNames.add(key.slice(prefix.length));
    }
    if (exportNames.size > 0) namespaces.set(local, exportNames);
  }
  return { locals, namespaces };
}

/**
 * 具名重导出的**别名边**:`(本模块#导出名) ← (源模块#原名)`。
 *
 * 三种写法都要认,仓库里前两种都有现成的:
 *   · `export { upload as wrap } from "./actions"` —— 带 specifier(`lib/rate-limit-gates.ts`);
 *   · `import { upload } from "./actions"; export { upload };` —— 按本地导入绑定解析
 *     (`lib/email/index.ts` 是同一族的 barrel 写法);
 *   · `export { default as upload } from "./actions"` —— 上游那一头得真的产出 `#default` 键,
 *     否则这条边表面在、实际永远接不到东西(见 exportedNames 的 default 处理)。
 * `export * from "…"` 维持边界:星号没有名字可对,见闭包边界清单。
 */
export function reexportEdges(
  file: string,
  sf: ts.SourceFile,
): { exported: string; from: { module: string; name: string } }[] {
  const bindings = moduleBindingsOf(file, sf).named;
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
 *   第 n 轮:任何模块,只要 ①具名重导出了一个已知动作,或者 ②import 了已知动作(裸标识符、
 *           默认导入、命名空间、静态说明符的动态 import 都算)且某个导出函数经模块内闭包
 *           调到了它 —— 那个导出就成为新动作。
 *
 * **传播面 = 全部产品源码目录**,不是只有 `lib/**`。只在 lib 里传播会留一个洞:
 * 一次常规的「抽成 `hooks/useUpload.ts`」或「放个 `components/upload-helper.ts`」就能让
 * 包装函数落在传播面之外,UI 调它计零、三张表纹丝不动。
 *
 * **但登记表只收 `lib/**` 的动作**(见 `uploadActionKeys`):UI 组件调了上传动作是**入口**,
 * 不是**动作**。两者混在一张表里,动作表会长出一串组件名,两边都读不懂。
 */
export function computeCensus(src: Sources): {
  writePointFiles: string[];
  writePointCounts: Record<string, number>;
  actions: Set<string>;
} {
  const writePointFiles: string[] = [];
  const writePointCounts: Record<string, number> = {};
  const actions = new Set<string>();

  for (const file of src.allFiles) {
    const { hasWritePoint, writePointFunctions, exportedWriters } = uploadWritersOf(
      src.parse(file),
      NO_IMPORTED_ACTIONS,
    );
    if (!hasWritePoint) continue;
    writePointFiles.push(file);
    writePointCounts[file] = writePointFunctions;
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
      const imported = importedActionsOf(file, sf, actions);
      if (imported.locals.size === 0 && imported.namespaces.size === 0) continue;
      for (const name of uploadWritersOf(sf, imported).exportedWriters) add(name);
    }
  }
  return { writePointFiles: writePointFiles.sort(), writePointCounts, actions };
}

/** 一个 UI 文件里对上传动作的**调用点数量**。
 *  裸标识符调用与 `ns.upload()` 都计;注释与字符串里出现同名文本不会计数(它们不是
 *  CallExpression);`await f(...)` 会计数。
 *  已知边界:把动作传给变量或回调再间接调用,这里数不到 —— 与写点侧同一条边界。 */
export function countCallSites(src: Sources, file: string, actions: ReadonlySet<string>): number {
  const sf = src.parse(file);
  const imported = importedActionsOf(file, sf, actions);
  if (imported.locals.size === 0 && imported.namespaces.size === 0) return 0;
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (ts.isIdentifier(callee) && imported.locals.has(callee.text)) count++;
      else if (ts.isPropertyAccessExpression(callee)) {
        const object = unwrap(callee.expression);
        if (ts.isIdentifier(object) && imported.namespaces.get(object.text)?.has(callee.name.text)) count++;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return count;
}

/** 内存源码面 —— 夹具用。走的函数和真实项目一模一样。 */
export function virtualSources(files: Record<string, string>): Sources {
  const all = Object.keys(files).sort();
  const cache = new Map<string, ts.SourceFile>();
  return {
    allFiles: all,
    moduleFiles: all,
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
export function realSources(): Sources {
  if (realSourcesCache) return realSourcesCache;
  return (realSourcesCache = {
    allFiles: scannedSourceFiles(),
    moduleFiles: scannedSourceFiles(),
    entryFiles: sourceFiles("app").concat(sourceFiles("components")),
    parse: parseFile,
  });
}

let censusCache: ReturnType<typeof computeCensus> | null = null;
export function actionCensus(): ReturnType<typeof computeCensus> {
  if (!censusCache) censusCache = computeCensus(realSources());
  return censusCache;
}

export function writePointFiles(): string[] {
  return actionCensus().writePointFiles;
}

/** **登记表**收的动作:`模块#导出名`,从语法树推导,没有任何手抄名单。
 *  只取 `lib/**` —— 传播集里还有 UI 侧的包装函数,那些属于「谁该挂披露」不属于「动作」。 */
export function uploadActionKeys(): string[] {
  return [...actionCensus().actions].filter((key) => key.startsWith("lib/")).sort();
}


export function callSiteCount(file: string): number {
  return countCallSites(realSources(), file, actionCensus().actions);
}

/** 调了任何一个上传动作的 UI 文件 —— 这就是「上传入口」的定义,不是谁记得住的那三处。 */
export function uploadEntryFiles(): string[] {
  return realSources()
    .entryFiles.filter((f) => callSiteCount(f) > 0)
    .sort();
}
