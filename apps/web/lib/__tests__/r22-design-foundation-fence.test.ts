/**
 * r22-design-foundation-fence.test.ts —— R22 设计地基三条机器围栏。
 *
 * 背景:token 央册 `components/r22/r22-tokens.css` 的 :root 已经登记了全部 R22 颜色,20 个
 * `r22-*.css` 业务文件已经全部裸值归零(裸 hex 一律换成 `var(--r22-*)`);字梯 token
 * (`--r22-text-body` 等七枚)已经登记,但各文件还没有逐面收静成只用 token;Home 的
 * connect-first 常驻说明句已经收静(`home-page.test.ts`「Home 收静」一段)。
 *
 * 人会忘,测试不会 —— 这份文件钉的不是「今天已经做到的样子」,是「以后不许退步」:
 *   ① 禁新增裸 hex —— 央册之外,一个字节都不许出现 `#` 开头的 hex 颜色;
 *   ② 字号 ratchet —— `var(--r22-text-*)` 一律放行,数字 px/em/clamp 值构成每个文件的
 *      「off-ladder 集合」,快照当前实况为上限:收静减少自动过,新增一个不在快照里的
 *      即兴尺寸才红;
 *   ③ 常驻句预算 ratchet —— 一张可扩的「表面注册表」,每项钉一个表面的常驻说明句上限。
 *      首项 = Home connect-first。以后每收静一面,在注册表里加一项、钉当时的实测值;
 *      上限只许下调,不许上调。
 *
 * 三条都不改产品代码,只读文件与只渲染既有组件 —— 围栏本身是只读的。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readOk, type HomeData } from "@/components/home/home-data";
import { HomeView, type HomeConnection } from "@/components/home/HomeView";
import { R22LibraryView } from "@/components/library/R22LibraryView";

const WEB_ROOT = path.resolve(__dirname, "../..");

/* ── 文件发现:运行时枚举,不写死清单 ─────────────────────────────────────────── */

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage", ".turbo", "public"]);

/** 从 `apps/web` 根往下走,找出全部 `r22-*.css`(大小写不敏感)。新增一个面、新开一个
 *  目录放它的 css,这里不用改一行就自动圈进来。 */
function findR22CssFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (/^r22-.*\.css$/i.test(entry.name)) out.push(full);
    }
  }
  walk(WEB_ROOT);
  return out.sort();
}

const TOKEN_FILE = path.join(WEB_ROOT, "components/r22/r22-tokens.css");
const NON_TOKEN_CSS_FILES = findR22CssFiles().filter((file) => file !== TOKEN_FILE);

/* ── 围栏 ① 禁新增裸 hex(央册之外零容忍) ────────────────────────────────────── */

/** `#fff` / `#ffffff` / `#ffffff80` 这几种长度都算颜色;后面跟着更多十六进制字符的不算
 *  (避免把一个更长的 token 名字或哈希误判成颜色)。 */
const HEX_COLOR_RE = /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/g;

describe("R22 地基围栏 ① 禁新增裸 hex —— 颜色只许住在央册里", () => {
  it(`圈到 ${NON_TOKEN_CSS_FILES.length} 个业务 r22-*.css(央册本身不在此列)`, () => {
    expect(NON_TOKEN_CSS_FILES.length).toBeGreaterThan(0);
    expect(NON_TOKEN_CSS_FILES).not.toContain(TOKEN_FILE);
  });

  it.each(NON_TOKEN_CSS_FILES.map((file) => [path.relative(WEB_ROOT, file), file] as const))(
    "%s 里没有裸 hex",
    (_relative, file) => {
      const source = readFileSync(file, "utf8");
      const hits = source.match(HEX_COLOR_RE) ?? [];
      expect(hits, `颜色请入册 r22-tokens.css 再 var() 引用 —— 命中:${hits.join(", ")}`).toEqual([]);
    },
  );
});

/* ── 围栏 ② 字号 ratchet(白名单 + 不许新增即兴尺寸) ─────────────────────────── */

/**
 * 每个业务文件里,当前实测的「off-ladder」`font-size` 值快照(2026-08-26 用
 * `find apps/web -iname "r22-*.css"` 圈出文件后逐个解析 `font-size:` 声明实测生成,不是
 * 编的)。`var(--r22-text-*)` 形式一律不进这张表 —— 它已经在梯子上,永远放行。
 *
 * 这张表是**上限**,不是「应该长什么样」:文件收静、off-ladder 集合变小,断言照样过;
 * 文件里冒出一个不在这张表里的新尺寸,断言才红。
 *
 * 注:`font:` 简写(`font: 620 13px/1.4 ...`)里裹着的字号本轮不解析 —— 现状本来就没有
 * 收口那条路,先留着,等逐面收静时一起处理。
 */
const FONT_SIZE_SNAPSHOT: Record<string, string[]> = {
  // 2026-08-26 R22 字号归梯执行(REPAIR 90 条 + 裁决 51 条)后重新实测生成 —— 这张表是
  // 修后实况,不是编的。梯外值仍在的,均是原型真值本身不落七档字梯、或裁决书明确要求
  // 保留冻结的部位(逐条理由见对应 CSS 行内注释)。
  "app/login/r22-auth.css": ["13.5px", "15px", "17px"],
  // Approvals v2 换皮时逐面收静完毕:整份文件的 `font-size` 全部落在字梯 token 上,
  // off-ladder 集合清零。ratchet 只许下调 —— 这一面从此不许再冒出一个即兴尺寸。
  "components/approvals/r22-approvals.css": [],
  "components/campaign/r22-campaigns.css": ["10.5px", "10px", "12px", "14.5px"],
  "components/canvas/r22-canvas.css": [
    "0.9em",
    "10.5px",
    "10.5px !important",
    "10px",
    "12px",
    "12px !important",
    "13.5px",
    "15px",
    "9.5px",
    "9px",
  ],
  "components/help/r22-help.css": ["10.5px", "10px", "12px", "13.5px", "15px", "18px", "34px", "9px"],
  "components/home/r22-home.css": [
    "10.5px",
    "10px",
    "12px",
    "15px",
    "17px",
    "18px",
    "26px",
    "9px",
  ],
  "components/library/r22-library.css": ["10px", "12px", "13.5px"],
  "components/notifications/r22-notifications.css": ["10.5px", "10px", "12px", "17px", "30px"],
  "components/onboarding/r22-onboarding.css": ["10.5px", "12px", "13.5px", "16px", "9.5px"],
  "components/otto-iq/r22-knowledge-flow.css": ["10.5px", "12px", "18px"],
  "components/otto-iq/r22-otto-iq-hub.css": [
    "10.5px",
    "10.5px !important",
    "13.5px",
    "15px",
    "18px",
    "9.5px",
  ],
  "components/otto-iq/r22-otto-iq.css": ["10px", "14.5px"],
  "components/projects/r22-projects.css": ["10.5px", "12px", "18px"],
  "components/r22/r22-dashboard.css": ["10.5px", "10px", "12px", "17px"],
  "components/routines/r22-routines.css": ["10.5px", "10px", "12px", "13.5px", "14.5px", "9.5px"],
  "components/schedule/r22-analytics.css": ["10.5px", "14.5px", "26px"],
  "components/schedule/r22-schedule.css": ["10.5px", "10px", "14.5px", "18px"],
  "components/settings/r22-settings-dialog-extra.css": ["10.5px", "10px", "12px"],
  "components/settings/r22-settings-dialog.css": ["12px", "17px"],
  "components/settings/r22-settings.css": ["10.5px", "10px", "12px", "15px", "20px", "9.5px", "9px"],
};

/** 一个文件里全部 off-ladder `font-size` 值(去重、排序)—— `var(--r22-text-*)` 放行。 */
function offLadderFontSizes(source: string): string[] {
  const re = /font-size\s*:\s*([^;}]+)[;}]/g;
  const out = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const value = match[1].trim();
    if (/^var\(--r22-text-/.test(value)) continue;
    out.add(value);
  }
  return [...out].sort();
}

describe("R22 地基围栏 ② 字号 ratchet —— 白名单 + 不许新增即兴尺寸", () => {
  it.each(NON_TOKEN_CSS_FILES.map((file) => [path.relative(WEB_ROOT, file), file] as const))(
    "%s 的 off-ladder 字号 ⊆ 快照",
    (relative, file) => {
      const source = readFileSync(file, "utf8");
      const actual = offLadderFontSizes(source);
      const allowed = new Set(FONT_SIZE_SNAPSHOT[relative] ?? []);
      const offenders = actual.filter((value) => !allowed.has(value));
      expect(offenders, `新字号请用字梯 token;确需新档先入册 —— 新增即兴尺寸:${offenders.join(", ")}`).toEqual([]);
    },
  );
});

/* ── 围栏 ③ 常驻句预算 ratchet(表面注册表,首项 = Home connect-first) ────────── */

const BASE_HOME_DATA: HomeData = {
  greeting: "Good morning, Aisha",
  credits: readOk("20 credits"),
  canvases: readOk([]),
  thumbs: readOk([]),
  upcoming: readOk([]),
  campaigns: readOk([]),
  equipment: readOk([]),
};

/** 商家眼睛看到的那一串,不是 HTML 转义之后的那一串 —— 抄自 `home-page.test.ts` 的同名
 *  helper,不重发明。 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** 商家可见的字(标签剥掉、实体还原、空白折叠)—— 同样抄自 `home-page.test.ts`。 */
function visibleText(markup: string): string {
  return decodeEntities(markup.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
}

/**
 * 按句末标点(`. ! ?`)切分整页可见文本,过滤掉 <=3 词的短语(那是标签/按钮字样,不是
 * 说明文),数剩下的段落个数。
 *
 * 这不是一把语言学意义上精确的分句器 —— 它就是一个「新增一整句解释话,计数就会跳」的
 * 机械尺子:标签/按钮之类的短字样天然被 <=3 词那道闸挡在外面,真正的说明句几乎总有
 * 标点或者本身就长过三个词,新增一句就会被数进来。
 */
function countResidentSentences(text: string): number {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .filter((chunk) => chunk.split(/\s+/).filter(Boolean).length > 3).length;
}

type SurfaceRegistryEntry = {
  surface: string;
  /** 渲染出这个表面「最需要说明的那个状态」,返回商家看得到的可见文本。 */
  render: () => string;
  /** 常驻说明句上限 —— 只许下调(收静),不许上调。上调需要新的 Founder 裁决。 */
  limit: number;
};

/**
 * 表面注册表 —— 可扩。每收静一面,在这里加一项并钉当时的实测上限;以后这一面的常驻
 * 说明句只许更少,不许更多。
 *
 * 首项:Home 默认第一屏(商家推开门看到的那一屏)。
 *
 * 上一版这一项渲染的是 connect-first 态、上限 3(Founder 2026-08-25 批的样张)。2026-08-26
 * 深夜 Founder 把连接线与 Performance 整体闸进幕后(beta V1 只做 creation),`connectionSurface`
 * 默认关 —— 默认第一屏因此只剩问候副句与创作入口那一行,实测降到 2。ratchet 只许下调,
 * 所以上限跟着下调到 2:以后这一面不许再冒出第三句常驻说明。
 *
 * 深链 `?connection=` 那条路径的常驻句不在这把尺子里 —— 它不是商家进来看到的第一屏,而且
 * 那一整套连接文案的口径由 `home-page.test.ts` 逐条钉着。
 */
const SURFACE_REGISTRY: SurfaceRegistryEntry[] = [
  {
    surface: "Home 默认第一屏(连接线闸后)",
    render: () =>
      visibleText(
        renderToStaticMarkup(
          createElement(HomeView, { data: BASE_HOME_DATA, connection: { kind: "not_connected" } } as never),
        ),
      ),
    limit: 2,
  },
  /**
   * Library 工作台(2026-08-26 重建时入栏,ready 态 = 商家推开这扇门看到的第一屏)。
   *
   * 这一面的常驻说明句**只有一句** —— 页头那句「Find every image and video you have already
   * made.」。工作台本体一句解释话都没有:左导航是标签,工具排是控件,组头是日期,卡上是
   * 名字与来源。空态与各种回执都是**条件出现**的,不常驻,所以不在这把尺子量的范围里。
   *
   * 上限钉 2 而不是 1,是因为这把尺子的机械特性,不是因为多了一句话:`countResidentSentences`
   * 按句末标点切段,页面最后那一大串**没有标点的标签**(All / Starred / Uploads / 24 Aug /
   * 卡名……)天生凑成一个 >3 词的尾段,永远被数进来。Home 那一项同理(样张说 4 句,尺子读 3)。
   * 真的多写一句解释话,这个数会变成 3 —— 闸照样红。
   */
  {
    surface: "Library workroom",
    render: () =>
      visibleText(
        renderToStaticMarkup(
          createElement(R22LibraryView, { initialItems: [], fixture: true, fixtureRestore: false } as never),
        ),
      ),
    limit: 2,
  },
];

describe("R22 地基围栏 ③ 常驻句预算 ratchet —— Home 首个入栏", () => {
  it.each(SURFACE_REGISTRY.map((entry) => [entry.surface, entry] as const))(
    "%s 的常驻说明句数 <= 上限",
    (_surface, entry) => {
      const count = countResidentSentences(entry.render());
      expect(
        count,
        `常驻说明句数 = ${count},超过上限 ${entry.limit} —— 新增常驻说明先报到,再改注册表上限`,
      ).toBeLessThanOrEqual(entry.limit);
    },
  );

  it("围栏本身没有空转:尺子认得出「一整句说明」,也认得出「就是个按钮字样」", () => {
    expect(countResidentSentences("Connect one channel so Otto can learn what is working.")).toBe(1);
    expect(countResidentSentences("Skip for now")).toBe(0); // 3 词以内,按钮字样不计入
  });
});

/* ── 围栏 ④ 减弱动效 = 去运动,不是换一种运动 ─────────────────────────────────── */

/**
 * `prefers-reduced-motion: reduce` 是商家在系统里说「别让屏幕上的东西动」。这一面上一版
 * 的做法是把 900ms 的转圈**换成** 1.4s 的无限闪烁 —— 换了个动法,东西照样永远在动,
 * 对晕动症的人来说这两件事一样难受(canvas 的 mini spinner、登录页的 loader、Otto 面板的
 * mini ring,三处一模一样地犯)。
 *
 * 所以这条围栏很短:**减弱动效块里不许出现 `infinite`**。进行中要不要有个标记、要不要
 * 有文字,那是设计问题;「永远动个不停」不是。
 */
function reducedMotionBlocks(source: string): string[] {
  const blocks: string[] = [];
  const opener = /@media[^{]*prefers-reduced-motion[^{]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    let depth = 1;
    let index = opener.lastIndex;
    while (index < source.length && depth > 0) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push(source.slice(opener.lastIndex, index - 1));
    opener.lastIndex = index;
  }
  return blocks;
}

const REDUCED_MOTION_FILES = findR22CssFiles()
  .map((file) => [path.relative(WEB_ROOT, file), reducedMotionBlocks(readFileSync(file, "utf8"))] as const)
  .filter(([, blocks]) => blocks.length > 0);

describe("R22 地基围栏 ④ 减弱动效块里没有无限动画", () => {
  it("围栏本身没有空转:真的圈到了减弱动效块", () => {
    expect(REDUCED_MOTION_FILES.length, "一个 prefers-reduced-motion 块都没圈到 —— 这条围栏在核对空气").toBeGreaterThan(0);
    expect(reducedMotionBlocks("@media (prefers-reduced-motion: reduce) { .a { animation: x 1s infinite; } }")[0]).toContain("infinite");
  });

  it.each(REDUCED_MOTION_FILES)("%s 的减弱动效块里没有 infinite", (_relative, blocks) => {
    const hits = blocks.filter((block) => /\binfinite\b/.test(block));
    expect(hits, `减弱动效下还留着无限动画 —— 换一种动法不叫减弱动效:${hits.join(" | ")}`).toEqual([]);
  });
});

/* ── 围栏 ⑤ 禁新增裸 letter-spacing(字距只许住在字距梯上) ────────────────────── */

/**
 * 照围栏 ① 禁裸 hex 的先例办。
 *
 * 病灶(2026-08-26 Founder 亲验点名「标题与正文的 kerning 看着不对」):全站 CSS 里散着
 * **17 种** letter-spacing 值,同一个角色在不同门写不同数 —— 所有全大写节头横跨
 * .03–.09em,所有 22px 页标题横跨 -.015 与 -.035em。看着发飘的不是某一处的数值,是
 * 「同角色不同值」本身,而这种病用眼睛逐面比对是抓不完的。
 *
 * 所以钉法和颜色一样:字距梯五档登记在央册 `components/r22/r22-tokens.css`
 * (`--r22-track-display-lg / -display / -heading / -body / -caps`),业务 `r22-*.css` 里
 * 一律 `letter-spacing: var(--r22-track-*)`,一个裸值都不许有。新角色 = 先入册一档,
 * 再引用;不是就地发明第 18 个数。
 *
 * 豁免名单**只减不增**:今天是空的(20 个业务文件全部归位完毕),往里加一项要有理由。
 */
const TRACK_TOKEN_RE = /^var\(--r22-track-[a-z0-9-]+\)$/;

/**
 * 允许留在梯外的裸字距,按文件登记。**空 = 今天没有一处豁免。**
 * 这是 ratchet 的另一半:名单只许变短。往里写一行,要连理由一起写。
 */
const LETTER_SPACING_EXEMPT: Record<string, string[]> = {};

/** 一个文件里全部 `letter-spacing` 声明值(保留重复顺序无所谓,去重即可)。 */
function letterSpacingValues(source: string): string[] {
  const re = /letter-spacing\s*:\s*([^;}]+)/g;
  const out = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) out.add(match[1].trim());
  return [...out].sort();
}

const LETTER_SPACING_SITES = NON_TOKEN_CSS_FILES.map(
  (file) => [path.relative(WEB_ROOT, file), letterSpacingValues(readFileSync(file, "utf8"))] as const,
).filter(([, values]) => values.length > 0);

/** 央册里真的登记了的字距档名(`--r22-track-*`)。 */
function declaredTrackTokens(): Set<string> {
  const source = readFileSync(TOKEN_FILE, "utf8");
  const re = /(--r22-track-[a-z0-9-]+)\s*:/g;
  const out = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) out.add(match[1]);
  return out;
}

describe("R22 地基围栏 ⑤ 禁新增裸 letter-spacing —— 字距只许住在字距梯上", () => {
  it("围栏本身没有空转:真的圈到了带字距的业务文件,而且认得出裸值", () => {
    expect(
      LETTER_SPACING_SITES.length,
      "一个带 letter-spacing 的业务 r22-*.css 都没圈到 —— 这条围栏在核对空气",
    ).toBeGreaterThan(0);
    expect(TRACK_TOKEN_RE.test("var(--r22-track-display)")).toBe(true);
    expect(TRACK_TOKEN_RE.test("-0.035em")).toBe(false);
    expect(TRACK_TOKEN_RE.test("normal")).toBe(false);
    expect(TRACK_TOKEN_RE.test("var(--tracking-tight)")).toBe(false);
    // 解析器认得出压平成一行的文件(半数 r22 css 是 minified 的)
    expect(letterSpacingValues("a{letter-spacing:.06em}b{letter-spacing:var(--r22-track-body)}")).toEqual([
      ".06em",
      "var(--r22-track-body)",
    ]);
  });

  it.each(LETTER_SPACING_SITES)("%s 的字距全部落在字距梯上", (relative, values) => {
    const allowed = new Set(LETTER_SPACING_EXEMPT[relative] ?? []);
    const offenders = values.filter((value) => !TRACK_TOKEN_RE.test(value) && !allowed.has(value));
    expect(
      offenders,
      `字距请用字距梯 token(--r22-track-*);确需新档先入册 r22-tokens.css —— 裸值:${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("引用到的每一档字距都真的在央册里登记着", () => {
    const declared = declaredTrackTokens();
    expect(declared.size, "央册一档字距都没登记 —— 这条围栏在核对空气").toBeGreaterThan(0);

    const referenced = new Set<string>();
    for (const [, values] of LETTER_SPACING_SITES) {
      for (const value of values) {
        const name = /^var\((--r22-track-[a-z0-9-]+)\)$/.exec(value)?.[1];
        if (name) referenced.add(name);
      }
    }
    const missing = [...referenced].filter((name) => !declared.has(name));
    expect(
      missing,
      `业务 css 引用了央册里不存在的字距档 —— 删档/改名请连引用点一起改:${missing.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * 光学单调 —— 这条钉的不是「每一档必须等于哪个数」(那会让每次调字距都要改测试),而是
   * 五档之间的**次序**:字号越大越紧、全大写最松。次序一旦塌了(比如把 display 档改成 0,
   * 或者把 caps 档写成负数),那不是调参数,那是梯子本身坏了。
   */
  it("五档字距光学单调:display-lg < display < heading < body < caps", () => {
    const source = readFileSync(TOKEN_FILE, "utf8");
    const ladder = ["display-lg", "display", "heading", "body", "caps"] as const;
    const values = ladder.map((step) => {
      const raw = new RegExp(`--r22-track-${step}\\s*:\\s*([^;]+);`).exec(source)?.[1]?.trim();
      expect(raw, `央册里找不到字距档 --r22-track-${step}`).toBeDefined();
      const em = Number.parseFloat(raw!);
      expect(Number.isNaN(em), `--r22-track-${step} 不是一个能比大小的数值:${raw}`).toBe(false);
      return [step, em] as const;
    });

    for (let i = 1; i < values.length; i += 1) {
      const [prevStep, prev] = values[i - 1];
      const [step, current] = values[i];
      expect(
        current > prev,
        `字距梯次序塌了:${prevStep}=${prev}em 不比 ${step}=${current}em 更紧 —— 字号越大越紧、全大写最松是这把梯子的全部意义`,
      ).toBe(true);
    }
    // 两头也钉住:再紧不过 -0.06em(字会粘连),再松不过 0.12em(全大写也散架)。
    expect(values[0][1]).toBeGreaterThanOrEqual(-0.06);
    expect(values[values.length - 1][1]).toBeLessThanOrEqual(0.12);
  });

  it("豁免名单只减不增:今天一处豁免都没有", () => {
    expect(
      Object.keys(LETTER_SPACING_EXEMPT),
      "字距豁免名单是 ratchet —— 只许变短。新增一项要连理由一起写进本文件的注释",
    ).toEqual([]);
  });
});

/* ── 围栏 ⑥ tsx 侧禁裸 tracking-[…] / letterSpacing(字距梯扩面到组件层) ────────── */

/**
 * 围栏 ⑤ 只圈 `r22-*.css`。字距梯真正流失的地方是 tsx 里的 Tailwind 任意值
 * `tracking-[…]` 和内联 `style={{ letterSpacing: … }}`——2026-08-26 字距收敛扫尾
 * (跟在 ⑤ 之后那一轮)实测全站散着约 60 处。本轮已收静的面钉进这里,ratchet 只减不增。
 *
 * 范围**不是**全仓 tsx——`components/otto/{panel,conversation}`、`components/canvas`
 * (除 CanvasLineagePanel 外)、`components/library`、`components/projects`、
 * `components/otto-iq`、`MentionInput.tsx` 当时另有 worker 在动,没有收静基线,圈进来
 * 只会红在别人的在飞改动上。这张清单只登记本轮实测收静完毕的面;新收静一面,在这里加
 * 一行,不是把整个目录一次性圈进来。
 */
const TSX_FENCE_FILES: string[] = [
  ...readdirSync(path.join(WEB_ROOT, "components/ui"))
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => `components/ui/${name}`),
  ...(function walkCrm(): string[] {
    const root = path.join(WEB_ROOT, "components/crm");
    const out: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".tsx")) {
          out.push(path.relative(WEB_ROOT, full));
        }
      }
    }
    walk(root);
    return out.sort();
  })(),
  "components/otto/OttoSchedule.tsx",
  "components/otto/OttoAnalytics.tsx",
  "components/otto/OttoDiscover.tsx",
  "components/otto/settings/sections.tsx",
  "app/profile/page.tsx",
  "app/profile/ProfileNames.tsx",
  "app/billing/page.tsx",
  "app/billing/loading.tsx",
  "app/design-system/DesignSystemReference.tsx",
  "components/asset/DetailPanel.tsx",
  "components/canvas/CanvasLineagePanel.tsx",
];

/**
 * 允许留在梯外的裸字距,按「文件 → 值列表」登记。**只有 DesignSystemReference 的
 * mono-label 一项**:那 4 处用的是 `--tracking-mono-label`(0.12em,r22-tokens.css 旧豁免,
 * 6ce4716a 那一轮定的),不是本轮字距梯的五档之一。design-system 参考页不是商家可见面
 * (只有开发者会打开 `/design-system`),所以本轮保留这个既有豁免而不是强改成 caps 档 ——
 * 改了反而混淆两套用途不同的 token。ratchet 只许变短。
 */
const TSX_TRACK_EXEMPT: Record<string, string[]> = {
  "app/design-system/DesignSystemReference.tsx": ["var(--tracking-mono-label)"],
};

const TSX_TRACK_TOKEN_RE = /^var\(--r22-track-[a-z0-9-]+\)$/;

/** 一个 tsx 文件里全部 `tracking-[…]` 任意值(去重、排序)。 */
function tsxTrackingArbitraryValues(source: string): string[] {
  const re = /tracking-\[([^\]]+)\]/g;
  const out = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) out.add(match[1].trim());
  return [...out].sort();
}

/** 一个 tsx 文件里全部内联 `letterSpacing:` 字符串值(去重、排序)。数字/无单位字面量
 *  (2026-08-26 OttoDiscover 那处 `letterSpacing: 0.4` 的写法)也当作裸值抓,不放过。 */
function tsxInlineLetterSpacingValues(source: string): string[] {
  const re = /letterSpacing:\s*(?:"([^"]*)"|(-?[\d.]+))/g;
  const out = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) out.add((match[1] ?? match[2]).trim());
  return [...out].sort();
}

const TSX_FENCE_SITES = TSX_FENCE_FILES.map((relative) => {
  const source = readFileSync(path.join(WEB_ROOT, relative), "utf8");
  const values = [...tsxTrackingArbitraryValues(source), ...tsxInlineLetterSpacingValues(source)];
  return [relative, [...new Set(values)].sort()] as const;
}).filter(([, values]) => values.length > 0);

describe("R22 地基围栏 ⑥ tsx 侧禁裸 tracking-[…] / letterSpacing —— 字距梯扩面", () => {
  it("围栏本身没有空转:圈到的文件里真的有 tracking-[…] 或内联 letterSpacing", () => {
    expect(TSX_FENCE_SITES.length, "一个带字距声明的 tsx 都没圈到 —— 这条围栏在核对空气").toBeGreaterThan(0);
    expect(tsxTrackingArbitraryValues('className="tracking-[0.08em]"')).toEqual(["0.08em"]);
    expect(tsxTrackingArbitraryValues('className="tracking-[var(--r22-track-caps)]"')).toEqual([
      "var(--r22-track-caps)",
    ]);
    expect(tsxInlineLetterSpacingValues('style={{ letterSpacing: "0.4em" }}')).toEqual(["0.4em"]);
    expect(tsxInlineLetterSpacingValues("style={{ letterSpacing: 0.4 }}")).toEqual(["0.4"]);
  });

  it.each(TSX_FENCE_SITES)("%s 的字距全部落在字距梯上", (relative, values) => {
    const allowed = new Set(TSX_TRACK_EXEMPT[relative] ?? []);
    const offenders = values.filter((value) => !TSX_TRACK_TOKEN_RE.test(value) && !allowed.has(value));
    expect(
      offenders,
      `字距请用字距梯 token(--r22-track-*);确需新档先入册 r22-tokens.css —— 裸值:${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("豁免名单只减不增:今天只有 design-system 参考页的既有 mono-label 一项", () => {
    expect(Object.keys(TSX_TRACK_EXEMPT)).toEqual(["app/design-system/DesignSystemReference.tsx"]);
    expect(TSX_TRACK_EXEMPT["app/design-system/DesignSystemReference.tsx"]).toEqual([
      "var(--tracking-mono-label)",
    ]);
  });
});
