"use client";

/**
 * NavigationRail.tsx —— 新左导轨的 React 壳。
 *
 * 规格:`docs/specs/wave2-shell.md` §2.1(形状)、§5.3(一层导轨)、§5.6 ④(dropdown-menu)。
 *
 * 三件事,一句话各一件:
 *
 *  ① **一层,不是三层。** 240px 带标签,商家按一颗按钮收成 64px 图标,状态存 localStorage。
 *     这个文件里没有任何断点前缀(`lg:` / `xl:`),也没有 `matchMedia` —— 宽度不再决定形态。
 *     旧壳那套(1024–1279 图标层 + 横向页签兜底 + 1280 以上标签层)制造了三份高亮规则、
 *     三份分组展开法和一份专管两个汉堡打架的测试;这一票不把它们重写一遍,而是不要它们。
 *
 *  ② **导轨不认识任何一个地址。** 每一格、每一条 href、每一个标签都来自 `MERCHANT_NAV`
 *     (§1.3 的纪律:那份数据是唯一权威,壳只是渲染器)。这个文件里搜不到一个路由字面量 ——
 *     credits 那行走 `railBillingLink()`,Profile 走 `SHELL_ROUTES.profile`。手抄一格,
 *     `nav-rail.test.ts` 里的派生断言就红。
 *
 *  ③ **身份菜单与分组是真菜单。** 旧壳用 `<details>/<summary>` 手搓:没有 ESC 关闭、
 *     没有点外关闭、`role="menu"` 写在一个普通 div 上、方向键按了什么都不发生。换成
 *     `ui/dropdown-menu`(Radix)之后这四件是它自带的,不是我们再实现一遍。
 *
 * **挂载:这一票不挂。** 组件族建好、可独立测试,一个现有文件都没动;把它接到 layout 上、
 * 删掉旧导轨,是切换总票 W2-11 的活(§6.3 Stack B→C)。所以今天旧壳行为零变化。
 */

import * as React from "react";
import Link from "next/link";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronDown,
  Clapperboard,
  Coins,
  Compass,
  CreditCard,
  Frame,
  Home,
  LayoutTemplate,
  Library,
  LogOut,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Settings,
  SlidersHorizontal,
  User,
  Users,
} from "lucide-react";
import { SHELL_ROUTES, type MerchantNavLink } from "@fikirtive/core/navigation";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { creditsLabel } from "@/lib/credit-format";
import { activeNavHref, isGroupActive, isNavGroup, railBillingLink, railNodes } from "./rail-tree";
import {
  type NavRailState,
  defaultNavRailState,
  navRailWidth,
  readNavRailState,
  toggleNavRailCollapsed,
  writeNavRailState,
} from "./rail-state";

type NavigationIcon = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** 折叠按钮的 `aria-controls` 指向的就是这条导轨本身。两处引用同一个常量,不手打两遍。 */
export const NAV_RAIL_ELEMENT_ID = "global-navigation-rail";

/**
 * key → 图标。**只有这一张表**,树的形状不在这里。
 *
 * 表里同时有今天权威源的 key(create / campaign / customers / workspace / library / edit /
 * templates / discover / analytics …)与换壳后七格的 key(home / brand / schedule / …):
 * 这一票不改 `MERCHANT_NAV`,所以导轨今天画的是今天那棵树,W2-11 改完数据它自己就长成七格。
 * 一张表覆盖两个阶段,换壳当天不需要再回来动这个文件。
 */
export const NAV_RAIL_ICONS: Readonly<Record<string, NavigationIcon>> = {
  // 顶层
  home: Home,
  create: Frame,
  library: Library,
  brand: BookOpen,
  campaign: Megaphone,
  schedule: CalendarDays,
  customers: Users,
  workspace: Library,
  settings: Settings,
  // 组内 / 页内
  edit: Clapperboard,
  templates: LayoutTemplate,
  discover: Compass,
  analytics: BarChart3,
  billing: CreditCard,
  connections: Plug,
  preferences: SlidersHorizontal,
};

function iconFor(key: string): NavigationIcon {
  return NAV_RAIL_ICONS[key] ?? Frame;
}

/**
 * 权威源的节点,图标**在模块作用域一次性配好**。
 *
 * 不是风格问题:渲染时才查出来的组件就是渲染时才创建的组件,React(与 lint 规则
 * `react-hooks/static-components`)拒绝得对 —— 每次渲染换一个组件身份会让整棵子树重挂。
 * 一枚导航图标本来也没有任何「随这次渲染而变」的东西。
 */
type RailLinkNode = MerchantNavLink & { readonly icon: NavigationIcon };
type RailGroupNode = {
  readonly key: string;
  readonly label: string;
  readonly icon: NavigationIcon;
  readonly items: readonly RailLinkNode[];
};
type RailNode = RailLinkNode | RailGroupNode;

function withIcon(link: MerchantNavLink): RailLinkNode {
  return { ...link, icon: iconFor(link.key) };
}

function isRailGroupNode(node: RailNode): node is RailGroupNode {
  return "items" in node;
}

const RAIL_TREE: readonly RailNode[] = railNodes().map((node): RailNode =>
  isNavGroup(node)
    ? { key: node.key, label: node.label, icon: iconFor(node.key), items: node.items.map(withIcon) }
    : withIcon(node),
);

/** 导轨里每一行共用的形状。收起来时变成一颗正方形图标格。 */
function rowClass(collapsed: boolean, active: boolean): string {
  return cn(
    "flex h-11 w-full items-center gap-3 rounded-[10px] text-sm outline-none transition-colors",
    "focus-visible:ring-[3px] focus-visible:ring-ring/40",
    collapsed ? "justify-center px-0" : "px-3",
    active
      ? "bg-secondary font-semibold text-foreground"
      : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
  );
}

/**
 * 一条真能点开的目的地。
 *
 * `preview` 是权威源里的字段(#792):这扇门后面的能力还没通电时,那句实话必须在**点进去
 * 之前**就说出来。收起来的时候没有地方画徽章,所以可访问名字里带上「(preview)」,再画一颗点 ——
 * 名字和 title 在两种形态下都在,徽章只在有地方写字的时候出现。
 */
function RailLink({
  link,
  active,
  collapsed,
}: {
  link: RailLinkNode;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      data-nav-rail-link={link.key}
      aria-current={active ? "page" : undefined}
      title={link.preview ? `${link.label} — Preview. ${link.preview}` : link.label}
      aria-label={link.preview ? `${link.label} (preview)` : link.label}
      className={rowClass(collapsed, active)}
    >
      <span className="relative shrink-0">
        <Icon className="size-4" aria-hidden />
        {link.preview && collapsed ? (
          <span aria-hidden data-nav-rail-preview-dot className="absolute -right-1 -top-1 size-1.5 rounded-full bg-warning" />
        ) : null}
      </span>
      {!collapsed && <span className="truncate">{link.label}</span>}
      {link.preview && !collapsed ? (
        <Badge variant="outline" className="ml-auto shrink-0">
          Preview
        </Badge>
      ) : null}
    </Link>
  );
}

/**
 * 一个分组 —— 一颗按钮 + 一张真菜单。
 *
 * 旧壳这里是 `<details>/<summary>`:收起来的 64px 层根本展不开(所以旧壳另外做了一条横向
 * 页签兜底),而展开的那层没有 ESC、没有点外关闭。换成 dropdown-menu 之后两种形态用**同一个**
 * 控件:240px 上它在名字右边弹出,64px 上它在图标右边弹出,行为一模一样。
 */
function RailGroup({
  group,
  pathname,
  collapsed,
}: {
  group: RailGroupNode;
  pathname: string;
  collapsed: boolean;
}) {
  const Icon = group.icon;
  const active = isGroupActive(group, pathname);
  const winner = activeNavHref(pathname);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-nav-rail-group={group.key}
          aria-label={group.label}
          title={group.label}
          className={cn(rowClass(collapsed, active), "justify-start", collapsed && "justify-center")}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          {!collapsed && (
            <>
              <span className="flex-1 truncate text-left">{group.label}</span>
              <ChevronDown className="size-4 shrink-0" aria-hidden />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="min-w-56">
        {group.items.map((item) => {
          const ItemIcon = item.icon;
          return (
            <DropdownMenuItem key={item.href} asChild>
              <Link
                href={item.href}
                data-nav-rail-link={item.key}
                aria-current={winner === item.href ? "page" : undefined}
              >
                <ItemIcon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{item.label}</span>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 身份区要的那几个字段(`AccountInfo` 的子集,见 `lib/account-actions.ts`)。 */
export type RailAccount = { email: string; displayName: string; balance: number };

/**
 * 商家在身份区看到的名字:自己设过的显示名,没设过就是邮箱(#592 的行为,原样搬过来)。
 * 纯函数,所以「没登进来时显示什么」不需要渲染就能钉。
 */
export function railIdentityLabel(account: RailAccount | null | undefined): string {
  if (!account) return "Account";
  return account.displayName || account.email || "Account";
}

/**
 * 身份菜单 —— Profile / Sign out。
 *
 * 单独导出是为了能拿一个给定的 `account` 直接渲染它(取余额那一步在别处,不在这个组件里)。
 */
export function RailIdentityMenu({
  account,
  signOutAction,
  collapsed,
}: {
  account?: RailAccount | null;
  signOutAction: () => Promise<void>;
  collapsed: boolean;
}) {
  const label = railIdentityLabel(account);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-nav-rail-identity
          aria-label="Account menu"
          title={label}
          className={cn(rowClass(collapsed, false), "justify-start", collapsed && "justify-center")}
        >
          <Avatar className="size-6 shrink-0">
            <AvatarFallback className="bg-accent text-[0.6rem] font-semibold text-accent-foreground">
              {(account ? label : "?").slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {!collapsed && <span className="truncate">{label}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="min-w-56">
        <DropdownMenuItem asChild>
          <Link href={SHELL_ROUTES.profile} data-nav-rail-profile>
            <User className="size-4 shrink-0" aria-hidden />
            <span>Profile</span>
          </Link>
        </DropdownMenuItem>
        {/* 退出走同一个 server action。菜单项自己发这一发,而不是包一个 <form>:
            Radix 选中一项就会关掉菜单,`<form>` 连同它的提交按钮会在那一刻被卸载。 */}
        <DropdownMenuItem
          data-nav-rail-signout
          onSelect={() => {
            void signOutAction();
          }}
        >
          <LogOut className="size-4 shrink-0" aria-hidden />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface NavigationRailProps {
  /** 当前地址(带 query)。壳自己不读路由 —— 传进来才测得动。 */
  pathname: string;
  /**
   * Otto 是**面板,不是地址**(§2.3 ②)。所以这一格是一颗按钮,不是一条链接。
   * 面板开合的状态机在 W2-7 的 `OttoPanelShell` 里;导轨挂到哪一层、怎么拿到那颗开关,
   * 由 W2-11 决定,所以这里只收一个回调,不自己去找面板。
   */
  onAskOtto: () => void;
  signOutAction: () => Promise<void>;
  /** 余额那一行要用。取数在挂载它的那一层,导轨不自己发请求。 */
  account?: RailAccount | null;
}

export function NavigationRail({ pathname, onAskOtto, signOutAction, account }: NavigationRailProps) {
  // 首帧一律默认形态(服务端不知道 localStorage),挂载后才套存值 —— `data-nav-rail-hydrated`
  // 存在的理由就是这个:没有它,240 → 64 会在每一次进页面时闪一下。
  const [state, setState] = React.useState<NavRailState>(defaultNavRailState);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载后套用存值,见上。
    setState(readNavRailState());
    setHydrated(true);
  }, []);

  // 存档只在套用完存值之后写,否则首帧的默认值会盖掉商家上次的选择。
  React.useEffect(() => {
    if (!hydrated) return;
    writeNavRailState(state);
  }, [hydrated, state]);

  const collapsed = state.collapsed;
  const width = navRailWidth(state);
  const winner = activeNavHref(pathname);
  const billing = railBillingLink();

  return (
    <nav
      id={NAV_RAIL_ELEMENT_ID}
      aria-label="Global navigation"
      data-nav-rail=""
      data-nav-rail-state={collapsed ? "collapsed" : "expanded"}
      {...(hydrated ? { "data-nav-rail-hydrated": "" } : {})}
      style={{ width: `${width}px`, transition: hydrated ? "width 200ms ease-out" : "none" }}
      className="flex h-dvh shrink-0 flex-col border-r border-border bg-card text-foreground"
    >
      <div className={cn("flex items-center gap-2 px-3 pt-3", collapsed && "flex-col gap-1 px-2")}>
        <Link
          href={SHELL_ROUTES.home}
          aria-label="FIKIRTIVE home"
          className={cn(
            "flex h-11 items-center rounded-[10px] text-lg font-extrabold tracking-[-0.03em] text-foreground outline-none",
            "focus-visible:ring-[3px] focus-visible:ring-ring/40",
            collapsed ? "w-11 justify-center" : "flex-1 px-3",
          )}
        >
          {collapsed ? "F" : "FIKIRTIVE"}
        </Link>
        {/* 一层导轨的那颗开关。宽度不再自己变,所以这是它唯一会变的原因。
            `aria-expanded` 只说「有东西展着」,`aria-controls` 才说清**展的是哪一样** ——
            这颗按钮画在导轨里面,读屏用户听不出它管的是自己所在的这条导轨还是别处的什么。 */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-nav-rail-toggle
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          aria-controls={NAV_RAIL_ELEMENT_ID}
          onClick={() => setState(toggleNavRailCollapsed)}
          className="size-9 shrink-0 rounded-[10px] text-muted-foreground"
        >
          {collapsed ? <PanelLeftOpen className="size-5" aria-hidden /> : <PanelLeftClose className="size-5" aria-hidden />}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 pt-5">
        {/* Otto 画在板块之上,而且不是板块:它帮的是全部七格,不是其中一格。 */}
        <Button
          type="button"
          variant="secondary"
          data-nav-rail-ask-otto
          onClick={onAskOtto}
          aria-label="Ask Otto"
          title="Ask Otto"
          className={cn(rowClass(collapsed, false), "justify-start text-foreground", collapsed && "justify-center")}
        >
          <OttoAvatar size={22} mood="idle" className="shrink-0" />
          {!collapsed && <span className="truncate">Ask Otto</span>}
        </Button>

        {/* 板块 —— 顺序、标签、地址全部照权威源原样画,壳不重排也不改名。 */}
        <div className="mt-4 space-y-1 border-t border-border pt-4">
          {RAIL_TREE.map((node) =>
            isRailGroupNode(node) ? (
              <RailGroup key={node.key} group={node} pathname={pathname} collapsed={collapsed} />
            ) : (
              <RailLink key={node.href} link={node} active={winner === node.href} collapsed={collapsed} />
            ),
          )}
        </div>

        <div className="mt-auto space-y-1 border-t border-border pt-3">
          {/* Credits —— 全产品唯一的余额数字,点进去就是买 credits 那一页。 */}
          <Link
            href={billing.href}
            data-nav-rail-credits
            title={billing.label}
            aria-label={billing.label}
            className={rowClass(collapsed, false)}
          >
            <Coins className="size-4 shrink-0" aria-hidden />
            {!collapsed && <span className="truncate">{account ? creditsLabel(account.balance) : "Credits"}</span>}
          </Link>

          <RailIdentityMenu account={account} signOutAction={signOutAction} collapsed={collapsed} />
        </div>
      </div>
    </nav>
  );
}
