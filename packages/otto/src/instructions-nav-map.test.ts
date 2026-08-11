/**
 * #802 —— 界面地图硬规则的围栏(Founder 已裁)。
 *
 * 裁决改的是硬规则的**方向**,不是它的严格度:
 *   旧规则「不许提按钮」 → 新规则「**只许提地图里存在的入口**」。
 * 防瞎编一分未减(地图外的东西照旧不许说),但指路能力解锁 —— 商家问「怎么连 Instagram」,
 * 该听见的是 Settings › Connections,而不是一句「我看不见你的界面」。
 *
 * ── 为什么这道围栏能承重 ────────────────────────────────────────────────────
 * 「只许提地图里有的」如果只写在提示词里,它就只是一句愿望。这里把它变成可执行的两条:
 *   ① **规则文本在场** —— 肯定式断言,删一句就红。
 *   ② **描述面里的每一个地名都在地图里** —— 结构闭合,不是关键词扫描。
 *
 * ② 的做法与 #834 的「键集合双向相等」同宗:先让权威**可枚举**(core 的
 * `navPointableNames()`),再拿枚举去核对文本,而不是写正则去「读懂」一句英语在不在点名
 * 地方 —— #541 六轮已经证明后者封不死自然英语。
 *
 * 具体到词法:路名的语法是分隔符 `›`(navigation.ts 的 NAV_PATH_SEPARATOR,地图与提示词
 * 共用同一个)。围栏把**授权路名**逐条从文本里剥掉,剥完还剩分隔符 = 有一条路不在名单上。
 * 于是「Workspace › Insights」(编的)、「Settings › Schedule」(错组)、
 * 「Workspace › Schedules」(差一个字母)全部变红,而真路名一条不误伤。
 *
 * ── 威胁模型边界(如实声明)────────────────────────────────────────────────
 * · 围栏管的是**写成路的地方**:带分隔符的路名,以及地图那种 `(/…)` 形状的路径。有人用
 *   一整句白话描述一个不存在的页面,或把路径裸写成 `/gallery`,这里逮不到 —— 那一层归
 *   golden 快照 + 复审(见 instructions.test.ts 文件头的威胁模型)。
 * · 分组名必须是单个词:围栏按分隔符两侧取词。这个假设由 core 侧
 *   navigation.test.ts 的「分组名是单个词」钉住,破了会在那边先红。
 */
import { describe, expect, it } from "vitest";
import {
  MERCHANT_NAV_REDIRECTS,
  NAV_PATH_SEPARATOR,
  everyNavDestination,
  merchantNavMap,
  navLinkByKey,
  navPath,
  navPointableNames,
} from "@fikirtive/core";
import { ottoInstructions } from "./instructions.js";
import { skillCatalog } from "./registry.js";

// ── 枚举源:Otto 可以说出口的名字,全部来自导航权威 ─────────────────────────
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 长的排前面:同一个起点上,「Settings › Connections」必须先于「Settings」被认出来。
const POINTABLE = [...navPointableNames()].sort((a, b) => b.length - a.length);
const AUTHORIZED_NAME = new RegExp(
  `(?<![A-Za-z])(?:${POINTABLE.map(escapeRegex).join("|")})(?![A-Za-z])`,
  "g",
);

/** 把授权路名逐条剥掉。剥完还剩分隔符,就是有一条路不在名单上。 */
function stripAuthorizedNames(text: string): string {
  return text.replace(AUTHORIZED_NAME, "«nav»");
}

/** 提示词里写成路、却不在地图上的那些行(原文,便于定位)。 */
function linesNamingUnmappedPlaces(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => stripAuthorizedNames(line).includes(NAV_PATH_SEPARATOR));
}

/**
 * 第二种形状:**真名字 + 编出来的下一层**。
 *
 * read-spending 的技能描述原本写着「Billing & credits → Spend history」—— 前半是地图上真有
 * 的入口,后半是页面里的一段,地图上没有。它不带路名分隔符,所以上面那把尺子量不到;而它
 * 恰恰是最容易长出来的那一种(名字是真的,所以谁都不会起疑)。
 *
 * 检测器跑在**剥掉授权名单之后**的文本上:真路名早已被剥成 «nav»,剩下的「入口名 + 箭头」
 * 就只可能是往真入口后面挂了一层地图外的东西。
 */
const ITEM_LABELS = [...everyNavDestination().map((item) => item.label)].sort(
  (a, b) => b.length - a.length,
);
const INVENTED_SUBLEVEL = new RegExp(
  `(?:${ITEM_LABELS.map(escapeRegex).join("|")})\\s*(?:→|${NAV_PATH_SEPARATOR}|>)\\s*[A-Za-z]`,
);

function namesInventedSublevel(text: string): boolean {
  return INVENTED_SUBLEVEL.test(stripAuthorizedNames(text));
}

// 地图里的路径都写成 `(/…)`;提示词其余地方没有这个形状(反例见下面的自检)。
const CITED_PATH = /\((\/[^)\s]*)\)/g;
const KNOWN_HREFS = new Set(everyNavDestination().map((item) => item.href));

function unmappedPaths(text: string): string[] {
  return [...text.matchAll(CITED_PATH)].map((m) => m[1]!).filter((href) => !KNOWN_HREFS.has(href));
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

  it("防瞎编没有被放宽:按钮与其他控件照旧不许点名", () => {
    expect(ottoInstructions).toContain("never name a button or any other control, because you cannot see one");
    // 自己那张卡是唯一例外,而且仍然不许念它上面的字。
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

  it("围栏放过每一条真路名(否则它会逼着大家把指路删掉)", () => {
    for (const name of navPointableNames()) {
      expect(
        linesNamingUnmappedPlaces(`Point them to ${name}.`),
        `真路名「${name}」不该被逮`,
      ).toEqual([]);
    }
  });

  it("没有在真入口后面挂一层地图上没有的东西", () => {
    expect(namesInventedSublevel(ottoInstructions)).toBe(false);
  });

  it("这把尺子逮得住「真名字 + 编出来的下一层」,也放得过真路名", () => {
    // read-spending 的原句,以及同一形状的几种写法。
    expect(namesInventedSublevel("sees under Billing & credits → Spend history.")).toBe(true);
    expect(namesInventedSublevel("open Connections → Instagram to reconnect")).toBe(true);
    expect(namesInventedSublevel("Library > Favourites has it")).toBe(true);
    // 真路名(整条都在名单上)必须放过。
    expect(namesInventedSublevel(`Point them to ${navPath("billing")}.`)).toBe(false);
    expect(namesInventedSublevel(`There is ONE calendar — ${navPath("schedule")}.`)).toBe(false);
    // 与地方无关的箭头(提示词里到处都是这种)不许误伤。
    expect(namesInventedSublevel('Image (kind:"image") → call seedreamPrompt first')).toBe(false);
  });

  it("路径检测器同样逮得住编出来的路径,放得过真的", () => {
    expect(unmappedPaths("Open it at (/settings/connections).")).toEqual(["/settings/connections"]);
    expect(unmappedPaths("Open it at (/library).")).toEqual(["/library"]); // 已收敛的旧路由
    expect(unmappedPaths(`Open it at (${navLinkByKey("connections").href}).`)).toEqual([]);
  });
});

describe("#802 ③ 技能描述也是描述面 —— 同一把尺子量到底", () => {
  // Otto 读到的「地方在哪」不止提示词一处:每个技能的 description 都随工具表进模型。
  // read-spending 原本在这里手打了「Billing & credits → Spend history」—— 一个真名字后面
  // 挂了一个地图上没有的第二层。描述面漏一处,硬规则就少一处约束。
  it("每个技能描述里写成路的地方,同样都在地图内", () => {
    const offenders = skillCatalog.flatMap((skill) =>
      linesNamingUnmappedPlaces(skill.description).map((line) => `${skill.name}: ${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it("也没有技能在真入口后面挂一层编出来的下一层", () => {
    const offenders = skillCatalog.filter((skill) => namesInventedSublevel(skill.description));
    expect(offenders.map((skill) => skill.name)).toEqual([]);
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
