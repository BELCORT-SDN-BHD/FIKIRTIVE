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
 *   ④ **没通电的能力只开一扇诚实的门**(#792)—— CRM 七扇门收成 Customers 一扇,并带
 *      一句 `preview`:消息渠道一个都连不上,所以那些页面发不出也收不到消息。页面本身
 *      一页没删,商家从预览页照样进得去。
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
    // #792 —— 七扇门收成一扇诚实的预览门(Founder 裁决 2026-08-08)。
    //
    // 原来这一组把 Inbox / Broadcasts / Workflows / Reports 与 Contacts 并排放在导轨上,
    // 每一扇都长得像一个能用的能力。可是**一个消息渠道都连不上**(Connections 里 Messaging
    // 整段写着 "Not available yet",全仓没有任何一条商家可走的连接路径),所以那六扇门后面
    // 没有一条消息发得出去、收得进来。导轨因此在替产品说大话。
    //
    // 收敛之后:导轨只承诺一件**现在真的做得到**的事 —— 建客户档案;那句 preview 把没通电
    // 的部分说在前面;那些页面本身一页没删,商家从预览页进得去(引擎 4600 行原地保留,等
    // 通电)。渠道接通的那一天(独立里程碑),删掉 preview 这一行即可。
    key: "customers",
    label: "Customers",
    // /crm 底下每一页都在这扇门后面(pathMatches 按前缀判定),所以走进 /crm 的任何一页,
    // 导轨亮的都是这一格。
    href: "/crm",
    does: "Keep a record of every customer — who they are, how to reach them, and what you may contact them about.",
    preview:
      "No messaging channel can be connected yet, so nothing in here can send a message to a customer or receive one from them. Keeping customer records is the part that works today.",
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

/**
 * 给 Otto 读的界面地图。
 *
 * 它从同一棵树生成,所以 Otto 说的路与导轨画的路不可能对不上。#802 会在这份地图上做更细
 * 的技能;在那之前,这一段已经足够让 Otto 把商家送到对的地方。
 */
export function merchantNavMap(): string {
  const lines: string[] = [];
  lines.push(describeNavLink(OTTO_ASSISTANT));
  for (const node of MERCHANT_NAV) {
    if (!isNavGroup(node)) {
      lines.push(describeNavLink(node));
      continue;
    }
    lines.push(`- ${node.label}`);
    for (const item of node.items) {
      lines.push(describeNavLink(item, `${node.label} › `, "  "));
    }
  }
  return lines.join("\n");
}

/**
 * 地图上的一行。预览门把那句实话**接在同一行**上,所以 Otto 读到「这里能做什么」的同时
 * 就读到「这里还不能做什么」—— 两句话分不开,也就不会只说前一半(#792)。
 */
function describeNavLink(item: MerchantNavLink, prefix = "", indent = ""): string {
  const preview = item.preview ? ` ${item.preview}` : "";
  return `${indent}- ${prefix}${item.label} (${item.href}) — ${item.does}${preview}`;
}
