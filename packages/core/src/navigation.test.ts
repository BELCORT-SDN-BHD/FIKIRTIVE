/**
 * 导航唯一权威源的自守(#801)。
 *
 * 这份树有三个读者(导轨、Otto、围栏),所以树自己的形状必须先站得住:名字只写一处、
 * 目的地不重复、每一条都有一句人话、助手不占板块位、一个日历。
 *
 * 零 I/O、零渲染 —— 纯数据断言。
 */
import { describe, expect, it } from "vitest";
import {
  CANVAS_HREF,
  CREATE_NAV_HREF,
  CREATE_NAV_LABEL,
  MERCHANT_NAV,
  MERCHANT_NAV_REDIRECTS,
  NAV_PATH_SEPARATOR,
  NAV_LABEL_ALLOWED_CHARS,
  NAV_PATH_SEPARATOR_FAMILY,
  OTTO_ASSISTANT,
  everyNavDestination,
  isNavGroup,
  merchantNavLinks,
  merchantNavMap,
  navLabel,
  navPath,
  navPointableNames,
} from "./navigation.js";

describe("MERCHANT_NAV 的形状", () => {
  // R22:九扇主门加一个独立 Settings 分组。数字写死,不是「至少」——多一格或少一格都是
  // 一次没被讨论过的导航改动。
  it("恰好十个顶层节点(R22 九扇主门 + Settings)", () => {
    expect(MERCHANT_NAV.length).toBe(10);
    expect(MERCHANT_NAV.map((node) => node.key)).toEqual([
      "home", "create", "library", "brand", "campaign", "approvals", "schedule", "analytics", "routines", "settings",
    ]);
  });

  it("每个 key 只出现一次(图标、测试与后续票都按 key 认人)", () => {
    const keys = everyNavDestination().map((item) => item.key);
    const groupKeys = MERCHANT_NAV.filter(isNavGroup).map((group) => group.key);
    const all = [...keys, ...groupKeys];
    expect(new Set(all).size).toBe(all.length);
  });

  it("同一个目的地不开两扇门", () => {
    const hrefs = everyNavDestination().map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("每一条都是真路径,而且都有一句能说给商家听的话", () => {
    for (const item of everyNavDestination()) {
      expect(item.href.startsWith("/"), `${item.key} → ${item.href}`).toBe(true);
      expect(item.label.trim().length, item.key).toBeGreaterThan(0);
      expect(item.does.trim().length, item.key).toBeGreaterThan(20);
    }
  });

  // W2-11 判官修复轮 P2:光查长度挡不住一句 does 悄悄多写或少写一个从句(Create 那次多带
  // 的 "and making anything always asks you first." 就是这样漏过去的)。这里逐字锁死
  // 规格书 §2.3① 那张表(`docs/specs/wave2-shell.md:117-131`)——九条 does,一个字都不许改,
  // 改了就是一次没有讨论过的导航文案改动。
  it("does 逐字锁死规格书 §2.3① 那张表,不是只查长度", () => {
    expect(Object.fromEntries(merchantNavLinks().map((item) => [item.key, item.does]))).toEqual({
      create: "Start something new and open it on a canvas — every canvas you have lives here.",
      library: "Find every image and video you have already made.",
      brand: "Keep what Otto should remember about your brand and the things you sell.",
      campaign: "Plan a campaign, edit its plan entries and their dates, and approve what may be made.",
      approvals: "Review work that needs a decision without implying that unavailable bulk actions succeeded.",
      schedule: "The one calendar: everything waiting to be posted, when it goes out, and your approval before it does.",
      analytics: "Read the performance data the connected provider actually exposes, with source and freshness visible.",
      routines: "See the routines Otto may run, their authority, schedule and credit limits.",
      billing: "Buy credits, and read what your credits have gone on.",
      connections: "Connect or disconnect the accounts you post from.",
      preferences: "Set your spend cap and posting defaults.",
      home: "See what is waiting for you, what you made lately, and what goes out next.",
    });
  });

  it("标签是 English sentence case —— 不是 Title Case", () => {
    for (const item of everyNavDestination()) {
      // 第二个词起,除了品牌与专有名词(Otto),不许再大写开头。
      const words = item.label.split(/\s+/).slice(1);
      const shouty = words.filter((word) => /^[A-Z]/.test(word) && !["Otto", "IQ"].includes(word));
      expect(shouty, `${item.key}: ${item.label}`).toEqual([]);
    }
  });

  it("每个分组至少有一条子项(导轨在 1024–1279 会拿第一条当整组的门)", () => {
    for (const group of MERCHANT_NAV.filter(isNavGroup)) {
      expect(group.items.length, group.key).toBeGreaterThan(0);
    }
  });
});

describe("换壳权威改写(W2-11 / #998,规格书 §2.3)", () => {
  // 验收条 3:merchantNavLinks() 里没有任何 /crm 前缀,也没有任何 ?view= 残留。
  // /crm 前缀已由「CRM 整段隐藏」那组测试钉死,这里补第二半:旧 /otto?view= 查询串。
  it("没有任何一条链接还挂着旧壳的 ?view= 查询串", () => {
    const stale = merchantNavLinks().filter((item) => item.href.includes("view="));
    expect(stale.map((item) => `${item.key} → ${item.href}`)).toEqual([]);
  });

  it("每一条链接都是真路由地址,不是 /otto 的一个查询变体", () => {
    for (const item of merchantNavLinks()) {
      expect(item.href, `${item.key} 还落在 /otto 后面`).not.toMatch(/^\/otto(\?|$)/);
    }
  });
});

describe("创作正名(Founder 裁决:画布是旗舰面,不下线)", () => {
  it("创作入口的名字只写在一处 —— 白标命名体系定了改这一行就够", () => {
    const create = merchantNavLinks().find((item) => item.key === "create");
    expect(create).toBeDefined();
    expect(create!.label).toBe(CREATE_NAV_LABEL);
  });

  it("创作是主导航一格直达(不必先展开分组),通向画布的家", () => {
    // W2-11(规格书 §2.1):Home 现在是落地页、排第一格(G4——唯一能一眼证明壳换了的屏);
    // Create 仍旧不是要先展开的分组,是顶层的一格直达链接,画布依旧是旗舰面。
    const create = MERCHANT_NAV.find((node) => !isNavGroup(node) && node.key === "create");
    expect(create).toBeDefined();
    expect((create as { href: string }).href).toBe(CREATE_NAV_HREF);
  });

  it("画布本身就在那扇门后面(不是另一处孤岛)", () => {
    expect(CANVAS_HREF.startsWith(`${CREATE_NAV_HREF}/`)).toBe(true);
  });
});

describe("CRM 整段隐藏(W2-13 / #993,恢复触发条件 = Meta verification 通过)", () => {
  // 这是本票的**主围栏**(规格书 §7.1「`merchantNavLinks()` 里没有任何 `/crm` 前缀」)。
  // 变异自查:把 `{ key: "customers", href: "/crm", … }` 加回 MERCHANT_NAV,这一条立刻红。
  it("导轨数据里没有任何 /crm 前缀的 href —— 一扇门都不剩", () => {
    const crmDoors = merchantNavLinks().filter((item) => item.href.startsWith("/crm"));
    expect(crmDoors.map((item) => `${item.key} → ${item.href}`)).toEqual([]);
  });

  it("customers 这个 key 已经不存在 —— 取它的名字要炸,不许静默返回一个空门", () => {
    expect(() => navLabel("customers")).toThrow(/customers/);
    expect(() => navPath("customers")).toThrow(/customers/);
  });

  it("Otto 读的界面地图里也没有 CRM —— 它不可能把商家送去一扇不存在的门", () => {
    expect(merchantNavMap()).not.toContain("/crm");
  });

  // preview 这个字段本身留着(CRM 回来那天要用),但今天树上没有一扇预览门 ——
  // 有一扇就意味着导轨又在承诺一件做不到的事,而这一票正是为了不再有这种门。
  it("今天树上没有任何预览门", () => {
    const preview = everyNavDestination().filter((item) => item.preview);
    expect(preview.map((item) => item.key)).toEqual([]);
  });

  it("实话不写工期 —— 产品不承诺自己不知道的事", () => {
    for (const item of everyNavDestination()) {
      expect(item.preview ?? "", item.key).not.toMatch(/coming soon|next (week|month)|by \w+ \d{4}/i);
    }
  });
});

describe("Otto 是助手,不是模块(W2-11:而且不是地址)", () => {
  it("助手不在板块列表里", () => {
    expect(merchantNavLinks().some((item) => item.key === OTTO_ASSISTANT.key)).toBe(false);
    expect(MERCHANT_NAV.some((node) => isNavGroup(node) && node.key === OTTO_ASSISTANT.key)).toBe(false);
  });

  it("它没有 href —— 面板不是地址,点开的是右侧常驻面板,不是一次跳转", () => {
    // 结构性断言,不是「凑巧没写」:这条对象上根本不存在 href 属性,所以它不可能被
    // 误接进任何按 href 做的枚举(everyNavDestination()、CRM 前缀检查、围栏……)。
    expect("href" in OTTO_ASSISTANT).toBe(false);
    expect(everyNavDestination().some((item) => item.key === OTTO_ASSISTANT.key)).toBe(false);
  });

  it("但它有名字,而且地图里说得清怎么打开它", () => {
    expect(navLabel("otto")).toBe(OTTO_ASSISTANT.label);
    const line = merchantNavMap().split("\n").find((row) => row.startsWith(`- ${OTTO_ASSISTANT.label}`));
    expect(line, "地图里应当有助手那一行").toBeDefined();
    // 只认 Cmd/Ctrl+J 这一种说法——"Otto button" 是 packages/otto 自己 #541 词表明令禁止
    // 的措辞(Otto 看不见 app 的控件),留它当"或"的另一支等于这条测试自己也会放行禁词。
    expect(line, "地图应当说清怎么打开它").toMatch(/Cmd\/Ctrl\+J/);
    // 反面:那一行不许长成「名字 (href)」的形状 —— 它没有地址可以摆进括号里。
    expect(line).not.toMatch(/\(\/[^)]*\)/);
  });
});

describe("两个日历择一为准", () => {
  it("树里只有一本日历,就是排期", () => {
    const calendars = merchantNavLinks().filter((item) => item.href === "/schedule");
    expect(calendars.map((item) => item.href)).toEqual(["/schedule"]);
  });

  it("旧的战役日历有去处,不是 404", () => {
    const retired = MERCHANT_NAV_REDIRECTS.find((row) => row.from === "/campaign/calendar");
    expect(retired?.to).toBe("/schedule");
  });

  it("每一条收敛掉的旧路由都写明了去哪、为什么", () => {
    for (const row of MERCHANT_NAV_REDIRECTS) {
      expect(row.from.startsWith("/")).toBe(true);
      expect(row.to.startsWith("/")).toBe(true);
      expect(row.why.trim().length, row.from).toBeGreaterThan(20);
    }
  });
});

describe("路名(#802:Otto 说出口的地名只有这一个来源)", () => {
  it("组内的写成「分组 › 子项」,顶层的就是它自己的名字", () => {
    // W2-11:schedule 换成七格之一,顶层直呼其名,不再挂在 Workspace 分组下面。
    expect(navPath("schedule")).toBe("Schedule");
    expect(navPath("connections")).toBe("Settings › Connections");
    expect(navPath("create")).toBe(CREATE_NAV_LABEL);
    expect(navPath("otto")).toBe(OTTO_ASSISTANT.label);
  });

  it("不存在的 key 直接炸 —— 不许静默返回一个编出来的名字", () => {
    expect(() => navPath("insights")).toThrow(/insights/);
    expect(() => navLabel("insights")).toThrow(/insights/);
    // workspace 分组随 W2-11 整格消失(六个孩子全部升为顶层或并入 Settings)。
    expect(() => navLabel("workspace")).toThrow(/workspace/);
  });

  // r2 · #802 判官 [P1-1]:句子里顺口提到一个地方时用 navLabel(),指路时用 navPath()。
  // 两者都不许手打 —— 判官逮到的是提示词里一处手打的 `Campaign`。
  it("navLabel 给的是导轨上那个词(不带分组前缀),分组名也取得到", () => {
    expect(navLabel("library")).toBe("Library");
    expect(navLabel("campaign")).toBe("Campaigns");
    expect(navLabel("settings")).toBe("Settings");
    expect(navLabel("otto")).toBe(OTTO_ASSISTANT.label);
    // 组内项:navPath 带分组前缀,navLabel 不带 —— 两者只差那一格。
    expect(navPath("connections")).toBe(
      `${navLabel("settings")} ${NAV_PATH_SEPARATOR} ${navLabel("connections")}`,
    );
  });

  it("每一条目的地都取得到路名,且路名与地图里的写法逐字一致", () => {
    const map = merchantNavMap();
    for (const item of everyNavDestination()) {
      const path = navPath(item.key);
      expect(path.trim().length, item.key).toBeGreaterThan(0);
      expect(map, `${item.key} 的路名与地图写法不一致`).toContain(`${path} (${item.href})`);
    }
  });

  it("可说出口的名单 = 助手 + 顶层板块 + 分组名 + 每条完整路名,一条不多一条不少", () => {
    const names = navPointableNames();
    const expected = [
      OTTO_ASSISTANT.label,
      ...MERCHANT_NAV.flatMap((node) =>
        isNavGroup(node) ? [node.label, ...node.items.map((item) => navPath(item.key))] : [node.label],
      ),
    ];
    expect([...names].sort()).toEqual([...expected].sort());
    expect(new Set(names).size, "名单里不许有重名").toBe(names.length);
  });

  it("分组名是单个词 —— Otto 侧围栏按这个形状取词(#802)", () => {
    // 这条不是洁癖:packages/otto 的界面地图围栏用「分隔符两侧」认路名,分组名一旦带空格,
    // 那道围栏会取错左半边并**变红**。真要给分组起一个两词的名字,先改那道围栏再改这里。
    for (const group of MERCHANT_NAV.filter(isNavGroup)) {
      expect(group.label, `${group.key} 的分组名带了空格`).not.toMatch(/\s/);
    }
  });

  // #802 判官 [P2] / r3 [P2-2]:标签自己就能伪造一层。`label: "Connections 〉 Advanced"` 会让
  // navPath() 吐出一条看起来有两级、实则不存在的路,而 Otto 侧围栏拿它当授权名单 ——
  // 一份被污染的权威,下游再严的对账也白搭。
  //
  // r2 用的是「不许含这一族字符」;r3 判官接着补了 `∕`、`：`、`⇒` 三个 —— 黑名单永远追不上
  // 同形字。r4 改成**白名单**:标签只能由字母/数字/空格/`&`/`-`/`'` 组成,一切标点、箭头、
  // 斜线、冒号自然全部在外。这条是可证的,不必再随判官的下一次复现加字符。
  it("标签只由白名单字符组成 —— 权威自己不可能伪造出一层(#802 r4)", () => {
    for (const item of everyNavDestination()) {
      expect(NAV_LABEL_ALLOWED_CHARS.test(item.label), `${item.key} 的标签有白名单外的字符:${item.label}`).toBe(
        true,
      );
    }
    for (const group of MERCHANT_NAV.filter(isNavGroup)) {
      expect(
        NAV_LABEL_ALLOWED_CHARS.test(group.label),
        `${group.key} 的分组名有白名单外的字符:${group.label}`,
      ).toBe(true);
    }
  });

  it("白名单真的挡得住伪造(不是一条永远为真的断言)", () => {
    // 判官三轮点过名的写法,逐个验红。
    for (const forged of [
      "Connections 〉 Advanced",
      "Connections > Advanced",
      "Connections ∕ Advanced", // U+2215(r3)
      "Connections：Advanced", // 全角冒号(r3)
      "Connections ⇒ Advanced", // U+21D2(r3)
      "Connections › Advanced",
      "Connections / Advanced",
      "Connections｜Advanced",
    ]) {
      expect(NAV_LABEL_ALLOWED_CHARS.test(forged), `伪造标签「${forged}」必须被挡`).toBe(false);
    }
    // 反向:现役标签的形状(含 & 与空格)必须过,否则白名单会逼着产品改名。
    for (const real of ["Brand & products", "Billing & credits", "Ask Otto", "CRM", "Create"]) {
      expect(NAV_LABEL_ALLOWED_CHARS.test(real), `真标签「${real}」不该被挡`).toBe(true);
    }
  });

  it("归一化字符族只收无歧义的分隔符(它只管报错可读性,封闭性在白名单与形状)", () => {
    for (const separator of ["›", "〉", ">", "》", "»", "＞"]) {
      expect(NAV_PATH_SEPARATOR_FAMILY, `${separator} 不在归一化字符族里`).toContain(separator);
    }
    expect(NAV_PATH_SEPARATOR_FAMILY).toContain(NAV_PATH_SEPARATOR);
    // 刻意在族外:这些字符在正当英语里到处都是,归一化它们会制造满屏误伤
    // (`image/video`、`kind:"image" → call seedreamPrompt`)。判官 r3 点名的三个就在其中,
    // 它们由 packages/otto 的形状尺子兜住,不靠字符表 —— 这是「可证」与「数字符」的分工。
    for (const everyday of ["/", "→", "⇒", "∕", "：", ":"]) {
      expect(NAV_PATH_SEPARATOR_FAMILY, `${everyday} 不该进归一化字符族`).not.toContain(everyday);
    }
  });
});

describe("给 Otto 的界面地图", () => {
  it("路名用的是同一个分隔符(围栏按它认路)", () => {
    expect(merchantNavMap()).toContain(`Settings ${NAV_PATH_SEPARATOR} Connections`);
  });

  it("从同一棵树生成 —— 每一条门都在地图里", () => {
    const map = merchantNavMap();
    for (const item of everyNavDestination()) {
      expect(map, `${item.key} 不在地图里`).toContain(item.href);
      expect(map, `${item.key} 的名字不在地图里`).toContain(item.label);
    }
  });

  it("分组的路写成商家跟得下去的形状", () => {
    expect(merchantNavMap()).toContain("Settings › Connections");
  });

  it("预览门的实话跟着它进地图 —— Otto 不可能只说前一半(#792)", () => {
    const map = merchantNavMap();
    for (const item of everyNavDestination()) {
      if (!item.preview) continue;
      // 同一行:能做什么与还不能做什么分不开。
      const line = map.split("\n").find((row) => row.includes(`(${item.href})`));
      expect(line, `${item.key} 不在地图里`).toBeDefined();
      expect(line, `${item.key} 的实话没跟上`).toContain(item.preview);
    }
  });

  it("地图里不出现供应商或模型名(白标)", () => {
    const map = merchantNavMap().toLowerCase();
    for (const forbidden of ["seedance", "seedream", "byteplus", "claude", "anthropic", "openai"]) {
      expect(map, forbidden).not.toContain(forbidden);
    }
  });
});
