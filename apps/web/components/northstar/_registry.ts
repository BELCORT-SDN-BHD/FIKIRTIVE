/**
 * 北极星原型 — 全城页面注册表(scaffold 唯一来源)
 *
 * 由 docs/northstar/PAGE-INVENTORY.md(57 页)生成;本文件是导航骨架 / 总目录页 /
 * stub 生成的单一数据源。维护规则与清单一致:不发明页面;新增行 = 先改清单再改这里。
 *
 * 字段口径:
 * - priority  原型优先级(清单「原型」列):P0 / P1 / P2 / 降级(设计降级)
 * - current   现状列:live·revamp / 断电 / 部分 / 未建 / live
 * - status    施工状态(@nsPage 台账口径):stub(未建占位)→ draft(已画待批)
 *             → approved(founder 已批)→ lit(已点亮)。
 *             zone builder 替换 stub 时必须同步翻页内 @nsPage 注释与本表。
 */

export type NsPriority = "P0" | "P1" | "P2" | "降级";
export type NsBuildStatus = "stub" | "draft" | "approved" | "lit";

export interface NsZone {
  slug: string;
  /** 板块名(清单章节名) */
  name: string;
  /** 章节序号,如「一」 */
  ordinal: string;
}

export interface NsPage {
  zoneSlug: string;
  /** 页面 slug(路由末段,@nsPage page= 同名) */
  page: string;
  /** 页面名(清单「页面」列) */
  title: string;
  /** 一句话用途 */
  purpose: string;
  /** 路由路径 */
  path: string;
  priority: NsPriority;
  current: string;
  status: NsBuildStatus;
  /** 来源列(缩写) */
  sources: string;
}

export const NS_ZONES: NsZone[] = [
  { slug: "global", name: "全局横切", ordinal: "〇" },
  { slug: "create", name: "创作区", ordinal: "一" },
  { slug: "schedule", name: "排期区", ordinal: "二" },
  { slug: "analytics", name: "分析区", ordinal: "三" },
  { slug: "assets", name: "资产区", ordinal: "四" },
  { slug: "ads", name: "广告区", ordinal: "五" },
  { slug: "campaign", name: "Campaign 区", ordinal: "六" },
  { slug: "crm", name: "CRM 区", ordinal: "七" },
  { slug: "inbox", name: "收件箱客服区", ordinal: "八" },
  { slug: "automation", name: "自动化区", ordinal: "九" },
  { slug: "team", name: "团队协作区", ordinal: "十" },
  { slug: "account", name: "住户服务中心", ordinal: "十一" },
  { slug: "onboarding", name: "Onboarding + 登录", ordinal: "十二" },
  { slug: "cityhall", name: "市政厅", ordinal: "十三" },
];

export const NS_PAGES: NsPage[] = [
  // ── 〇 全局横切 ──
  { zoneSlug: "global", page: "nav", title: "全局导航骨架", purpose: "全城的走路方式与页面外壳", path: "/northstar/global/nav", priority: "P0", current: "live·revamp", status: "stub", sources: "区划图·资产区(#129 分组导航);design-rules §10" },
  { zoneSlug: "global", page: "otto-dock", title: "Otto dock(常驻)", purpose: "Otto 随时一步可唤起、工作可见、永不抢主场", path: "/northstar/global/otto-dock", priority: "P0", current: "未建(spec 已定)", status: "stub", sources: "宪法 11 v2.6④;design-rules §8d" },
  { zoneSlug: "global", page: "otto-chat", title: "Otto 聊天全页", purpose: "与 Otto 的全屏对话工作面(中央区人工面)", path: "/northstar/global/otto-chat", priority: "P0", current: "live·revamp", status: "stub", sources: "区划图·中央区;GOAL H0/H4" },
  { zoneSlug: "global", page: "search", title: "全局搜索", purpose: "从任何页找到自己的项目 / 会话 / 生成历史", path: "/northstar/global/search", priority: "P0", current: "未建", status: "stub", sources: "GOAL A3(左栏 Search)" },
  { zoneSlug: "global", page: "notifications", title: "通知与审批入口", purpose: "待我批的事 + Otto 替我做完的事,一处可见", path: "/northstar/global/notifications", priority: "P1", current: "未建", status: "stub", sources: "G-11;harmony-01 §四④;宪法 11 v2.6①" },
  { zoneSlug: "global", page: "legal", title: "法务页(privacy/terms/data-deletion)", purpose: "合规文本", path: "/northstar/global/legal", priority: "降级", current: "live", status: "stub", sources: "现有路由(apps/web/app/privacy 等)" },

  // ── 一 创作区 ──
  { zoneSlug: "create", page: "home", title: "创作首页(front door)", purpose: "进城第一屏:模板与灵感把「不知道要什么」的老板领进创作", path: "/northstar/create/home", priority: "P0", current: "未建(GOAL 裁决二期)", status: "stub", sources: "GOAL A0" },
  { zoneSlug: "create", page: "canvas", title: "Canvas 主场", purpose: "用户的家:画布为主、产物即有状态对象、就地进化、agent 编排", path: "/northstar/create/canvas", priority: "P0", current: "live·revamp", status: "stub", sources: "GOAL §2 全表;区划图·创作区;N (Grok) canvas A/B 分叉判决「要」" },
  { zoneSlug: "create", page: "asset-viewer", title: "全屏资产查看器(生成详情)", purpose: "单资产的放大工作面:版本 / 帧轨 / 续写 / 下载", path: "/northstar/create/asset-viewer", priority: "P0", current: "部分(detail panel 已建)", status: "stub", sources: "GOAL G1;g2a detail panel spec(2026-06-27)" },
  { zoneSlug: "create", page: "media-editor", title: "素材编辑面", purpose: "生成后的就地修与剪(图 / 视频对象级编辑)", path: "/northstar/create/media-editor", priority: "P0", current: "部分", status: "stub", sources: "GOAL C3/C4/D4/D5/E2/E3;区划图·创作区(抽帧)" },
  { zoneSlug: "create", page: "storyboard", title: "分镜工作台", purpose: "storyboard 四步出片(1-3 步 $0 + 第 4 步付费)", path: "/northstar/create/storyboard", priority: "P0", current: "live·revamp", status: "stub", sources: "区划图·中央区(#111/#114);storyboard specs F1-F4" },
  { zoneSlug: "create", page: "factory", title: "工厂出片间", purpose: "产品 → 可投成片的流水线人工面(收钱先锋)", path: "/northstar/create/factory", priority: "P1", current: "未建", status: "stub", sources: "harmony-03 Wave 1-2;判决 7-2/7-3/7-7;C-01/C-07" },
  { zoneSlug: "create", page: "ideas", title: "想法清单(极轻)", purpose: "零散想法不沉底,一键转创作", path: "/northstar/create/ideas", priority: "P1", current: "未建", status: "stub", sources: "N (Buffer) Ideas 判决;campaign spec §一.3" },

  // ── 二 排期区 ──
  { zoneSlug: "schedule", page: "plan", title: "Plan 视图", purpose: "排期主视图(Plan + 队列混合)", path: "/northstar/schedule/plan", priority: "P0", current: "live·revamp", status: "stub", sources: "区划图·排期区(#123);对标地图(Buffer 3 视图范本)" },
  { zoneSlug: "schedule", page: "calendar", title: "日历视图", purpose: "按月 / 周看全部排期", path: "/northstar/schedule/calendar", priority: "P0", current: "live·revamp", status: "stub", sources: "区划图·排期区;Buffer 范本" },
  { zoneSlug: "schedule", page: "queue", title: "队列视图", purpose: "按时间顺序的发布队列", path: "/northstar/schedule/queue", priority: "P0", current: "live·revamp", status: "stub", sources: "区划图·排期区" },
  { zoneSlug: "schedule", page: "composer", title: "Composer(撰写器)", purpose: "撰写与定时一条帖", path: "/northstar/schedule/composer", priority: "P0", current: "live·revamp", status: "stub", sources: "区划图·排期区;harmony-01 #4;X 定价判决(第四批)" },
  { zoneSlug: "schedule", page: "share-preview", title: "单帖分享预览页", purpose: "无席位链接式外审(给老板 / 客户看一眼再发)", path: "/northstar/schedule/share-preview", priority: "P1", current: "未建", status: "stub", sources: "N-14(可纳入 12 项:单帖可分享预览 URL)" },

  // ── 三 分析区 ──
  { zoneSlug: "analytics", page: "overview", title: "分析总览", purpose: "真实 KPI 一屏看懂(全城设计基准 gold standard 屏)", path: "/northstar/analytics/overview", priority: "P0", current: "live·revamp(organic 部分断电)", status: "stub", sources: "区划图·分析区(#116/#117);宪法 11(设计基准)" },
  { zoneSlug: "analytics", page: "reports", title: "报表引擎与品牌化报告", purpose: "人工可完整操作的报表构建 + Otto 人话解读", path: "/northstar/analytics/reports", priority: "P2", current: "未建", status: "stub", sources: "红旗二判决(要,双模无例外);P4-1;G-12;GM-04" },

  // ── 四 资产区 ──
  { zoneSlug: "assets", page: "my-stuff", title: "My Stuff", purpose: "我的全部素材一处管", path: "/northstar/assets/my-stuff", priority: "P0", current: "live·revamp", status: "stub", sources: "区划图·资产区(#103/#129)" },
  { zoneSlug: "assets", page: "library", title: "Library(生成历史)", purpose: "全部生成产物的历史与回溯", path: "/northstar/assets/library", priority: "P0", current: "live·revamp", status: "stub", sources: "区划图·资产区;g5a spec;GOAL I2" },
  { zoneSlug: "assets", page: "brand-memory", title: "Brand memory(品牌记忆)", purpose: "「懂你的店」的 6-tab 知识库", path: "/northstar/assets/brand-memory", priority: "P0", current: "live·revamp", status: "stub", sources: "区划图·资产区(#103/#113/#124);O-04 判决" },
  { zoneSlug: "assets", page: "templates", title: "Templates", purpose: "官方模板库", path: "/northstar/assets/templates", priority: "P0", current: "live·revamp", status: "stub", sources: "区划图·资产区;g5b spec;N (Grok) 模板 gallery 判决「以后」" },
  { zoneSlug: "assets", page: "discover", title: "Discover", purpose: "灵感瀑布流", path: "/northstar/assets/discover", priority: "P0", current: "live·revamp", status: "stub", sources: "区划图·资产区;g5c spec;GOAL A0(同源)" },
  { zoneSlug: "assets", page: "brand-kit", title: "品牌包页(BrandKit)", purpose: "结构化品牌包(与自由态记忆互补)", path: "/northstar/assets/brand-kit", priority: "P1", current: "未建", status: "stub", sources: "harmony-01 #2;C-08 判决" },
  { zoneSlug: "assets", page: "cast", title: "选角库(Cast / 人设)", purpose: "训练型人设:「训练一次永久锁脸」", path: "/northstar/assets/cast", priority: "P2", current: "未建", status: "stub", sources: "harmony-01 #3;harmony-03 Wave 3;判决 7-6" },

  // ── 五 广告区 ──
  { zoneSlug: "ads", page: "performance", title: "广告表现页", purpose: "逐条 ad 表现与 Otto 诊断(不捏造,带 KB 引用)", path: "/northstar/ads/performance", priority: "P0", current: "live·revamp(今挂分析区视图)", status: "stub", sources: "区划图·广告区/分析区(#128);O-10 判决" },
  { zoneSlug: "ads", page: "builder", title: "广告构建工作台", purpose: "人工建整 campaign 草稿(build=$0,PAUSED)与 ad-write", path: "/northstar/ads/builder", priority: "P1", current: "断电(Otto 卡片流已建)", status: "stub", sources: "区划图·广告区;G7 v2 spec(2026-06-29);宪法 7 双模" },
  { zoneSlug: "ads", page: "multi-platform", title: "多平台投放扩展", purpose: "TikTok → Lazada → Shopee 逐平台连接与投放", path: "/northstar/ads/multi-platform", priority: "P2", current: "未建", status: "stub", sources: "红旗一判决(全要 + 可插拔);蓝图第六章·多平台广告区" },

  // ── 六 Campaign 区 ──
  { zoneSlug: "campaign", page: "workbench", title: "Campaign 工作台(结构化入口)", purpose: "填表即可发起策划,不用会「聊天 prompt」", path: "/northstar/campaign/workbench", priority: "P1", current: "未建", status: "stub", sources: "campaign spec §5.1;第四批判决(专属工作台「要」)" },
  { zoneSlug: "campaign", page: "calendar", title: "Campaign 日历工作台", purpose: "提案卡的日历批改面(与聊天卡同一份数据)", path: "/northstar/campaign/calendar", priority: "P1", current: "未建", status: "stub", sources: "campaign spec §5.1/§2.4" },
  { zoneSlug: "campaign", page: "proposal-card", title: "Campaign 提案卡(聊天内)", purpose: "Otto 交出的整案:主题 / 目标 / 跨度 / 节奏 + N 条内容日历", path: "/northstar/campaign/proposal-card", priority: "P1", current: "未建", status: "stub", sources: "campaign spec §2.2" },
  { zoneSlug: "campaign", page: "pack-confirm", title: "打包确认页(大单确认)", purpose: "Otto 花大钱前复述理解 + 报价,一次点头", path: "/northstar/campaign/pack-confirm", priority: "P1", current: "未建", status: "stub", sources: "判决 7-3/7-7;campaign spec §2.5" },
  { zoneSlug: "campaign", page: "list", title: "Campaign 列表与详情(完全体)", purpose: "独立 Campaign 对象的管理面", path: "/northstar/campaign/list", priority: "P2", current: "未建", status: "stub", sources: "红旗六判决;P3-1;GM-03 判决" },
  { zoneSlug: "campaign", page: "trends", title: "趋势存档页", purpose: "Otto 的市场资料库人工面(「懂市场当下」)", path: "/northstar/campaign/trends", priority: "P1", current: "未建", status: "stub", sources: "campaign spec §5.2;宪法 7(读的对等)" },

  // ── 七 CRM 区 ──
  { zoneSlug: "crm", page: "contacts", title: "联系人列表", purpose: "客户唯一档案总览(联系人主要从对话 / 广告自动进来)", path: "/northstar/crm/contacts", priority: "P2", current: "未建", status: "stub", sources: "harmony-01 #7;蓝图第六章·CRM 区;红旗三" },
  { zoneSlug: "crm", page: "contact-profile", title: "联系人档案", purpose: "单个客户的全景页", path: "/northstar/crm/contact-profile", priority: "P2", current: "未建", status: "stub", sources: "harmony-01 §四②;N-22/N-23;判决 7-9;红旗三" },
  { zoneSlug: "crm", page: "segments", title: "分群页(Segment)", purpose: "用人话描述 → 确定性规则编译 → 成员表", path: "/northstar/crm/segments", priority: "P2", current: "未建", status: "stub", sources: "harmony-01 #13;P3-2;宪法 10" },
  { zoneSlug: "crm", page: "deals", title: "Deal 看板", purpose: "SMB-lite 交易管道", path: "/northstar/crm/deals", priority: "P2", current: "未建", status: "stub", sources: "harmony-01 #12;P3-2" },

  // ── 八 收件箱客服区 ──
  { zoneSlug: "inbox", page: "shared", title: "共享收件箱", purpose: "WhatsApp-first 多渠道收件箱(团队共用)", path: "/northstar/inbox/shared", priority: "P2", current: "未建", status: "stub", sources: "红旗五判决;P2-1/P2-2;harmony-01 #8" },
  { zoneSlug: "inbox", page: "conversation", title: "对话视图", purpose: "单会话工作面:人和 Otto 同台接客", path: "/northstar/inbox/conversation", priority: "P2", current: "未建", status: "stub", sources: "P2-4;O-06 判决;判决 7-8;harmony-01 §四③" },
  { zoneSlug: "inbox", page: "comments", title: "公开评论收件箱", purpose: "帖子下的公开评论统一收进一个箱子逐条回", path: "/northstar/inbox/comments", priority: "P2", current: "未建", status: "stub", sources: "N (Buffer) 公开评论收件箱判决「要」;P2-4" },
  { zoneSlug: "inbox", page: "knowledge", title: "知识库页", purpose: "AI 客服的可读知识文件管理(护栏的溯源对象)", path: "/northstar/inbox/knowledge", priority: "P2", current: "未建", status: "stub", sources: "harmony-01 #9;N (HubSpot) 知识库反向回路判决「要」" },
  { zoneSlug: "inbox", page: "test-drive", title: "试驾场", purpose: "对客 AI 上线前的硬前置测试场", path: "/northstar/inbox/test-drive", priority: "P2", current: "未建", status: "stub", sources: "O-01 + O-06 绑定判决" },

  // ── 九 自动化区 ──
  { zoneSlug: "automation", page: "rules", title: "规则文件编辑器", purpose: "人看得懂、改得动的规则文件 + 开关(O-09 人工面)", path: "/northstar/automation/rules", priority: "P2", current: "未建", status: "stub", sources: "O-09 判决(分域);宪法 7 builder 分域;判决 7-8/7-9;N-20" },
  { zoneSlug: "automation", page: "routines", title: "Routine 管理面", purpose: "用户的「授权书」管理:定时自主 Otto", path: "/northstar/automation/routines", priority: "P1", current: "未建", status: "stub", sources: "O-02+O-05 routine 授权模型;P1½-3;harmony-01 #6/§四⑤" },

  // ── 十 团队协作区 ──
  { zoneSlug: "team", page: "members", title: "成员与席位管理", purpose: "多席位协作的家(创作席 / 审批席双档)", path: "/northstar/team/members", priority: "P2", current: "未建", status: "stub", sources: "G-01;G-11+O-13 判决;harmony-01 §五;宪法 7 租户 RBAC" },
  { zoneSlug: "team", page: "approvals", title: "审批工作台", purpose: "「小编做 → 老板批 → 才发布」的批阅面", path: "/northstar/team/approvals", priority: "P2", current: "未建", status: "stub", sources: "G-11 判决;P3-3;harmony-01 §四④" },

  // ── 十一 住户服务中心 ──
  { zoneSlug: "account", page: "settings", title: "Account 设置页", purpose: "资料与 Otto 行为设置", path: "/northstar/account/settings", priority: "P0", current: "live·revamp", status: "stub", sources: "区划图·住户服务中心(#74)" },
  { zoneSlug: "account", page: "credits", title: "Credits 与消费明细", purpose: "分类消费明细,可展开单笔(计费透明)", path: "/northstar/account/credits", priority: "P0", current: "live·revamp(判决形态待补全)", status: "stub", sources: "追加判决·Credit 消费明细「要」;铁律①" },
  { zoneSlug: "account", page: "top-up", title: "充值 / 购买页", purpose: "money-in(显示当地法币 MYR;Otto 永不代办)", path: "/northstar/account/top-up", priority: "P0", current: "live·revamp", status: "stub", sources: "区划图(Stripe MYR LIVE);铁律①;G-01/G-02/G-03;宪法 7 money-in 豁免" },
  { zoneSlug: "account", page: "connections", title: "Connections 渠道连接页", purpose: "全部渠道的连接与开关一页管理", path: "/northstar/account/connections", priority: "P0", current: "live·revamp(Meta);X 未建(spec 在途)", status: "stub", sources: "区划图·住户服务中心;X spec §四/§六;红旗一" },
  { zoneSlug: "account", page: "channel-wallet", title: "通道费钱包页", purpose: "第二账道人工面(通道费 MYR 直传,永不混 credits)", path: "/northstar/account/channel-wallet", priority: "P2", current: "未建", status: "stub", sources: "红旗五判决;宪法 5;harmony-05" },

  // ── 十二 Onboarding + 登录 ──
  { zoneSlug: "onboarding", page: "login", title: "登录 / 注册页", purpose: "进城的门", path: "/northstar/onboarding/login", priority: "P0", current: "live·revamp", status: "draft", sources: "区划图·地下管网 / 住户服务(#74);design-rules §3" },
  { zoneSlug: "onboarding", page: "checklist", title: "开店完成度(onboarding)", purpose: "新店主的开店 checklist(做完即消失)", path: "/northstar/onboarding/checklist", priority: "P1", current: "未建", status: "draft", sources: "GM-05 判决「要」;harmony-06 §三" },

  // ── 十三 市政厅 ──
  { zoneSlug: "cityhall", page: "admin", title: "市政厅全后台(admin,单列)", purpose: "运营与账房(仅 BELCORT 内部,Otto 永久豁免)", path: "/northstar/cityhall/admin", priority: "降级", current: "live(11 section);v2 未建", status: "draft", sources: "区划图·市政厅;蓝图第六章·市政厅 v2;X-01~X-05 判决" },
];

export function nsZone(slug: string): NsZone {
  const z = NS_ZONES.find((z) => z.slug === slug);
  if (!z) throw new Error(`Unknown northstar zone: ${slug}`);
  return z;
}

export function nsPage(path: string): NsPage {
  const p = NS_PAGES.find((p) => p.path === path);
  if (!p) throw new Error(`Unknown northstar page: ${path}`);
  return p;
}

export function nsPagesByZone(zoneSlug: string): NsPage[] {
  return NS_PAGES.filter((p) => p.zoneSlug === zoneSlug);
}

export const NS_COUNTS = {
  total: NS_PAGES.length,
  p0: NS_PAGES.filter((p) => p.priority === "P0").length,
  p1: NS_PAGES.filter((p) => p.priority === "P1").length,
  p2: NS_PAGES.filter((p) => p.priority === "P2").length,
  degraded: NS_PAGES.filter((p) => p.priority === "降级").length,
  stub: NS_PAGES.filter((p) => p.status === "stub").length,
  draft: NS_PAGES.filter((p) => p.status === "draft").length,
  approved: NS_PAGES.filter((p) => p.status === "approved").length,
  lit: NS_PAGES.filter((p) => p.status === "lit").length,
};
