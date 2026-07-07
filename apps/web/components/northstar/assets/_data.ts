/**
 * 北极星原型 · 资产区 — 区内派生示例数据
 *
 * 全部从共用 mock 模块(_mock.ts)派生/扩展:同一家店(Roti Bulan Bakery)、
 * 同一批产品、同一 nsPlaceholder 占位图。确定性字面量,零随机、零 Date.now。
 *
 * 注:BRAND_KIT 色板里的 hex 是「用户品牌数据」(图片内容级豁免,比照 _mock
 * 占位图与 mascot art)——它们是店家自己的颜色,不是 UI token;界面 chrome
 * 永远走 .gb token。
 */

import { NS_BRAND, NS_PRODUCTS, nsPlaceholder, type NsProduct } from "../_mock";

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
  { id: "st-01", title: "Merdeka box hero shot", kind: "image", createdAt: "2026-07-07", thumb: nsPlaceholder("Hero shot", 640, 640, "crust"), credits: 12, byOtto: true, status: "ready" },
  { id: "st-02", title: "Croissant fold reel", kind: "video", createdAt: "2026-07-07", thumb: nsPlaceholder("Reel 9:16", 360, 640, "video"), portrait: true, credits: 40, byOtto: true, status: "ready" },
  { id: "st-03", title: "Raya box teaser", kind: "video", createdAt: "2026-07-07", thumb: nsPlaceholder("Teaser 9:16", 360, 640, "video"), portrait: true, credits: 40, byOtto: true, status: "failed" },
  { id: "st-04", title: "Pandan cake close-up", kind: "image", createdAt: "2026-07-06", thumb: nsPlaceholder("Close-up", 640, 640, "pandan"), credits: 8, byOtto: false, status: "ready" },
  { id: "st-05", title: "Weekend promo storyboard", kind: "storyboard", createdAt: "2026-07-06", thumb: nsPlaceholder("Storyboard", 640, 360, "neutral"), credits: 0, byOtto: true, status: "ready" },
  { id: "st-06", title: "Storefront photo", kind: "upload", createdAt: "2026-07-05", thumb: nsPlaceholder("Storefront", 640, 480, "kopi"), byOtto: false, status: "ready" },
  { id: "st-07", title: "Menu flat lay", kind: "upload", createdAt: "2026-07-05", thumb: nsPlaceholder("Flat lay", 640, 640, "crust"), byOtto: false, status: "ready" },
  { id: "st-08", title: "Kopi tiramisu menu card", kind: "image", createdAt: "2026-07-04", thumb: nsPlaceholder("Menu card", 640, 800, "kopi"), credits: 8, byOtto: false, status: "ready" },
  { id: "st-09", title: "Kaya croissant macro", kind: "image", createdAt: "2026-07-03", thumb: nsPlaceholder("Macro", 640, 640, "crust"), credits: 8, byOtto: true, status: "ready" },
  { id: "st-10", title: "Bakery morning b-roll", kind: "upload", createdAt: "2026-07-02", thumb: nsPlaceholder("B-roll", 640, 360, "video"), byOtto: false, status: "ready" },
  { id: "st-11", title: "Milo cookie stack", kind: "image", createdAt: "2026-07-01", thumb: nsPlaceholder("Cookie stack", 640, 640, "kopi"), credits: 8, byOtto: true, status: "ready" },
  { id: "st-12", title: "Onde-onde puff teaser", kind: "video", createdAt: "2026-06-30", thumb: nsPlaceholder("Teaser 9:16", 360, 640, "video"), portrait: true, credits: 40, byOtto: true, status: "ready" },
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
  { id: "gen-01", title: "Office order teaser", kind: "video", prompt: "6s vertical teaser of office pastry boxes being packed, warm morning light", canvas: "Merdeka planning", createdAt: "2026-07-07T09:40:00+08:00", day: "today", thumb: nsPlaceholder("Generating", 360, 640, "video"), portrait: true, credits: 40, byOtto: true, variants: 1, status: "generating" },
  { id: "gen-02", title: "Croissant fold reel", kind: "video", prompt: "Hands folding croissant dough, close-up, 6s loop, bakery counter", canvas: "Merdeka planning", createdAt: "2026-07-07T09:14:00+08:00", day: "today", thumb: nsPlaceholder("Reel 9:16", 360, 640, "video"), portrait: true, credits: 40, byOtto: true, variants: 2, status: "ready" },
  { id: "gen-03", title: "Merdeka box hero shot", kind: "image", prompt: "Festive gift box of assorted pastries on rattan tray, flag ribbon accents", canvas: "Merdeka planning", createdAt: "2026-07-07T09:02:00+08:00", day: "today", thumb: nsPlaceholder("Hero shot", 640, 640, "crust"), credits: 12, byOtto: true, variants: 4, status: "ready" },
  { id: "gen-04", title: "Pandan cake close-up", kind: "image", prompt: "Slice of pandan gula melaka cake, cross-section layers, natural light", canvas: "Weekly posts", createdAt: "2026-07-06T15:22:00+08:00", day: "yesterday", thumb: nsPlaceholder("Close-up", 640, 640, "pandan"), credits: 8, byOtto: false, variants: 2, status: "ready" },
  { id: "gen-05", title: "Weekend promo storyboard", kind: "storyboard", prompt: "4-scene storyboard: weekend pre-order push for the Raya cookie gift box", canvas: "Weekly posts", createdAt: "2026-07-06T11:05:00+08:00", day: "yesterday", thumb: nsPlaceholder("Storyboard", 640, 360, "neutral"), credits: 0, byOtto: true, variants: 1, status: "ready" },
  { id: "gen-06", title: "Kopi tiramisu menu card", kind: "image", prompt: "Menu card layout for kopi-O tiramisu cup, RM14, cream background", canvas: "Menu refresh", createdAt: "2026-07-04T16:48:00+08:00", day: "earlier", thumb: nsPlaceholder("Menu card", 640, 800, "kopi"), credits: 8, byOtto: false, variants: 3, status: "ready" },
  { id: "gen-07", title: "Kaya croissant macro", kind: "image", prompt: "Macro shot of kaya oozing from a torn croissant", canvas: "Menu refresh", createdAt: "2026-07-03T10:30:00+08:00", day: "earlier", thumb: nsPlaceholder("Macro", 640, 640, "crust"), credits: 8, byOtto: true, variants: 2, status: "ready" },
  { id: "gen-08", title: "Milo cookie stack", kind: "image", prompt: "Stack of Milo dinosaur cookies with crumbs, playful angle", canvas: "Weekly posts", createdAt: "2026-07-01T14:12:00+08:00", day: "earlier", thumb: nsPlaceholder("Cookie stack", 640, 640, "kopi"), credits: 8, byOtto: true, variants: 2, status: "ready" },
  { id: "gen-09", title: "Onde-onde puff teaser", kind: "video", prompt: "6s vertical teaser: onde-onde cream puff pull-apart", canvas: "Weekly posts", createdAt: "2026-06-30T09:55:00+08:00", day: "earlier", thumb: nsPlaceholder("Teaser 9:16", 360, 640, "video"), portrait: true, credits: 40, byOtto: true, variants: 1, status: "ready" },
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
  image: nsPlaceholder("Teh tarik cookies", 640, 640, "kopi"),
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
  { id: "tpl-01", name: "Weekly special splash", category: "Promo", surface: "Instagram post", blurb: "One hero product, price, and a 3-day window.", preview: nsPlaceholder("Weekly special", 640, 800, "crust"), portrait: true, includes: ["Hero product frame", "Price tag layout", "Caption starter"] },
  { id: "tpl-02", name: "Festive gift box promo", category: "Festive", surface: "Instagram post", blurb: "Seasonal gift box with ribbon-and-flag styling.", preview: nsPlaceholder("Gift box", 640, 640, "pandan"), includes: ["Gift box scene", "Festive colour wash", "Pre-order caption"] },
  { id: "tpl-03", name: "Price list menu card", category: "Menu", surface: "Story", blurb: "Clean menu card for up to 8 items with prices.", preview: nsPlaceholder("Menu card", 360, 640, "kopi"), portrait: true, includes: ["8-item price grid", "Logo slot", "Opening hours strip"] },
  { id: "tpl-04", name: "Before and after bake", category: "Behind the scenes", surface: "Reel", blurb: "Dough to golden bake, two-beat reveal.", preview: nsPlaceholder("Before after", 360, 640, "video"), portrait: true, includes: ["2-scene reveal", "Timer overlay", "Sound cue marks"] },
  { id: "tpl-05", name: "Customer review card", category: "Promo", surface: "Instagram post", blurb: "A real quote over a soft product background.", preview: nsPlaceholder("Review card", 640, 640, "neutral"), includes: ["Quote layout", "Star row", "Name and date slot"] },
  { id: "tpl-06", name: "Flash sale story", category: "Promo", surface: "Story", blurb: "Today-only push with a countdown sticker slot.", preview: nsPlaceholder("Flash sale", 360, 640, "crust"), portrait: true, includes: ["Countdown slot", "Big price cut", "Swipe-up prompt"] },
  { id: "tpl-07", name: "New bake announcement", category: "Announcement", surface: "Instagram post", blurb: "Introduce a new item with a tasting-notes strip.", preview: nsPlaceholder("New bake", 640, 800, "pandan"), portrait: true, includes: ["Tasting notes strip", "Launch date badge", "Caption starter"] },
  { id: "tpl-08", name: "Opening hours update", category: "Announcement", surface: "Instagram post", blurb: "Holiday or festive hours, unmissable and clear.", preview: nsPlaceholder("Hours update", 640, 640, "neutral"), includes: ["Hours table", "Map pin slot", "Festive trim"] },
  { id: "tpl-09", name: "Packing day reel", category: "Behind the scenes", surface: "Reel", blurb: "Order-packing rhythm cut, great for busy seasons.", preview: nsPlaceholder("Packing day", 360, 640, "video"), portrait: true, includes: ["3-scene rhythm cut", "Order counter overlay", "Thank-you end card"] },
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
  { id: "dv-01", title: "Morning counter rush", tag: "Food reels", kind: "video", thumb: nsPlaceholder("Counter rush", 480, 720, "video"), h: 720 },
  { id: "dv-02", title: "Pastel box stacking", tag: "Packaging", kind: "image", thumb: nsPlaceholder("Box stacking", 480, 480, "neutral"), h: 480 },
  { id: "dv-03", title: "Kopitiam tablescape", tag: "Local trends", kind: "image", thumb: nsPlaceholder("Kopitiam", 480, 600, "kopi"), h: 600 },
  { id: "dv-04", title: "Slow syrup pour", tag: "Food reels", kind: "video", thumb: nsPlaceholder("Syrup pour", 480, 840, "video"), h: 840 },
  { id: "dv-05", title: "Merdeka window display", tag: "Festive", kind: "image", thumb: nsPlaceholder("Window display", 480, 560, "crust"), h: 560 },
  { id: "dv-06", title: "Flour cloud slow-mo", tag: "Food reels", kind: "video", thumb: nsPlaceholder("Flour cloud", 480, 700, "video"), h: 700 },
  { id: "dv-07", title: "Pandan layer reveal", tag: "Bakery", kind: "image", thumb: nsPlaceholder("Layer reveal", 480, 640, "pandan"), h: 640 },
  { id: "dv-08", title: "Ribbon tying loop", tag: "Packaging", kind: "video", thumb: nsPlaceholder("Ribbon loop", 480, 520, "video"), h: 520 },
  { id: "dv-09", title: "Pasar malam lights", tag: "Local trends", kind: "image", thumb: nsPlaceholder("Pasar malam", 480, 760, "kopi"), h: 760 },
  { id: "dv-10", title: "Butter block satisfying cut", tag: "Food reels", kind: "video", thumb: nsPlaceholder("Butter cut", 480, 600, "video"), h: 600 },
  { id: "dv-11", title: "Raya table spread", tag: "Festive", kind: "image", thumb: nsPlaceholder("Raya spread", 480, 680, "crust"), h: 680 },
  { id: "dv-12", title: "Minimal price tags", tag: "Packaging", kind: "image", thumb: nsPlaceholder("Price tags", 480, 440, "neutral"), h: 440 },
  { id: "dv-13", title: "Golden crust macro", tag: "Bakery", kind: "image", thumb: nsPlaceholder("Crust macro", 480, 580, "crust"), h: 580 },
  { id: "dv-14", title: "Teh tarik pull", tag: "Local trends", kind: "video", thumb: nsPlaceholder("Teh tarik", 480, 800, "video"), h: 800 },
];

/* ── Brand kit:结构化品牌包 ──────────────────────────────────────────── */
export const BRAND_KIT = {
  brandName: NS_BRAND.name,
  logos: [
    { id: "logo-01", name: "Primary logo", note: "Full wordmark on cream", image: nsPlaceholder("Wordmark", 480, 300, "crust") },
    { id: "logo-02", name: "App mark", note: "Moon-and-loaf mark, square", image: nsPlaceholder("Mark", 300, 300, "pandan") },
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
  { id: "ps-01", name: "Aunty Salmah", role: "Home baker aunty", status: "ready", portrait: nsPlaceholder("Aunty Salmah", 480, 480, "crust"), trainedAt: "2026-06-18", scenes: 12 },
  { id: "ps-02", name: "Farah", role: "KL office worker", status: "training", portrait: nsPlaceholder("Farah", 480, 480, "neutral"), progress: 62 },
  { id: "ps-03", name: "Ah Keat", role: "Kopitiam uncle", status: "ready", portrait: nsPlaceholder("Ah Keat", 480, 480, "kopi"), trainedAt: "2026-06-25", scenes: 8 },
  { id: "ps-04", name: "Devi", role: "Weekend market regular", status: "draft", portrait: nsPlaceholder("Devi", 480, 480, "pandan") },
];

export interface ScenePack {
  id: string;
  name: string;
  scenes: number;
  cover: string;
  note: string;
}

export const SCENE_PACKS: ScenePack[] = [
  { id: "sp-01", name: "Kopitiam mornings", scenes: 8, cover: nsPlaceholder("Kopitiam", 480, 300, "kopi"), note: "Marble tables, teh tarik, morning light" },
  { id: "sp-02", name: "Pasar malam", scenes: 10, cover: nsPlaceholder("Pasar malam", 480, 300, "video"), note: "Night market stalls and string lights" },
  { id: "sp-03", name: "Mamak supper", scenes: 6, cover: nsPlaceholder("Mamak", 480, 300, "crust"), note: "Late-night tables, roti canai counters" },
  { id: "sp-04", name: "Office pantry KL", scenes: 6, cover: nsPlaceholder("Office pantry", 480, 300, "neutral"), note: "Tower pantries and meeting rooms" },
];

export const TRAIN_STEPS = [
  "Uploading reference photos…",
  "Learning the face…",
  "Locking identity…",
] as const;
