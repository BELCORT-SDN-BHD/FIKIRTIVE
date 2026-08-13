/**
 * 商家主导航的**唯一权威源**(#801)。
 *
 * 为什么在 core:这份树有三个读者 —— 左侧导轨(画它)、Otto(照它指路)、围栏测试(照它
 * 核对)。抄成三份,就一定有一份先烂掉;本仓已经在「说的与做的失同步」上栽过太多次。
 * 从此导航只有数据,壳只是渲染器:后面的票(#792 CRM 折叠、#802 Otto 界面地图)改这里的
 * 数据即可,不必再动壳。
 *
 * 纯数据、零依赖(没有 React、没有图标、没有 node/network),所以主 barrel 装得下,
 * Otto 的指令与浏览器端导轨可以读同一份。图标在 apps/web 按 key 配。
 *
 * 三条 Founder 裁决落在这份数据上:
 *   ① **画布是 creation 旗舰面,不下线** —— 它有主导航第一格(见 CREATE_NAV_LABEL),
 *      沉浸式外壳原来的「六扇门」全部收编进这棵树,不再有第二套导航。
 *   ② **Otto 是助手,不是模块** —— 它不在 MERCHANT_NAV 里占板块位;它是
 *      OTTO_ASSISTANT,导轨把它画在板块之上、随处可点。
 *   ③ **一个日历** —— 排期日历是唯一权威(真有 ScheduledPost 表、worker 会照它发布);
 *      /campaign/calendar 那张草稿列表收敛成重定向,见 MERCHANT_NAV_REDIRECTS。
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
};

/** 一组目的地(导轨里可折叠的一段)。 */
export type MerchantNavGroup = {
  readonly key: string;
  readonly label: string;
  /** 这一组在路由上的根。有它,「我现在算不算在这一组里」就不必靠壳去猜 —— 也不必在壳里
   *  硬写一次 "/crm"。只有真的独占一段路径前缀的组才有;其余组按子项逐条判定。 */
  readonly rootPath?: string;
  readonly items: readonly MerchantNavLink[];
};

export type MerchantNavNode = MerchantNavLink | MerchantNavGroup;

export function isNavGroup(node: MerchantNavNode): node is MerchantNavGroup {
  return "items" in node;
}

/**
 * 创作入口的名字 —— **全仓只写这一处**。
 *
 * 白标命名体系还没定(Founder 未拍板),先叫 "Create";体系定了就改这一行,导轨、Otto
 * 指路文案与围栏一起跟着换,没有第二处要找。
 */
export const CREATE_NAV_LABEL = "Create";

/** 创作旗舰面:沉浸式画布的家(开工输入框 + 新建画布 + 商家自己的画布列表)。 */
export const CREATE_NAV_HREF = "/northstar-immersive";

/** 画布本身。Create 首页把商家送到自己那张画布上,所以导轨不再单列一行。 */
export const CANVAS_HREF = "/northstar-immersive/create/canvas";

/**
 * Otto —— 助手,不是板块。
 *
 * 它不在 MERCHANT_NAV 里:导轨把它画在板块之上、每一个商家表面都在,点开就是真对话。
 * 「主导航第一项叫 Otto」曾经把助手当成了模块,这个常量是那件事的反面。
 */
export const OTTO_ASSISTANT: MerchantNavLink = {
  key: "otto",
  label: "Ask Otto",
  href: "/otto",
  does: "Ask Otto to do any of this with you — Otto is your assistant, beside you on every page, and never a section of its own.",
};

/** 主导航,顺序即导轨从上到下的顺序。 */
export const MERCHANT_NAV: readonly MerchantNavNode[] = [
  {
    key: "create",
    label: CREATE_NAV_LABEL,
    href: CREATE_NAV_HREF,
    does: "Start something new and open it on a canvas — every canvas you have lives here, and making anything always asks you first.",
  },
  {
    key: "campaign",
    label: "Campaign",
    href: "/campaign",
    does: "Plan a campaign, edit its plan entries and their dates, and approve what may be made.",
  },
  {
    key: "crm",
    label: "CRM",
    // /crm 底下还有没进导航的子路由(如 /crm/inbox/templates),所以这一组按根判定:
    // 走进 /crm 的任何一页,CRM 这一段就该是展开且高亮的。
    rootPath: "/crm",
    items: [
      { key: "crm-inbox", label: "Inbox", href: "/crm/inbox", does: "Read and reply to customer conversations." },
      { key: "crm-contacts", label: "Contacts", href: "/crm/contacts", does: "Look up a customer and everything you know about them." },
      { key: "crm-segments", label: "Segments", href: "/crm/segments", does: "Group customers by what they did, so a broadcast reaches the right people." },
      { key: "crm-templates", label: "Templates", href: "/crm/templates", does: "Keep the message wording you reuse when you write to customers." },
      { key: "crm-broadcasts", label: "Broadcasts", href: "/crm/broadcasts", does: "Send one message to a segment, with its own approval." },
      { key: "crm-workflows", label: "Workflows", href: "/crm/workflows", does: "Set up a reply or follow-up that goes out automatically." },
      { key: "crm-reports", label: "Reports", href: "/crm/reports", does: "See how your conversations and broadcasts are doing." },
    ],
  },
  {
    key: "workspace",
    label: "Workspace",
    // 顺序照商家在 Otto 自有导轨里已经习惯的那一串(Library → 品牌 → Templates →
    // Discover → Schedule → Analytics),不另发明一套。
    //
    // 为什么 Templates 与 Discover 在这里而不在 Create:它们确实是「开始做一件新东西」的
    // 两条捷径,但 Create 必须保持**一格直达**画布 —— Founder 裁的是画布是主要卖点,把它
    // 变成一个要先展开的分组,等于给旗舰面多加一次点击。分组留给工具,直达留给旗舰。
    items: [
      { key: "library", label: "Library", href: "/otto?view=library", does: "Find every image and video you have already made." },
      { key: "brand", label: "Brand & products", href: "/otto?view=memory", does: "Keep what Otto should remember about your brand and the things you sell." },
      { key: "templates", label: "Templates", href: "/otto?view=templates", does: "Start from a ready-made setup: pick one, add your product, get a polished image." },
      { key: "discover", label: "Discover", href: "/otto?view=discover", does: "Browse ideas worth trying when you are not sure what to make next." },
      {
        key: "schedule",
        label: "Schedule",
        href: "/otto?view=schedule",
        // 唯一的日历。/campaign/calendar 那张草稿列表已收敛(见 MERCHANT_NAV_REDIRECTS):
        // 计划日期在战役自己那一页改,真正要发出去的东西只有这一本。
        does: "The one calendar: everything waiting to be posted, when it goes out, and your approval before it does.",
      },
      { key: "analytics", label: "Analytics", href: "/otto?view=analytics", does: "See how what you posted actually performed." },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    items: [
      { key: "connections", label: "Connections", href: "/otto?view=connections", does: "Connect or disconnect the accounts you post from." },
      { key: "preferences", label: "Preferences", href: "/otto?view=account", does: "Set your spend cap, notifications and posting defaults." },
      { key: "billing", label: "Billing & credits", href: "/billing", does: "Buy credits, and read what your credits have gone on." },
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
    to: "/otto?view=schedule",
    why: "One calendar, not two. The campaign calendar only re-edited plan-entry dates that the campaign's own page already edits; the schedule is the calendar that actually posts.",
  },
  {
    from: "/library",
    to: "/otto?view=library",
    why: "The old standalone library was retired into the workspace Library.",
  },
  {
    from: "/m",
    to: "/otto",
    why: "The old simple-mode surface was retired; there is one Otto.",
  },
];

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

/** 每一条可点的目的地,含助手 —— 用于「这个能力有没有门」这类覆盖检查。 */
export function everyNavDestination(): readonly MerchantNavLink[] {
  return [OTTO_ASSISTANT, ...merchantNavLinks()];
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
  lines.push(`- ${OTTO_ASSISTANT.label} (${OTTO_ASSISTANT.href}) — ${OTTO_ASSISTANT.does}`);
  for (const node of MERCHANT_NAV) {
    if (!isNavGroup(node)) {
      lines.push(`- ${node.label} (${node.href}) — ${node.does}`);
      continue;
    }
    lines.push(`- ${node.label}`);
    for (const item of node.items) {
      lines.push(`  - ${navPath(item.key)} (${item.href}) — ${item.does}`);
    }
  }
  return lines.join("\n");
}
