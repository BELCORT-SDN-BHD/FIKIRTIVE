/**
 * route-redirects.test.ts —— 换壳的路由围栏(Wave 2,规格书 `docs/specs/wave2-shell.md` §7.1)。
 *
 * 这一票(W2-0)只建**骨架**,钉的是今天就能证明的两件事:
 *   ① 旧 `/otto?view=X` 的每一个 view 在 `OTTO_VIEW_REDIRECTS` 里都有去处 —— 一个不少;
 *   ② 那些去处的路径部分全部来自 `SHELL_ROUTES` —— 换壳的新地址只有一份。
 *
 * 为什么围栏在 apps/web 而不在 packages/core:视图的权威名单是
 * `components/otto/otto-view-param.ts` 的 `OTTO_VIEW_KEYS`(#969 判官 P2-3 之后由它一家
 * 收着,服务端页面与客户端外壳都读它),而 core 够不着 apps/web。围栏必须站在**两份权威
 * 都看得见**的地方,才能拿一份去核另一份;把清单抄进 core 再对账,对的就是自己抄的那一份。
 * 先例:`creation-nav-flagship.test.ts` 也在这里用同一份名单核 core 的导航树。
 *
 * 后续票往这个文件里加(§7.1「重定向」那三条,今天证不了):
 *   - §2.2 表里每一条 `from` 都有真的 route 文件,`to` 落在一条真路由上(等新路由建出来)
 *   - `/otto?view=<每一个旧值>` 都不 404(等 `/otto` 缩成重定向表,W2-11)
 *   - `?project=` / `?thread=` 在重定向后不丢(同上)
 *
 * W2-11 落地后,§7.1「重定向」剩下的那三条也补齐在这个文件里(见文末三个 describe):
 * `/otto` 本身缩成了纯重定向表(`app/otto/page.tsx`),所以这三条现在真的证得了。
 *
 * 零 I/O、零渲染(§2.2/OTTO_VIEW_REDIRECTS 的数据对账部分);末尾三组会真的调用
 * `/otto` 的页面函数,mock 掉 `next/navigation` 的 `redirect()`(它靠抛异常中断渲染,
 * 假件也必须抛,不然被测代码会继续往下跑,生产里它不会——沿用 library-real-route-986
 * 已经立好的假件形状)。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { OTTO_VIEW_REDIRECTS, SHELL_ROUTES } from "@fikirtive/core/navigation";
import { OTTO_VIEW_KEYS } from "@/components/otto/otto-view-param";

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

const { default: OttoRedirect } = await import("../../app/otto/page");

/** 去处里的路径部分 —— `?otto=1` 与 `#templates` 都不是新路由,不参与地址对账。 */
function pathOf(target: string): string {
  return target.split(/[?#]/)[0] || "/";
}

describe("旧 /otto?view= 的每一个视图都有去处(规格书 §2.3 ③)", () => {
  it("权威名单本身还读得出来 —— 读不出来就等于这条围栏空转", () => {
    // 名单在 components/otto/otto-view-param.ts。数字是规格书 §7.1 写死的 11;
    // 真正的对账在下一条,它拿名单逐个来核,不在这里抄第二份清单。
    expect(OTTO_VIEW_KEYS.length).toBe(11);
  });

  it("一个不少:每一个 view 键在重定向表里都有一行", () => {
    const homeless = OTTO_VIEW_KEYS.filter((view) => !(view in OTTO_VIEW_REDIRECTS));
    expect(homeless, "这些旧地址商家的书签里还有,重定向表里却没有去处").toEqual([]);
  });

  it("一条不多:重定向表里不许躺着一个产品根本不认的 view", () => {
    const known = new Set<string>(OTTO_VIEW_KEYS);
    const phantom = Object.keys(OTTO_VIEW_REDIRECTS).filter((view) => !known.has(view));
    expect(phantom, "这些键 /otto 路由自己都不认,它们只会让下一个人以为还有别的旧地址").toEqual([]);
  });

  it("每一条去处都是一个真地址(以 / 开头,不是相对路径也不是外链)", () => {
    for (const [view, target] of Object.entries(OTTO_VIEW_REDIRECTS)) {
      expect(target.startsWith("/"), `?view=${view} → ${target}`).toBe(true);
      expect(target.startsWith("//"), `?view=${view} → ${target} 会被当成外链`).toBe(false);
    }
  });

  it("去处不许再指回 /otto?view= —— 重定向表不是一张自己指自己的表", () => {
    for (const [view, target] of Object.entries(OTTO_VIEW_REDIRECTS)) {
      expect(target, `?view=${view} 又指回了旧地址`).not.toContain("view=");
    }
  });
});

describe("换壳的新地址只有一份(规格书 §1.3)", () => {
  it("每一条去处的路径部分都来自 SHELL_ROUTES —— 表里不许长出第二个地址", () => {
    const routes = new Set<string>(Object.values(SHELL_ROUTES));
    const strays = Object.entries(OTTO_VIEW_REDIRECTS)
      .filter(([, target]) => !routes.has(pathOf(target)))
      .map(([view, target]) => `${view} → ${target}`);
    expect(strays, "这些去处的地址在 SHELL_ROUTES 里没有对应的一条").toEqual([]);
  });

  // 判官 P2-1:上面那些交叉核对都只经过「被别处引用到」的那几条 —— canvas / campaign /
  // billing / profile 四条今天没有任何一条对账碰得到,把 `/create/canvas` 拼成
  // `/create/canvass` 全绿。所以这一条把十三个值逐字钉死:地址是规格书 §2.2 拍的板,
  // 改它必须是一次**明写**的改动,不能是一个手滑。
  it("十七条新地址逐字就是规格书 §2.2 那一份", () => {
    expect(SHELL_ROUTES).toEqual({
      home: "/",
      create: "/create",
      canvas: "/create/canvas",
      library: "/library",
      edit: "/library/editor",
      brand: "/brand",
      campaign: "/campaign",
      approvals: "/approvals",
      schedule: "/schedule",
      analytics: "/schedule/analytics",
      routines: "/routines",
      billing: "/billing",
      connections: "/settings/connections",
      preferences: "/settings",
      profile: "/profile",
      notifications: "/notifications",
      help: "/help",
    });
  });

  it("每一条新路由常量都是一个真路径(以 / 开头,不带 query、不带锚点、不带尾斜杠)", () => {
    for (const [key, href] of Object.entries(SHELL_ROUTES)) {
      expect(href.startsWith("/"), `${key} → ${href}`).toBe(true);
      expect(href, `${key} 带了 query`).not.toContain("?");
      expect(href, `${key} 带了锚点`).not.toContain("#");
      // 尾斜杠会让「同一条路两种写法」变成两份真相;根路径是唯一的例外。
      expect(href === "/" || !href.endsWith("/"), `${key} 带了尾斜杠:${href}`).toBe(true);
    }
  });

  it("同一个地址不写两次 —— 两个 key 指同一条路就是一次没收干净的重复", () => {
    const hrefs = Object.values(SHELL_ROUTES);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("新地址里没有旧壳的残留:既没有 ?view=,也没有 CRM(Founder 裁决:整段收起来)", () => {
    for (const [key, href] of Object.entries(SHELL_ROUTES)) {
      expect(href, `${key} 还挂着旧壳的 query`).not.toContain("view=");
      expect(href.startsWith("/crm"), `${key} 指向了收起来的 CRM`).toBe(false);
    }
  });

  it("子路由长在自己那扇门后面 —— 不是另一处孤岛", () => {
    expect(SHELL_ROUTES.canvas.startsWith(`${SHELL_ROUTES.create}/`)).toBe(true);
    expect(SHELL_ROUTES.edit.startsWith(`${SHELL_ROUTES.library}/`)).toBe(true);
    expect(SHELL_ROUTES.analytics.startsWith(`${SHELL_ROUTES.schedule}/`)).toBe(true);
    expect(SHELL_ROUTES.connections.startsWith(`${SHELL_ROUTES.preferences}/`)).toBe(true);
  });
});

/**
 * CRM 整段收起来了(W2-13 / #993,Founder 裁决 2026-08-18 裁决2;恢复触发条件 = Meta
 * verification 通过,登记在延期台账 issue #359)。
 *
 * 收起来的做法是**重定向,不是删页**:测试账号的书签里还有这十四串地址,404 会让商家以为
 * 自己的东西丢了。所以这一组按 §2.5「旧书签一律不撞墙」逐个枚举 —— 枚举源是**磁盘上真实
 * 存在的路由文件**,不是手抄的清单,少一个多一个都红。
 */
const CRM_APP_DIR = path.resolve(__dirname, "../../app/crm");

function crmRoutes(): string[] {
  return readdirSync(CRM_APP_DIR, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith("page.tsx"))
    .sort();
}

describe("CRM 十四条旧地址一条都不撞墙(W2-13 / #993)", () => {
  it("十四个路由文件都还在 —— 收起来不等于删页", () => {
    expect(crmRoutes()).toEqual([
      "broadcasts/[id]/page.tsx",
      "broadcasts/new/page.tsx",
      "broadcasts/page.tsx",
      "contacts/[id]/page.tsx",
      "contacts/page.tsx",
      "inbox/[id]/page.tsx",
      "inbox/page.tsx",
      "page.tsx",
      "reports/[id]/page.tsx",
      "reports/page.tsx",
      "segments/page.tsx",
      "templates/page.tsx",
      "workflows/[id]/page.tsx",
      "workflows/page.tsx",
    ]);
  });

  it.each(crmRoutes())("%s 只做一件事:redirect(\"/\")", (file) => {
    const src = readFileSync(path.join(CRM_APP_DIR, file), "utf8");

    expect(src, `${file} 没有把人送走`).toContain('redirect("/")');
    expect(src, `${file} 的落点不是 Home`).not.toMatch(/redirect\((?!"\/"\))/);
    // 重定向页不渲染、不取数:留着任何一样,「收起来」就只是嘴上说说。
    expect(src, `${file} 还在渲染 CRM 页面`).not.toContain('from "@/components/crm');
    expect(src, `${file} 还在取数`).not.toContain('from "@/lib/');
    expect(src, `${file} 还在声明 force-dynamic(它已经不取数了)`).not.toContain("force-dynamic");
  });

  it("落点是 SHELL_ROUTES.home —— 不是某个人手打的第二个「首页」", () => {
    expect(SHELL_ROUTES.home).toBe("/");
  });

  it("骨架页删干净了(重定向页没有内容可等)", () => {
    const loading = readdirSync(CRM_APP_DIR, { recursive: true, encoding: "utf8" }).filter((file) =>
      file.endsWith("loading.tsx"),
    );
    expect(loading).toEqual([]);
  });
});

/**
 * 延期项①(本文件第 15 行,W2-11 触发条件已到):§2.2 表里每一条 `to` 都落在一条真路由上。
 * `from` 那一侧(`/otto?view=X`)不是文件系统上的东西——它是同一个 `/otto/page.tsx`
 * 读出来的 query,不是十一个不同的路由文件,所以这里只核「去处」,「起点」由下面两组
 * 通过真的调用页面函数来核(调用得动本身就证明了 `/otto` 这一个文件接住了全部十一个 view)。
 */
describe("§2.2 表的去处都落在真路由文件上(W2-11)", () => {
  const APP_DIR = path.resolve(__dirname, "../../app");

  /**
   * 一条 URL 路径在磁盘上可能的路由文件位置。
   *
   * 不止一个,是因为 **route group**:`app/(home)/page.tsx` 服务的地址就是 `/`——括号目录
   * 不进地址,它存在只为把一份 `loading.tsx` 的 Suspense 边界圈在一页身上(理由全文在
   * `app/(home)/page.tsx`)。把 URL 直接当成路径拼是把「地址」与「目录」当成同一件事,
   * 那个前提今天不成立了,而这条围栏要核的是「这个去处有没有一条真路由」,不是「目录名
   * 长得像不像地址」。
   *
   * 只展开**根一层**的括号目录 —— 今天只有这一处。真出现嵌套的那天这条围栏会红(找不到
   * 文件),那是 fail closed:它不会悄悄放行一个不存在的去处。
   */
  function pageFileCandidates(urlPath: string): string[] {
    const trimmed = urlPath === "/" ? "" : urlPath.replace(/^\//, "");
    const groups = readdirSync(APP_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\(.+\)$/.test(entry.name))
      .map((entry) => entry.name);
    return [APP_DIR, ...groups.map((group) => path.join(APP_DIR, group))].map((base) =>
      path.join(base, trimmed, "page.tsx"),
    );
  }

  it.each(Object.entries(OTTO_VIEW_REDIRECTS))("?view=%s → %s 有真的 page.tsx", (_view, target) => {
    const candidates = pageFileCandidates(pathOf(target));
    expect(
      candidates.some((route) => existsSync(route)),
      `${target} 没有路由文件(找过:${candidates.join("、")})`,
    ).toBe(true);
  });
});

/**
 * 延期项②:`/otto?view=<每一个旧值>` 都不 404 —— 真的调用页面函数(不是读源码字符串),
 * 传入每一个 `OTTO_VIEW_KEYS`,断言它落进 `redirect()`、目标恰好是权威表那一行。
 * 「不 404」在服务端组件的世界里就是「函数正常跑完并交出一个 redirect,不是抛一个
 * 意料之外的错误、也不是渲染出空页面」。
 */
describe("/otto?view=<每一个旧值> 都不 404(W2-11)", () => {
  it.each(OTTO_VIEW_KEYS)("?view=%s 落进 redirect(),目标是权威表那一行", async (view) => {
    await expect(
      OttoRedirect({ searchParams: Promise.resolve({ view }) }),
    ).rejects.toThrow(`NEXT_REDIRECT:${OTTO_VIEW_REDIRECTS[view]}`);
  });

  it("不给 ?view= 也不 404 —— 落回「otto」那一行(面板自动打开)", async () => {
    await expect(
      OttoRedirect({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(`NEXT_REDIRECT:${OTTO_VIEW_REDIRECTS.otto}`);
  });

  it("一个产品不认的 ?view= 也不 404 —— 同样落回「otto」那一行", async () => {
    await expect(
      OttoRedirect({ searchParams: Promise.resolve({ view: "not-a-real-view" }) }),
    ).rejects.toThrow(`NEXT_REDIRECT:${OTTO_VIEW_REDIRECTS.otto}`);
  });
});

/**
 * 延期项③:`?project=` / `?thread=` 在重定向后不丢。
 */
describe("?project= / ?thread= 重定向后不丢(W2-11)", () => {
  it("?view=library&project=P&thread=T → /library 后面接住 project 与 thread", async () => {
    await expect(
      OttoRedirect({
        searchParams: Promise.resolve({ view: "library", project: "P", thread: "T" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/library?project=P&thread=T");
  });

  it("落点本来就带 query 时(?otto=1)不拼出两个 ? —— project/thread 接在后面", async () => {
    await expect(
      OttoRedirect({
        searchParams: Promise.resolve({ project: "P", thread: "T" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/?otto=1&project=P&thread=T");
  });

  it("落点带锚点时(#templates)query 在锚点之前,锚点仍在最后", async () => {
    await expect(
      OttoRedirect({
        searchParams: Promise.resolve({ view: "templates", project: "P" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/create?project=P#templates");
  });

  it("view 参数本身不会跟着一起被转发(已被消费掉,不属于任何人)", async () => {
    await expect(
      OttoRedirect({
        searchParams: Promise.resolve({ view: "memory", thread: "T" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/brand?thread=T");
  });
});
