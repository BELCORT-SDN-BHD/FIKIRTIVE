/**
 * product-vocabulary-fence.test.ts —— 商家读得到的**产品名词围栏**（`FRONT-A14`）。
 *
 * FRONT-A14 是 Founder 走 Home → Create / Canvas → Library → Brand → Settings → Auth
 * 六面、逐面对已批准设计。词汇不一致正是那趟走查最容易撞上、又最容易被下一个 PR 撞回去
 * 的一类差异——`Canvas` 那一个词在 2026-09-04 才刚收成单源（`canvas-title.ts`），而 Otto
 * 前门的 `QuickBrief` 直到 2026-09-06 第三轮才把最后一处 "project" 换掉。人走一趟能发现
 * 它，机器每次都能。
 *
 * 两道判据，同一套「商家读得到的字」提取器：
 *   ① **旧词**（`RETIRED_PRODUCT_WORDS`）不许出现在界面文案里；
 *   ② **五个现行产品名**不许以裸字面量出现——要从 `lib/product-vocabulary.ts` 取词，
 *      否则「单源」这条性质没有任何机器在守（判官 #1251 P1-2）。
 *
 * **扫描范围＝面的真实渲染树，不是同名目录**（判官 #1251 P1-1：按目录划面时，Otto 面板
 * 与 Brand 两面渲染的组件住在 `components/otto/` 上层，扫不到，围栏名不副实还长绿）：
 *   · Otto 面板：`OttoPanelConversation` 在无活动对话时渲染 `components/otto/OttoFrontDoor`，
 *     前门再渲染 `components/otto/QuickBrief` —— 所以整个 `components/otto/` 都要扫；
 *   · Brand：`/brand/records` 渲染 `components/otto/OttoMemory` 与 `components/otto/memory/*`；
 *     `components/otto/stuff/` 也在两面的渲染树里（`OttoStuff` 与 Brand 的
 *     `memory/ProductImagePickerDialog` 都渲染 `stuff/StuffLibrary`），所以整棵一并扫
 *     （判官 #1251 第三轮 P2-1 推翻了上一轮「旧壳，不在 beta 六面」的说法）。
 *   · `components/otto/panel` 与 `components/brand` 是**软链**（分别指向
 *     `design-system/patterns/otto-panel` 与 `design-system/brand/components`）。目录遍历
 *     因此按 `statSync` 判目录（`Dirent.isDirectory()` 对软链返回 false，会把整棵 panel
 *     子树静静漏掉），并按 inode 去重防环。
 *
 * **这道围栏不拦什么**（写下来，免得下一个人以为是漏网）：
 *   · 普通名词。`asset`（一件素材）、`campaign`（商家自己在 Meta／TikTok 上跑的广告）
 *     都是真实存在的词，IA 裁掉的是「一个 Assets 面」「一个 Campaign 产品对象」。
 *   · 注释、`className`、`${…}` 插值里的字：不是商家读到的字。
 *   · `console.*(…)` 那一行：开发者日志，不是界面文案。
 *   · **全小写的单词片段**（`"project"`、`"canvas"`）：判别式常量、query 参数、路由片段。
 *     首字母大写的单词片段（`Assets`、`Library`）照扫——那正是面名标签的形状
 *     （判官 #1251 P2-3：一律跳过没有空格的片段，等于让 `<h2>Projects</h2>` 永远漏网）。
 *   · **小写开头的解构参数续行**（`  projects,` 独占一行）：见 `CODE_CONTINUATION_LINE`。
 *     合并散文段之后它才成问题，所以排除写在那里，不在这条清单上多说；大写开头的
 *     `Canvas,` 是标签文案的形状，照扫（判官 #1251 第五轮 P2-1）。
 *   · **剩下的盲点**（有已知实例，写在这里免得下一个人以为守住了）：一句话被拆成
 *     「半行 JSX ＋ 半行文字」时仍会漏，例如
 *     `<p>Otto uses this on every <strong>Canvas</strong>` 这种把词包进标签的写法——
 *     `<>` 一出现那一行就不算散文，也就接不进散文段。数据库里商家自填的文本同样管不到。
 *   · **跳过的是「整段全小写」，不是「整行全小写」**（判官 #1251 第四轮）：连续的散文行
 *     先合并成一段再判，所以 `Otto keeps it consistent across every` ／ `project.` 拆成
 *     两行也照样命中；只有合并后**整段没有一个大写字母**（判别式常量、query 参数、
 *     路由片段独占一行的形状）才跳过。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRODUCT_VOCABULARY,
  RETIRED_PRODUCT_WORDS,
  productWordLiteralsIn,
  retiredProductWordsIn,
} from "@/lib/product-vocabulary";

const WEB_ROOT = join(__dirname, "..", "..");

/**
 * FRONT-A14 原文的六面（Home / Create·Canvas / Library / Brand / Settings / Auth），
 * 外加 **Otto 面板** —— 它不在 FRONT-A14 那一行里，但它是旧词的重灾区，而且和那六面
 * 共用同一批组件，所以一并扫（判官 #1251 P2-2：别让测试名说得比守得住的多）。
 */
const SCANNED_SURFACES: readonly { readonly surface: string; readonly roots: readonly string[] }[] = [
  { surface: "Home", roots: ["app/(home)", "components/home"] },
  { surface: "Create / Canvas", roots: ["app/create", "components/start-something", "components/canvas"] },
  { surface: "Library", roots: ["app/library", "components/library"] },
  // Brand 的编辑入口今天是 `/brand/records` → `components/otto/OttoMemory` 与 `memory/*`。
  { surface: "Brand", roots: ["app/brand", "components/brand", "components/otto/memory"] },
  { surface: "Settings", roots: ["app/settings", "app/profile", "app/billing", "components/settings", "components/billing"] },
  { surface: "Auth", roots: ["app/login", "app/signup", "app/forgot-password", "app/reset-password", "app/verify-email"] },
  // Otto 面板的真实渲染树:面板软链 + 前门 + 前门底下的卡片,全在 `components/otto/` 里。
  { surface: "Otto 面板", roots: ["components/otto"] },
];

/**
 * 整棵不扫的子树（每一条都要在 §5 有登记，否则它就是个后门）。今天一条都没有：
 * `components/otto/stuff/` 上一轮以「旧壳素材库，不在 beta 六面」为由排除，那句话是错的
 * （判官 #1251 第三轮 P2-1）—— `stuff/StuffLibrary.tsx` 由 `components/otto/OttoStuff.tsx`
 * 与 Brand 面的 `components/otto/memory/ProductImagePickerDialog.tsx` 双双渲染，商家读得到
 * 里面的字。本轮纳入扫描。
 */
const UNSCANNED_SUBTREES: readonly string[] = [];

/**
 * 一条具名豁免：`copy` 是**商家读得到的那一整段**（提取器合并之后的文本），不是源码行。
 * 只有「这个文件里、整段就是这一句」才放行——见 `isExemptSegment`。
 */
interface ExemptCopy {
  readonly file: string;
  readonly copy: string;
  readonly why: string;
}

/**
 * 「旧词零出现」的**具名豁免**：整句列在这里，改一个字就不再豁免（所以它挡不住漂移，
 * 只挡这一句）。今天只有一条，理由是两条 Founder 裁决撞了车，归 Founder 裁，不由围栏自决。
 */
const RETIRED_WORD_EXEMPT_COPY: readonly ExemptCopy[] = [
  {
    file: "components/otto/OttoMemory.tsx",
    copy: "What Otto remembers about your brand — Otto uses it in every project.",
    why: "#682（Founder 2026-08-08 人称裁决）的逐处钉板按源码字面钉着这一整句（otto-pronoun-consistency.test.ts:525），brand-route.test.ts:406 又按 DOM 文本钉一次，那一段抬头写着「规格书 §4.4 的原话，一个字不许改」；与 IA 2026-08-30 的 Project → Canvas 冲突，已登记 docs/specs/frontend-baseline.md §5 等 Founder 裁。",
  },
];

/**
 * 「五个现行产品名不许写裸字面量」的豁免——**按整句，不按文件**（判官 #1251 第四轮 P2-1：
 * 按文件豁免时，那个文件里此后新写的每一处裸字面量都白白搭了顺风车；上一轮两个豁免文件
 * 里实际站得住的只有 `Canvas history` 那一行）。形状与 `RETIRED_WORD_EXEMPT_COPY` 一样：
 * 整句列在这里，改一个字就不再豁免。
 *
 * 唯一站得住的理由：那一句被别的围栏**按源码字面**钉在设计系统夹具上，而夹具对所有段
 * 只读（`frontend-baseline.md` §7.4 裁决九），改成 `${PRODUCT_VOCABULARY.canvas}` 会让那道围栏红。
 */
const SINGLE_SOURCE_EXEMPT_COPY: readonly ExemptCopy[] = [
  {
    file: "components/start-something/CreateWorkspace.tsx",
    // 商家读到的整段就是这两个词(那一整行源码见 `why` 里的三道钉板)。
    copy: "Canvas history",
    why: "这一整行被 create-design-parity.test.tsx:139 逐字比对夹具 CreateWorkspaceReference.tsx，另有 create-design-system.test.ts:36 与 create-route-rename.test.ts:65 两道按源码字面的 toContain。",
  },
];

function sourceFilesUnder(dir: string, seen: Set<string>, out: string[]): string[] {
  let stat: import("node:fs").Stats;
  try {
    stat = statSync(dir);
  } catch {
    return out;
  }
  if (!stat.isDirectory()) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    let entryStat: import("node:fs").Stats;
    try {
      entryStat = statSync(full); // 软链要跟过去:panel/ 与 brand/ 都是软链目录。
    } catch {
      continue;
    }
    if (entryStat.isDirectory()) {
      const identity = `${entryStat.dev}:${entryStat.ino}`;
      if (seen.has(identity)) continue; // 防环,也防同一棵树被两条软链扫两遍。
      seen.add(identity);
      sourceFilesUnder(full, seen, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function filesOfSurface(roots: readonly string[]): string[] {
  const seen = new Set<string>();
  const files = roots.flatMap((root) => sourceFilesUnder(join(WEB_ROOT, root), seen, []));
  return files.filter((file) => {
    const rel = file.slice(WEB_ROOT.length + 1);
    return !UNSCANNED_SUBTREES.some((subtree) => rel.startsWith(`${subtree}/`));
  });
}

/** 注释里的字不是商家读到的字。剥掉时保留行数与列数，报错才报得准行号。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (all, keep: string) => keep + " ".repeat(all.length - keep.length));
}

/** 一段商家读得到的文案，连同它在文件里从第几行开始、到第几行结束（报错要报得出行号）。 */
interface CopySegment {
  readonly line: number;
  /** 合并散文段的最后一行；单行段与 `line` 相同。具名豁免只认「整段就是那一句」。 */
  readonly endLine: number;
  readonly text: string;
}

/**
 * 解构参数与对象字面量的**续行**：`filters,` / `sidebarThreads: threads,` 这种
 * 「小写开头的一个词、以逗号结尾」独占一行的形状。它们不含 `<>{}=();[]`，逐行判时无所谓，
 * 合并成段之后却会和邻行拼成假文案（`OttoThreadList({ projects, activeProjectId, … })`
 * 拼出来就带着 `projects` 这个旧词）。
 *
 * **只收小写开头**（判官 #1251 第五轮 P2-1）：不分大小写时，`Canvas,` ／ `Projects,` 这种
 * 独占一行的**标签文案**也被当成续行放走，还顺手把散文段从那一行切断。今天真暴露的五处
 * 续行全是小写开头的解构参数，收紧不碰它们。
 */
const CODE_CONTINUATION_LINE = /^[a-z_$][\w$]*(?:\s*:\s*[\w$.]+)?[,;]$/;

/** 这一行是不是「整行都是散文」：剥掉样式与 HTML 实体后非空，且不含任何代码形状。 */
function proseOf(line: string): string {
  const withoutStyles = line.replace(/\b(?:className|class)=(?:\{[^}]*\}|"[^"]*"|'[^']*')/g, " ");
  const prose = withoutStyles.replace(/&[a-z]+;/g, "").trim();
  if (!prose || /[<>{}=();[\]]/.test(prose) || CODE_CONTINUATION_LINE.test(prose)) return "";
  return prose;
}

/**
 * 商家读得到的片段：字符串字面量 / 同行的 JSX 文本 / **连续散文行合并成的整段**。
 *
 * 每一处排除都对应一类**不是文案**的字符串——留着它们，围栏就会逼人把变量名和样式类
 * 改成假话（误报比漏报更贵：它把人训练成绕过围栏）：
 *   · `className` / `class` 的值是样式作用域名（Tailwind 的 `group/project`）；
 *   · `${…}` 插值里是表达式，商家读到的是它的**值**；
 *   · `console.*` 是开发者日志；
 *   · 没有空格、又不是大写起头的单词片段是标识符／query 参数／路由片段。
 *
 * 「散文段」那一条补的是最常见的一个漏：多行 JSX 里，一句 `<EmptyDescription>` 的正文
 * 独占一行或几行，同行既没有 `>` 也没有 `<`，按同行规则永远抓不到（`FactSection.tsx`
 * 的删除影响句就是这样藏了下来）。
 *
 * **合并是 2026-09-06 第四轮补的**（判官 #1251 P1-2）：判据此前逐行判，于是一句话被
 * 折行折断时，**尾巴那一行独占的小写单词**会被当成标识符跳过——`StuffLibrary.tsx` 的
 * 上手空态正是这样藏了三轮：`… across every` 一行、`project.` 一行，两行分开看都不像
 * 文案，围栏长绿。现在先把**连续的散文行**按行序拼成一段（行号记第一行），再对整段判
 * 「是不是全小写」与旧词／裸字面量；整段一个大写字母都没有才跳过。
 */
function copySegmentsOf(input: string | readonly string[]): CopySegment[] {
  const lines = typeof input === "string" ? [input] : input;
  const segments: CopySegment[] = [];
  let proseStart = -1;
  let proseEnd = -1;
  let proseParts: string[] = [];

  const flushProse = () => {
    if (proseParts.length > 0) {
      const merged = proseParts.join(" ").trim();
      // 整段全小写＝标识符／query 参数／路由片段的形状,跳过;有一个大写字母就当文案。
      if (merged && merged !== merged.toLowerCase()) {
        segments.push({ line: proseStart, endLine: proseEnd, text: merged });
      }
    }
    proseParts = [];
    proseStart = -1;
    proseEnd = -1;
  };

  lines.forEach((line, index) => {
    if (/\bconsole\.\w+\(/.test(line)) {
      flushProse();
      return;
    }
    const withoutStyles = line.replace(/\b(?:className|class)=(?:\{[^}]*\}|"[^"]*"|'[^']*')/g, " ");
    const literals = [...withoutStyles.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g)]
      .map((match) => match[1] ?? match[2] ?? match[3] ?? "");
    const jsxText = [...withoutStyles.matchAll(/>([^<>{}]+)</g)].map((match) => match[1]);
    for (const raw of [...literals, ...jsxText]) {
      const text = raw.replace(/\$\{[^}]*\}/g, " ");
      if (/\s/.test(text.trim()) || /^[A-Z]/.test(text.trim())) {
        segments.push({ line: index, endLine: index, text });
      }
    }

    const prose = proseOf(line);
    if (prose) {
      if (proseStart < 0) proseStart = index;
      proseEnd = index;
      proseParts.push(prose);
    } else {
      flushProse();
    }
  });
  flushProse();
  return segments;
}

/** 只要文本的薄壳：自证用例读起来直白些,扫描走 `copySegmentsOf` 是为了拿行号。 */
function merchantCopySegments(input: string | readonly string[]): string[] {
  return copySegmentsOf(input).map((segment) => segment.text);
}

/**
 * 具名豁免只在**整段就是那一句**时生效（判官 #1251 第五轮 P1-1）：上一轮按 hit 字符串
 * 里的 `includes` 判，而 hit 只带合并段的**第一行**原文，于是把豁免句写在段首、下一行
 * 紧跟一句真旧词，整段一起被放行（实证：在 `OttoMemory.tsx:545` 下面插一行
 * 「Every project you start shows up here automatically.」，围栏 22 passed 全绿）。
 */
function isExemptSegment(exemptions: readonly ExemptCopy[], rel: string, segment: CopySegment): boolean {
  return exemptions.some(
    (e) => e.file === rel && segment.line === segment.endLine && segment.text === e.copy,
  );
}

function scan(
  files: readonly string[],
  find: (copy: string) => readonly string[],
  label: string,
  exemptions: readonly ExemptCopy[],
): string[] {
  const hits = new Set<string>();
  for (const file of files) {
    const rel = file.slice(WEB_ROOT.length + 1);
    for (const segment of copySegmentsOf(stripComments(readFileSync(file, "utf8")).split("\n"))) {
      if (isExemptSegment(exemptions, rel, segment)) continue;
      // 报的是合并后的整段,不是第一行原文 —— 折行的一句话要看得见全貌。
      for (const found of find(segment.text)) {
        hits.add(`${rel}:${segment.line + 1} ${label}「${found}」 → ${segment.text}`);
      }
    }
  }
  return [...hits];
}

const SURFACE_CASES = SCANNED_SURFACES.map((s) => [s.surface, s.roots] as const);

describe("FRONT-A14 词汇围栏:界面文案不再出现被裁掉的旧产品名", () => {
  it.each(SURFACE_CASES)("FRONT-A14 %s 面的界面文案零旧产品名", (_surface, roots) => {
    const files = filesOfSurface(roots);
    expect(files.length, `这一面的目录一个都没扫到,围栏形同虚设:${roots.join(", ")}`).toBeGreaterThan(0);
    const hits = scan(files, retiredProductWordsIn, "旧词", RETIRED_WORD_EXEMPT_COPY);
    expect(
      hits,
      `这些界面文案还在用被裁掉的旧产品名。改法:从 lib/product-vocabulary.ts 取词。\n${hits.join("\n")}`,
    ).toEqual([]);
  });
});

describe("FRONT-A14 词汇围栏:五个产品名只在 lib/product-vocabulary.ts 定义一次", () => {
  it.each(SURFACE_CASES)("FRONT-A14 %s 面不写产品名的裸字面量", (_surface, roots) => {
    const hits = scan(filesOfSurface(roots), productWordLiteralsIn, "裸字面量", SINGLE_SOURCE_EXEMPT_COPY);
    expect(
      hits,
      `这些文案手抄了产品名。改法:引用 PRODUCT_VOCABULARY（显示的字一个不变）。\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  it("FRONT-A14 单源豁免逐句核对:按整句放行,那一句必须还在原文件里,且写明是哪道围栏在钉", () => {
    // 按文件豁免＝那个文件此后新写的裸字面量全搭顺风车(判官 #1251 第四轮 P2-1)。
    for (const { file, copy, why } of SINGLE_SOURCE_EXEMPT_COPY) {
      expect(statSync(join(WEB_ROOT, file)).isFile(), `${file} 已不存在,豁免该删了`).toBe(true);
      expect(readFileSync(join(WEB_ROOT, file), "utf8"), `${file} 里已经没有这一句,豁免该删了`).toContain(copy);
      expect(why, `${file} 的豁免没写清是哪道围栏在钉`).toMatch(/test\.tsx?|parity|rename/);
    }
  });

  it("FRONT-A14 旧词豁免逐句核对:那一句必须还在原文件里,一改字就该把豁免删掉", () => {
    // 豁免最容易腐坏的方式是「那句话早改了,豁免还留着,于是替一整类旧词开了后门」。
    for (const { file, copy, why } of RETIRED_WORD_EXEMPT_COPY) {
      expect(readFileSync(join(WEB_ROOT, file), "utf8"), `${file} 里已经没有这一句,豁免该删了`).toContain(copy);
      expect(why, `${file} 的豁免没写清是谁在钉、去哪儿裁`).toMatch(/§5/);
    }
  });
});

describe("FRONT-A14 词汇围栏自证", () => {
  it("FRONT-A14 围栏抓得住:把旧词与裸产品名塞回一句文案,它必须命中", () => {
    // 围栏最坏的失败方式是「什么都没扫到,于是永远绿」。
    expect(retiredProductWordsIn("This moves it out of your projects.")).toContain("Project");
    expect(retiredProductWordsIn("Brand IQ remembers this.")).toContain("Brand IQ");
    expect(retiredProductWordsIn("Assets")).toContain("Assets（作为面／分区的名字）");
    expect(productWordLiteralsIn("It lands in your Library.")).toContain("Library");
    expect(productWordLiteralsIn("Canvas")).toContain("Canvas");
    // 反面:普通名词与标识符不许误伤,否则围栏会逼着人把真话改成假话。
    expect(retiredProductWordsIn("This asset is not ready for details yet.")).toEqual([]);
    expect(retiredProductWordsIn("projectId")).toEqual([]);
    expect(productWordLiteralsIn("canvasHistory")).toEqual([]);
  });

  it("FRONT-A14 提取器认得整行散文的 JSX 文本,也认得首字母大写的单词标签", () => {
    // 两条都是判官 #1251 点名的漏:前者藏住了 FactSection 的删除影响句,后者藏住了面名标签。
    expect(merchantCopySegments("              Otto will stop using this detail in future projects.")).toEqual([
      "Otto will stop using this detail in future projects.",
    ]);
    expect(merchantCopySegments("<h2>Projects</h2>")).toContain("Projects");
    // 独占一行的一两个词:多行 JSX 里徽章／标签最常见的形状,放宽前整类是盲区
    // (判官 #1251 第三轮 P1-2,实例是 OttoThreadList 的画布徽章)。
    expect(merchantCopySegments("              Canvas")).toEqual(["Canvas"]);
    expect(merchantCopySegments("              Otto IQ")).toEqual(["Otto IQ"]);
    // 反面:标识符、样式类、日志、插值都不算文案。
    expect(merchantCopySegments('const key = "project";')).toEqual([]);
    expect(merchantCopySegments('<div className="group/project flex items-center">')).toEqual([]);
    expect(merchantCopySegments('console.warn("canvas recovery will place its card");')).toEqual([]);
    expect(merchantCopySegments("<span>{project.name}</span>")).toEqual([]);
    expect(merchantCopySegments("              project")).toEqual([]);
  });

  it("FRONT-A14 提取器把折行的一句话先合并再判,尾巴那一行独占的小写词不再当标识符放走", () => {
    // 这是 `StuffLibrary.tsx` 的上手空态藏了三轮的形状(判官 #1251 第四轮 P1-2):
    // 「… across every」一行、「project.」一行,逐行判时后一行全小写被当标识符跳过。
    const wrapped = ["    Otto keeps it consistent across every", "    project."];
    expect(merchantCopySegments(wrapped)).toEqual(["Otto keeps it consistent across every project."]);
    expect(retiredProductWordsIn(merchantCopySegments(wrapped)[0]!)).toContain("Project");
    // 合并后的行号记的是第一行,报错才指得回那句话的开头。
    expect(copySegmentsOf(["", ...wrapped])[0]?.line).toBe(1);
    // 非散文的一行把段落切断:两句不相干的话不会被拼成一段。
    expect(merchantCopySegments(["    Otto keeps it consistent across every", "    <Button>", "    project."])).toEqual(
      ["Otto keeps it consistent across every"],
    );
    // 「整段全小写」仍然跳过 —— 跳过的判据从「整行」挪到了「整段」,不是取消了。
    expect(merchantCopySegments(["    canvas", "    project"])).toEqual([]);
  });

  it("FRONT-A14 合并不把解构参数当文案:一行一个标识符加逗号的形状不进散文段", () => {
    // 合并带来的唯一一类新误报:`OttoThreadList({ projects, activeProjectId, … })` 这样
    // 一行一个参数的写法,逐行都不含代码字符,拼起来却带着 `projects` 这个旧词。
    const destructuring = ["export function OttoThreadList({", "  projects,", "  activeProjectId,", "}) {"];
    expect(merchantCopySegments(destructuring)).toEqual([]);
    expect(merchantCopySegments(["  sidebarThreads: threads,"])).toEqual([]);
    // 反面:真文案里的逗号结尾行(多个词)照旧算散文,不许借这条规则开后门。
    expect(merchantCopySegments(["    Upload a product photo,", "    a character, or a logo."])).toEqual([
      "Upload a product photo, a character, or a logo.",
    ]);
    // 反面:大写开头的一个词加逗号是标签文案的形状,不是续行(判官 #1251 第五轮 P2-1);
    // 收紧前它既被放走、又把散文段从那一行切断。
    expect(merchantCopySegments(["    Canvas,"])).toEqual(["Canvas,"]);
    expect(merchantCopySegments(["    Projects,"])).toEqual(["Projects,"]);
    expect(merchantCopySegments(["    Save this to your", "    Library,", "    then reuse it."])).toEqual([
      "Save this to your Library, then reuse it.",
    ]);
  });

  it("FRONT-A14 具名豁免只放行整段就是那一句:豁免句一旦和邻行合并成段就不再豁免", () => {
    // 第四轮的回归(判官 #1251 第五轮 P1-1):豁免此前按 hit 字符串 includes 判,而 hit 只带
    // 合并段的第一行原文,于是「豁免句在段首、下一行是真旧词」整段搭顺风车。
    const { file, copy } = RETIRED_WORD_EXEMPT_COPY[0]!;
    const alone: CopySegment = { line: 544, endLine: 544, text: copy };
    expect(isExemptSegment(RETIRED_WORD_EXEMPT_COPY, file, alone)).toBe(true);

    const withNeighbour: CopySegment = {
      line: 544,
      endLine: 545,
      text: `${copy} Every project you start shows up here automatically.`,
    };
    expect(isExemptSegment(RETIRED_WORD_EXEMPT_COPY, file, withNeighbour)).toBe(false);
    expect(retiredProductWordsIn(withNeighbour.text)).toContain("Project");

    // 豁免也只认那一个文件:别处照抄同一句话不放行。
    expect(isExemptSegment(RETIRED_WORD_EXEMPT_COPY, "components/otto/OttoStuff.tsx", alone)).toBe(false);
  });

  it("FRONT-A14 目录遍历跟得过软链:panel 与 brand 两棵软链子树真的被扫到了", () => {
    // `Dirent.isDirectory()` 对软链返回 false —— 上一版围栏就是这样把整棵 panel 漏掉的。
    const ottoPanelFiles = filesOfSurface(["components/otto"]).map((f) => f.slice(WEB_ROOT.length + 1));
    expect(ottoPanelFiles).toContain("components/otto/panel/OttoPanelHost.tsx");
    expect(ottoPanelFiles).toContain("components/otto/QuickBrief.tsx");
    // stuff/ 由 OttoStuff 与 Brand 的 ProductImagePickerDialog 双双渲染,商家读得到,
    // 所以它必须在扫描范围内(判官 #1251 第三轮 P2-1 推翻了上一轮的「不在 beta 六面」)。
    expect(ottoPanelFiles).toContain("components/otto/stuff/StuffLibrary.tsx");
    expect(UNSCANNED_SUBTREES).toEqual([]);
    expect(filesOfSurface(["components/brand"]).length).toBeGreaterThan(0);
  });

  it("FRONT-A14 五个产品名词的拼写以 lib/product-vocabulary.ts 为准,且每条旧词都指向其中一个", () => {
    // 词本身是 Founder 裁的（IA README §6 与 2026-08-22 的 Brand → Otto IQ），
    // 这一条钉的是「代码里的拼写没有被谁顺手改掉」。
    expect(PRODUCT_VOCABULARY).toEqual({
      canvas: "Canvas",
      library: "Library",
      elements: "Elements",
      ottoIq: "Otto IQ",
      workspace: "Workspace",
    });
    for (const word of RETIRED_PRODUCT_WORDS) {
      expect(PRODUCT_VOCABULARY[word.replacedBy], `${word.retired} 指向了一个不存在的词`).toBeTruthy();
      expect(word.ruling.length, `${word.retired} 没写清是谁在什么时候裁的`).toBeGreaterThan(10);
    }
  });
});
