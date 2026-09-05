/**
 * product-vocabulary-fence.test.ts —— beta 六面的**旧产品名围栏**（`FRONT-A14`）。
 *
 * FRONT-A14 是 Founder 走 Home → Create / Canvas → Library → Brand → Settings 六面、
 * 逐面对已批准设计。词汇不一致正是那趟走查最容易撞上、又最容易被下一个 PR 撞回去的一
 * 类差异——`Canvas` 那一个词在 2026-09-04 才刚收成单源（`canvas-title.ts`），而 Otto
 * 面板的重命名／删除对话到今天还在对商家说 "project"。人走一趟能发现它，机器每次都能。
 *
 * **这道围栏拦什么**：`lib/product-vocabulary.ts` 里 `RETIRED_PRODUCT_WORDS` 那几个
 * 被 Founder 裁掉的旧产品名，出现在 beta 六面的**界面文案**里。判据是「商家读得到的
 * 字」——字符串字面量、模板串、JSX 文本；注释与标识符（`projectId`、`activeProject`、
 * `AssetLineage`）都不算，所以整词匹配之外还先剥注释。
 *
 * **这道围栏不拦什么**（写下来，免得下一个人以为是漏网）：
 *   · 普通名词。`asset`（一件素材）、`campaign`（商家自己在 Meta／TikTok 上跑的广告）
 *     都是真实存在的词，IA 裁掉的是「一个 Assets 面」「一个 Campaign 产品对象」，
 *     不是这两个字本身。
 *   · 六面之外。`components/otto/stuff/StuffLibrary.tsx`（旧壳素材库）今天还留着同一句
 *     "show up in projects" —— 它不在 beta 六面里，本轮不动，登记在
 *     `docs/specs/frontend-baseline.md` §5。
 *   · 路由、query 参数、数据库列名里的 `project`：那是 `Project` 模型的真名，冻结非目标
 *     写明不改（`canvas-title.ts` 抬头）。它们不是字面量文案，本围栏本来就扫不到。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRODUCT_VOCABULARY,
  RETIRED_PRODUCT_WORDS,
  retiredProductWordsIn,
} from "@/lib/product-vocabulary";

const WEB_ROOT = join(__dirname, "..", "..");

/** beta 六面的源码树（Home / Create / Library / Brand / Settings / Otto 面板）。 */
const SURFACES_IN_BETA: readonly { readonly surface: string; readonly roots: readonly string[] }[] = [
  { surface: "Home", roots: ["app/(home)", "components/home"] },
  { surface: "Create / Canvas", roots: ["app/create", "components/start-something", "components/canvas"] },
  { surface: "Library", roots: ["app/library", "components/library"] },
  { surface: "Brand", roots: ["app/brand", "components/brand"] },
  { surface: "Settings", roots: ["app/settings", "app/profile", "app/billing", "components/settings", "components/billing"] },
  { surface: "Otto 面板", roots: ["components/otto/panel"] },
];

function sourceFilesUnder(dir: string, out: string[] = []): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFilesUnder(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

/** 注释里的字不是商家读到的字。剥掉时保留行数与列数，报错才报得准行号。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (all, keep: string) => keep + " ".repeat(all.length - keep.length));
}

/**
 * 一行里商家读得到的片段：字符串字面量 / 模板串 / JSX 文本。
 *
 * 三处刻意的排除，每一处都对应一类**不是文案**的字符串——留着它们，围栏就会逼人把
 * 变量名和样式类改成假话（判官口径：误报比漏报更贵，因为它会把人训练成绕过围栏）：
 *   · `className` / `class` 的值：Tailwind 的 `group/project`、`group-hover/project:` 是
 *     样式作用域名，不是给人读的字；
 *   · `${…}` 插值：里面是表达式（`${project.name}`），商家读到的是它的**值**，不是这段源码；
 *   · 单个词、没有空格的片段：`"project"` 这种是判别式常量、query 参数名或路由片段，
 *     商家读到的文案至少是一个词组。
 */
function merchantCopySegments(line: string): string[] {
  const withoutStyles = line.replace(/\b(?:className|class)=(?:\{[^}]*\}|"[^"]*"|'[^']*')/g, " ");
  const literals = [...withoutStyles.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "");
  const jsxText = [...withoutStyles.matchAll(/>([^<>{}]+)</g)].map((match) => match[1]);
  return [...literals, ...jsxText]
    .map((segment) => segment.replace(/\$\{[^}]*\}/g, " "))
    .filter((segment) => /\s/.test(segment.trim()));
}

function retiredWordHits(files: readonly string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const rawLines = raw.split("\n");
    stripComments(raw).split("\n").forEach((line, index) => {
      for (const segment of merchantCopySegments(line)) {
        for (const retired of retiredProductWordsIn(segment)) {
          hits.push(`${file.slice(WEB_ROOT.length + 1)}:${index + 1} 旧词「${retired}」 → ${rawLines[index].trim()}`);
        }
      }
    });
  }
  return hits;
}

describe("FRONT-A14 词汇围栏:beta 六面的界面文案不再出现被裁掉的旧产品名", () => {
  it.each(SURFACES_IN_BETA.map((s) => [s.surface, s.roots] as const))(
    "FRONT-A14 %s 面的界面文案零旧产品名",
    (_surface, roots) => {
      const files = roots.flatMap((root) => sourceFilesUnder(join(WEB_ROOT, root)));
      expect(files.length, `写集里的目录一个都没扫到,围栏形同虚设:${roots.join(", ")}`).toBeGreaterThan(0);
      const hits = retiredWordHits(files);
      expect(
        hits,
        `这些界面文案还在用被裁掉的旧产品名。改法:从 lib/product-vocabulary.ts 取词。\n${hits.join("\n")}`,
      ).toEqual([]);
    },
  );

  it("FRONT-A14 围栏自己抓得住:把旧词塞回一句文案里,它必须命中", () => {
    // 一句自证 —— 围栏最坏的失败方式是「什么都没扫到，于是永远绿」。
    expect(retiredProductWordsIn('This moves it out of your projects.')).toContain("Project");
    expect(retiredProductWordsIn('Brand IQ remembers this.')).toContain("Brand IQ");
    expect(retiredProductWordsIn('Assets')).toContain("Assets（作为面／分区的名字）");
    // 反面:普通名词与标识符不许误伤,否则围栏会逼着人把真话改成假话。
    expect(retiredProductWordsIn("This asset is not ready for details yet.")).toEqual([]);
    expect(retiredProductWordsIn("projectId")).toEqual([]);
    expect(retiredProductWordsIn("activeProject")).toEqual([]);
  });

  it("FRONT-A14 五个产品名词的拼写以本文件为准,且每条旧词都指向其中一个", () => {
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
