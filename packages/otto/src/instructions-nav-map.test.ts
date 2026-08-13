/**
 * #802 —— 界面地图硬规则的围栏(Founder 已裁;r4 收判官 r1/r3 六条判词)。
 *
 * 裁决改的是硬规则的**方向**,不是它的严格度:
 *   旧规则「不许提按钮」 → 新规则「**只许提地图里存在的入口**」。
 * 防瞎编一分未减(地图外的东西照旧不许说),但指路能力解锁 —— 商家问「怎么连 Instagram」,
 * 该听见的是 Settings › Connections,而不是一句「我看不见你的界面」。
 *
 * ── 为什么这道围栏能承重 ────────────────────────────────────────────────────
 * 「只许提地图里有的」如果只写在提示词里,它就只是一句愿望。这里把它变成可执行的四条:
 *   ① **规则文本在场** —— 肯定式断言,删一句就红。
 *   ② **描述面里写成路的地方都在地图里** —— 结构闭合,不是关键词扫描。
 *   ③ **源码里一个地名都不许手打** —— 提示词与指路文案的每个地名都走权威插值。
 *   ④ **没有人指着某个界面说话** —— 「入口名 + UI/page/screen」这种引用必须走权威或改写。
 *
 * ② 的做法与 #834 的「键集合双向相等」同宗:先让权威**可枚举**(core 的
 * `navPointableNames()`),再拿枚举去核对文本,而不是写正则去「读懂」一句英语在不在点名
 * 地方 —— #541 六轮已经证明后者封不死自然英语。
 *
 * ── ② 的四把尺子(都跑在归一化 + 剥离之后的残留上) ─────────────────────────
 *   (a) **剥完还剩分隔符** = 有一条路不在名单上。
 *   (b) **完整路名后紧跟一个大写词** = 在真入口后面接了一截(`Settings › Connections
 *       Advanced`)。剥离后残留无分隔符,(a) 看不见它。
 *   (c) **合法名 + 任意标点 + 大写词** = 用某种符号把两截拼成一条路。
 *       r3 判官 [P2-2] 补过 `∕`(U+2215)、`：`(全角冒号)、`⇒` —— **字符表永远数不完**,
 *       所以这把尺子不认字符,认**形状**:名字后面凡是「非字母非数字非空白」的连接符
 *       (句末标点 `.,;!?` 除外)再接一个大写词,一律算拼路。归一化字符族只用来让报错
 *       好读,不再承担封闭性。
 *   (d) **两个合法单段名只隔空白相邻** = 不写符号也能拼(`CRM Library`)。地图上真实存在
 *       的组合(`CRM Segments` = `CRM › Segments`)放行,其余变红。
 *
 * ③ 的做法:用 **TypeScript AST**(`ts.createSourceFile`)取出每一条**模型看得见**的字符串
 * 字面量,再扫导航标签。r2 的手搓状态机被 r3 判官 [P2-1] 判死:嵌套模板串里插值内的
 * `{`/`}` 会数错,`${"Campaign"}` 无条件漏 —— AST 两者都不会错,插值表达式里的字符串同样
 * 是节点,照样被看见。
 *
 * ④ 的界线(r3 判官 [P1] 划定,已核真):`Create a Campaign container` 是**正当业务句**,
 * 不动;`CRM page` / `Campaign UI` / `Contacts pages` 是**界面引用**,改名必漂 —— 必须走权威
 * 或改写成不指界面的说法。所以尺子是「**导航标签 + UI/page(s)/screen/tab(s)**」这个形状,
 * 不是「出现了标签就红」。
 *
 * ── 威胁模型边界(如实声明)────────────────────────────────────────────────
 * · ②管的是**写成路的地方**与**拼路的形状**。有人用一整句白话描述一个不存在的页面,或把
 *   路径裸写成 `/gallery`,这里逮不到 —— 那一层归 golden 快照 + 复审。
 * · (c)/(d) 要求接的是**大写词**:英文里界面名都是大写起首,小写的「Workspace ∕ insights」
 *   逮不到。这是为了不误伤 `the user's Library — it is $0` 这类正当英语。
 * · ②只查右延伸,不查左延伸(`My Settings › Connections`):左边多一个词构不成一个新地方。
 * · ③的扫描面是 `instructions.ts` 与 `connection-copy.ts`(它们每一次出现都是在指地方);
 *   技能文件里 `Create`/`Campaign`/`CRM` 同时是业务名词,一刀切会误伤,技能侧由 ②④ 覆盖。
 * · 标签自身不可能伪造出一层:core 侧钉的是**字符白名单**(navigation.test.ts)。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import {
  MERCHANT_NAV,
  MERCHANT_NAV_REDIRECTS,
  NAV_PATH_SEPARATOR,
  NAV_PATH_SEPARATOR_FAMILY,
  OTTO_ASSISTANT,
  everyNavDestination,
  isNavGroup,
  merchantNavMap,
  navLabel,
  navLinkByKey,
  navPath,
  navPointableNames,
} from "@fikirtive/core";
import { ottoInstructions } from "./instructions.js";
import { skillCatalog } from "./registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── 归一化:各种「路的那一格」的写法折成同一个字符 ───────────────────────────
// 只为报错好读。封闭性在下面的 (c):它认形状,不认字符。
const SEPARATOR_RUN = new RegExp(
  `[ \\t]*(?:${NAV_PATH_SEPARATOR_FAMILY.map(escapeRegex).join("|")})[ \\t]*`,
  "g",
);
function normalizeSeparators(text: string): string {
  return text.replace(SEPARATOR_RUN, ` ${NAV_PATH_SEPARATOR} `);
}

// ── 枚举源:Otto 可以说出口的名字,全部来自导航权威 ─────────────────────────
// 长的排前面:同一个起点上,「Settings › Connections」必须先于「Settings」被认出来。
const POINTABLE = [...navPointableNames()].sort((a, b) => b.length - a.length);
const AUTHORIZED_NAME = new RegExp(
  `(?<![A-Za-z])(?:${POINTABLE.map(escapeRegex).join("|")})(?![A-Za-z])`,
  "g",
);
const POINTABLE_SET = new Set(navPointableNames());

/** 每一个导航标签(顶层、分组、组内、助手)—— 手打其中任何一个都是第二份地图。 */
const EVERY_LABEL = [
  OTTO_ASSISTANT.label,
  ...MERCHANT_NAV.flatMap((node) =>
    isNavGroup(node) ? [node.label, ...node.items.map((item) => item.label)] : [node.label],
  ),
];


// 哨兵里把路名自己的分隔符换成 `|`,否则 (a)「残留里还有分隔符」会被哨兵自己触发。
const PATH_MARK = "|";
/** 剥离后的哨兵带着名字,报错才说得出是哪一条被延伸了。 */
function residue(text: string): string {
  return normalizeSeparators(text).replace(
    AUTHORIZED_NAME,
    (name) => `«nav:${name.split(` ${NAV_PATH_SEPARATOR} `).join(PATH_MARK)}»`,
  );
}

/** 连接符:非字母、非数字、非空白,且不是句末标点,也不是哨兵自己的括号。 */
const CONNECTOR = String.raw`[^\p{L}\p{N}\s.,;!?«»]`;
/** (b) 完整路名(哨兵里带 PATH_MARK 的那种)后面紧跟一个大写词。 */
const EXTENDS_NAV_PATH = new RegExp(`«nav:[^»]*\\${PATH_MARK}[^»]*»[ \\t]+[A-Z]`, "u");
/** (c-1) 合法名 + 任意连接符 + 大写词。 */
const SPLICED_ONTO_NAV_NAME = new RegExp(`«nav:[^»]*»[ \\t]*${CONNECTOR}{1,3}[ \\t]*[A-Z]`, "u");
/** (c-2) 裸入口名(单段名不在授权名单里,不会被剥)+ 连接符 + 大写词。 */
const ITEM_LABELS = [...everyNavDestination().map((item) => item.label)].sort(
  (a, b) => b.length - a.length,
);
const SPLICED_ONTO_BARE_LABEL = new RegExp(
  `(?<![A-Za-z])(?:${ITEM_LABELS.map(escapeRegex).join("|")})[ \\t]*${CONNECTOR}{1,3}[ \\t]*[A-Z]`,
  "u",
);
/**
 * (d) 两个**单段**合法名只隔空白相邻 —— 不写任何符号的拼路(判官 r3 [P2-2]②:`CRM Library`)。
 *
 * 注意这里认的是**单段名**(分组名 + 组内项名 + 顶层名 + 助手名),不是 navPointableNames()
 * ——「Library」自己不在可指名单里(可指的是 `Workspace › Library`),正是因此它才会在残留里
 * 留下来给人拼。判定标准由判官指定:拼起来是地图上真有的那条路就放行(`CRM Segments` =
 * `CRM › Segments`,同时也是技能描述里的正当业务说法),否则红。
 */
const SINGLE_SEGMENT_NAMES = new RegExp(
  `(?<![A-Za-z])(?:${[...EVERY_LABEL].sort((a, b) => b.length - a.length).map(escapeRegex).join("|")})(?![A-Za-z])`,
  "g",
);

function splicedPairs(text: string): string[] {
  const normalized = normalizeSeparators(text);
  const matches = [...normalized.matchAll(SINGLE_SEGMENT_NAMES)];
  const found: string[] = [];
  for (let i = 0; i + 1 < matches.length; i++) {
    const left = matches[i]!;
    const right = matches[i + 1]!;
    const gap = normalized.slice(left.index! + left[0].length, right.index!);
    if (!/^[ \t]+$/.test(gap)) continue; // 中间有标点/换行 = 两句话,不是一条路
    if (!POINTABLE_SET.has(`${left[0]} ${NAV_PATH_SEPARATOR} ${right[0]}`)) {
      found.push(`${left[0]} + ${right[0]}`);
    }
  }
  return found;
}

/** 四把尺子合起来:一行文本里,凡是写成路却不在地图上的地方。原文回报,便于定位。 */
function linesNamingUnmappedPlaces(text: string): string[] {
  return text.split("\n").filter((line) => {
    const rest = residue(line);
    return (
      rest.includes(NAV_PATH_SEPARATOR) ||
      EXTENDS_NAV_PATH.test(rest) ||
      SPLICED_ONTO_NAV_NAME.test(rest) ||
      SPLICED_ONTO_BARE_LABEL.test(rest) ||
      splicedPairs(line).length > 0
    );
  });
}

// 地图里的路径都写成 `(/…)`;提示词其余地方没有这个形状(反例见下面的自检)。
const CITED_PATH = /\((\/[^)\s]*)\)/g;
const KNOWN_HREFS = new Set(everyNavDestination().map((item) => item.href));

function unmappedPaths(text: string): string[] {
  return [...text.matchAll(CITED_PATH)].map((m) => m[1]!).filter((href) => !KNOWN_HREFS.has(href));
}

// ── ③④ 的取材:TypeScript AST 取出模型看得见的字符串 ────────────────────────
//
// r3 判官 [P2-1] 判死了 r2 的手搓状态机(嵌套模板里的 `{`/`}` 会数错,`${"Campaign"}`
// 无条件漏)。AST 没有这两个问题:模板串的 head/middle/tail 是各自的节点,插值表达式里的
// 字符串字面量也是节点,照样被走到。注释不是节点,自然被排除 —— 注释写给人看,不进模型。
function stringLiteralTexts(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) texts.push(node.text);
    else if (ts.isTemplateExpression(node)) {
      texts.push(node.head.text);
      for (const span of node.templateSpans) texts.push(span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return texts;
}

function literalsOf(relativePath: string): string {
  const source = readFileSync(join(HERE, relativePath), "utf8");
  return stringLiteralTexts(relativePath, source).join("\n");
}

function handTypedLabels(source: string, fileName = "probe.ts"): string[] {
  const literals = stringLiteralTexts(fileName, source).join("\n");
  return EVERY_LABEL.filter((label) =>
    new RegExp(`(?<![A-Za-z0-9])${escapeRegex(label)}(?![A-Za-z0-9])`).test(literals),
  );
}

/** ④ 界面引用的形状:导航标签 + 一个界面词。业务名词句(`Campaign container`)不在内。 */
const UI_SURFACE_WORDS = ["UI", "page", "pages", "screen", "screens", "tab", "tabs"];
const NAMES_A_SCREEN = new RegExp(
  `(?<![A-Za-z])(?:${EVERY_LABEL.map(escapeRegex).join("|")})[ \\t]+(?:${UI_SURFACE_WORDS.join("|")})(?![A-Za-z])`,
);

function namesAScreen(text: string): string[] {
  return text.split("\n").filter((line) => NAMES_A_SCREEN.test(line));
}

const SKILL_FILES = readdirSync(join(HERE, "skills"))
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
  .sort();

describe("#802 ① 硬规则的文本在场", () => {
  it("硬规则说的是「只许提地图里有的」,而且它是硬规则", () => {
    expect(ottoInstructions).toContain("**Hard rule — name only what is on the map.**");
    expect(ottoInstructions).toContain(
      "You may name a place if and only if it appears above, spelled exactly as the map spells it",
    );
  });

  it("地图外的问题有明确出路:说不确定 + 说结果,而不是编一个地方", () => {
    expect(ottoInstructions).toContain(
      "say plainly you are not sure where it lives and describe the outcome they want instead",
    );
    expect(ottoInstructions).toContain("never invent a place, and never guess at a control");
  });

  // r2 · 判官 [P1-2]:旧句禁的是「指示用户操作控件」,新句一度只禁「点名控件」——
  // 商家自己说出控件名、Otto 答一句「对,用那个」,没点名也没编造,却是旧规则明令禁止的。
  // 两条禁令现在都必须在场:**不许点名**,也**不许指示操作**(连商家自己提的也不行)。
  it("防瞎编没有被放宽:不许点名控件,也不许指示操作控件", () => {
    expect(ottoInstructions).toContain(
      "Never name a button or any other control, because you cannot see one",
    );
    expect(ottoInstructions).toContain(
      "never tell the user to use, act on, or look at any control — not even one THEY named to you",
    );
    // 自己那张卡是唯一例外,而且仍然不许念它上面的字。
    expect(ottoInstructions).toContain("The one exception is a card you yourself put in this conversation");
    expect(ottoInstructions).toContain("never name the button on it");
  });

  it("指路被明确要求,不再是「能不说就不说」—— 这是这张票解锁的那一半", () => {
    expect(ottoInstructions).toContain("pointing the way is your job, not something to avoid");
    // Founder 的原例:问怎么连 Instagram,答的是真入口的名字。
    expect(ottoInstructions).toContain(`"How do I connect Instagram?" → ${navPath("connections")}`);
  });
});

describe("#802 ② 描述面提到的每个入口都在地图里", () => {
  it("提示词里写成路的地方,没有一条在地图之外", () => {
    expect(linesNamingUnmappedPlaces(ottoInstructions)).toEqual([]);
  });

  it("提示词引的每一个路径都是真路径", () => {
    const cited = [...ottoInstructions.matchAll(CITED_PATH)].map((m) => m[1]!);
    // 扫描面自检:地图确实被扫到了(路径一条都没扫到 = 断言永远为真)。
    expect(cited.length).toBeGreaterThan(10);
    expect(unmappedPaths(ottoInstructions)).toEqual([]);
  });

  it("收敛掉的旧路由一条都不许出现在指令里(它们只会 redirect,不是入口)", () => {
    for (const { from } of MERCHANT_NAV_REDIRECTS) {
      expect(ottoInstructions, `旧路由 ${from} 不该出现在 Otto 的地图话里`).not.toMatch(
        new RegExp(`${escapeRegex(from)}(?![A-Za-z0-9])`),
      );
    }
  });

  // ── 检测器自检:逮得住 + 不误伤 ───────────────────────────────────────────
  it("围栏真的逮得住编出来的地方(不是一条永远为绿的断言)", () => {
    const invented = [
      "Workspace › Insights", // 组对,子项是编的
      "Settings › Schedule", // 子项真,组错了
      "Workspace › Schedules", // 差一个字母
      "Dashboard › Overview", // 整条都是编的
      "CRM › Inbox › Templates", // 编出来的第三层
    ];
    for (const place of invented) {
      expect(
        linesNamingUnmappedPlaces(`Point them to ${place}.`),
        `编出来的「${place}」必须被逮住`,
      ).toHaveLength(1);
    }
  });

  // r2 · 判官 r1 [P2] 与 r3 [P2-2] 的表示逃逸,逐条钉死。r4 起靠的是**形状**不是字符表:
  // 名字后面凡是连接符再接大写词就算拼路,所以下一个同形字不必再改代码。
  it("同形连接符不是逃逸手段:〉 > 》 » ＞ ⟩ ∕ ： ⇒ ／ 一律逮住", () => {
    const disguised = [
      "Workspace 〉 Insights", // U+3009(r1)
      "Workspace > Insights", // ASCII(r1)
      "Workspace》Insights", // U+300B,连空格都不留
      "Workspace » Insights",
      "Settings ⟩ Overview",
      "Settings＞Overview", // 全角
      "Workspace ∕ Insights", // U+2215(r3)
      "Workspace：Insights", // 全角冒号(r3)
      "Workspace ⇒ Insights", // U+21D2(r3)
      "Workspace／Insights", // 全角斜线
      "Workspace | Insights", // 竖线 —— 从没有人点过名,形状判定照样逮住
      "Workspace ~ Insights",
    ];
    for (const place of disguised) {
      expect(
        linesNamingUnmappedPlaces(`Point them to ${place}.`),
        `同形写法「${place}」必须被逮住`,
      ).toHaveLength(1);
    }
    // 反向:同形字换到**真**路名上,照样是真路名 —— 归一化不许把对的判成错的。
    expect(linesNamingUnmappedPlaces("Point them to Workspace > Schedule.")).toEqual([]);
    expect(linesNamingUnmappedPlaces("Point them to Settings〉Connections.")).toEqual([]);
  });

  it("在真入口后面接一截也不行(合法名 + 多出来的大写词 / 连接符)", () => {
    const extended = [
      "Settings › Connections Advanced", // 判官原例:剥掉合法名后残留无分隔符
      "Workspace › Schedule Calendar",
      "Workspace → Insights", // 箭头 + 编出来的下一层
      "Settings -> Overview",
    ];
    for (const place of extended) {
      expect(
        linesNamingUnmappedPlaces(`Point them to ${place}.`),
        `延伸写法「${place}」必须被逮住`,
      ).toHaveLength(1);
    }
  });

  // r3 判官 [P2-2]②:不写任何符号,靠两个合法单段名相邻也能拼出一条不存在的路。
  it("不写符号的拼路同样逮得住,地图上真有的组合放行", () => {
    for (const spliced of ["CRM Library", "Settings Analytics", "Workspace Connections", "CRM Discover"]) {
      expect(splicedPairs(`Point them to ${spliced}.`), `拼路「${spliced}」必须被逮住`).not.toEqual([]);
      expect(linesNamingUnmappedPlaces(`Point them to ${spliced}.`)).toHaveLength(1);
    }
    // 地图上真实存在的组合 = 白名单(判官指定):`CRM Segments` 就是 `CRM › Segments`,
    // 而它同时是技能描述里的正当业务说法,不许误伤。
    for (const real of ["CRM Segments", "CRM Broadcasts", "Workspace Analytics", "Settings Preferences"]) {
      expect(splicedPairs(`Read the user's ${real} here.`), `真组合「${real}」不该被逮`).toEqual([]);
    }
  });

  it("围栏放过每一条真路名(否则它会逼着大家把指路删掉)", () => {
    for (const name of navPointableNames()) {
      expect(
        linesNamingUnmappedPlaces(`Point them to ${name}.`),
        `真路名「${name}」不该被逮`,
      ).toEqual([]);
    }
    // 真路名后面接标点、括号、加粗标记,都不算「接了一截」。
    for (const around of [
      `Point them to **${navPath("billing")}** when they want to look for themselves.`,
      `There is ONE calendar — ${navPath("schedule")}. ${navPath("campaign")} plan dates live elsewhere.`,
      `"How do I connect Instagram?" → ${navPath("connections")}. "Where did my video go?" → ${navPath("library")}.`,
      `- ${navPath("schedule")} (/otto?view=schedule) — the one calendar.`,
    ]) {
      expect(linesNamingUnmappedPlaces(around), `真句子「${around}」不该被逮`).toEqual([]);
    }
    // 与地方无关的箭头(提示词里到处都是这种)不许误伤。
    expect(linesNamingUnmappedPlaces('Image (kind:"image") → call seedreamPrompt first')).toEqual([]);
    // 顺口提到一个入口的名字(不写成路)也不该被逮 —— 那是产品自己的说法。
    expect(linesNamingUnmappedPlaces(`look through the user's ${navLabel("library")} — it is $0`)).toEqual(
      [],
    );
    // 判官核真过的正当业务句:业务名词跟在板块名后面,不是拼路。
    expect(linesNamingUnmappedPlaces("Create a Campaign container; propose, update, remove")).toEqual([]);
    expect(linesNamingUnmappedPlaces("update only: exact CRM Segment id returned by readSegments")).toEqual(
      [],
    );
  });

  it("这把尺子逮得住「真名字 + 编出来的下一层」,也放得过真路名", () => {
    // read-spending 的原句,以及同一形状的几种写法。
    expect(linesNamingUnmappedPlaces("sees under Billing & credits → Spend history.")).toHaveLength(1);
    expect(linesNamingUnmappedPlaces("open Connections → Instagram to reconnect")).toHaveLength(1);
    expect(linesNamingUnmappedPlaces("Library > Favourites has it")).toHaveLength(1);
  });

  it("路径检测器同样逮得住编出来的路径,放得过真的", () => {
    expect(unmappedPaths("Open it at (/settings/connections).")).toEqual(["/settings/connections"]);
    expect(unmappedPaths("Open it at (/library).")).toEqual(["/library"]); // 已收敛的旧路由
    expect(unmappedPaths(`Open it at (${navLinkByKey("connections").href}).`)).toEqual([]);
  });
});

describe("#802 ③ 源码里一个地名都不许手打(判官 r1 [P1-1] / r3 [P2-1])", () => {
  // 判官 r1 逮到的那一处:`Campaign plan dates are edited on the campaign's own page` —— 名字是
  // 对的,可它是**手打**的。core 改名时地图与 navPath() 会跟着变,这句不会,②那几把尺子
  // 也看不见它(没有分隔符、没有路径)。根治不是再加一把量文本的尺子,是让文本里根本不存
  // 在手打的地名。r3 判官接着判死了手搓的字面量扫描器 —— 现在走 TypeScript AST。
  const GUARDED = ["instructions.ts", "connection-copy.ts"];

  it.each(GUARDED)("%s 的字符串字面量里没有手打的导航标签", (file) => {
    const source = readFileSync(join(HERE, file), "utf8");
    expect(handTypedLabels(source, file), `${file} 手打了导航标签,应改走 navPath()/navLabel()`).toEqual(
      [],
    );
  });

  it("扫描面自检:两个文件都真的被读到了,而且里面确实有字面量", () => {
    for (const file of GUARDED) {
      expect(literalsOf(file).length, file).toBeGreaterThan(200);
    }
  });

  it("AST 扫描器认得出注释、字符串、模板串与插值(r3 判官 [P2-1] 的两个漏洞)", () => {
    // 注释里的地名不算数(注释是写给人看的,不会进模型)。
    expect(handTypedLabels("// 这句话提到 Campaign 只是注释\nconst a = 1;")).toEqual([]);
    expect(handTypedLabels("/* Campaign 也可以出现在块注释里 */")).toEqual([]);
    // 走权威的插值不算数 —— key 是小写的 "campaign",不是标签 "Campaign"。
    expect(handTypedLabels('const s = `open ${navPath("campaign")} now`;')).toEqual([]);
    // 判官漏洞①:`${"Campaign"}` —— 手搓状态机无条件漏,AST 照样看见。
    expect(handTypedLabels('const s = `open ${"Campaign"} now`;')).toEqual(["Campaign"]);
    // 判官漏洞②:嵌套模板 + 插值里的花括号,手搓状态机会数错,AST 不会。
    expect(
      handTypedLabels("const s = `a ${cond ? `x ${ {k: 1}.k } y` : `z`} b Campaign`;"),
    ).toEqual(["Campaign"]);
    expect(
      handTypedLabels("const s = `a ${cond ? `x ${ {k: 1}.k } y` : `z`} b`;"),
    ).toEqual([]);
    // 手打的算数,不管用哪种引号。
    expect(handTypedLabels('const s = "open Campaign now";')).toEqual(["Campaign"]);
    expect(handTypedLabels("const s = 'open Campaign now';")).toEqual(["Campaign"]);
    expect(handTypedLabels("const s = `open Campaign now`;")).toEqual(["Campaign"]);
    // URL 里的 `//` 不是注释开头 —— 后面的地名照样要被看见。
    expect(handTypedLabels('const s = "https://x.test — then open Campaign";')).toEqual(["Campaign"]);
    // 标签是词,不是子串:标识符里的同名片段不算手打。
    expect(handTypedLabels('const s = "call manageLibrary now";')).toEqual([]);
  });
});

describe("#802 ④ 没有人指着某个界面说话(r3 判官 [P1])", () => {
  // 判官 AST 扫出来六处:`CRM page`、`CRM UI`、`Campaign UI`、`Campaign pages`、
  // `Contacts pages`、`CRM page`。它们是**模型看得见**的手写界面引用,改名必漂 —— 与 r1 的
  // `Campaign plan dates` 同根。②那几把尺子只认分隔符/连接符/路径,看不见它们。
  //
  // 界线由判官划定并已核真:`Create a Campaign container` 是正当业务句,不动;
  // 「导航标签 + UI/page(s)/screen/tab(s)」才是界面引用。
  it.each(SKILL_FILES)("skills/%s 的字符串里没有手写的界面引用", (file) => {
    const offenders = namesAScreen(literalsOf(join("skills", file)));
    expect(offenders, `skills/${file} 指着界面说话了,应走权威或改写`).toEqual([]);
  });

  it.each(["instructions.ts", "connection-copy.ts"])("%s 里同样没有手写的界面引用", (file) => {
    expect(namesAScreen(literalsOf(file))).toEqual([]);
  });

  it("技能表的描述面(模型真正读到的那一份)也没有", () => {
    const offenders = skillCatalog.flatMap((skill) =>
      namesAScreen(skill.description).map((line) => `${skill.name}: ${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it("扫描面自检:技能目录真的被扫到了", () => {
    expect(SKILL_FILES.length).toBeGreaterThan(30);
    expect(SKILL_FILES).toContain("read-segments.ts");
  });

  it("尺子逮得住判官点名的六处原文,放得过正当业务句", () => {
    // 判官 r3 [P1] 的六处,逐条验红。
    for (const reference of [
      "through the same validated, owner-scoped action layer as the CRM page.",
      "through the same authenticated actions as the CRM UI.",
      "$0 internal planning writes through the same owner-scoped actions as the Campaign UI.",
      "through the same owner-scoped actions as the Campaign pages.",
      "through the same owner-scoped actions as the Contacts pages.",
      "through the same owner-scoped action layer as the CRM page.",
      // 同族的其它写法:
      "open the Schedule screen",
      "the Library tab",
    ]) {
      expect(namesAScreen(reference), `界面引用「${reference}」必须被逮住`).toHaveLength(1);
    }
    // 判官核真过的正当业务句,以及与我们界面无关的第三方名词,一律不许误伤。
    for (const legit of [
      "Create a Campaign container; propose, update, remove, or mark approved a plan entry",
      "Read the user's CRM Segments through the same owner-scoped action layer",
      "Lists the owner's connected Facebook Pages so Otto can pick one when building an ad",
      "use only ids returned by list-meta-pages; never invent a pageId",
      "the same owner-scoped actions the merchant's own screens use",
    ]) {
      expect(namesAScreen(legit), `正当句「${legit}」不该被逮`).toEqual([]);
    }
  });
});

describe("#802 ⑤ 技能描述也是描述面 —— 同一把尺子量到底", () => {
  // Otto 读到的「地方在哪」不止提示词一处:每个技能的 description 都随工具表进模型。
  // read-spending 原本在这里手打了「Billing & credits → Spend history」—— 一个真名字后面
  // 挂了一个地图上没有的第二层。描述面漏一处,硬规则就少一处约束。
  it("每个技能描述里写成路的地方,同样都在地图内", () => {
    const offenders = skillCatalog.flatMap((skill) =>
      linesNamingUnmappedPlaces(skill.description).map((line) => `${skill.name}: ${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it("技能描述里引的路径同样都是真路径", () => {
    for (const skill of skillCatalog) {
      expect(unmappedPaths(skill.description), skill.name).toEqual([]);
    }
  });

  it("扫描面自检:技能表真的被扫到了", () => {
    expect(skillCatalog.length).toBeGreaterThan(30);
    expect(skillCatalog.some((skill) => skill.name === "readSpending")).toBe(true);
  });
});

describe("#802 双面:商家问路,地图里真有一条能答的入口", () => {
  // 这一条钉的是「Otto 有没有能力答」,不是「模型说了哪句话」——如实声明:模型的措辞由
  // golden 快照 + 复审看,这里看的是它手上有没有答案。答案的两半都要在:**名字**(商家在
  // 左边能看见的那个词)与**一句人话**(商家用自己的话描述需求时对得上的那句)。
  const WAYFINDING = [
    { ask: "How do I connect Instagram?", key: "connections", cue: /connect/i },
    { ask: "Where did my video go?", key: "library", cue: /video/i },
    { ask: "When is this going out?", key: "schedule", cue: /posted/i },
    { ask: "How many credits do I have left?", key: "billing", cue: /credits/i },
    { ask: "Where do I answer a customer?", key: "crm-inbox", cue: /reply/i },
    { ask: "What do you remember about my shop?", key: "brand", cue: /remember/i },
  ];

  it.each(WAYFINDING)("「$ask」→ 地图里有 $key,名字与人话都在", ({ ask, key, cue }) => {
    const path = navPath(key);
    const line = merchantNavMap()
      .split("\n")
      .find((row) => row.includes(`${path} (`));
    expect(line, `${ask} —— 地图里找不到 ${path}`).toBeDefined();
    expect(line!, `${ask} —— ${path} 那一行没有商家认得出的说明`).toMatch(cue);
  });

  it("问到地图上没有的东西时,Otto 手上没有第二份可编的地图", () => {
    // 地图是 Otto 关于「东西在哪」的**全部**知识,这句话必须写在提示词里 —— 否则
    // 「只许提地图里有的」就少了它的前提。
    expect(ottoInstructions).toContain("it is the whole of what you know about where things are");
  });
});
