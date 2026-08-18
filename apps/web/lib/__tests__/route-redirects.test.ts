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
 * 零 I/O、零渲染:纯数据对账。
 */
import { describe, expect, it } from "vitest";
import { OTTO_VIEW_REDIRECTS, SHELL_ROUTES } from "@fikirtive/core/navigation";
import { OTTO_VIEW_KEYS } from "@/components/otto/otto-view-param";

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
