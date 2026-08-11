/**
 * #802 —— 界面地图硬规则的围栏(Founder 已裁;r2 收判官 r1 三条判词)。
 *
 * 裁决改的是硬规则的**方向**,不是它的严格度:
 *   旧规则「不许提按钮」 → 新规则「**只许提地图里存在的入口**」。
 * 防瞎编一分未减(地图外的东西照旧不许说),但指路能力解锁 —— 商家问「怎么连 Instagram」,
 * 该听见的是 Settings › Connections,而不是一句「我看不见你的界面」。
 *
 * ── 为什么这道围栏能承重 ────────────────────────────────────────────────────
 * 「只许提地图里有的」如果只写在提示词里,它就只是一句愿望。这里把它变成可执行的三条:
 *   ① **规则文本在场** —— 肯定式断言,删一句就红。
 *   ② **描述面里的每一个地名都在地图里** —— 结构闭合,不是关键词扫描。
 *   ③ **源码里一个地名都不许手打** —— 提示词与指路文案的每个地名都走权威插值。
 *
 * ② 的做法与 #834 的「键集合双向相等」同宗:先让权威**可枚举**(core 的
 * `navPointableNames()`),再拿枚举去核对文本,而不是写正则去「读懂」一句英语在不在点名
 * 地方 —— #541 六轮已经证明后者封不死自然英语。
 *
 * 三把尺子,都跑在**归一化之后**的文本上(r2 · 判官 [P2]):
 *   (a) **剥完还剩分隔符** = 有一条路不在名单上。归一化先把 `›〉》»＞>⟩⟫❯` 这一族折成同一个
 *       字符 —— 判官用 U+3009 `〉` 与 ASCII `>` 各穿透过一次,同形字不该是逃逸手段。
 *   (b) **完整路名后面紧跟一个大写词**,或**任何合法名后面跟箭头再跟词** = 有人在真入口后面
 *       接了一截地图外的东西(`Settings › Connections Advanced`、`Workspace → Insights`)。
 *       剥离后残留无分隔符,(a) 看不见它。
 *   (c) **裸入口名 + 箭头 + 词** = 真名字挂了一层编出来的下级(`Billing & credits → Spend
 *       history`,本 PR 修掉的那句原文)。
 *
 * ③ 的做法:对 `instructions.ts` 与 `connection-copy.ts` 的**字符串字面量**(注释与
 * `${…}` 插值都不算)扫一遍导航标签。手打一个 `Campaign`,当场就红 —— 不必等到有人改名
 * 之后才发现那句话没跟着改(判官 [P1-1] 逮到的正是这一处)。
 *
 * ── 威胁模型边界(如实声明)────────────────────────────────────────────────
 * · ②管的是**写成路的地方**:归一化后的分隔符路名、`(/…)` 形状的路径、真名字后接的一截。
 *   有人用一整句白话描述一个不存在的页面,或把路径裸写成 `/gallery`,这里逮不到 —— 那一层
 *   归 golden 快照 + 复审(见 instructions.test.ts 文件头的威胁模型)。
 * · ②只查**右延伸**(`完整路名 + 额外词`),不查左延伸(`My Settings › Connections`):左边
 *   多一个词构不成一个新地方,而句子里合法名前面本来就常有大写词,查了只会误伤。单段名
 *   (`CRM`、`Campaign`)的右延伸同样不查 —— 它们同时是业务名词,详见 (b) 上方的注释。
 * · ③的扫描面**只有那两个文件** —— 它们的每一次出现都是在指地方。技能文件里
 *   `Create`/`Campaign`/`CRM`/`Segments` 同时是业务名词(「Create a Campaign container」),
 *   一刀切禁掉会制造噪声;技能侧由 ② 覆盖(扫描面含 skillCatalog 全表)。
 * · 分组名必须是单个词、且不含分隔符字符族:两条都由 core 侧 navigation.test.ts 钉住,
 *   破了会在那边先红。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
// 两个哨兵:完整路名(带分隔符的那种)与单段名分开记 —— (b) 的两种形状要分别对待。
const PATH_SENTINEL = "«navpath»";
const NAME_SENTINEL = "«navname»";

// ── 归一化:各种「路的那一格」的写法折成同一个字符(r2 · 判官 [P2]) ────────────
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

/** 归一化 + 把授权名逐条剥成哨兵(完整路名与单段名分开)。三把尺子都量这段残留。 */
function residue(text: string): string {
  return normalizeSeparators(text).replace(AUTHORIZED_NAME, (name) =>
    name.includes(NAV_PATH_SEPARATOR) ? PATH_SENTINEL : NAME_SENTINEL,
  );
}

/**
 * (b) 在真入口后面接了一截。两种精确形状,不是「合法名 + 大写词」一刀切:
 *   b1 **完整路名**后面紧跟一个大写词 —— `Settings › Connections Advanced`。完整路名是一条
 *      路的全部,后面再接词就只能是编的。
 *   b2 任何合法名后面跟一个**箭头**再跟词 —— `Workspace → Insights`。
 *
 * 为什么 b1 只认完整路名:`CRM`、`Campaign`、`Create` 这些单段名同时是业务名词,
 * 「Create a Campaign container」「one CRM Segment」是技能描述里的正当英语,一刀切会把
 * 六个技能误判成瞎编 —— 围栏只紧不松,但不许靠误伤换紧。
 */
const EXTENDS_NAV_PATH = new RegExp(`${escapeRegex(PATH_SENTINEL)}[ \\t]+[A-Z]`);
const ARROW_OFF_NAV_NAME = new RegExp(
  `(?:${escapeRegex(PATH_SENTINEL)}|${escapeRegex(NAME_SENTINEL)})[ \\t]*(?:→|->)[ \\t]*[A-Za-z]`,
);

/** (c) 裸入口名 + 箭头 + 词 —— 真名字挂了一层编出来的下级。 */
const ITEM_LABELS = [...everyNavDestination().map((item) => item.label)].sort(
  (a, b) => b.length - a.length,
);
const INVENTED_SUBLEVEL = new RegExp(
  `(?<![A-Za-z])(?:${ITEM_LABELS.map(escapeRegex).join("|")})[ \\t]*(?:→|->)[ \\t]*[A-Za-z]`,
);

/** 三把尺子合起来:一行文本里,凡是写成路却不在地图上的地方。原文回报,便于定位。 */
function linesNamingUnmappedPlaces(text: string): string[] {
  return text.split("\n").filter((line) => {
    const rest = residue(line);
    return (
      rest.includes(NAV_PATH_SEPARATOR) ||
      EXTENDS_NAV_PATH.test(rest) ||
      ARROW_OFF_NAV_NAME.test(rest) ||
      INVENTED_SUBLEVEL.test(rest)
    );
  });
}

// 地图里的路径都写成 `(/…)`;提示词其余地方没有这个形状(反例见下面的自检)。
const CITED_PATH = /\((\/[^)\s]*)\)/g;
const KNOWN_HREFS = new Set(everyNavDestination().map((item) => item.href));

function unmappedPaths(text: string): string[] {
  return [...text.matchAll(CITED_PATH)].map((m) => m[1]!).filter((href) => !KNOWN_HREFS.has(href));
}

// ── ③ 源码扫描:字符串字面量里不许出现导航标签 ──────────────────────────────
//
// 单遍状态机,认得出注释、字符串与模板串,并且**跳过 `${…}` 插值**(插值按定义就是权威给
// 的)。#841 的教训:把注释与字符串一锅端的正则围栏,会把 `https://` 当成注释开头 —— 所以
// 这里不用正则切,而是走一遍字符。
function stringLiterals(source: string): string {
  const out: string[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    if (c === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let buf = "";
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") {
          buf += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (source[i] === "\n") break;
        buf += source[i++]!;
      }
      i++;
      out.push(buf);
      continue;
    }
    if (c === "`") {
      i++;
      let buf = "";
      while (i < n) {
        if (source[i] === "\\") {
          buf += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (source[i] === "`") {
          i++;
          break;
        }
        if (source[i] === "$" && source[i + 1] === "{") {
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (source[i] === "{") depth++;
            else if (source[i] === "}") depth--;
            i++;
          }
          buf += " "; // 插值留一个空格,免得把两侧的词粘成一个
          continue;
        }
        buf += source[i++]!;
      }
      out.push(buf);
      continue;
    }
    i++;
  }
  return out.join("\n");
}

/** 每一个导航标签(顶层、分组、组内、助手)—— 手打其中任何一个都是第二份地图。 */
const EVERY_LABEL = [
  OTTO_ASSISTANT.label,
  ...MERCHANT_NAV.flatMap((node) =>
    isNavGroup(node) ? [node.label, ...node.items.map((item) => item.label)] : [node.label],
  ),
];

function handTypedLabels(source: string): string[] {
  const literals = stringLiterals(source);
  return EVERY_LABEL.filter((label) =>
    new RegExp(`(?<![A-Za-z0-9])${escapeRegex(label)}(?![A-Za-z0-9])`).test(literals),
  );
}

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

  // r2 · 判官 [P2] 内存复现的三种表示逃逸,逐条钉死。
  it("同形分隔符不是逃逸手段:〉/ > / 》/ » / ⟩ / ＞ 一族都折成同一条路来对账", () => {
    const disguised = [
      "Workspace 〉 Insights", // U+3009
      "Workspace > Insights", // ASCII
      "Workspace》Insights", // U+300B,连空格都不留
      "Workspace » Insights",
      "Settings ⟩ Overview",
      "Settings＞Overview", // 全角
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

  it("在真入口后面接一截也不行(合法名 + 多出来的大写词 / 箭头)", () => {
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
  });

  it("没有在真入口后面挂一层地图上没有的东西", () => {
    expect(INVENTED_SUBLEVEL.test(residue(ottoInstructions))).toBe(false);
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

describe("#802 ③ 源码里一个地名都不许手打(r2 · 判官 [P1-1])", () => {
  // 判官逮到的那一处:`Campaign plan dates are edited on the campaign's own page` —— 名字是
  // 对的,可它是**手打**的。core 改名时地图与 navPath() 会跟着变,这句不会,②那三把尺子
  // 也看不见它(没有分隔符、没有路径)。根治不是再加一把量文本的尺子,是让文本里根本不存
  // 在手打的地名。
  const GUARDED = ["instructions.ts", "connection-copy.ts"];

  it.each(GUARDED)("%s 的字符串字面量里没有手打的导航标签", (file) => {
    const source = readFileSync(join(HERE, file), "utf8");
    expect(handTypedLabels(source), `${file} 手打了导航标签,应改走 navPath()/navLabel()`).toEqual([]);
  });

  it("扫描面自检:两个文件都真的被读到了,而且里面确实有字面量", () => {
    for (const file of GUARDED) {
      const literals = stringLiterals(readFileSync(join(HERE, file), "utf8"));
      expect(literals.length, file).toBeGreaterThan(200);
    }
  });

  it("扫描器认得出注释、字符串与插值(#841:别把 https:// 当注释)", () => {
    // 注释里的地名不算数(注释是写给人看的,不会进模型)。
    expect(handTypedLabels("// 这句话提到 Campaign 只是注释\nconst a = 1;")).toEqual([]);
    expect(handTypedLabels("/* Campaign 也可以出现在块注释里 */")).toEqual([]);
    // 插值不算数 —— 它按定义就是权威给的。
    expect(handTypedLabels('const s = `open ${navPath("campaign")} now`;')).toEqual([]);
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

describe("#802 ④ 技能描述也是描述面 —— 同一把尺子量到底", () => {
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
