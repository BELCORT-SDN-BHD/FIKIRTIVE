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
 *   · **剩下的盲点**（有已知实例，写在这里免得下一个人以为守住了）：跨行的 JSX 文本节点
 *     只在**整行都是散文**时才认得出（见 `merchantCopySegments`）——一句话被拆成
 *     「半行 JSX ＋ 半行文字」时会漏，例如
 *     `<p>Otto uses this on every <strong>Canvas</strong>` 这种把词包进标签的写法，
 *     `<>` 一出现整行就不算散文了。**全小写的独占行**（`project` 独占一行）也跳过，
 *     那是标识符的形状。数据库里商家自填的文本本围栏同样管不到。
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
 * 「旧词零出现」的**具名豁免**：整句列在这里，改一个字就不再豁免（所以它挡不住漂移，
 * 只挡这一句）。今天只有一条，理由是两条 Founder 裁决撞了车，归 Founder 裁，不由围栏自决。
 */
const RETIRED_WORD_EXEMPT_COPY: readonly { readonly file: string; readonly copy: string; readonly why: string }[] = [
  {
    file: "components/otto/OttoMemory.tsx",
    copy: "What Otto remembers about your brand — Otto uses it in every project.",
    why: "#682（Founder 2026-08-08 人称裁决）的逐处钉板按源码字面钉着这一整句（otto-pronoun-consistency.test.ts:525），brand-route.test.ts:406 又按 DOM 文本钉一次，那一段抬头写着「规格书 §4.4 的原话，一个字不许改」；与 IA 2026-08-30 的 Project → Canvas 冲突，已登记 docs/specs/frontend-baseline.md §5 等 Founder 裁。",
  },
];

/**
 * 「五个现行产品名不许写裸字面量」的豁免文件。只有一个理由站得住：那一句被别的围栏
 * **按源码字面**钉在设计系统夹具上，而夹具对所有段只读（`frontend-baseline.md` §7.4 裁决九），
 * 改成 `${PRODUCT_VOCABULARY.canvas}` 会让那道围栏红。
 */
const SINGLE_SOURCE_EXEMPT_FILES: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: "components/start-something/CreateWorkspace.tsx",
    why: "`Canvas history` 那一行被 create-design-parity.test.tsx:139 逐字比对夹具 CreateWorkspaceReference.tsx，另有 create-design-system / create-route-rename 两道 toContain。",
  },
  {
    file: "components/canvas/NorthstarHome.tsx",
    why: "CreateWorkspace 的成对实现（create-route-rename.test.ts 抬头写明「NorthstarHome pair」），两边文案保持逐字相同才比得下去。",
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

/**
 * 一行里商家读得到的片段：字符串字面量 / 同行的 JSX 文本 / 整行都是散文的 JSX 文本行。
 *
 * 每一处排除都对应一类**不是文案**的字符串——留着它们，围栏就会逼人把变量名和样式类
 * 改成假话（误报比漏报更贵：它把人训练成绕过围栏）：
 *   · `className` / `class` 的值是样式作用域名（Tailwind 的 `group/project`）；
 *   · `${…}` 插值里是表达式，商家读到的是它的**值**；
 *   · `console.*` 是开发者日志；
 *   · 全小写、没有空格的单词片段是标识符／query 参数／路由片段。
 *
 * 「整行散文」那一条补的是最常见的一个漏：多行 JSX 里，一句 `<AlertDescription>` 的正文
 * 独占一行，同行既没有 `>` 也没有 `<`，按同行规则永远抓不到（`FactSection.tsx` 的删除
 * 影响句就是这样藏了下来）。判据＝整行没有 `<>{}=();[]`、非空、不是全小写。
 *
 * **判据在 2026-09-06 放宽过一次**（判官 #1251 第三轮 P1-2）：原本还要求「至少三个词」，
 * 于是**独占一行的一两个词**——多行 JSX 里最常见的徽章／标签形状，例如
 * `OttoThreadList.tsx` 那个独占一行的 `Canvas` 徽章——整类都是盲区。现在只要整行是散文
 * 且带大写字母就算文案；全小写的独占行（`project`、`canvas`）仍跳过，那是标识符的形状。
 */
function merchantCopySegments(line: string): string[] {
  if (/\bconsole\.\w+\(/.test(line)) return [];
  const withoutStyles = line.replace(/\b(?:className|class)=(?:\{[^}]*\}|"[^"]*"|'[^']*')/g, " ");
  const literals = [...withoutStyles.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "");
  const jsxText = [...withoutStyles.matchAll(/>([^<>{}]+)</g)].map((match) => match[1]);
  const proseOnly = withoutStyles.replace(/&[a-z]+;/g, "").trim();
  const proseLine =
    proseOnly && !/[<>{}=();[\]]/.test(proseOnly) && proseOnly !== proseOnly.toLowerCase() ? [proseOnly] : [];
  return [...literals, ...jsxText, ...proseLine]
    .map((segment) => segment.replace(/\$\{[^}]*\}/g, " "))
    .filter((segment) => /\s/.test(segment.trim()) || /^[A-Z]/.test(segment.trim()));
}

function scan(files: readonly string[], find: (copy: string) => readonly string[], label: string): string[] {
  const hits = new Set<string>();
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const rawLines = raw.split("\n");
    stripComments(raw).split("\n").forEach((line, index) => {
      for (const segment of merchantCopySegments(line)) {
        for (const found of find(segment)) {
          hits.add(`${file.slice(WEB_ROOT.length + 1)}:${index + 1} ${label}「${found}」 → ${rawLines[index].trim()}`);
        }
      }
    });
  }
  return [...hits];
}

const SURFACE_CASES = SCANNED_SURFACES.map((s) => [s.surface, s.roots] as const);

describe("FRONT-A14 词汇围栏:界面文案不再出现被裁掉的旧产品名", () => {
  it.each(SURFACE_CASES)("FRONT-A14 %s 面的界面文案零旧产品名", (_surface, roots) => {
    const files = filesOfSurface(roots);
    expect(files.length, `这一面的目录一个都没扫到,围栏形同虚设:${roots.join(", ")}`).toBeGreaterThan(0);
    const hits = scan(files, retiredProductWordsIn, "旧词").filter(
      (hit) => !RETIRED_WORD_EXEMPT_COPY.some((e) => hit.includes(e.file) && hit.includes(e.copy)),
    );
    expect(
      hits,
      `这些界面文案还在用被裁掉的旧产品名。改法:从 lib/product-vocabulary.ts 取词。\n${hits.join("\n")}`,
    ).toEqual([]);
  });
});

describe("FRONT-A14 词汇围栏:五个产品名只在 lib/product-vocabulary.ts 定义一次", () => {
  it.each(SURFACE_CASES)("FRONT-A14 %s 面不写产品名的裸字面量", (_surface, roots) => {
    const exempt = new Set(SINGLE_SOURCE_EXEMPT_FILES.map((e) => e.file));
    const files = filesOfSurface(roots).filter((file) => !exempt.has(file.slice(WEB_ROOT.length + 1)));
    const hits = scan(files, productWordLiteralsIn, "裸字面量");
    expect(
      hits,
      `这些文案手抄了产品名。改法:引用 PRODUCT_VOCABULARY（显示的字一个不变）。\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  it("FRONT-A14 单源豁免只有夹具逐字比对这一个理由,且每条都写明是哪一道围栏在钉", () => {
    for (const { file, why } of SINGLE_SOURCE_EXEMPT_FILES) {
      expect(statSync(join(WEB_ROOT, file)).isFile(), `${file} 已不存在,豁免该删了`).toBe(true);
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
