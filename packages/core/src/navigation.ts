/**
 * 商家主导航的**唯一权威源**(#801)。
 *
 * 为什么在 core:这份树有三个读者 —— 左侧导轨(画它)、Otto(照它指路)、围栏测试(照它
 * 核对)。抄成三份,就一定有一份先烂掉;本仓已经在「说的与做的失同步」上栽过太多次。
 * 从此导航只有数据,壳只是渲染器:后面的票(#802 Otto 界面地图)改这里的数据即可,不必
 * 再动壳。#792 是第一次验证 —— CRM 七扇门收成一扇预览门,只改了这里的数据;壳唯一的改动
 * 是学会画一枚 Preview 徽章,而那是一种新的**表现**,不是第二份导航。
 *
 * 纯数据、零依赖(没有 React、没有图标、没有 node/network),所以主 barrel 装得下,
 * Otto 的指令与浏览器端导轨可以读同一份。图标在 apps/web 按 key 配。
 *
 * 四条 Founder 裁决落在这份数据上:
 *   ① **画布是 creation 旗舰面,不下线** —— 它有主导航第一格(见 CREATE_NAV_LABEL),
 *      沉浸式外壳原来的「六扇门」全部收编进这棵树,不再有第二套导航。
 *   ② **Otto 是助手,不是模块** —— 它不在 MERCHANT_NAV 里占板块位;它是
 *      OTTO_ASSISTANT,导轨把它画在板块之上、随处可点。
 *   ③ **一个日历** —— 排期日历是唯一权威(真有 ScheduledPost 表、worker 会照它发布);
 *      /campaign/calendar 那张草稿列表收敛成重定向,见 MERCHANT_NAV_REDIRECTS。
 *   ④ **CRM 整段先收起来**(W2-13 / #993,Founder 裁决 2026-08-18 裁决2)—— 从前这里有
 *      一格 Customers 预览门(#792,七扇 /crm 子门收成一扇并挂一句 `preview`)。渠道一条都
 *      连不上,预览门再诚实也仍然是一扇通向空房间的门,所以这一格整个删掉:
 *      **导航里不许再出现任何 `/crm` 前缀的 href**(围栏在 navigation.test.ts)。
 *      /crm 的 14 个路由文件保留、各自 `redirect("/")`(旧书签不撞墙),4600 行 CRM 引擎与
 *      packages/otto 的 CRM 技能原地保留。**恢复触发条件 = Meta verification 通过**
 *      (登记在延期台账 issue #359):那一天把这一格连同它的 `preview` 一起加回来。
 */

/** 一条真能点开的目的地。 */
export type MerchantNavLink = {
  /** 稳定的机器 key —— 图标、测试与后续票都按它认人,标签改字不影响。 */
  readonly key: string;
  /** 商家看到的字。English sentence case。 */
  readonly label: string;
  /** 真实路由(可带 query)。 */
  readonly href: string;
  /** 一句人话:在这里能做什么。Otto 照它指路,所以它与导轨写的是同一句 —— 商家听到的
   *  和看到的永远对得上。 */
  readonly does: string;
  /**
   * 这扇门后面的能力**还不完整**时,这一句就是它的实话(#792)。
   *
   * 为什么是一个字段而不是把「(preview)」塞进 label:「这扇门是预览」是一个关于目的地的
   * 事实,它有两个读者 —— 导轨要画一枚 Preview 徽章,Otto 要把这句话说给商家听。写进
   * label 就等于把事实藏进一个字符串里,两个读者各自去解析它,那正是本仓的老病。
   *
   * 有它 = 商家点进去之前就知道这里还没通电;没有它 = 这扇门后面说的话全部作数。
   * 能力通电的那一天,删掉这一行,徽章与那句话一起消失,没有第二处要找。
   */
  readonly preview?: string;
};

/** 一组目的地(导轨里可折叠的一段)。 */
export type MerchantNavGroup = {
  readonly key: string;
  readonly label: string;
  readonly items: readonly MerchantNavLink[];
};

export type MerchantNavNode = MerchantNavLink | MerchantNavGroup;

export function isNavGroup(node: MerchantNavNode): node is MerchantNavGroup {
  return "items" in node;
}

/**
 * 换壳之后的路由常量(Wave 2,规格书 `docs/specs/wave2-shell.md` §2.2)。
 *
 * 为什么是一份、而且摆在最前面:换壳开六路并行(Library / Brand / Schedule / Settings /
 * Create / Home),六个人会同时需要同一串新地址。谁在自己那一面手写一次 `"/library"`,
 * 这棵树就又多了一份会各自漂移的真相 —— 本仓最贵的一课(两个导航、两个日历、两个创作
 * 入口)全是这么来的。所以新地址在权威源里只落这一份,六路各自 import。
 *
 * W2-5 把它从文件下半段挪到这里:`CREATE_NAV_HREF` / `CANVAS_HREF` 现在就是这张表里的两条
 * (创作面改名 `/create` 之后,再写第二遍地址就是又开一份真相),而 const 的求值是自上而下的,
 * 所以表必须先于读它的人。**十三个值逐字节不变**;跟着改的只有两句已经过期的注释 ——
 * 这一段自己的「W2-5 改名搬家」预告,与 `create:` 那一行的「今天叫 `/northstar-immersive`」。
 *
 * **它仍然不是导航数据**:`MERCHANT_NAV` 的七格权威改写留给切换总票(W2-11)。
 *
 * 用 key 而不是一串散常量:后续票要按 key 取(`SHELL_ROUTES.library`),围栏也要能把它当
 * 枚举源逐条对账(`Object.values`)。
 */
export const SHELL_ROUTES = {
  /** 商家自己的总览。今天 `/` 是 `redirect("/otto")`,W2-6 把它换成真页面。 */
  home: "/",
  /** 创作旗舰面。W2-5 起这就是它真正的地址(旧 `/northstar-immersive` 永久重定向到这里)。 */
  create: "/create",
  /** 画布本身,永远在 Create 那扇门后面。 */
  canvas: "/create/canvas",
  /** 已经做出来的每一张图、每一条片。今天是 `/otto?view=library`。 */
  library: "/library",
  /** 剪辑台 —— 要剪的东西就在 Library,所以它跟着 Library 走(规格书 Q6)。 */
  edit: "/library/editor",
  /** Otto 该记住的品牌与产品。今天是 `/otto?view=memory`。 */
  brand: "/brand",
  /** 战役。今天已经是真路由,新旧同址。 */
  campaign: "/campaign",
  /** 唯一的日历。今天是 `/otto?view=schedule`。 */
  schedule: "/schedule",
  /** Analytics 并进 Schedule 的第二个页签(规格书 Q4):它对每个商家都还是空态,不占一格。 */
  analytics: "/schedule/analytics",
  /** 买 credits 与消费历史。今天已经是真路由,新旧同址。 */
  billing: "/billing",
  /** 连接要发布的账号。今天是 `/otto?view=connections`。 */
  connections: "/settings/connections",
  /** 花费上限与发布默认值。今天是 `/otto?view=account`。 */
  preferences: "/settings",
  /** 身份菜单进得去的那一页 —— 不是导航格,但它是商家表面之一。 */
  profile: "/profile",
} as const;

/**
 * 创作入口的名字 —— **全仓只写这一处**。
 *
 * 白标命名体系还没定(Founder 未拍板),先叫 "Create";体系定了就改这一行,导轨、Otto
 * 指路文案与围栏一起跟着换,没有第二处要找。
 */
export const CREATE_NAV_LABEL = "Create";

/**
 * 创作旗舰面:沉浸式画布的家(开工输入框 + 新建画布 + 商家自己的画布列表)。
 *
 * W2-5(规格书 §2.2):地址从 `/northstar-immersive` 改成 `/create`。`northstar-immersive`
 * 是内部代号 —— 它出现在商家的地址栏里,本身就是一处「说的与做的不一致」。旧地址不 404,
 * 由 `apps/web/app/northstar-immersive/*` 三个重定向路由永久送到新地址。
 */
export const CREATE_NAV_HREF = SHELL_ROUTES.create;

/** 画布本身。Create 首页把商家送到自己那张画布上,所以导轨不再单列一行。 */
export const CANVAS_HREF = SHELL_ROUTES.canvas;

/**
 * Otto 的描述 —— 助手,不是板块,而且**不是地址**(W2-11,规格书 §2.3 ②)。
 *
 * 它不在 MERCHANT_NAV 里:导轨把它画在板块之上、每一个商家表面都在,点开的是右侧常驻
 * 面板,不是一次跳转。「主导航第一项叫 Otto」曾经把助手当成了模块,这个常量是那件事的
 * 反面;`href` 字段的消失是下一层反面 —— Otto 不再是「点开就换页」的东西。
 *
 * 没有 `MerchantNavLink` 类型标注,是因为它没有 `href`——那个类型要求真地址,Otto 给不出。
 * `navPath()` / `navLabel()` 仍然对 `otto` key 单独判断(它俩不读 `.href`),所以 Otto 仍能
 * 说出自己的名字;`everyNavDestination()` 不再把它接进去,因为那份名单的契约就是「真链接」。
 */
export const OTTO_ASSISTANT = {
  key: "otto",
  label: "Ask Otto",
  does: "Ask Otto to do any of this with you — Otto sits on the right of every page, and is never a section of its own.",
} as const;

/**
 * 主导航,顺序即导轨从上到下的顺序(W2-11,规格书 §2.3 ①)。
 *
 * 七格权威改写 —— 前面各票已经把真路由建好(W2-1…6、W2-10),这里只改数据本身。地址一律
 * 引 `SHELL_ROUTES`,不在这里再写第二遍字面量。
 *
 * 两处诚实修正(`simulated-features.json` 已实证,随本票一并修掉):
 *   - `preferences.does` 不再提 "notifications"——通知开关早已删除,没有任何邮件或站内渠道
 *     读它。
 *   - `analytics` 不再作为导航承诺出现:它读的是 Meta 广告账户,不是自然帖表现(规格书
 *     §2.3 ①);Analytics 仍在,是 Schedule 页内的第二个页签(`SHELL_ROUTES.analytics`),
 *     不占导航格。
 *
 * `Templates` / `Discover` / `Video editor` 不再各占一格(规格书 Q6-A):Video editor 跟着
 * Library 走(`SHELL_ROUTES.edit`),Templates / Discover 收编进 Create 页面下方的两个区段
 * (`#templates` / `#ideas`),不是新路由,所以这里没有它们的条目。
 */
export const MERCHANT_NAV: readonly MerchantNavNode[] = [
  {
    key: "home",
    label: "Home",
    href: SHELL_ROUTES.home,
    does: "See what is waiting for you, what you made lately, and what goes out next.",
  },
  {
    key: "create",
    label: CREATE_NAV_LABEL,
    href: CREATE_NAV_HREF,
    does: "Start something new and open it on a canvas — every canvas you have lives here.",
  },
  {
    key: "library",
    label: "Library",
    href: SHELL_ROUTES.library,
    does: "Find every image and video you have already made.",
  },
  {
    key: "brand",
    label: "Brand",
    href: SHELL_ROUTES.brand,
    does: "Keep what Otto should remember about your brand and the things you sell.",
  },
  {
    key: "campaign",
    label: "Campaigns",
    href: SHELL_ROUTES.campaign,
    does: "Plan a campaign, edit its plan entries and their dates, and approve what may be made.",
  },
  {
    key: "schedule",
    label: "Schedule",
    href: SHELL_ROUTES.schedule,
    // 唯一的日历。/campaign/calendar 那张草稿列表已收敛(见 MERCHANT_NAV_REDIRECTS):
    // 计划日期在战役自己那一页改,真正要发出去的东西只有这一本。
    does: "The one calendar: everything waiting to be posted, when it goes out, and your approval before it does.",
  },
  {
    key: "settings",
    label: "Settings",
    items: [
      { key: "billing", label: "Billing & credits", href: SHELL_ROUTES.billing, does: "Buy credits, and read what your credits have gone on." },
      { key: "connections", label: "Connections", href: SHELL_ROUTES.connections, does: "Connect or disconnect the accounts you post from." },
      { key: "preferences", label: "Preferences", href: SHELL_ROUTES.preferences, does: "Set your spend cap and posting defaults." },
    ],
  },
];

/**
 * 收敛掉的旧路由 —— 一律 redirect,永不 404。
 *
 * 这份表是围栏的枚举源:每一条 `from` 都必须有一个真的 route 文件把人送到 `to`。
 */
export const MERCHANT_NAV_REDIRECTS: readonly { readonly from: string; readonly to: string; readonly why: string }[] = [
  {
    from: "/campaign/calendar",
    to: SHELL_ROUTES.schedule,
    why: "One calendar, not two. The campaign calendar only re-edited plan-entry dates that the campaign's own page already edits; the schedule is the calendar that actually posts.",
  },
  // `/library` 曾经在这张表里(「旧的独立素材库已并进工作区 Library」)。W2-1 把它撤了 ——
  // 不是改了去处,是**它不再是一条收敛掉的旧路由**:`/library` 现在是真页面
  // (`apps/web/app/library/page.tsx`,规格书 §2.2「shim 撤销,变回真页面」)。这张表的
  // 契约是「每一条 from 都必须有一个真的 redirect 路由文件」,留着这一行就等于要求那扇门
  // 继续把商家甩走。
  //
  // `/m` 曾经在这张表里(「旧的 simple-mode 表面已经退役,只有一个 Otto」)。W2-11 把它撤了
  // 同一个理由:`apps/web/app/m/page.tsx` 这个文件本身随本票删除,不再是一条「收敛掉的旧
  // 路由」——它是一条**不存在的**路由。旧书签 `/m` 今天起 404,而不是二次转发:它从来只是
  // 一个内部代号入口,产品从未公测过,没有商家书签需要兼容。
];

/**
 * 旧 `/otto?view=X` 的去处 —— 每一个 view 都必须在这里有一行,否则围栏红
 * (规格书 §2.3 ③)。
 *
 * 这是围栏的第二个枚举源:`MERCHANT_NAV_REDIRECTS` 的 `{from,to,why}` 只表达得了整路径
 * 重定向,而 `/otto` 那十一个视图是同一条路径上的 query。旧书签一律 307,永不 404
 * (§2.5),所以这张表的**键位完整性**就是「没有一个旧地址撞墙」的机器判定:
 * 权威名单是 `apps/web/components/otto/otto-view-param.ts` 的 `OTTO_VIEW_KEYS`,
 * 围栏拿那份名单逐个来核这里,不在这里手抄第二份视图清单
 * (见 `apps/web/lib/__tests__/route-redirects.test.ts`)。
 *
 * 值里的路径部分全部来自 SHELL_ROUTES —— 同一条围栏会核对这一点,所以这张表不可能长出
 * 一个 SHELL_ROUTES 里没有的地址。`?otto=1` 是「落地后自动把 Otto 面板打开」,
 * `#templates` / `#ideas` 是 `/create` 页面下方的两个区段(Q6),它们都不是新路由。
 */
export const OTTO_VIEW_REDIRECTS: Readonly<Record<string, string>> = {
  otto: "/?otto=1",
  library: "/library",
  stuff: "/library",
  edit: "/library/editor",
  memory: "/brand",
  templates: "/create#templates",
  discover: "/create#ideas",
  schedule: "/schedule",
  analytics: "/schedule/analytics",
  connections: "/settings/connections",
  account: "/settings",
};

/**
 * 按 key 取一条链接。壳要单独用某一条(例如导轨底部那行 credits 点进账单)时走这里,
 * 而不是在壳里再硬写一次它的路径 —— 路径只有权威源写。
 */
export function navLinkByKey(key: string): MerchantNavLink {
  const found = everyNavDestination().find((item) => item.key === key);
  if (!found) throw new Error(`navLinkByKey: no navigation destination with key "${key}"`);
  return found;
}

/** 树里每一条链接(组内的也算),顺序即导轨顺序。助手不在内 —— 它不是板块。 */
export function merchantNavLinks(): readonly MerchantNavLink[] {
  return MERCHANT_NAV.flatMap((node) => (isNavGroup(node) ? node.items : [node]));
}

/**
 * 每一条可点的目的地 —— 只有真链接(W2-11)。
 *
 * 助手不在内:它没有 `href`,「这个能力有没有门」这类覆盖检查问的正是「有没有一条能点开的
 * 地址」,而 Otto 给不出地址。以前这里把 `OTTO_ASSISTANT` 接在最前面,是它还有 `href` 的
 * 年代;现在这个函数与 `merchantNavLinks()` 同义,保留成独立导出只是为了不逼所有调用点
 * 改名。
 */
export function everyNavDestination(): readonly MerchantNavLink[] {
  return merchantNavLinks();
}

/** 分组名与组内项之间的那一格 —— 商家跟着走的那条路只有这一种写法。 */
export const NAV_PATH_SEPARATOR = "›";

/**
 * 会被当成「路的那一格」读的字符族 —— 归一化用。
 *
 * 为什么要列出来:#802 判官 r1 [P2] 用同形字穿透过围栏 —— `Workspace 〉 Insights`(U+3009)
 * 与 `Workspace > Insights`(ASCII)在商家眼里就是一条路,在只认 U+203A 的围栏眼里却什么
 * 都不是。围栏先把这一族归一成 NAV_PATH_SEPARATOR 再对账。
 *
 * **这份名单不是围栏的封闭性所在**(判官 r3 [P2-2] 又补了 `∕`、`：`、`⇒` 三个):字符表
 * 永远数不完。围栏真正的封闭手段是 packages/otto 那道「合法名 + 任意标点 + 大写词」的形状
 * 判定 —— 不认字符,认形状。这份名单只负责把常见写法折成一个字符,让报错更好读。
 * 标签侧的封闭手段同理:navigation.test.ts 钉的是**字符白名单**(标签只能由字母/数字/空格/
 * `&`/`-`/`'` 组成),而不是逐个禁这份名单。
 */
export const NAV_PATH_SEPARATOR_FAMILY = [
  NAV_PATH_SEPARATOR, // U+203A,权威写法
  "〉", // U+3009
  "》", // U+300B
  "»", // U+00BB
  "＞", // U+FF1E 全角
  ">", // ASCII
  "⟩", // U+27E9
  "⟫", // U+27EB
  "❯", // U+276F
] as const;

// 刻意**不**收进这一族:`→`、`⇒`、`/`、`∕`、`／`、`：`。它们在正当英语里到处都是
// (`image/video`、`kind:"image" → call seedreamPrompt`),归一化会把它们变成假路径而制造
// 满屏误伤。判官 r3 [P2-2] 点名的正是这三个字符 —— 它们由 packages/otto 那把**形状**尺子
// 兜住(合法名 + 任意连接符 + 大写词),不靠字符表。

/**
 * 标签里允许出现的字符 —— **白名单**,不是黑名单。
 *
 * 判官 r3 [P2-2]:禁一族字符永远追不上同形字。反过来规定「标签只能长这样」就封闭了:
 * 字母、数字、空格、`&`(Brand & products)、`-`、`'`。任何标点/箭头/斜线/冒号都进不来,
 * 于是一个标签**不可能**自己伪造出一层不存在的下级。
 */
export const NAV_LABEL_ALLOWED_CHARS = /^[A-Za-z0-9 &'-]+$/;

/**
 * 一条目的地在商家眼里的**完整路名**:组内的写成「Workspace › Schedule」,顶层的就是它
 * 自己的名字。
 *
 * #802:Otto 说出口的每一个地名都从这里取,提示词里不再手打第二份。名字改一个字,Otto 的
 * 指路话与导轨同时改口 —— 这正是 #801 把导航收成一棵树要买的东西。
 */
export function navPath(key: string): string {
  if (key === OTTO_ASSISTANT.key) return OTTO_ASSISTANT.label;
  for (const node of MERCHANT_NAV) {
    if (!isNavGroup(node)) {
      if (node.key === key) return node.label;
      continue;
    }
    const item = node.items.find((child) => child.key === key);
    if (item) return `${node.label} ${NAV_PATH_SEPARATOR} ${item.label}`;
  }
  throw new Error(`navPath: no navigation destination with key "${key}"`);
}

/**
 * 一条目的地在导轨上的**那个词**(不带分组前缀)。
 *
 * 句子里顺口提到一个地方时用它(「look through the user's Library」),需要指路时用
 * navPath()。两者都不许手打 —— #802 判官 r1 [P1-1] 逮到的就是一处手打的裸地名:地图和
 * navPath() 会跟着改名,那句话不会。
 */
export function navLabel(key: string): string {
  if (key === OTTO_ASSISTANT.key) return OTTO_ASSISTANT.label;
  const found = merchantNavLinks().find((item) => item.key === key);
  if (found) return found.label;
  const group = MERCHANT_NAV.find((node) => isNavGroup(node) && node.key === key);
  if (group) return group.label;
  throw new Error(`navLabel: no navigation destination or group with key "${key}"`);
}

/**
 * Otto 可以说出口的**全部**地名:助手、顶层板块、分组名,以及组内每一条的完整路名。
 *
 * 围栏的枚举源(#802):Otto 描述面里凡是写成路的地方,都必须落在这份名单内 —— 名单外的
 * 名字一律视为编造。
 */
export function navPointableNames(): readonly string[] {
  const names: string[] = [OTTO_ASSISTANT.label];
  for (const node of MERCHANT_NAV) {
    names.push(node.label);
    if (!isNavGroup(node)) continue;
    for (const item of node.items) names.push(navPath(item.key));
  }
  return names;
}

/**
 * 给 Otto 读的界面地图。
 *
 * 它从同一棵树生成,所以 Otto 说的路与导轨画的路不可能对不上。路名走 navPath(),因此地图
 * 里的写法与提示词其他段落里的写法必然是同一种。
 */
export function merchantNavMap(): string {
  const lines: string[] = [];
  // 助手没有 href——它是面板,不是地址(W2-11)。这一行单独说清怎么打开它,不套
  // describeNavLink() 那副「名字 (href) — 能做什么」的模具(它要求一条真地址)。
  // 不写 "button"——packages/otto 的 #541 词表禁令挡的正是这个词:Otto 看不见 app 的
  // 控件,连自己这份地图里都不许出现点名控件的写法(否则这句话本身就会被它复述出去)。
  lines.push(`- ${OTTO_ASSISTANT.label} — ${OTTO_ASSISTANT.does} Reachable on every page, or with Cmd/Ctrl+J.`);
  for (const node of MERCHANT_NAV) {
    if (!isNavGroup(node)) {
      lines.push(describeNavLink(node));
      continue;
    }
    lines.push(`- ${node.label}`);
    for (const item of node.items) {
      lines.push(describeNavLink(item, "  "));
    }
  }
  return lines.join("\n");
}

/**
 * 地图上的一行。
 *
 * 名字走 `navPath()`(#802 的权威:板块 › 子项那一串只在那里拼一次);预览门把那句实话
 * **接在同一行**上,所以 Otto 读到「这里能做什么」的同时就读到「这里还不能做什么」——
 * 两句话分不开,也就不会只说前一半(#792)。
 */
function describeNavLink(item: MerchantNavLink, indent = ""): string {
  const preview = item.preview ? ` ${item.preview}` : "";
  return `${indent}- ${navPath(item.key)} (${item.href}) — ${item.does}${preview}`;
}
