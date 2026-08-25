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
  "app/login/r22-auth.css": ["12px", "13.5px", "15px", "17px"],
  // Approvals v2 换皮时逐面收静完毕:整份文件的 `font-size` 全部落在字梯 token 上,
  // off-ladder 集合清零。ratchet 只许下调 —— 这一面从此不许再冒出一个即兴尺寸。
  "components/approvals/r22-approvals.css": [],
  "components/campaign/r22-campaigns.css": ["10.5px", "10px", "12px", "15px", "16px", "17px", "30px"],
  "components/canvas/r22-canvas.css": [
    "0.9em",
    "10.5px",
    "10.5px !important",
    "10px",
    "12px",
    "12px !important",
    "13.5px",
    "15px",
    "8.5px",
    "9.5px",
  ],
  "components/help/r22-help.css": ["10.5px", "10px", "12px", "13.5px", "15px", "18px", "34px", "9px"],
  "components/home/r22-home.css": [
    "10.5px",
    "10px",
    "10px !important",
    "12px",
    "15.5px",
    "18px",
    "26px",
    "8.5px",
  ],
  "components/library/r22-library.css": ["10.5px", "10px", "12px", "13.5px"],
  "components/notifications/r22-notifications.css": ["10.5px", "10px", "12px", "17px", "30px"],
  "components/onboarding/r22-onboarding.css": ["10.5px", "12px", "13.5px", "16px", "9.5px", "9px"],
  "components/otto-iq/r22-knowledge-flow.css": ["10.5px", "10px", "12px", "18px", "9.5px"],
  "components/otto-iq/r22-otto-iq-hub.css": [
    "10.5px",
    "10.5px !important",
    "10px",
    "12px",
    "15px",
    "17px",
    "8px",
    "9.5px",
  ],
  "components/otto-iq/r22-otto-iq.css": ["10.5px", "10px", "12px", "14.5px", "16px", "23px"],
  "components/projects/r22-projects.css": ["10px", "12px", "17px", "18px", "23px"],
  "components/r22/r22-dashboard.css": ["10.5px", "10px", "12px", "13.5px", "17px", "8px", "9.5px", "9px"],
  "components/routines/r22-routines.css": ["10.5px", "10px", "12px", "13.5px", "14.5px", "17px", "9.5px"],
  "components/schedule/r22-analytics.css": [
    "10.5px",
    "10px",
    "12px",
    "13.5px",
    "16px",
    "30px",
    "9px",
    "clamp(16px, 2vw, 23px)",
  ],
  "components/schedule/r22-schedule.css": [
    "10.5px",
    "10px",
    "12px",
    "13.5px",
    "16px",
    "18px",
    "30px",
    "8.5px",
    "9.5px",
    "9px",
  ],
  "components/settings/r22-settings-dialog-extra.css": ["10.5px", "12px", "9.5px"],
  "components/settings/r22-settings-dialog.css": ["12px", "17px"],
  "components/settings/r22-settings.css": ["10.5px", "10px", "12px", "15px", "20px", "8px", "9.5px"],
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
  billingHref: "/billing",
  billingLabel: "Billing & credits",
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
 * 首项:Home connect-first(`connection.kind === "not_connected"`,数据全部读到了)——
 * Founder 2026-08-25 批的样张把这个态的常驻说明句从原来的多句收到 3 句
 * (`home-page.test.ts`「Home 收静」一段的裁决)。
 */
const SURFACE_REGISTRY: SurfaceRegistryEntry[] = [
  {
    surface: "Home connect-first",
    render: () =>
      visibleText(
        renderToStaticMarkup(
          createElement(HomeView, { data: BASE_HOME_DATA, connection: { kind: "not_connected" } } as never),
        ),
      ),
    limit: 3,
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
