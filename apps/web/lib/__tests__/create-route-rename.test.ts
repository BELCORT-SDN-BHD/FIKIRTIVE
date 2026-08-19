/**
 * Create 改名 `/create` + 收编 Templates / Discover(W2-5,#990,规格书 §2.2 / Q6-A / Q2-A)。
 *
 * 三件商家看得见的事,各钉一组:
 *   ① **旧地址一条都不撞墙** —— `/northstar-immersive*` 全部 307 到新地址,画布深链的
 *      `?project=` / `?thread=` 一个字不丢。新旧对照表从 `SHELL_ROUTES` 派生,不在这里手抄
 *      第二份地址(手抄的那一份迟早和权威源各说各话 —— 本仓最贵的一课)。
 *   ② **Templates 与 Discover 真的在 `/create` 页面上** —— 两个区段的锚点就是重定向表
 *      (`OTTO_VIEW_REDIRECTS`)指过去的那两个,而且区段里装的是真目录,不是占位。
 *   ③ **一屏只有一个「开始做点什么」** —— 那个开工框全仓只有一份实现,`/create` 摆的就是它。
 *
 * 外加一条老纪律的复检:受控入口认不出人就 `redirect("/login")`,一个字节都不交出去。
 *
 * 零后端、零生成:文件系统、源码读取、纯静态渲染,以及对重定向路由函数的直接调用。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OTTO_VIEW_REDIRECTS, SHELL_ROUTES } from "@fikirtive/core/navigation";
import { TEMPLATES } from "@fikirtive/core/templates";
import { INSPIRATIONS } from "@/lib/inspirations";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  requireOwner: vi.fn(),
  getProjects: vi.fn(),
  getEntities: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/data", () => ({ getProjects: mocks.getProjects, getEntities: mocks.getEntities }));

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, "../..");

/** 注释里提到一个旧地址、或者交代一段历史,都不是把人送过去 —— 对账只看代码。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function sourceCode(relativePath: string): string {
  return stripComments(readFileSync(resolve(WEB_ROOT, relativePath), "utf8"));
}

function filesUnder(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

afterEach(() => {
  vi.clearAllMocks();
});

/* ── ① 旧地址一条都不撞墙 ───────────────────────────────────────────────────── */

/** 旧代号目录 —— 改名之后它只剩重定向,一页真内容都没有。 */
const LEGACY_ROOT = "app/northstar-immersive";

/**
 * 新旧对照 —— **去处从 `SHELL_ROUTES` 派生**,不写第二份地址。
 *
 * 规格书 §2.2 那两行:`/northstar-immersive` → Create,`/northstar-immersive/create/canvas`
 * → Canvas。旧路径是历史事实(商家书签里就长那样),所以它只能写在这里;新路径来自权威源,
 * 所以把 `/create` 拼错这件事在这个文件里不可能发生。
 */
const RENAMES = [
  { legacy: "/northstar-immersive", route: `${LEGACY_ROOT}/page.tsx`, to: SHELL_ROUTES.create },
  {
    legacy: "/northstar-immersive/create/canvas",
    route: `${LEGACY_ROOT}/create/canvas/page.tsx`,
    to: SHELL_ROUTES.canvas,
  },
  {
    // 旧前缀底下的其余任何一条路(#606 删掉的那批设计稿页的地址全在这里面)。
    legacy: "/northstar-immersive/<其余任何一条路>",
    route: `${LEGACY_ROOT}/[...retired]/page.tsx`,
    to: SHELL_ROUTES.create,
  },
] as const;

describe("旧地址 307 到新地址,永不 404(规格书 §2.2 / §2.5)", () => {
  it.each(RENAMES)("$legacy 有一个真的重定向路由", ({ route }) => {
    expect(existsSync(resolve(WEB_ROOT, route)), `${route} 不在`).toBe(true);
    expect(sourceCode(route), `${route} 不是重定向`).toContain("redirect(");
  });

  it.each(RENAMES)("$legacy 送到 $to —— 真的调用一次,不是读源码猜的", async ({ route, to }) => {
    const mod = await import(/* @vite-ignore */ resolve(WEB_ROOT, route));
    await expect(mod.default({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      `NEXT_REDIRECT:${to}`,
    );
  });

  /**
   * 深链的每一个参数都跟着搬家 —— **三条重定向同一个形状**(判官 P3-5)。
   *
   * 画布那一条最要命:送到新地址却打开别的画布,比 404 更难发现,因为它看起来是成功的。
   * 另外两条今天没有哪个参数是它们自己读的,所以「裸 redirect」当下不丢东西 —— 但三条里
   * 两条保参、一条不保,就是一个迟早有人踩的差别。这条围栏把形状钉成一致的,而不是钉在
   * 「今天恰好没参数」上。
   */
  it.each(RENAMES)("$legacy 的 query 一个字不丢", async ({ route, to }) => {
    const mod = await import(/* @vite-ignore */ resolve(WEB_ROOT, route));

    await expect(
      mod.default({
        searchParams: Promise.resolve({
          project: "p-1",
          thread: "t-1",
          audience: "a-1",
          // 多张脸 —— 同名参数重复出现,不能被折成一个值。
          persona: ["face-1", "face-2"],
        }),
      }),
    ).rejects.toThrow(
      `NEXT_REDIRECT:${to}?project=p-1&thread=t-1&audience=a-1&persona=face-1&persona=face-2`,
    );
  });

  it("旧目录里**只有**重定向:一页真内容都没留下(留下就是两个创作面)", () => {
    const pages = filesUnder(resolve(WEB_ROOT, LEGACY_ROOT)).filter((file) =>
      file.endsWith("page.tsx"),
    );
    expect(pages.length).toBeGreaterThan(0);

    const notARedirect = pages
      .map((file) => relative(WEB_ROOT, file))
      .filter((file) => {
        const source = sourceCode(file);
        // 一条重定向该有的样子:调 redirect(),而且不碰认证 / 数据库 / server action。
        return (
          !source.includes("redirect(") ||
          /@\/lib\/(auth-guard|data|actions)/.test(source) ||
          source.includes("@/components/canvas/")
        );
      });

    expect(notARedirect, "这些旧路由不只是一条重定向").toEqual([]);
  });

  it("重定向里不硬写新地址 —— 地址只有权威源写", () => {
    for (const file of [
      `${LEGACY_ROOT}/page.tsx`,
      `${LEGACY_ROOT}/create/canvas/page.tsx`,
      `${LEGACY_ROOT}/[...retired]/page.tsx`,
    ]) {
      const source = sourceCode(file);
      expect(source, `${file} 没有引权威源`).toMatch(
        /from\s+["']@fikirtive\/core\/navigation["']/,
      );
      expect(source, `${file} 手抄了一份新地址`).not.toContain(`"${SHELL_ROUTES.create}"`);
    }
  });

  it("新地址背后是真的路由文件(不是只有一张重定向表)", () => {
    for (const file of ["app/create/layout.tsx", "app/create/page.tsx", "app/create/canvas/page.tsx"]) {
      expect(existsSync(resolve(WEB_ROOT, file)), `${file} 不在`).toBe(true);
    }
  });

  it("内部代号不再是任何一条地址 —— 权威源里一个字都不剩", () => {
    // 注释里可以提它(那是在交代改名这件事),代码里不许再有它 —— 它不再是任何一条地址。
    const authority = stripComments(
      readFileSync(resolve(WEB_ROOT, "../../packages/core/src/navigation.ts"), "utf8"),
    );
    const asAnAddress = [...authority.matchAll(/["'`](\/northstar[^"'`\s]*)/g)];
    expect(asAnAddress.map((m) => m[1]), "导航权威源里还留着旧代号地址").toEqual([]);
  });
});

/* ── ② Templates 与 Discover 是 /create 上的两个区段(Q6-A) ─────────────────── */

/** 重定向表说旧的两个视图去哪 —— 锚点从**它**读出来,页面必须真有这两个 id。 */
function anchorOf(view: "templates" | "discover"): string {
  const target = OTTO_VIEW_REDIRECTS[view];
  const [path, hash] = target.split("#");
  expect(path, `?view=${view} 不再落在创作面上`).toBe(SHELL_ROUTES.create);
  expect(hash, `?view=${view} 没有锚点`).toBeTruthy();
  return hash;
}

async function renderSections(projectId: string | null): Promise<string> {
  const { CreateBrowseSections } = await import("@/components/create/CreateBrowseSections");
  return renderToStaticMarkup(createElement(CreateBrowseSections, { projectId, entities: [] }));
}

describe("Templates 与 Discover 收编成 /create 的两个区段(规格书 Q6-A)", () => {
  it("重定向表指的那两个锚点,页面上真的有", async () => {
    const markup = await renderSections("p-1");

    expect(markup).toContain(`id="${anchorOf("templates")}"`);
    expect(markup).toContain(`id="${anchorOf("discover")}"`);
  });

  it("区段里装的是真目录,不是一块占位", async () => {
    const markup = await renderSections("p-1");

    // 两块的真实内容各取一条:模板名与灵感标题都来自各自的目录数据。
    expect(markup).toContain(TEMPLATES[0].name);
    expect(markup).toContain(INSPIRATIONS[0].title);
  });

  it("一张画布都还没有时,模板区段说实话,而不是替商家悄悄建一张", async () => {
    const markup = await renderSections(null);

    expect(markup).toContain(`id="${anchorOf("templates")}"`);
    expect(markup).toContain("Start a canvas above first");
    // 灵感是可以先逛的,所以它照常在。
    expect(markup).toContain(INSPIRATIONS[0].title);
  });

  it("这一票只建区段,导航格的删除留给切换总票 —— 旧壳零行为变化", () => {
    // 两个旧视图今天照常在 Otto 自己的视图宿主里挂着(W2-11 才拆)。
    const ottoView = sourceCode("components/otto/OttoView.tsx");
    expect(ottoView).toContain("OttoTemplates");
    expect(ottoView).toContain("OttoDiscover");
  });

  it("`/create` 上不画一颗按了没反应的「Use in Otto」(面板由 W2-11 才挂上)", () => {
    const sections = sourceCode("components/create/CreateBrowseSections.tsx");
    expect(sections, "创作面给了 onUseInOtto,但那一页还没有 Otto 面板").not.toContain("onUseInOtto");
    // 旧壳照旧传它,所以那颗按钮在 /otto 上一如从前。
    expect(sourceCode("components/otto/OttoView.tsx")).toContain("onUseInOtto");
  });
});

/* ── ③ 一屏只有一个「开始做点什么」(规格书 Q2-A) ──────────────────────────── */

/**
 * 开工框的**唯一实现**。
 *
 * `ia.json` 记录的头号重叠就是两个平行前门(Otto 聊天框 vs 画布输入框),裁决的收口办法不是
 * 「少摆一个」,而是「同一个框摆两处」。所以这里钉的不是「只出现一次」的字面量洁癖,而是:
 * 商家看得见的那两个控件(输入框与提交键)的无障碍名字,全仓只由一个文件写出来。谁复制粘贴
 * 出第二个开工框,复制的一定包括这两个名字。
 */
const START_SOMETHING = "components/start-something/StartSomething.tsx";
const START_CONTROL_LABELS = ['aria-label="What are we making?"', 'aria-label="Open a canvas for this"'];

/** 源码扫描范围:产品代码。测试文件按名字断言是它们的职责,不算第二个前门。 */
function productSources(): string[] {
  return [
    ...filesUnder(resolve(WEB_ROOT, "app")),
    ...filesUnder(resolve(WEB_ROOT, "components")),
    ...filesUnder(resolve(WEB_ROOT, "lib")),
  ].filter((file) => /\.tsx?$/.test(file) && !file.includes("__tests__"));
}

describe("一屏只有一个开工入口(规格书 Q2-A)", () => {
  it("那个开工框只有一份实现", () => {
    expect(existsSync(resolve(WEB_ROOT, START_SOMETHING))).toBe(true);

    for (const label of START_CONTROL_LABELS) {
      const owners = productSources()
        .filter((file) => stripComments(readFileSync(file, "utf8")).includes(label))
        .map((file) => relative(WEB_ROOT, file));
      expect(owners, `${label} 出现在不止一个文件里 —— 第二个开工框`).toEqual([START_SOMETHING]);
    }
  });

  it("`/create` 摆的就是那一份(不是长得像的第二个)", () => {
    expect(sourceCode("components/canvas/NorthstarHome.tsx")).toContain(
      "@/components/start-something/StartSomething",
    );
    // 创作面这一页 → 受控入口 → NorthstarHome → 那个框,一条真的引用链。
    expect(sourceCode("app/create/page.tsx")).toContain("@/components/canvas/NorthstarHomeEntry");
    expect(sourceCode("components/canvas/NorthstarHomeEntry.tsx")).toContain(
      "@/components/canvas/NorthstarHome",
    );
  });

  it("开工动作也只有一条:`createProject` 的调用点是一份写明理由的名单", () => {
    /**
     * 谁可以调 `createProject`,以及为什么。空豁免簿骗不了人,长豁免簿才会 ——
     * 所以每一行都得说清它**不是**第二个开工前门。
     */
    const ALLOWED: Record<string, string> = {
      [START_SOMETHING]: "唯一的开工入口:商家写一句话 → 建画布 → 落在那张画布上。",
      "components/otto/OttoApp.tsx":
        "旧壳左侧项目列表那颗 +:它建的是一个空项目,不是「开始做点什么」。整条随 W2-11 退场。",
      "lib/otto-projects-port.ts":
        "Otto 技能的项目端口:Otto 只提议,商家点了才建 —— 它不画界面,也不静默开画布。",
    };

    const callers = productSources()
      .filter((file) => /createProject[,\s}(]/.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => relative(WEB_ROOT, file))
      .filter((file) => file !== "lib/actions.ts") // 动作本体自己不算调用点
      .sort();

    expect(callers, "有人在名单外开了第二条建画布的路").toEqual(Object.keys(ALLOWED).sort());
  });
});

/* ── 受控入口的登录闸(老纪律复检) ─────────────────────────────────────────── */

describe("认不出人就不交出内容", () => {
  it("`/create` 下半页的受控入口未登录直接 redirect('/login')", async () => {
    mocks.requireOwner.mockResolvedValue({ error: "unauthenticated" });
    const { CreateBrowseEntry } = await import("@/components/create/CreateBrowseEntry");

    await expect(CreateBrowseEntry()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.getProjects).not.toHaveBeenCalled();
    expect(mocks.getEntities).not.toHaveBeenCalled();
  });

  it("认出人之后只读**他自己的** ownerId 下的东西(客户端一个字都送不进来)", async () => {
    mocks.requireOwner.mockResolvedValue({ ownerId: "owner-1" });
    mocks.getProjects.mockResolvedValue([{ id: "p-1", name: "One" }]);
    mocks.getEntities.mockResolvedValue([]);
    const { CreateBrowseEntry } = await import("@/components/create/CreateBrowseEntry");

    await CreateBrowseEntry();

    expect(mocks.getProjects).toHaveBeenCalledWith("owner-1");
    expect(mocks.getEntities).toHaveBeenCalledWith("owner-1");
  });

  it("逛一眼模板不会替商家凭空建一张画布", () => {
    const entry = sourceCode("components/create/CreateBrowseEntry.tsx");
    expect(entry, "这一页 bootstrap 了一张商家没建过的画布").not.toContain("getOrCreateDefaultProject");
  });
});
