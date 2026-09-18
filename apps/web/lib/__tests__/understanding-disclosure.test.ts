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
 *      这条链整支都在围栏里,而不是只看直接来自写点文件的 import。传播面是**全部产品
 *      源码目录**(会自己长,新开一个 `hooks/` 不需要有人记得来改这里),而登记表只收
 *      `lib/**`。模块键归一了目录入口(`lib/foo/index.ts` 与 `@/lib/foo` 同一个模块)、
 *      默认导出(统一记成 `模块#default`)与具名重导出;调用点除裸标识符外,还认
 *      `ns.upload()` 与静态说明符的动态 import。上面这些写法仓库里多数都有现成的。
 *      §7.3 明写「施工首件事用 grep 复核入口清单」—— 手抄的清单只在抄它的那一天是对的,
 *      而漏挂一个入口的代价,是商家被收一笔他从没在任何屏幕上见过的钱(顾问复审 2026-09-02
 *      就是这样抓到 Canvas 拖放与裁剪保存两个漏网入口的)。EditDesk 单列豁免:只收音频,
 *      音频不在收费的三类里。
 *   ④ 级联说明必须在(计费四则②):一张图被认出是菜单/价目表时会**再收一次**,
 *      只报第一段价是「真话,但仍然是骗人」。
 *
 * 另外两面:billing 价目区(同源、措辞更详)与 Otto 的 URL 导入(无 UI,披露走动作前报价)。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

import {
  UNDERSTANDING_PRICED_INTERNAL,
  displayCredits,
  pricedUnderstandingCredits,
} from "@fikirtive/core/spend";
import { creditsLabel } from "@/lib/credit-format";
import { copyLines, HAND_TYPED_CREDITS } from "./helpers/price-literal-fence";
// 写点/动作/入口的**普查**住在 `helpers/upload-write-census.ts` —— 与 ingest 派工那道围栏
// (`ingest-dispatch-single-authority.test.ts`)共用同一份实现,两边按同一张表按函数对账。
import {
  WEB_ROOT,
  codeOf,
  scannedSourceFiles,
  unwrap,
  literalTextOf,
  isUploadWrite,
  functionDeclarationOf,
  uploadWritersOf,
  parseFile,
  moduleIdOf,
  resolveSpecifier,
  computeCensus,
  countCallSites,
  virtualSources,
  actionCensus,
  writePointFiles,
  uploadActionKeys,
  callSiteCount,
  uploadEntryFiles,
} from "./helpers/upload-write-census";


/** 一件某类素材的报价,**按测试自己现算的口径** —— 与被测代码同一个函数,不是同一份字面量。 */
const priceOf = (kind: keyof typeof UNDERSTANDING_PRICED_INTERNAL) =>
  creditsLabel(displayCredits(pricedUnderstandingCredits(kind)));

/** 「手抄的钱数」与「只扫商家读得到的那部分」两条判据住在 `helpers/price-literal-fence.ts` ——
 *  四份成本小字围栏共用同一份,不再各抄一遍(判官 #1227 P2-3 ＝ #1219 P2-4)。 */

/**
 * 「上传那一刻就锁价」这一族**假话**。
 *
 * 产品做不到:快照是**扫描器建 AssetUnderstanding 行**那一刻写的(`apps/worker/src/jobs/
 * understand.ts` —— `priceInternalSnapshot: pricedUnderstandingCredits(kind)` 就在 create 里,
 * 而扫描器每轮至多捡 `UNDERSTAND_SCAN_BATCH = 25` 行、每分钟一轮)。所以 2000 张的批量上传要
 * 八十分钟才建完行,**排队期间调价,后面那些文件按新价建行**。
 *
 * 跨厂复审 2026-09-02 的唯一 P1 就是打这一条:第一版把它写成「(normally the moment you
 * upload)」,句子形式上说了「排队时」,读起来还是「上传即锁价」—— 括号里那半句把前半句抵消掉了。
 * 所以这里不再钉「必须出现某句好话」,改成**禁止整整一族说法**,五处商家/Otto 能读到的报价句
 * 逐处扫。列表是穷举的:每一条都是曾经真的写在产品里、或者最容易被下一个人重新写出来的那句。
 */
const FALSE_LOCK_PHRASES = [
  "moment you upload",
  "locked in on upload",
  "the moment it lands",
  "at upload time",
  "price shown when you upload",
  "locked in the moment",
] as const;

/** 新口径必须自己说全两半:**哪一刻的价**(排队去理解时)+ **它可能不是上传那一刻**(积压)。
 *  只说前一半,商家默认会把它读成上传那一刻 —— 这正是被打回的那次。 */
const QUEUED_PHRASE = "queued for understanding";
const BACKLOG_PHRASE = "backlog";

/** 一句报价文案的完整判定:禁语族一条不许中,两个必须词一个不许少。 */
function assertQueuedNotUploadWording(label: string, sentence: string): void {
  const text = sentence.toLowerCase();
  for (const phrase of FALSE_LOCK_PHRASES) {
    expect(
      text,
      `${label} 又出现了「${phrase}」—— 那是「上传即锁价」的说法,而快照是扫描器建行时才写的`,
    ).not.toContain(phrase);
  }
  expect(text, `${label} 没说清是**哪一刻**的价(缺「${QUEUED_PHRASE}」)`).toContain(QUEUED_PHRASE);
  expect(
    text,
    `${label} 只说了「排队时」却没说排队**可能要等**(缺「${BACKLOG_PHRASE}」)—— 少了这一半,`
      + "商家仍然会把它读成上传那一刻",
  ).toContain(BACKLOG_PHRASE);
}

/** 写点所在的文件。多一个文件开始写 UPLOAD 素材,这里当场红 —— 那意味着有一条新的计费路径,
 *  而它的 UI 入口还没有人问过「商家看得见价目吗」。 */
const WRITE_POINT_FILES: Record<string, { note: string; writePointFunctions: number }> = {
  "lib/actions.ts": {
    // 钱引擎⑤A 2026-09-02:uploadCandidates 与 addReferenceImages 两个零调用方的导出动作已删
    // (变更登记「A9 披露入口补挂」的待清理项),写点从三支降到两支 —— 这两个数字是普查算出来的,
    // 不是手抄的:改这里之前先看测试打出来的实际值。
    note: "ingestFile / uploadReference 两处直接落行,再经 createEntity 转出去",
    writePointFunctions: 2,
  },
  "lib/asset-actions.ts": {
    note: "saveCroppedGeneration —— 裁剪保存落一条全新的 UPLOAD 素材",
    writePointFunctions: 1,
  },
  "lib/upload-actions.ts": {
    note: "finalizeCandidateUploads —— 直传落盘的唯一权威(Otto 的 URL 导入也走它)",
    writePointFunctions: 1,
  },
};

/** 登记的动作集合(`模块#导出名`)。跨文件包装也在里面 —— 集合变了就红。 */
const EXPECTED_ACTION_KEYS = [
  "lib/actions#createEntity",
  "lib/actions#uploadReference",
  "lib/asset-actions#saveCroppedGeneration",
  "lib/upload-actions#finalizeCandidateUploads",
];

/**
 * 会落 UPLOAD 素材、因此会触发自动理解计费的 UI 入口:文件 → 说明 → **该文件里的上传调用点数量**。
 *
 * R3-F06(Founder 2026-09-14)之前这张表叫「必须挂披露的入口」,每一处都挂着同一行价目小字。
 * 那一行整批撤了,但**这张表本身没有失去意义**:它钉的是「有几个 UI 入口会落 UPLOAD 素材」,
 * 而那件事与展不展示价目无关。多一个入口仍旧必须有人签字 —— 从前签的是「披露覆盖到了吗」,
 * 现在签的是「这条计费路径是有意新增的吗」。
 *
 * 计数这一栏是围栏语义,不是逐点证明:grep 证不了「第 3 个调用点是什么形状」,但它能证
 * 「调用点数量变了」。变了就红,评审者必须先确认那条新路径是有意的,再来更新这个数字 ——
 * 也就是把「在 OttoChatStream 里再塞一个上传弹层」从一次静默的合并,变成一次签字的改动。
 */
const UPLOAD_ENTRIES = [
  ["components/asset/DetailPanel.tsx", "素材详情的裁剪保存(saveCroppedGeneration)", 1],
  ["components/canvas/FlowCanvas.tsx", "Canvas 拖放上传(uploadReference)", 1],
  ["components/otto/OttoChatStream.tsx", "Otto 对话的附件入口", 3],
  ["components/otto/TemplateModal.tsx", "模板的产品图上传", 1],
  ["components/otto/stuff/AddAssetDialog.tsx", "素材库的多图上传", 2],
  // FRONT §7.3⑨(起步页参考契约):Create 起步页从此有 Upload image。它落的是同一行
  // `Generation(source: "UPLOAD")`,自动理解照样会跑 —— 所以它是这张表上的一员。
  ["components/start-something/StartSomething.tsx", "Create 起步页的 Add context 上传", 1],
] as const;

/** 取一个具名函数的源码片段(豁免 guard 要核的是**处理函数**,不是整份文件)。 */
function functionSourceOf(file: string, name: string): string | null {
  const sf = parseFile(file);
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (functionDeclarationOf(node)?.name === name) {
      found = sf.text.slice(node.getStart(sf), node.end);
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

/** 断言一个节点是某种语法形态,并把类型收窄 —— 失败时给出人能看懂的话。 */
function must<T extends ts.Node>(
  node: ts.Node | undefined,
  is: (n: ts.Node) => n is T,
  message: string,
): T {
  expect(node !== undefined && is(node), message).toBe(true);
  return node as T;
}

/**
 * 整份文件里叫这个名字的变量声明**有几支** —— 函数体里、块里、嵌套里的全算。
 *
 * (Codex #1118 第十轮 P2)上一版的 `initializerOf` 递归扫整棵树、取**第一个**同名变量就收工。
 * 那是可以被排版顺序骗过去的:把真名单改成手抄的六个扩展名 + mp4,再在**它前面**放一个函数,
 * 函数里留一支同名的、写法完全正确的诱饵 —— DFS 先撞上诱饵,整套结构检查照样全绿,而
 * `clip.mp4` 被放行、服务端落 `video/mp4`、建 video-qa 收费行,这个入口却不挂披露。
 * 所以名字得是**唯一**的:多一支(哪怕是函数内的局部变量)就红,由人来判哪一支才是白名单。
 */
function declarationCountOf(sf: ts.SourceFile, name: string): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) count++;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return count;
}

/**
 * **模块顶层** `const <name> = …` 的初始化表达式节点(不是文本)。
 *
 * 顶层与 const 两件都是硬条件:函数体里的同名变量不是模块白名单(它只在那一次调用里存在),
 * 而 `let` / `var` 声明的名单意味着这个集合可以被整支换掉 —— 结构检查看的是初始化那一刻的写法,
 * 换掉之后它一个字都不知道。
 */
function moduleConstInitializerOf(
  sf: ts.SourceFile,
  name: string,
): { node: ts.Expression; text: string } | null {
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    if (!(st.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const decl of st.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== name || !decl.initializer) continue;
      const node = decl.initializer;
      return { node, text: sf.text.slice(node.getStart(sf), node.end) };
    }
  }
  return null;
}

/**
 * 对这个集合的**变异调用**(`X.add(…)` / `X.delete(…)`),原样返回源码片段。
 *
 * 结构检查钉的是「这个 Set 是怎么算出来的」。算得再对,初始化之后补一句
 * `AUDIO_UPLOAD_EXTENSIONS.add("mp4")`,白名单照样多一个 video 扩展名 —— 而上一版的检查
 * 到 `new Set(...)` 那一层就结束了,一个字都看不见。
 */
function mutationCallsOf(sf: ts.SourceFile, name: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === name &&
      (node.expression.name.text === "add" || node.expression.name.text === "delete")
    ) {
      found.push(sf.text.slice(node.getStart(sf), node.end));
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

/**
 * `import { … } from "…"` 里一个**本地名**的来源:说明符**原样**返回(不解析成模块 id),
 * 外加它在来源模块里**真正叫什么**(`propertyName ?? name`)。
 *
 * (Codex #1118 第十轮 P2)上一版只比本地名与模块路径,忽略 `propertyName` —— 于是
 * `import { SOME_OTHER as UPLOAD_EXTS } from "@fikirtive/core/upload"` 全绿:模块对、本地名对,
 * 而真正被过滤的是 core 里另一个完全不相干的导出。改名进来的名单不是 core 的上传扩展名权威,
 * 所以调用方要逐字核 `imported`。
 */
function importOriginOf(
  sf: ts.SourceFile,
  local: string,
): { module: string; imported: string } | null {
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const bindings = st.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if (el.name.text !== local) continue;
      return { module: st.moduleSpecifier.text, imported: (el.propertyName ?? el.name).text };
    }
  }
  return null;
}

/** 一个名字在这个文件里被**声明成值**的次数:变量、函数、类都算。
 *  `declarationCountOf` 只数变量 —— 而「自己重写一份同名函数」正是要挡的那种写法。 */
function valueDeclarationCountOf(sf: ts.SourceFile, name: string): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    const named =
      (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) ||
      (ts.isFunctionDeclaration(node) && node.name?.text === name) ||
      (ts.isClassDeclaration(node) && node.name?.text === name);
    if (named) count++;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return count;
}

/**
 * 这个文件**依赖**的模块说明符:静态 import、`export … from` 再导出、以及说明符是静态字符串的
 * 动态 `import()`。
 *
 * **已知边界(非恶意代码限制)**:说明符由字符串拼接或变量给出的动态 import
 * (`import("next/" + x)`、`import(mod)`)这里认不到。这道围栏挡的是「有人顺手 import 了一个
 * 服务端模块」,不是「有人存心藏一条依赖」——后者靠复审,不靠语法树。
 */
function moduleSpecifiersOf(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      out.push((node.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

/** 仓库内说明符 → 真实源码文件(相对 WEB_ROOT);第三方包返回 null。 */
function sourceFileOf(fromFile: string, spec: string): string | null {
  const moduleId = resolveSpecifier(fromFile, spec);
  if (moduleId === null) return null;
  for (const candidate of [`${moduleId}.ts`, `${moduleId}.tsx`, `${moduleId}/index.ts`, `${moduleId}/index.tsx`]) {
    try {
      readFileSync(path.join(WEB_ROOT, candidate));
      return candidate;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

/** 服务端专属依赖:碰上任何一个,这个文件就不能再在没有请求上下文的测试里被 import。 */
const FORBIDDEN_LEAF_DEP = /^(next\/|next$|server-only|@fikirtive\/db|@prisma|\.prisma)/;

/**
 * 叶子体检:这个文件、以及它**本地相对/别名导入**的那一层,有没有碰服务端专属依赖。
 * 返回 `文件 → 说明符` 的命中清单(空数组 = 干净),外加走到过的本地文件,好证明递归真的走了。
 */
function leafDepScan(rel: string): { offenders: string[]; visited: string[] } {
  const offenders: string[] = [];
  const visited: string[] = [];
  const check = (file: string, depth: number): void => {
    for (const spec of moduleSpecifiersOf(parseFile(file))) {
      if (FORBIDDEN_LEAF_DEP.test(spec)) offenders.push(`${file} → ${spec}`);
      if (depth === 0) continue;
      const local = sourceFileOf(file, spec);
      if (local && !visited.includes(local)) {
        visited.push(local);
        check(local, depth - 1);
      }
    }
  };
  check(rel, 1);
  return { offenders, visited };
}

/**
 * port **真的把那句报价委托给了叶子模块**,而不是只借个 CT_EXT、自己再重写一份同名函数。
 *
 * 两半都要:①具名绑定 `importUnderstandingQuote` 逐字来自叶子模块(`propertyName ?? name`,
 * 所以 `somethingElse as importUnderstandingQuote` 不算);②这个文件里**没有**第二个同名的
 * 值声明 —— 有的话,那句话就有两份真相,而围栏读的是叶子那一份。
 */
function assertPortDelegatesQuote(sf: ts.SourceFile): void {
  const origin = importOriginOf(sf, "importUnderstandingQuote");
  expect(
    origin?.module ?? null,
    "otto-media-port 没有从 @/lib/understanding-quote-copy 导入 importUnderstandingQuote",
  ).toBe("@/lib/understanding-quote-copy");
  expect(
    origin?.imported ?? null,
    "importUnderstandingQuote 是叶子模块里**另一个导出**改名来的 —— 那不是围栏读的那一句",
  ).toBe("importUnderstandingQuote");
  expect(
    valueDeclarationCountOf(sf, "importUnderstandingQuote"),
    "otto-media-port 自己又声明了一个 importUnderstandingQuote —— 报价句于是有了两份真相",
  ).toBe(0);
}

/**
 * 钉住音频扩展名白名单**确实是从 core 算出来的**,而且是按语法树钉,不是按文本。
 *
 * 为什么必须按语法树:文本 `toContain` 钉不住「这个集合是怎么来的」。把真实集合改成
 * 「六个音频扩展名 + mp4」,再在文件别处留一段没人用的
 * `UPLOAD_EXTS.filter((ext) => mimeOf(ext).startsWith("audio/"))` 当诱饵,文本断言照样全绿 ——
 * 而 `clip.mp4` 会被放行,服务端落 `video/mp4`、建 video-qa 收费行,这个入口却不挂披露。
 * 所以这里逐层拆 `new Set(UPLOAD_EXTS.filter((p) => mimeOf(p).startsWith("audio/")))`,
 * 任何一层不对就红,并把实际写法打在失败信息里。
 */
function assertAudioWhitelistIsDerived(sf: ts.SourceFile): void {
  const NAME = "AUDIO_UPLOAD_EXTENSIONS";

  for (const local of ["UPLOAD_EXTS", "mimeOf"]) {
    const origin = importOriginOf(sf, local);
    expect(
      origin?.module ?? null,
      `${local} 不是从 @fikirtive/core/upload 导入的 —— 白名单必须来自 core 的单一权威`,
    ).toBe("@fikirtive/core/upload");
    // 模块对、本地名对,还不够:`import { SOME_OTHER as UPLOAD_EXTS }` 两样都对得上,
    // 过滤的却是另一个导出。来源模块里那个名字必须逐字就是它自己。
    expect(
      origin?.imported ?? null,
      `${local} 是同一个模块里**另一个导出**改名来的(${origin?.imported ?? "?"} as ${local})—— `
        + "改了名的东西不是 core 的上传扩展名权威",
    ).toBe(local);
  }

  // 名字必须唯一:函数里留一支写法正确的同名诱饵,就能把「取第一个同名变量」的检查骗到。
  expect(
    declarationCountOf(sf, NAME),
    `${NAME} 在这个文件里不是恰好声明一次 —— 多一支(哪怕是函数内的局部变量)就分不清哪一支是白名单`,
  ).toBe(1);

  const found = moduleConstInitializerOf(sf, NAME);
  expect(
    found,
    `找不到模块顶层的 \`const ${NAME} = …\` —— 白名单被删、改名,或者挪进了函数体 / 改成了 let`,
  ).not.toBeNull();
  const actual = found!.text;

  const created = must(
    found!.node,
    ts.isNewExpression,
    `白名单不是 new Set(...) 的形态,实际写法:${actual}`,
  );
  expect(
    ts.isIdentifier(created.expression) && created.expression.text === "Set",
    `白名单不是 new Set(...),实际写法:${actual}`,
  ).toBe(true);
  expect((created.arguments ?? []).length, `new Set(...) 的参数不是恰好一个:${actual}`).toBe(1);

  const filterCall = must(
    unwrap(created.arguments![0]!),
    ts.isCallExpression,
    `白名单不是算出来的(new Set 里不是一次 filter 调用),实际写法:${actual}`,
  );
  const filterCallee = must(
    filterCall.expression,
    ts.isPropertyAccessExpression,
    `白名单不是 UPLOAD_EXTS.filter(...),实际写法:${actual}`,
  );
  expect(
    ts.isIdentifier(filterCallee.expression) &&
      filterCallee.expression.text === "UPLOAD_EXTS" &&
      filterCallee.name.text === "filter",
    `白名单不是从 UPLOAD_EXTS 过滤出来的(手抄的名单会再混进 .webm 这种 video 扩展名),实际写法:${actual}`,
  ).toBe(true);
  expect(filterCall.arguments.length, `filter 的参数不是恰好一个:${actual}`).toBe(1);

  const predicate = must(
    unwrap(filterCall.arguments[0]!),
    ts.isArrowFunction,
    `filter 的参数不是箭头函数:${actual}`,
  );
  expect(predicate.parameters.length, `过滤函数的参数不是恰好一个:${actual}`).toBe(1);
  const parameter = must(
    predicate.parameters[0]!.name,
    ts.isIdentifier,
    `过滤函数的参数不是一个普通标识符:${actual}`,
  );
  expect(
    ts.isBlock(predicate.body),
    `过滤函数写成了带 {} 的块体,这条结构检查只认单表达式形态:${actual}`,
  ).toBe(false);

  const startsWithCall = must(
    unwrap(predicate.body as ts.Expression),
    ts.isCallExpression,
    `过滤条件不是一次调用:${actual}`,
  );
  const startsWithCallee = must(
    startsWithCall.expression,
    ts.isPropertyAccessExpression,
    `过滤条件不是 ….startsWith(...):${actual}`,
  );
  expect(startsWithCallee.name.text, `过滤条件不是 startsWith:${actual}`).toBe("startsWith");
  expect(startsWithCall.arguments.length, `startsWith 的参数不是恰好一个:${actual}`).toBe(1);
  expect(
    literalTextOf(unwrap(startsWithCall.arguments[0]!)),
    `过滤条件比的不是 "audio/" 前缀:${actual}`,
  ).toBe("audio/");

  const mimeCall = must(
    unwrap(startsWithCallee.expression),
    ts.isCallExpression,
    `startsWith 的接收者不是 mimeOf(...) 的结果:${actual}`,
  );
  expect(
    ts.isIdentifier(mimeCall.expression) && mimeCall.expression.text === "mimeOf",
    `过滤条件没有调用 core 的 mimeOf —— 那才是服务端定 MIME 的那个函数:${actual}`,
  ).toBe(true);
  expect(mimeCall.arguments.length, `mimeOf 的参数不是恰好一个:${actual}`).toBe(1);
  const mimeArgument = must(
    unwrap(mimeCall.arguments[0]!),
    ts.isIdentifier,
    `mimeOf 的参数不是过滤函数那个参数:${actual}`,
  );
  expect(
    mimeArgument.text,
    `mimeOf 判的不是被过滤的那个扩展名(参数对不上):${actual}`,
  ).toBe(parameter.text);

  // 算得再对,初始化之后补一句 `.add("mp4")` / `.delete("m4a")`,名单照样被改 ——
  // 而上面的结构拆解到 `new Set(...)` 就结束了,一个字都看不见。
  expect(
    mutationCallsOf(sf, NAME),
    `${NAME} 在初始化之后被改过 —— 白名单必须是算出来就定死的那一份`,
  ).toEqual([]);
}

/** 仓库根(WEB_ROOT 是 apps/web)。豁免要引规格,规格得真的读得到。 */
const REPO_ROOT = path.join(WEB_ROOT, "..", "..");
const specText = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

/**
 * 明示豁免。
 *
 * 上一版的豁免只验「理由字符串够长」—— 那等于没验:一句编得好听的话照样过。
 * 现在每条豁免带三样东西,而且**都要能当场执行**:
 *   · `spec` 指向规格里真正写了这条豁免的位置,测试去读那一行,读不到就红;
 *   · `guard()` 断言豁免的**前提在代码里仍然成立**,而不是当年成立过;
 *   · `callSites` 钉住调用点数量,它一变就说明这个入口的形状变了。
 */
interface Exemption {
  file: string;
  reason: string;
  /** 规格里的出处,`路径#锚点`。 */
  spec: string;
  callSites: number;
  guard: () => void;
}

const EXEMPTIONS: Exemption[] = [
  {
    file: "components/otto/edit/EditDesk.tsx",
    reason:
      "只收音频;audio 不在收费的三类里(§7.3 单列)。两道守:文件选择器的 accept=\"audio/*\" 提示,"
      + "加 uploadMusic 里的守卫 —— 扩展名必须落在「core 的 mimeOf 判为 audio/*」的那组里(硬条件:服务端对非图片"
      + "扩展名不读字节,直接按扩展名落 MIME,音频扩展名一律落 audio/*,understandingKindForMime 返回 null 不计费),"
      + "MIME 只作副条件(audio/ 前缀、浏览器没意见、或 m4a/aac 报 video/mp4 这类已知容器误报)",
    spec: "docs/specs/money-engine.md#7.3-A9-素材理解计费面",
    callSites: 1,
    guard: () => {
      const src = codeOf("components/otto/edit/EditDesk.tsx");
      // ① 选择器提示:商家打开弹窗时默认只看得到音频。
      expect(src, "EditDesk 的文件选择器不再限定 audio/*,这条豁免少了一道守").toContain(
        'accept="audio/*"',
      );
      // ② 真正的守卫:accept 只是建议,弹窗里改个筛选就绕过去了。豁免立在这一条上。
      const handler = functionSourceOf("components/otto/edit/EditDesk.tsx", "uploadMusic");
      expect(handler, "找不到 uploadMusic —— 豁免要核对的处理函数变了,豁免得重新判").not.toBeNull();
      expect(
        handler!,
        "uploadMusic 里的音频守卫没了 —— 非音频文件会重新落成会被理解计费的 UPLOAD 素材,而这个入口不挂披露",
      ).toContain("looksLikeAudio");

      // 守卫的**函数体自己**要有两项检查。只在整份文件里 toContain 是假绿:
      // 把 looksLikeAudio 换成 `() => true`,常量和别处的字符串都还在,断言照样过。
      const audioGuard = functionSourceOf("components/otto/edit/EditDesk.tsx", "looksLikeAudio");
      expect(audioGuard, "找不到 looksLikeAudio —— 守卫被删或改名了").not.toBeNull();
      expect(
        audioGuard!,
        "looksLikeAudio 里没有扩展名白名单检查 —— 扩展名是硬条件:它决定服务端把文件落成哪种 MIME,也就决定会不会被理解计费",
      ).toContain("AUDIO_UPLOAD_EXTENSIONS");
      expect(
        audioGuard!,
        "looksLikeAudio 不再按 audio/ 前缀判断 —— 守卫被掏空了",
      ).toContain('startsWith("audio/")');
      // 白名单本身必须**是从 core 算出来的**,按语法树逐层拆,不是文本 toContain ——
      // 文本断言钉不住「这个集合是怎么来的」,别处留一段死表达式当诱饵就能骗过去。
      assertAudioWhitelistIsDerived(parseFile("components/otto/edit/EditDesk.tsx"));
      // ③ 守卫要真的拦在 finalize 之前,不是拦完还继续走。
      const guardIndex = handler!.indexOf("looksLikeAudio");
      const finalizeIndex = handler!.indexOf("finalizeCandidateUploads");
      expect(guardIndex, "守卫排到了 finalizeCandidateUploads 之后 —— 那就没拦住").toBeLessThan(
        finalizeIndex,
      );
    },
  },
];

describe("R3-F06 上传入口不再常驻理解价目说明,而价目本身仍在 billing 念得到", () => {
  /**
   * R3-F06(Founder 2026-09-14;`docs/specs/money-engine.md` 等三份规格的 2026-09-14 变更登记,
   * APPROVED)。这一组从前钉的是反方向:六个上传入口各挂一行「Uploads are understood
   * automatically …」。Founder 看到那几段堆在输入附近的截图后裁定这类常驻说明不要,整批撤掉。
   *
   * 裁决同时明写:**移除展示不批准免费理解**,也不改价目单一来源与快照口径。所以这一组现在
   * 钉两半 —— 展示真的没了(上半),而钱那一侧一个字没松(下半)。
   */
  const FORMER_HINT_SENTENCE = "Uploads are understood automatically";

  it.each(UPLOAD_ENTRIES)("%s 不再常驻理解价目说明", (file) => {
    const src = codeOf(file);
    expect(src, `${file} 又挂回了理解价目组件`).not.toContain("UnderstandingCostHint");
    expect(src, `${file} 自己抄了一份理解价目文案`).not.toContain(FORMER_HINT_SENTENCE);
  });

  it("三个价目小字组件都已删除 —— 不是留在仓库里等人挂回来", () => {
    for (const gone of [
      "components/otto/UnderstandingCostHint.tsx",
      "components/otto/SearchCostHint.tsx",
      "components/otto/ConversationCostHint.tsx",
    ]) {
      expect(
        () => codeOf(gone),
        `${gone} 还在 —— R3-F06 撤的是这类展示本身,不是只摘掉挂点`,
      ).toThrow();
    }
  });

  it("理解的三类价仍旧在 billing 念得到,而且与报价函数同源(测试自己现算期望值,不手抄)", () => {
    // 撤掉展示之后,billing 的 Auto-understanding 一节是商家读这个价的**唯一**地方。
    // 它缺一档,商家就是在为一笔没人告诉过他的钱付费 —— 所以这一条比从前更硬,不是更松。
    const billing = codeOf("app/billing/page.tsx");
    expect(billing).toContain("Auto-understanding");
    expect(billing, "billing 不再从报价函数现算,而是抄了一份数").toContain(
      "pricedUnderstandingCredits",
    );
    const offenders = copyLines(billing).filter(
      (line) => /understand/i.test(line) && HAND_TYPED_CREDITS.test(line),
    );
    expect(offenders, "理解价目区出现了手抄的钱数").toEqual([]);
  });

  it("第四类理解上线时,billing 的价目区必须跟着改(枚举长度即闸)", () => {
    // 这一行不是形式主义:三类价是**三个句子槽**,加第四类而不改文案,商家读到的就是一份
    // 缺一档的价目表 —— 而缺的那一档照样扣钱。枚举一变长,这里当场红。
    expect(
      Object.keys(UNDERSTANDING_PRICED_INTERNAL),
      "理解档多了一类:billing 价目区要多一个槽",
    ).toHaveLength(3);
  });

  it("级联说明仍在 billing(计费四则②:菜单/价目表会被再读一次,两段价一并披露)", () => {
    const billing = codeOf("app/billing/page.tsx");
    expect(billing).toContain("menu or a price list");
    expect(billing).toContain('understandingPrice("doc-extract")');
  });

  // ── 围栏:两侧各扫一遍,任一侧动了而另一侧没跟上就红 ────────────────────────────
  it("写点普查:落 UPLOAD 素材的文件就是登记的这几个(多一个=多一条没人问过披露的计费路径)", () => {
    expect(
      writePointFiles(),
      "有文件开始写 source:\"UPLOAD\":先追它的 UI 面,再决定挂披露还是写进豁免",
    ).toEqual(Object.keys(WRITE_POINT_FILES).sort());

    // 只比文件名不够:在既有写点文件里再加一支写 UPLOAD 的函数(比如一个匿名默认导出),
    // 文件集合纹丝不动。所以每个文件的**写点函数个数**也要对上。
    expect(
      actionCensus().writePointCounts,
      "某个写点文件里的写点函数个数变了:多出来的那一支要么进动作表,要么说明有条新的计费路径",
    ).toEqual(
      Object.fromEntries(
        Object.entries(WRITE_POINT_FILES).map(([file, { writePointFunctions }]) => [file, writePointFunctions]),
      ),
    );
  });

  it("写点普查:转调内部 helper 的导出动作也算上传动作(闭包取代了手抄的 helper 名单)", () => {
    // createEntity 自己一个 source:"UPLOAD" 都没写,它调 ingestFile。上一版靠一份手写的
    // WRITE_HELPERS 名单才认得出这一层,而那份名单本身就是个漏洞:在写点文件里新增一个
    // 非导出的 persistUpload() 再由新动作转调,名单不更新就全绿。现在由调用闭包保证。
    const actions = uploadActionKeys();
    expect(actions, "createEntity 只通过 helper 落盘,闭包必须认出它").toContain("lib/actions#createEntity");
    // 而 helper 自己不导出,不会被当成「UI 该去调的动作」漏进入口侧
    expect(actions, "ingestFile 是非导出 helper,不该出现在动作表里").not.toContain("lib/actions#ingestFile");
    // 删掉的两支不许悄悄回来:零 UI 调用方的导出上传动作正是这套围栏要盯的形状。
    for (const gone of ["lib/actions#uploadCandidates", "lib/actions#addReferenceImages"]) {
      expect(actions, `${gone} 又出现了 —— 它 2026-09-02 被当死导出删掉,回来就得重新问披露`).not.toContain(gone);
    }
  });

  /** 用一段合成源码跑一遍模块闭包 —— 夹具比探针值钱:探针跑完就没了,夹具会一直在。 */
  const writersOf = (source: string, importedLocals: string[] = []): string[] =>
    uploadWritersOf(
      ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS),
      { locals: new Set(importedLocals), namespaces: new Map() },
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
    const all = [...census.actions].sort();
    return {
      /** 传播集全量(含 UI 侧包装)—— 入口计数用的就是它。 */
      propagated: all,
      /** 登记表口径:只有 `lib/**` 的动作。UI 侧包装属于「谁该挂披露」,不进动作表。 */
      registered: all.filter((key) => key.startsWith("lib/")),
      writePoints: census.writePointFiles,
      writePointCounts: census.writePointCounts,
      count: (file: string) => countCallSites(project, file, census.actions),
      entries: project.entryFiles.filter((f) => countCallSites(project, f, census.actions) > 0),
    };
  };

  it("跨文件包装:UI → wrapper → 写点模块,整条链走真实普查", () => {
    const result = censusOf({
      "lib/actions.ts": 'export function upload(p) { return { id: p, source: "UPLOAD" }; }',
      "lib/wrapper.ts": 'import { upload } from "./actions";\nexport function wrap(p) { return upload(p); }',
      "components/Ui.tsx": 'import { wrap } from "@/lib/wrapper";\nexport function Ui() { return () => wrap("p"); }',
    });
    expect(result.registered, "包装函数没有继承上游动作的身份 —— 跨文件闭包断了").toEqual([
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
    expect(result.registered, "lib/foo/index.ts 的动作键没有归一到 lib/foo").toEqual(["lib/foo#upload"]);
    expect(result.count("components/Ui.tsx"), "从目录入口导入的调用没被计到").toBe(1);
  });

  it("具名重导出:barrel 两种写法都要把动作转出去(export…from 与 import 后再 export)", () => {
    const viaFrom = censusOf({
      "lib/actions.ts": 'export function upload(p) { return { id: p, source: "UPLOAD" }; }',
      "lib/barrel.ts": 'export { upload as wrap } from "./actions";',
      "components/Ui.tsx": 'import { wrap } from "@/lib/barrel";\nexport function Ui() { return () => wrap("p"); }',
    });
    expect(viaFrom.registered, "`export { x as y } from` 的别名边没接上").toContain("lib/barrel#wrap");
    expect(viaFrom.count("components/Ui.tsx"), "从 barrel 导入的调用没被计到").toBe(1);

    const viaLocal = censusOf({
      "lib/actions.ts": 'export function upload(p) { return { id: p, source: "UPLOAD" }; }',
      "lib/barrel.ts": 'import { upload } from "./actions";\nexport { upload };',
      "components/Ui.tsx": 'import { upload } from "@/lib/barrel";\nexport function Ui() { return () => upload("p"); }',
    });
    expect(viaLocal.registered, "`import 后 export { x }` 的绑定边没接上").toContain("lib/barrel#upload");
    expect(viaLocal.count("components/Ui.tsx"), "从 barrel 导入的调用没被计到").toBe(1);
  });

  /** 写点模块的最小样子:一个导出函数,函数体里落一条 UPLOAD 素材。 */
  const WRITE_POINT_MODULE = 'export function upload(p) { return { id: p, source: "UPLOAD" }; }';

  it("传播面覆盖全部产品目录:抽到 hooks/ 的包装不该让整条链跑出围栏", () => {
    // 「把上传逻辑抽成 hooks/useUpload.ts」是一次再常规不过的重构。传播面写死 lib/** 时,
    // 这个文件不在任何一张表里,UI 调 uploadImage() 计零,三张表纹丝不动 —— 静默全绿。
    const result = censusOf({
      "lib/actions.ts": WRITE_POINT_MODULE,
      "hooks/useUpload.ts": 'import { upload } from "@/lib/actions";\nexport function uploadImage(p) { return upload(p); }',
      "components/Ui.tsx": 'import { uploadImage } from "@/hooks/useUpload";\nexport function Ui() { return () => uploadImage("p"); }',
    });
    expect(result.count("components/Ui.tsx"), "经 hooks/ 包装的调用没被计成入口").toBe(1);
    expect(result.entries, "Ui.tsx 没进入口表").toContain("components/Ui.tsx");
    expect(result.propagated, "hooks/ 的包装没进传播集").toContain("hooks/useUpload#uploadImage");
    expect(result.registered, "hooks/ 的包装不该进登记表(它不是 lib/** 的动作)").toEqual([
      "lib/actions#upload",
    ]);
  });

  it("传播面覆盖 components/ 内的包装:helper 算入口,但不混进动作登记表", () => {
    const result = censusOf({
      "lib/actions.ts": WRITE_POINT_MODULE,
      "components/helper.ts": 'import { upload } from "@/lib/actions";\nexport function uploadImage(p) { return upload(p); }',
      "components/Ui.tsx": 'import { uploadImage } from "./helper";\nexport function Ui() { return () => uploadImage("p"); }',
    });
    expect(result.count("components/Ui.tsx"), "经同目录 helper 的调用没被计成入口").toBe(1);
    expect(result.count("components/helper.ts"), "helper 自己直接调动作,它也是入口").toBe(1);
    expect(result.registered, "components/ 的包装混进了动作登记表").toEqual(["lib/actions#upload"]);
  });

  it("默认导出四种写法都归到 `模块#default`,默认导入也认", () => {
    const viaDeclaration = censusOf({
      "lib/actions.ts": 'export default function upload(p) { return { id: p, source: "UPLOAD" }; }',
      "components/Ui.tsx": 'import upload from "@/lib/actions";\nexport function Ui() { return () => upload("p"); }',
    });
    expect(viaDeclaration.registered, "`export default function upload(){}` 没记成 #default").toEqual([
      "lib/actions#default",
    ]);
    expect(viaDeclaration.count("components/Ui.tsx"), "默认导入的调用没被计到").toBe(1);

    const viaAssignment = censusOf({
      "lib/actions.ts": 'function upload(p) { return { id: p, source: "UPLOAD" }; }\nexport default upload;',
      "components/Ui.tsx": 'import upload from "@/lib/actions";\nexport function Ui() { return () => upload("p"); }',
    });
    expect(viaAssignment.registered, "`export default upload;` 没记成 #default").toContain(
      "lib/actions#default",
    );
    expect(viaAssignment.count("components/Ui.tsx")).toBe(1);

    const viaNamedDefault = censusOf({
      "lib/actions.ts": 'function upload(p) { return { id: p, source: "UPLOAD" }; }\nexport { upload as default };',
    });
    expect(viaNamedDefault.registered, "`export { x as default }` 没记成 #default").toContain(
      "lib/actions#default",
    );

    const viaBarrel = censusOf({
      "lib/actions.ts": 'export default function upload(p) { return { id: p, source: "UPLOAD" }; }',
      "lib/barrel.ts": 'export { default as upload } from "./actions";',
      "components/Ui.tsx": 'import { upload } from "@/lib/barrel";\nexport function Ui() { return () => upload("p"); }',
    });
    expect(viaBarrel.registered, "`export { default as x } from` 这条边接不到 #default").toContain(
      "lib/barrel#upload",
    );
    expect(viaBarrel.count("components/Ui.tsx"), "经 default barrel 的调用没被计到").toBe(1);
  });

  it("命名空间导入与动态 import 的调用点都要计(裸标识符之外的两种常见写法)", () => {
    const namespace = censusOf({
      "lib/actions.ts": WRITE_POINT_MODULE,
      "components/Ui.tsx": 'import * as actions from "@/lib/actions";\nexport function Ui() { return () => actions.upload("p"); }',
    });
    expect(namespace.count("components/Ui.tsx"), "`import * as ns` 后的 ns.upload() 没被计到").toBe(1);

    const awaited = censusOf({
      "lib/actions.ts": WRITE_POINT_MODULE,
      "components/Ui.tsx":
        'export async function Ui() { const m = await import("@/lib/actions"); return m.upload("p"); }',
    });
    expect(awaited.count("components/Ui.tsx"), "`const m = await import()` 后的 m.upload() 没被计到").toBe(1);

    const thenable = censusOf({
      "lib/actions.ts": WRITE_POINT_MODULE,
      "components/Ui.tsx":
        'export function Ui() { return import("@/lib/actions").then((m) => m.upload("p")); }',
    });
    expect(thenable.count("components/Ui.tsx"), "`import().then(m => m.upload())` 没被计到").toBe(1);
  });

  it("导入/导出的已知边界:动态说明符、解构命名空间(认不到=预期)", () => {
    const dynamicSpecifier = censusOf({
      "lib/actions.ts": WRITE_POINT_MODULE,
      "components/Ui.tsx":
        'const where = "@/lib/actions";\nexport async function Ui() { const m = await import(where); return m.upload("p"); }',
    });
    expect(dynamicSpecifier.count("components/Ui.tsx"), "边界:说明符不是静态字符串的动态 import").toBe(0);

    const destructured = censusOf({
      "lib/actions.ts": WRITE_POINT_MODULE,
      "components/Ui.tsx":
        'export async function Ui() { const { upload } = await import("@/lib/actions"); return upload("p"); }',
    });
    expect(destructured.count("components/Ui.tsx"), "边界:把命名空间解构后再调用").toBe(0);

    // (匿名默认导出曾经列在这里当边界,现在已经认了 —— 见下面「匿名默认导出」那条。)
  });

  it("匿名默认导出也是动作:`export default function (…)` 配得出 `模块#default`", () => {
    const result = censusOf({
      "lib/actions.ts": 'export default function (p) { return { id: p, source: "UPLOAD" }; }',
      "components/Ui.tsx": 'import upload from "@/lib/actions";\nexport function Ui() { return () => upload("p"); }',
    });
    expect(result.registered, "匿名默认导出没配出 #default 键").toEqual(["lib/actions#default"]);
    expect(result.count("components/Ui.tsx"), "默认导入匿名默认导出的调用没被计到").toBe(1);

    const arrow = censusOf({
      "lib/actions.ts": 'export default (p) => ({ id: p, source: "UPLOAD" });',
      "components/Ui.tsx": 'import upload from "@/lib/actions";\nexport function Ui() { return () => upload("p"); }',
    });
    expect(arrow.registered, "`export default (p) => …` 没配出 #default 键").toEqual([
      "lib/actions#default",
    ]);
    expect(arrow.count("components/Ui.tsx")).toBe(1);
  });

  it("既有写点文件里再加一支匿名默认写点:动作表、入口、写点计数三样都要动", () => {
    // 这就是复审那条探针的场景:往已经在登记表里的写点文件后面追加一支匿名默认导出的写点,
    // 再加一个默认导入它的 UI。只比「文件名集合」的话,三张表可以纹丝不动 —— 静默全绿。
    const before = censusOf({
      "lib/actions.ts": 'export function upload(p) { return { id: p, source: "UPLOAD" }; }',
    });
    expect(before.registered).toEqual(["lib/actions#upload"]);
    expect(before.writePointCounts["lib/actions.ts"]).toBe(1);

    const after = censusOf({
      "lib/actions.ts":
        'export function upload(p) { return { id: p, source: "UPLOAD" }; }\n'
        + 'export default function (p) { return { id: p, source: "UPLOAD" }; }',
      "components/Sneaky.tsx": 'import upload from "@/lib/actions";\nexport function Sneaky() { return () => upload("p"); }',
    });
    expect(after.registered, "追加的匿名默认写点没进动作表").toEqual([
      "lib/actions#default",
      "lib/actions#upload",
    ]);
    expect(after.count("components/Sneaky.tsx"), "偷偷加的 UI 入口没被计到").toBe(1);
    expect(
      after.writePointCounts["lib/actions.ts"],
      "写点函数计数没跟着变 —— 只比文件名集合正是这条探针能钻的洞",
    ).toBe(2);
  });

  it("目录入口的两种显式写法也归一(`@/lib/foo/index` 与 `./index.js`)", () => {
    const explicitAlias = censusOf({
      "lib/foo/index.ts": WRITE_POINT_MODULE,
      "components/Ui.tsx": 'import { upload } from "@/lib/foo/index";\nexport function Ui() { return () => upload("p"); }',
    });
    expect(explicitAlias.count("components/Ui.tsx"), "`@/lib/foo/index` 没归一到 lib/foo").toBe(1);

    const relativeJs = censusOf({
      "lib/foo/index.ts": WRITE_POINT_MODULE,
      "lib/caller.ts": 'import { upload } from "./foo/index.js";\nexport function wrap(p) { return upload(p); }',
      "components/Ui.tsx": 'import { wrap } from "@/lib/caller";\nexport function Ui() { return () => wrap("p"); }',
    });
    expect(relativeJs.registered, "`./foo/index.js` 没归一到 lib/foo").toContain("lib/caller#wrap");
    expect(relativeJs.count("components/Ui.tsx")).toBe(1);
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
    expect(crossFile.registered, "边界④跨文件同名成员:名字对齐越界了,只该在文件内对齐").toEqual([
      "lib/b#fb",
    ]);

    const star = censusOf({
      "lib/actions.ts": 'export function upload(p) { return { id: p, source: "UPLOAD" }; }',
      "lib/star.ts": 'export * from "./actions";',
      "components/Ui.tsx": 'import { upload } from "@/lib/star";\nexport function Ui() { return () => upload("p"); }',
    });
    expect(star.registered, "边界⑤export *:被意外覆盖了,清单该更新").toEqual(["lib/actions#upload"]);
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
    const declared = [...UPLOAD_ENTRIES.map(([file]) => file), ...EXEMPTIONS.map((e) => e.file)].sort();
    expect(
      uploadEntryFiles(),
      "有 UI 开始调上传动作:要么进上传入口表,要么进 EXEMPT 并写明理由",
    ).toEqual(declared);
  });

  it.each(UPLOAD_ENTRIES)("%s 的上传调用点数量 = 登记值(多一个调用点=强制人工复核)", (file, _note, callSites) => {
    expect(
      callSiteCount(file),
      `${file} 的上传调用点数量变了:先确认披露仍覆盖新的调用点,再来更新这个数字`,
    ).toBe(callSites);
  });

  it("豁免不是一句好听的话:每条都要引规格、跑 guard、钉调用点数量", () => {
    const entries = new Set<string>(UPLOAD_ENTRIES.map(([file]) => file));
    for (const exemption of EXEMPTIONS) {
      expect(entries.has(exemption.file), `${exemption.file} 同时出现在入口表和豁免表`).toBe(false);

      // ⓪ 豁免面也不许把那段说明抄回来。
      //
      //    上面那道 `it.each(UPLOAD_ENTRIES)` 只走**入口表**,豁免表(今天只有 EditDesk)不在
      //    它的迭代里 —— 于是 R3-F06 的清场在豁免面上留了个洞:那里贴回一段
      //    「Uploads are understood automatically …」,两道围栏都不会红。改版前这一格是有的
      //    (旧版断言豁免面不含 `UnderstandingCostHint`),翻面时跟着组件名一起删掉了;
      //    这里按**商家读到的句子**补回来,比组件名更难绕过。
      expect(
        codeOf(exemption.file),
        `${exemption.file} 抄了一份理解价目文案`,
      ).not.toContain(FORMER_HINT_SENTENCE);

      // ① 规格出处必须读得到,而且那一段真的在谈这个豁免。
      const [specFile] = exemption.spec.split("#");
      const spec = specText(specFile);
      expect(spec, `${exemption.spec} 读不到 —— 豁免的出处是空的`).toContain("EditDesk` 现仅收 audio");
      expect(spec, "规格里的豁免条文变了,豁免要重新判").toContain("audio 不入理解三类、不收费");

      // ② 豁免的前提在代码里仍然成立。
      exemption.guard();

      // ③ 入口形状没变。
      expect(
        callSiteCount(exemption.file),
        `${exemption.file} 的上传调用点数量变了:豁免可能已经不成立`,
      ).toBe(exemption.callSites);
    }
  });

  // ── 豁免 guard 自己的反向夹具(Codex #1118 第十轮两条非阻塞 P2 的落点)────────────
  // guard 也会腐坏,而它腐坏的方式恰好是「看起来全绿」。下面三条喂的是**合成源码**,走的是
  // guard 真正跑的那条链路(不是另写一套判定),逐条证明它对三种能放行 video 扩展名的写法当场红。
  // 放行一个 video 扩展名的代价是具体的:`clip.mp4` 过了 EditDesk 的守卫,服务端落 video/mp4,
  // 建一条 video-qa 收费行 —— 而这个入口是按「只收音频、不计费」豁免掉披露的。
  const FIXTURE_IMPORT = 'import { UPLOAD_EXTS, mimeOf } from "@fikirtive/core/upload";';
  const FIXTURE_DERIVED =
    'const AUDIO_UPLOAD_EXTENSIONS = new Set(UPLOAD_EXTS.filter((p) => mimeOf(p).startsWith("audio/")));';
  const fixtureOf = (source: string): ts.SourceFile =>
    ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);

  it("豁免 guard 夹具:算出来的名单过,函数内的同名诱饵红(不再是「取第一个同名变量」)", () => {
    expect(() => assertAudioWhitelistIsDerived(fixtureOf(`${FIXTURE_IMPORT}\n${FIXTURE_DERIVED}\n`))).not.toThrow();

    // 诱饵排在**前面**:递归扫整棵树取第一个同名变量的旧写法先撞上它,整套结构检查照样全绿,
    // 而真正生效的那份名单是手抄的,里面躺着 mp4。
    expect(() =>
      assertAudioWhitelistIsDerived(
        fixtureOf(
          `${FIXTURE_IMPORT}\n` +
            `function decoy() {\n  ${FIXTURE_DERIVED}\n  return AUDIO_UPLOAD_EXTENSIONS;\n}\n` +
            'const AUDIO_UPLOAD_EXTENSIONS = new Set(["mp3", "mp4"]);\n',
        ),
      ),
    ).toThrow(/恰好声明一次/);
  });

  it("豁免 guard 夹具:名单算对了、初始化之后又 .add() 的红", () => {
    expect(() =>
      assertAudioWhitelistIsDerived(
        fixtureOf(`${FIXTURE_IMPORT}\n${FIXTURE_DERIVED}\nAUDIO_UPLOAD_EXTENSIONS.add("mp4");\n`),
      ),
    ).toThrow(/初始化之后被改过/);
  });

  it("豁免 guard 夹具:`SOME_OTHER as UPLOAD_EXTS` 红(模块与本地名都对得上,来源不对)", () => {
    expect(() =>
      assertAudioWhitelistIsDerived(
        fixtureOf(
          'import { SOME_OTHER as UPLOAD_EXTS, mimeOf } from "@fikirtive/core/upload";\n' +
            `${FIXTURE_DERIVED}\n`,
        ),
      ),
    ).toThrow(/另一个导出/);
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
    vi.doMock("@/lib/owner-settings-actions", () => ({
      // 前端基线合并(FRONT-A1):花费上限搬到 /billing 之后这一页多读一个数据源;
      // 这一票不测上限,但不 mock 就会打真 auth 假红。
      getOwnerSettings: async () => ({ spendCapCredits: 0 }),
      setOwnerSetting: async () => ({ ok: true as const }),
    }));
    // FSE-202 — BillingLiveRefresh(正文)调用 useRouter();renderToStaticMarkup 不经过 Next 真的
    // App Router,不 mock 就会抛 "expected app router to be mounted"。
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
    const { default: BillingPage } = await import("@/app/billing/page");

    const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Auto-understanding");
    for (const kind of Object.keys(UNDERSTANDING_PRICED_INTERNAL) as (keyof typeof UNDERSTANDING_PRICED_INTERNAL)[]) {
      expect(html, `${kind} 的价没有出现在 billing 价目区`).toContain(priceOf(kind));
    }
    expect(html).toContain("menu or a price list");
    // 四则①:结算按快照价,所以价目区不能只报价、不说这笔价什么时候锁 —— 而那一刻是
    // **扫描器建理解行**的时刻(Founder 2026-09-02 接受偏差、裁决措辞改实话;跨厂复审同日
    // 打回第一版的「(normally the moment you upload)」)。整页扫:禁语族一条都不许出现。
    assertQueuedNotUploadWording("billing 价目区", html);
    // 免费祖父条款:A9 之前落的老行快照为 null,整条钱路跳过,永不补收
    // (packages/db/prisma/schema.prisma priceInternalSnapshot / understand.ts 的免费祖父分支)。
    expect(html.toLowerCase()).toContain("before automatic understanding was priced stay free");
    vi.doUnmock("@/lib/account-actions");
    vi.doUnmock("@/lib/billing-actions");
    vi.doUnmock("@/lib/spend-history-data");
    vi.doUnmock("@/lib/owner-settings-actions");
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
  /** 报价那句话住在叶子模块里(见「Otto 侧三处」那条的判词);port 只负责把它挂到结果上。 */
  const quote = codeOf("lib/understanding-quote-copy.ts");

  it("「$0 by construction」的旧说法已废止 —— 导入落的是会被理解计费的 UPLOAD 素材", () => {
    expect(port).not.toContain("$0 by construction");
    expect(port).toContain("MONEY-A9");
  });

  it("成功结果带一句报价,而且是现算的(无 UI 面,披露只能走动作层)", () => {
    expect(quote).toContain("pricedUnderstandingCredits");
    expect(quote).toContain("creditsLabel");
    expect(port, "port 不再把那句报价挂到结果上").toContain("note: importUnderstandingQuote(");
    for (const [who, src] of [["导入报价", quote], ["otto-media-port", port]] as const) {
      const offenders = copyLines(src).filter((line) => HAND_TYPED_CREDITS.test(line));
      expect(offenders, `${who}里出现了手抄的钱数`).toEqual([]);
    }
  });

  it("报价句住在**叶子模块**里 —— 它不许把 Next 的请求作用域运行时拖进测试进程", () => {
    // 这条是那次「24 个不相干文件一起红」的碑。围栏要在运行时读这句话,而读它的唯一安全办法
    // 就是让它住在一个不碰 next/、不碰 server-only、不碰 prisma 的文件里。
    //
    // 按**语法树**扫,不按文本行:上一版用 copyLines 扫文本,两头都不准 —— 行尾注释或字符串里
    // 提一句 `server-only` 会误报(这个文件的判词里就有),而 `"server" + "-only"` 拼出来的
    // 说明符、或者经一个本地 helper 间接引入的 next,一个都报不出来。这里改成遍历真实的
    // import / export…from / 静态说明符的动态 import(),并把**本地导入**再往下走一层。
    const { offenders, visited } = leafDepScan("lib/understanding-quote-copy.ts");
    expect(offenders, "报价叶子模块(或它本地依赖的那一层)碰了服务端专属依赖 —— 它就不再是叶子了").toEqual([]);
    // 递归不是摆设:它必须真的走到了叶子的那个本地依赖(credit-format),否则「一层」等于零层。
    expect(visited, "叶子的本地依赖一个都没解析到 —— 这条递归是空转的").toContain("lib/credit-format.ts");
  });

  it("port 真的把报价**委托**给叶子模块(不是借个常量、自己重写一份同名函数)", () => {
    assertPortDelegatesQuote(parseFile("lib/otto-media-port.ts"));
  });

  // ── 两条围栏各配一条反向夹具:围栏自己也会腐坏,而它腐坏时的样子就是「全绿」──────────
  const srcOf = (source: string): ts.SourceFile =>
    ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);

  it("委托断言的反向夹具:只借常量、自己重写一份同名函数 ⇒ 红", () => {
    // 正向:真实写法过。
    expect(() =>
      assertPortDelegatesQuote(
        srcOf('import { CT_EXT, importUnderstandingQuote } from "@/lib/understanding-quote-copy";\n'),
      ),
    ).not.toThrow();

    // ① 只借 CT_EXT,报价句自己再写一份 —— 上一版那句 `toContain('from "@/lib/…"')` 照样全绿。
    expect(() =>
      assertPortDelegatesQuote(
        srcOf(
          'import { CT_EXT } from "@/lib/understanding-quote-copy";\n' +
            "function importUnderstandingQuote() { return 'charged at the price locked in on upload.'; }\n",
        ),
      ),
    ).toThrow(/没有从 @\/lib\/understanding-quote-copy 导入/);

    // ② 导入了、却又在本文件里重写一个同名的 —— 那句话就有了两份真相。
    expect(() =>
      assertPortDelegatesQuote(
        srcOf(
          'import { importUnderstandingQuote } from "@/lib/understanding-quote-copy";\n' +
            "const importUnderstandingQuote2 = 1; function importUnderstandingQuote() { return ''; }\n",
        ),
      ),
    ).toThrow(/又声明了一个/);

    // ③ 改名进来的不算:模块与本地名都对得上,来源却是另一个导出。
    expect(() =>
      assertPortDelegatesQuote(
        srcOf('import { somethingElse as importUnderstandingQuote } from "@/lib/understanding-quote-copy";\n'),
      ),
    ).toThrow(/另一个导出/);
  });

  it("禁依赖扫描的反向夹具:三种写法都认得出(文本行扫不出其中两种)", () => {
    const specs = (source: string) => moduleSpecifiersOf(srcOf(source)).filter((x) => FORBIDDEN_LEAF_DEP.test(x));
    // 静态 import —— 文本扫也认得。
    expect(specs('import "server-only";\n')).toEqual(["server-only"]);
    // `export … from` 再导出 —— 文本扫看不出这是一条依赖。
    expect(specs('export { cookies } from "next/headers";\n')).toEqual(["next/headers"]);
    // 静态说明符的动态 import —— 同上。
    expect(specs('const m = await import("@fikirtive/db");\n')).toEqual(["@fikirtive/db"]);
    // 反向:注释与字符串里提到这些名字**不是**依赖(上一版文本扫在这里误报)。
    expect(specs('// 这个文件不许 import "server-only"\nconst s = "next/headers";\n')).toEqual([]);
  });

  it("级联那一句只给图片 —— 视频不会触发 doc-extract,承诺它就是另一句假话", () => {
    expect(quote).toContain('kind === "image-caption"');
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

/**
 * 快照价口径的**总闸**(跨厂复审 2026-09-02 唯一 P1 的落点)。
 *
 * 上面几组各自钉自己那一处;这一组把**能被商家或 Otto 读到的报价句**放在同一张表上扫,
 * 因为这次犯错的方式就是「改了两处、漏了三处」—— 商家读到的是排队口径,Otto 在同一次导入
 * 里说的却还是「上传即锁价」,两句话都出自我们,而商家只会记住更肯定的那一句。
 *
 * 表是**穷举**的。R3-F06(Founder 2026-09-14)撤掉了上传入口那一行小字,于是从五处变成四处:
 * 商家侧只剩 billing 价目区一处,Otto 侧仍是三处。再多一处报价句而不进这张表,只能靠复审 ——
 * 但那正是当初被抓到的东西,所以宁可把表写死在这里。
 */
describe("MONEY-A9 快照价口径:四处报价句一律说「排队去理解时」,不许说「上传即锁价」", () => {
  it("商家侧一处(billing 价目区源码 —— 撤掉输入口小字之后的唯一一处)", () => {
    // billing 页的渲染结果在上一组扫过;这里扫**源码文案行**,连注释以外的写法一起钉住。
    assertQueuedNotUploadWording("billing 页文案行", copyLines(codeOf("app/billing/page.tsx")).join(" "));
  });

  it("Otto 侧三处(URL 导入的事后报价 + 说明书 + importMedia 工具描述)", async () => {
    // URL 导入那一句改成**调函数、读返回值**(复审二 P2)。
    //
    // 上一版扫的是 `copyLines(codeOf(...))` —— 整份文件、只删掉整行注释。那有两个洞,而且
    // 两个都能让围栏在文案已经变回假话时照样全绿:
    //   ① **行尾注释**满足要求词:`const s = "...(假话)"; // queued for understanding backlog`
    //      —— copyLines 只丢弃**整行**注释,行尾的留在原地,扫描器把它当文案读。
    //   ② **插值拼错**看不出来:这句话是模板串,`${price(kind)}` 之类拼出来才是完整句子;
    //      源码文本永远是模板,不是商家读到的那一句。
    // 所以这里直接调那个纯函数,对**它返回的字符串**做判定 —— 商家读到什么,就判什么。
    //
    // 但**不能**为此去 import `otto-media-port`(复审三的第二次落修):那个文件头一行是
    // `import "server-only"`,并牵出整片服务端动作图(`./actions`、`./cowork-actions`、prisma)。
    // apps/web 的 vitest 把所有文件跑在**同一个 worker**(`pool: "threads"` +
    // `singleThread: true`),于是一个没有请求上下文的测试把 Next 的请求作用域运行时载进来之后,
    // 后面 24 个毫不相干的文件一起红:`Invariant: AsyncLocalStorage accessed in runtime where
    // it is not available`(E504)。钱的披露必须能在运行时断言,所以那句话被抽进叶子模块
    // `lib/understanding-quote-copy.ts`(纯函数,零 next/、零 server-only、零 prisma),
    // 由 otto-media-port 从那里 import 使用 —— 行为不变,而围栏够得到它。
    const { importUnderstandingQuote } = await import("../understanding-quote-copy");
    // 图片(会级联)与视频(不会)两条路各判一次:级联那半句是拼在图片分支上的。
    assertQueuedNotUploadWording("URL 导入报价(图片)", importUnderstandingQuote("png", "image/png"));
    assertQueuedNotUploadWording("URL 导入报价(视频)", importUnderstandingQuote("mp4", "video/mp4"));

    const { ottoInstructions, skillCatalog } = await import("@fikirtive/otto");
    const importMedia = skillCatalog.find((s) => s.name === "importMedia");
    expect(importMedia, "importMedia 不在 Otto 的动作表里").toBeDefined();
    // 这两条扫的是**运行时字符串**,不是源码:插值拼错了在源码上看不出来。
    assertQueuedNotUploadWording("Otto 说明书的理解报价句", ottoInstructions);
    assertQueuedNotUploadWording("importMedia 工具描述", importMedia!.description);
  });
});
