/**
 * 北极星原型 · 资产区 — 区内派生示例数据
 *
 * 全部从共用 mock 模块(_mock.ts)派生/扩展:同一家店(Roti Bulan Bakery)、
 * 同一批产品、同一 NS_IMAGES 真图目录(ENDGAME §一 图片纪律:全城只从 NS_IMAGES
 * 取图)。确定性字面量,零随机、零 Date.now。
 *
 * 注:BRAND_KIT 色板里的 hex 是「用户品牌数据」(图片内容级豁免,比照 _mock
 * 占位图与 mascot art)——它们是店家自己的颜色,不是 UI token;界面 chrome
 * 永远走 .gb token。
 */

import { NS_BRAND, NS_PRODUCTS, nsImage, type NsProduct } from "../_mock";

/* ── My Stuff:统一素材(生成 + 上传) ─────────────────────────────────── */
export type StuffKind = "image" | "video" | "storyboard" | "upload";
export type StuffStatus = "ready" | "generating" | "failed";

export interface StuffItem {
  id: string;
  title: string;
  kind: StuffKind;
  createdAt: string; // ISO date
  thumb: string;
  /** 竖版 9:16 之类的媒体标出比例,网格用 */
  portrait?: boolean;
  credits?: number;
  byOtto: boolean;
  status: StuffStatus;
}

export const STUFF_ITEMS: StuffItem[] = [
  { id: "st-01", title: "Merdeka box hero shot", kind: "image", createdAt: "2026-07-07", thumb: nsImage("bakery", 3), credits: 12, byOtto: true, status: "ready" },
  { id: "st-02", title: "Croissant fold reel", kind: "video", createdAt: "2026-07-07", thumb: nsImage("bakery", 1), portrait: true, credits: 40, byOtto: true, status: "ready" },
  { id: "st-03", title: "Raya box teaser", kind: "video", createdAt: "2026-07-07", thumb: nsImage("bakery", 20), portrait: true, credits: 40, byOtto: true, status: "failed" },
  { id: "st-04", title: "Pandan cake close-up", kind: "image", createdAt: "2026-07-06", thumb: nsImage("bakery", 5), credits: 8, byOtto: false, status: "ready" },
  { id: "st-05", title: "Weekend promo storyboard", kind: "storyboard", createdAt: "2026-07-06", thumb: nsImage("storefront", 2), credits: 0, byOtto: true, status: "ready" },
  { id: "st-06", title: "Storefront photo", kind: "upload", createdAt: "2026-07-05", thumb: nsImage("storefront", 0), byOtto: false, status: "ready" },
  { id: "st-07", title: "Menu flat lay", kind: "upload", createdAt: "2026-07-05", thumb: nsImage("bakery", 14), byOtto: false, status: "ready" },
  { id: "st-08", title: "Kopi tiramisu menu card", kind: "image", createdAt: "2026-07-04", thumb: nsImage("bakery", 10), credits: 8, byOtto: false, status: "ready" },
  { id: "st-09", title: "Kaya croissant macro", kind: "image", createdAt: "2026-07-03", thumb: nsImage("bakery", 16), credits: 8, byOtto: true, status: "ready" },
  { id: "st-10", title: "Bakery morning b-roll", kind: "upload", createdAt: "2026-07-02", thumb: nsImage("storefront", 8), byOtto: false, status: "ready" },
  { id: "st-11", title: "Milo cookie stack", kind: "image", createdAt: "2026-07-01", thumb: nsImage("bakery", 7), credits: 8, byOtto: true, status: "ready" },
  { id: "st-12", title: "Onde-onde puff teaser", kind: "video", createdAt: "2026-06-30", thumb: nsImage("bakery", 12), portrait: true, credits: 40, byOtto: true, status: "ready" },
];

/* ── Library:生成历史(可回到源画布) ────────────────────────────────── */
export interface GenRecord {
  id: string;
  title: string;
  kind: "image" | "video" | "storyboard";
  prompt: string;
  canvas: string;
  createdAt: string; // ISO datetime (+08:00)
  day: "today" | "yesterday" | "earlier";
  thumb: string;
  portrait?: boolean;
  credits: number;
  byOtto: boolean;
  variants: number;
  status: "ready" | "generating";
}

export const GEN_RECORDS: GenRecord[] = [
  { id: "gen-01", title: "Office order teaser", kind: "video", prompt: "6s vertical teaser of office pastry boxes being packed, warm morning light", canvas: "Merdeka planning", createdAt: "2026-07-07T09:40:00+08:00", day: "today", thumb: nsImage("storefront", 4), portrait: true, credits: 40, byOtto: true, variants: 1, status: "generating" },
  { id: "gen-02", title: "Croissant fold reel", kind: "video", prompt: "Hands folding croissant dough, close-up, 6s loop, bakery counter", canvas: "Merdeka planning", createdAt: "2026-07-07T09:14:00+08:00", day: "today", thumb: nsImage("bakery", 1), portrait: true, credits: 40, byOtto: true, variants: 2, status: "ready" },
  { id: "gen-03", title: "Merdeka box hero shot", kind: "image", prompt: "Festive gift box of assorted pastries on rattan tray, flag ribbon accents", canvas: "Merdeka planning", createdAt: "2026-07-07T09:02:00+08:00", day: "today", thumb: nsImage("bakery", 3), credits: 12, byOtto: true, variants: 4, status: "ready" },
  { id: "gen-04", title: "Pandan cake close-up", kind: "image", prompt: "Slice of pandan gula melaka cake, cross-section layers, natural light", canvas: "Weekly posts", createdAt: "2026-07-06T15:22:00+08:00", day: "yesterday", thumb: nsImage("bakery", 5), credits: 8, byOtto: false, variants: 2, status: "ready" },
  { id: "gen-05", title: "Weekend promo storyboard", kind: "storyboard", prompt: "4-scene storyboard: weekend pre-order push for the Raya cookie gift box", canvas: "Weekly posts", createdAt: "2026-07-06T11:05:00+08:00", day: "yesterday", thumb: nsImage("storefront", 2), credits: 0, byOtto: true, variants: 1, status: "ready" },
  { id: "gen-06", title: "Kopi tiramisu menu card", kind: "image", prompt: "Menu card layout for kopi-O tiramisu cup, RM14, cream background", canvas: "Menu refresh", createdAt: "2026-07-04T16:48:00+08:00", day: "earlier", thumb: nsImage("bakery", 10), credits: 8, byOtto: false, variants: 3, status: "ready" },
  { id: "gen-07", title: "Kaya croissant macro", kind: "image", prompt: "Macro shot of kaya oozing from a torn croissant", canvas: "Menu refresh", createdAt: "2026-07-03T10:30:00+08:00", day: "earlier", thumb: nsImage("bakery", 16), credits: 8, byOtto: true, variants: 2, status: "ready" },
  { id: "gen-08", title: "Milo cookie stack", kind: "image", prompt: "Stack of Milo dinosaur cookies with crumbs, playful angle", canvas: "Weekly posts", createdAt: "2026-07-01T14:12:00+08:00", day: "earlier", thumb: nsImage("bakery", 7), credits: 8, byOtto: true, variants: 2, status: "ready" },
  { id: "gen-09", title: "Onde-onde puff teaser", kind: "video", prompt: "6s vertical teaser: onde-onde cream puff pull-apart", canvas: "Weekly posts", createdAt: "2026-06-30T09:55:00+08:00", day: "earlier", thumb: nsImage("bakery", 12), portrait: true, credits: 40, byOtto: true, variants: 1, status: "ready" },
];

export const LIBRARY_DAY_LABELS: Record<GenRecord["day"], string> = {
  today: "Today · 7 Jul",
  yesterday: "Yesterday · 6 Jul",
  earlier: "Earlier",
};

/* ── Brand memory:6-tab 知识库 ───────────────────────────────────────── */
export type MemoryTabKey = "about" | "look" | "customers" | "products" | "offers" | "rules";

export const MEMORY_TABS: { key: MemoryTabKey; label: string }[] = [
  { key: "about", label: "About the brand" },
  { key: "look", label: "Look & feel" },
  { key: "customers", label: "Your customers" },
  { key: "products", label: "Your products" },
  { key: "offers", label: "Your offers" },
  { key: "rules", label: "Do & don't" },
];

export interface MemoryFact {
  id: string;
  text: string;
  tab: MemoryTabKey;
  /** 来源:owner 手填 / otto 研究所得 */
  source: "owner" | "otto";
  addedAt: string;
}

export const MEMORY_FACTS: MemoryFact[] = [
  { id: "mf-01", text: "Family-run bakery in Bangsar, baking since 2019.", tab: "about", source: "owner", addedAt: "2026-06-12" },
  { id: "mf-02", text: "Halal-certified kitchen. Certificate renewed March 2026.", tab: "about", source: "owner", addedAt: "2026-06-12" },
  { id: "mf-03", text: "Pickup at the shop or Lalamove delivery within KL.", tab: "about", source: "otto", addedAt: "2026-07-05" },
  { id: "mf-04", text: "Best known for the pandan gula melaka cake. It sells out most weekends.", tab: "about", source: "otto", addedAt: "2026-07-05" },
  { id: "mf-05", text: "Warm cream and pandan green. Film-grain photos, never studio-flat.", tab: "look", source: "owner", addedAt: "2026-06-14" },
  { id: "mf-06", text: "Natural morning light. Shoot on the rattan tray or the marble counter.", tab: "look", source: "owner", addedAt: "2026-06-14" },
  { id: "mf-07", text: "Captions mix English and Malay the way KL actually talks.", tab: "look", source: "otto", addedAt: "2026-06-28" },
  { id: "mf-08", text: "10% off pre-orders placed before Friday 6pm.", tab: "offers", source: "owner", addedAt: "2026-07-01" },
  { id: "mf-09", text: "Free delivery within KL for orders above RM150.", tab: "offers", source: "owner", addedAt: "2026-06-20" },
  { id: "mf-10", text: "Raya cookie gift box early-bird price until 15 Aug.", tab: "offers", source: "otto", addedAt: "2026-07-06" },
  { id: "mf-11", text: "Do mention halal certification when a customer asks.", tab: "rules", source: "owner", addedAt: "2026-06-12" },
  { id: "mf-12", text: "Do reply in the language the customer used.", tab: "rules", source: "owner", addedAt: "2026-06-12" },
  { id: "mf-13", text: "Don't promise same-day custom cakes. Minimum 3 days notice.", tab: "rules", source: "owner", addedAt: "2026-06-15" },
  { id: "mf-14", text: "Don't offer discounts beyond the published offers.", tab: "rules", source: "owner", addedAt: "2026-06-15" },
];

export interface MemorySegment {
  id: string;
  name: string;
  description: string;
  usedIn: string;
}

export const MEMORY_SEGMENTS: MemorySegment[] = [
  { id: "seg-01", name: "Office orderers", description: "Admins and team leads around Bangsar and Mid Valley ordering 15-30 pastries for meetings. Care about on-time delivery and easy invoicing.", usedIn: "Used in 4 campaigns" },
  { id: "seg-02", name: "Weekend families", description: "Parents picking up cakes and cookies on Saturday mornings. Respond to photos of kids' favourites and bundle deals.", usedIn: "Used in 2 campaigns" },
  { id: "seg-03", name: "Festive gifters", description: "Customers buying Raya and Merdeka gift boxes for clients and relatives. Order early, value premium packaging.", usedIn: "Used in 3 campaigns" },
];

/** 产品档案 = 共用 NS_PRODUCTS(单一来源) */
export const MEMORY_PRODUCTS: NsProduct[] = NS_PRODUCTS;

export const MEMORY_PRODUCT_CATEGORIES = ["All", "Cakes", "Pastries", "Cookies", "Desserts", "Seasonal"];

/** #124 产品链接一键建档:模拟建出的草稿档案 */
export const INGESTED_PRODUCT: NsProduct = {
  id: "prod-07",
  name: "Teh tarik butter cookies",
  category: "Cookies",
  priceMyr: 18,
  description: "Crumbly butter cookies with a pulled-tea glaze. Draft profile from your product link.",
  image: nsImage("bakery", 22),
  bestSeller: false,
};

export const INGEST_STEPS = [
  "Reading the product page…",
  "Extracting name and price…",
  "Drafting the profile…",
] as const;

export const RESEARCH_STEPS = [
  "Reading rotibulan.my…",
  "Checking your latest offers…",
  "Comparing with what I know…",
  "Saving what changed…",
] as const;

export const RESEARCHED_FACTS: MemoryFact[] = [
  { id: "mf-r1", text: "Website now lists Sunday hours as 8am to 2pm.", tab: "about", source: "otto", addedAt: "2026-07-07" },
  { id: "mf-r2", text: "New teh tarik butter cookies appear on the menu page.", tab: "about", source: "otto", addedAt: "2026-07-07" },
];

/* ── Templates:官方模板库 ────────────────────────────────────────────── */
export interface TemplateItem {
  id: string;
  name: string;
  category: "Promo" | "Festive" | "Menu" | "Behind the scenes" | "Announcement";
  surface: string; // e.g. "Instagram post"
  blurb: string;
  preview: string;
  portrait?: boolean;
  includes: string[];
}

export const TEMPLATE_CATEGORIES = ["All", "Promo", "Festive", "Menu", "Behind the scenes", "Announcement"] as const;

export const TEMPLATE_ITEMS: TemplateItem[] = [
  { id: "tpl-01", name: "Weekly special splash", category: "Promo", surface: "Instagram post", blurb: "One hero product, price, and a 3-day window.", preview: nsImage("bakery", 0), portrait: true, includes: ["Hero product frame", "Price tag layout", "Caption starter"] },
  { id: "tpl-02", name: "Festive gift box promo", category: "Festive", surface: "Instagram post", blurb: "Seasonal gift box with ribbon-and-flag styling.", preview: nsImage("bakery", 20), includes: ["Gift box scene", "Festive colour wash", "Pre-order caption"] },
  { id: "tpl-03", name: "Price list menu card", category: "Menu", surface: "Story", blurb: "Clean menu card for up to 8 items with prices.", preview: nsImage("storefront", 10), portrait: true, includes: ["8-item price grid", "Logo slot", "Opening hours strip"] },
  { id: "tpl-04", name: "Before and after bake", category: "Behind the scenes", surface: "Reel", blurb: "Dough to golden bake, two-beat reveal.", preview: nsImage("bakery", 15), portrait: true, includes: ["2-scene reveal", "Timer overlay", "Sound cue marks"] },
  { id: "tpl-05", name: "Customer review card", category: "Promo", surface: "Instagram post", blurb: "A real quote over a soft product background.", preview: nsImage("bakery", 25), includes: ["Quote layout", "Star row", "Name and date slot"] },
  { id: "tpl-06", name: "Flash sale story", category: "Promo", surface: "Story", blurb: "Today-only push with a countdown sticker slot.", preview: nsImage("bakery", 6), portrait: true, includes: ["Countdown slot", "Big price cut", "Swipe-up prompt"] },
  { id: "tpl-07", name: "New bake announcement", category: "Announcement", surface: "Instagram post", blurb: "Introduce a new item with a tasting-notes strip.", preview: nsImage("bakery", 8), portrait: true, includes: ["Tasting notes strip", "Launch date badge", "Caption starter"] },
  { id: "tpl-08", name: "Opening hours update", category: "Announcement", surface: "Instagram post", blurb: "Holiday or festive hours, unmissable and clear.", preview: nsImage("storefront", 5), includes: ["Hours table", "Map pin slot", "Festive trim"] },
  { id: "tpl-09", name: "Packing day reel", category: "Behind the scenes", surface: "Reel", blurb: "Order-packing rhythm cut, great for busy seasons.", preview: nsImage("storefront", 6), portrait: true, includes: ["3-scene rhythm cut", "Order counter overlay", "Thank-you end card"] },
];

/* ── Discover:灵感瀑布流 ─────────────────────────────────────────────── */
export interface DiscoverItem {
  id: string;
  title: string;
  tag: string;
  kind: "image" | "video";
  thumb: string;
  h: number; // 瀑布流高度参差
}

export const DISCOVER_TAGS = ["All", "Bakery", "Food reels", "Local trends", "Festive", "Packaging"] as const;

export const DISCOVER_ITEMS: DiscoverItem[] = [
  { id: "dv-01", title: "Morning counter rush", tag: "Food reels", kind: "video", thumb: nsImage("storefront", 0), h: 720 },
  { id: "dv-02", title: "Pastel box stacking", tag: "Packaging", kind: "image", thumb: nsImage("bakery", 20), h: 480 },
  { id: "dv-03", title: "Kopitiam tablescape", tag: "Local trends", kind: "image", thumb: nsImage("storefront", 3), h: 600 },
  { id: "dv-04", title: "Slow syrup pour", tag: "Food reels", kind: "video", thumb: nsImage("bakery", 4), h: 840 },
  { id: "dv-05", title: "Merdeka window display", tag: "Festive", kind: "image", thumb: nsImage("storefront", 7), h: 560 },
  { id: "dv-06", title: "Flour cloud slow-mo", tag: "Food reels", kind: "video", thumb: nsImage("bakery", 14), h: 700 },
  { id: "dv-07", title: "Pandan layer reveal", tag: "Bakery", kind: "image", thumb: nsImage("bakery", 5), h: 640 },
  { id: "dv-08", title: "Ribbon tying loop", tag: "Packaging", kind: "video", thumb: nsImage("bakery", 24), h: 520 },
  { id: "dv-09", title: "Pasar malam lights", tag: "Local trends", kind: "image", thumb: nsImage("storefront", 11), h: 760 },
  { id: "dv-10", title: "Butter block satisfying cut", tag: "Food reels", kind: "video", thumb: nsImage("bakery", 2), h: 600 },
  { id: "dv-11", title: "Raya table spread", tag: "Festive", kind: "image", thumb: nsImage("bakery", 26), h: 680 },
  { id: "dv-12", title: "Minimal price tags", tag: "Packaging", kind: "image", thumb: nsImage("bakery", 18), h: 440 },
  { id: "dv-13", title: "Golden crust macro", tag: "Bakery", kind: "image", thumb: nsImage("bakery", 16), h: 580 },
  { id: "dv-14", title: "Teh tarik pull", tag: "Local trends", kind: "video", thumb: nsImage("storefront", 12), h: 800 },
];

/* ── Brand kit:结构化品牌包 ──────────────────────────────────────────── */
export const BRAND_KIT = {
  brandName: NS_BRAND.name,
  logos: [
    { id: "logo-01", name: "Primary logo", note: "Full wordmark on cream", image: nsImage("bakery", 9) },
    { id: "logo-02", name: "App mark", note: "Moon-and-loaf mark, square", image: nsImage("bakery", 13) },
  ],
  /** 用户品牌色 = 数据,不是 UI token(文件头注记) */
  colours: [
    { id: "col-01", name: "Pandan", hex: "#7F9C6B", use: "Accents and highlights" },
    { id: "col-02", name: "Cream", hex: "#F6EFE3", use: "Backgrounds" },
    { id: "col-03", name: "Gula melaka", hex: "#6F4E37", use: "Headlines on cream" },
    { id: "col-04", name: "Charcoal", hex: "#2A2420", use: "Body text" },
  ],
  fonts: [
    { id: "font-01", role: "Headings", family: "Poppins SemiBold", sample: "Fresh bakes, KL heart" },
    { id: "font-02", role: "Body", family: "Inter Regular", sample: "Pickup at the shop or Lalamove delivery within KL." },
  ],
  voice: "Warm, neighbourly, a little playful. Never salesy. Mix English and Malay naturally, the way KL talks. Short sentences. Prices stated plainly in RM.",
  languages: NS_BRAND.languages,
  market: "Malaysia",
  currency: NS_BRAND.currency,
} as const;

export const BRAND_CHECK_STEPS = [
  "Reading your brand kit…",
  "Checking recent visuals…",
  "Writing the report…",
] as const;

export interface BrandCheckResult {
  id: string;
  level: "pass" | "warn";
  text: string;
}

export const BRAND_CHECK_RESULTS: BrandCheckResult[] = [
  { id: "bc-01", level: "pass", text: "Logo clear space respected in all 12 recent visuals." },
  { id: "bc-02", level: "warn", text: "1 visual uses an off-kit caption font. Open it in Library to fix." },
  { id: "bc-03", level: "pass", text: "Colours stay within the kit palette." },
];

/* ── Cast:选角库(工厂第三步,Wave 3) ──────────────────────────────── */
export type PersonaStatus = "ready" | "training" | "draft";

export interface Persona {
  id: string;
  name: string;
  role: string;
  status: PersonaStatus;
  portrait: string;
  trainedAt?: string;
  scenes?: number;
  progress?: number; // training 状态用
}

export const PERSONAS: Persona[] = [
  { id: "ps-01", name: "Aunty Salmah", role: "Home baker aunty", status: "ready", portrait: nsImage("portrait", 10), trainedAt: "2026-06-18", scenes: 12 },
  { id: "ps-02", name: "Farah", role: "KL office worker", status: "training", portrait: nsImage("portrait", 13), progress: 62 },
  { id: "ps-03", name: "Ah Keat", role: "Kopitiam uncle", status: "ready", portrait: nsImage("portrait", 6), trainedAt: "2026-06-25", scenes: 8 },
  { id: "ps-04", name: "Devi", role: "Weekend market regular", status: "draft", portrait: nsImage("portrait", 18) },
];

export interface ScenePack {
  id: string;
  name: string;
  scenes: number;
  cover: string;
  note: string;
}

export const SCENE_PACKS: ScenePack[] = [
  { id: "sp-01", name: "Kopitiam mornings", scenes: 8, cover: nsImage("storefront", 3), note: "Marble tables, teh tarik, morning light" },
  { id: "sp-02", name: "Pasar malam", scenes: 10, cover: nsImage("storefront", 11), note: "Night market stalls and string lights" },
  { id: "sp-03", name: "Mamak supper", scenes: 6, cover: nsImage("storefront", 13), note: "Late-night tables, roti canai counters" },
  { id: "sp-04", name: "Office pantry KL", scenes: 6, cover: nsImage("storefront", 4), note: "Tower pantries and meeting rooms" },
];

export const TRAIN_STEPS = [
  "Uploading reference photos…",
  "Learning the face…",
  "Locking identity…",
] as const;

/* ── 连接器 1 · 一键进画布:CTA ?from=<id> → canvas 种子 ────────────────────
 * Templates/Discover/Library/My-stuff 四页 CTA 发出的 `?from=<id>` 全部在此解析。
 * 创作区 canvas 挂载时 `resolveCanvasFromSeed(from)` 读它预置会话(create worker 消费侧)。
 * 种子确定性派生自本文件四张真数据表 —— 这就是「保证参数与 id 真实存在」的单一源:
 * 任何 CTA 能发出的 id,这里都查得到;查不到的 id,任何 CTA 都发不出。 */
export interface CanvasFromSeed {
  /** 源 id(回链 / 调试用) */
  id: string;
  /** 来源类型(canvas 首条叙述用人话说清「从哪来的」) */
  origin: "template" | "idea" | "generation" | "asset";
  /** 新会话名(canvas 顶栏 / history) */
  title: string;
  /** 画布首条用户消息(prefill 到 chat composer) */
  firstMessage: string;
  kind: "image" | "video" | "storyboard";
  /** 缩略图(canvas 可选作首个对象占位图) */
  thumb: string;
}

export function resolveCanvasFromSeed(fromId: string): CanvasFromSeed | null {
  const tpl = TEMPLATE_ITEMS.find((t) => t.id === fromId);
  if (tpl) {
    return {
      id: tpl.id,
      origin: "template",
      title: tpl.name,
      firstMessage: `Start from the “${tpl.name}” template. ${tpl.blurb}`,
      kind: /reel/i.test(tpl.surface) ? "video" : "image",
      thumb: tpl.preview,
    };
  }
  const dv = DISCOVER_ITEMS.find((d) => d.id === fromId);
  if (dv) {
    return {
      id: dv.id,
      origin: "idea",
      title: dv.title,
      firstMessage: `Make my own version of “${dv.title}”.`,
      kind: dv.kind,
      thumb: dv.thumb,
    };
  }
  const gen = GEN_RECORDS.find((g) => g.id === fromId);
  if (gen) {
    return {
      id: gen.id,
      origin: "generation",
      title: gen.title,
      firstMessage: `Keep working on “${gen.title}”. ${gen.prompt}`,
      kind: gen.kind,
      thumb: gen.thumb,
    };
  }
  const st = STUFF_ITEMS.find((s) => s.id === fromId);
  if (st) {
    return {
      id: st.id,
      origin: "asset",
      title: st.title,
      firstMessage: `Use “${st.title}” as the starting point.`,
      kind: st.kind === "upload" ? "image" : st.kind,
      thumb: st.thumb,
    };
  }
  return null;
}

/* ── 连接器 2 · 生成时校验(C-08):品牌校验 chips ─────────────────────────
 * 花费确认弹窗生成前对着 BRAND_KIT 跑的确定性假规则(纯前端、零随机):同一段
 * seedText 永远同结果。logo 安全区 / 品牌色偏离出 warn chip,其余出 pass chip。
 * 不是真校验,是把「Otto 生成前替你对了一遍品牌」这件事画出来给 founder 看。 */
export interface BrandCheckChip {
  id: string;
  level: "pass" | "warn";
  label: string;
}

/** 明显偏离 BRAND_KIT.colours 的色词(命中即 warn 一条品牌色偏离) */
const OFF_KIT_COLOUR_WORDS = [
  "neon",
  "black background",
  "hot pink",
  "electric blue",
  "monochrome",
  "greyscale",
  "grayscale",
] as const;

export function brandCheckChips(seedText: string): BrandCheckChip[] {
  const text = seedText.toLowerCase();
  const chips: BrandCheckChip[] = [];

  // logo 安全区:默认留足(pass);文案要把 logo 压到边角 / 全出血才 warn。
  const logoAtRisk =
    /(edge|corner|full[- ]?bleed|crop|cut off)/.test(text) && /logo|wordmark|mark/.test(text);
  chips.push(
    logoAtRisk
      ? { id: "bc-logo", level: "warn", label: "Logo may fall inside its clear space" }
      : { id: "bc-logo", level: "pass", label: "Logo clear space kept" },
  );

  // 品牌色偏离:命中非 kit 色词 → warn;否则 pass(点名 kit 里的主色)。
  const offKit = OFF_KIT_COLOUR_WORDS.find((c) => text.includes(c));
  chips.push(
    offKit
      ? { id: "bc-colour", level: "warn", label: `“${offKit}” is off your kit palette` }
      : { id: "bc-colour", level: "pass", label: `Colours stay on kit — ${BRAND_KIT.colours[0].name}, ${BRAND_KIT.colours[1].name}` },
  );

  // 视频 / reel:字幕字体在导出时才最终定 → 一条温和提示(不是错,是提醒)。
  if (/video|reel|clip|9:16|stitch/.test(text)) {
    chips.push({ id: "bc-font", level: "warn", label: "Caption font locks on export — check it there" });
  }

  return chips;
}
