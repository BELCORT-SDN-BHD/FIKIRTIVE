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
    items: [
      { key: "crm-inbox", label: "Inbox", href: "/crm/inbox", does: "Read and reply to customer conversations." },
      { key: "crm-contacts", label: "Contacts", href: "/crm/contacts", does: "Look up a customer and everything you know about them." },
      { key: "crm-segments", label: "Segments", href: "/crm/segments", does: "Group customers by what they did, so a broadcast reaches the right people." },
      { key: "crm-templates", label: "Templates", href: "/crm/templates", does: "Keep the message wording you reuse when you write to customers." },
      { key: "crm-broadcasts", label: "Broadcasts", href: "/crm/broadcasts", does: "Send one message to a segment, with its own approval." },
      { key: "crm-workflows", label: "Workflows", href: "/crm/workflows", does: "Set up a reply or follow-up that happens on its own." },
      { key: "crm-reports", label: "Reports", href: "/crm/reports", does: "See how your conversations and broadcasts are doing." },
    ],
  },
  {
    key: "workspace",
    label: "Workspace",
    items: [
      { key: "library", label: "Library", href: "/otto?view=library", does: "Find every image and video you have already made." },
      { key: "brand", label: "Brand & products", href: "/otto?view=memory", does: "Keep what Otto should remember about your brand and the things you sell." },
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
  lines.push(`- ${OTTO_ASSISTANT.label} (${OTTO_ASSISTANT.href}) — ${OTTO_ASSISTANT.does}`);
  for (const node of MERCHANT_NAV) {
    if (!isNavGroup(node)) {
      lines.push(`- ${node.label} (${node.href}) — ${node.does}`);
      continue;
    }
    lines.push(`- ${node.label}`);
    for (const item of node.items) {
      lines.push(`  - ${node.label} › ${item.label} (${item.href}) — ${item.does}`);
    }
  }
  return lines.join("\n");
}
