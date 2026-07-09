/**
 * 北极星原型 — 全城共用示例数据(唯一 mock 模块)
 *
 * 场景:马来西亚 SMB — 吉隆坡家庭烘焙坊「Roti Bulan Bakery」。
 * 规矩(PROGRAM.md §1.1):示例数据要像真的 — 马来西亚商家、MYR、真实尺寸占位图;
 * 全部确定性(固定种子,零 Date.now / 零模块顶层 Math.random);零后台 import。
 *
 * 占位图:内联 SVG data URI(nsPlaceholder)— 不用任何外链图片。
 * SVG 字符串内的 hex 是图片内容(比照 mascot art 豁免),不是 UI token;
 * UI 层永远用 .gb token,不得把这些值当颜色用。
 */

// ── deterministic PRNG(mulberry32,固定种子) ─────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 占位图(inline SVG,零外链) ─────────────────────────────────────────────
const PLACEHOLDER_TONES = {
  /** 烘焙暖调 */
  crust: ["#E8D5B7", "#B98A5A"],
  /** 抹茶 */
  pandan: ["#DDE8CE", "#7F9C6B"],
  /** 咖啡 */
  kopi: ["#D9C3B0", "#6F4E37"],
  /** 中性(界面示意) */
  neutral: ["#EFEFED", "#B6B6B0"],
  /** 视频深色 */
  video: ["#3A3A3E", "#1C1C1F"],
} as const;

export type NsPlaceholderTone = keyof typeof PLACEHOLDER_TONES;

/** 真实尺寸的内联 SVG 占位图(data URI)。label 显示在图中央。 */
export function nsPlaceholder(
  label: string,
  w: number,
  h: number,
  tone: NsPlaceholderTone = "neutral",
): string {
  const [bg, fg] = PLACEHOLDER_TONES[tone];
  const fontSize = Math.max(11, Math.min(18, Math.round(Math.min(w, h) / 10)));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${bg}"/>` +
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="${fg}" stroke-opacity="0.35"/>` +
    `<circle cx="${w / 2}" cy="${h / 2 - fontSize}" r="${fontSize * 0.9}" fill="${fg}" fill-opacity="0.3"/>` +
    `<text x="${w / 2}" y="${h / 2 + fontSize}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="${fontSize}" fill="${fg}">${label} · ${w}×${h}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ── NS_IMAGES:真图目录(全城唯一图源) ─────────────────────────────────────────
/**
 * ENDGAME-CITY-ORDER §一 图片纪律:全城**只从 NS_IMAGES 取图**(禁止自造 photo ID)。
 * 图源 = images.unsplash.com 热链(`?w=800&q=80`)+ i.pravatar.cc 头像。
 * 每条 URL 已 `curl -sI` 验证 HTTP 200(验证记录见本次 PR/commit message)。
 * 同一家店(Roti Bulan Bakery)的视觉保持一致:烘焙产品 / 店景生活 / campaign 主视觉 / 人像四类。
 * 原型层用 `<img>`(不走 next/image);取图请用 `nsImage(cat, i)`(确定性、循环取,永不越界)。
 */
const U = (id: string) => `https://images.unsplash.com/photo-${id}?w=800&q=80`;

export const NS_IMAGES = {
  /** 烘焙产品(蛋糕/可颂/饼干/甜点…)— 28 张,curl 200 */
  bakery: [
    U("1509440159596-0249088772ff"), U("1555507036-ab1f4038808a"), U("1486427944299-d1955d23e34d"),
    U("1517433670267-08bbd4be890f"), U("1550617931-e17a7b70dce2"), U("1464349095431-e9a21285b5f3"),
    U("1587241321921-91a834d6d191"), U("1608198093002-ad4e005484ec"), U("1568254183919-78a4f43a2877"),
    U("1509365465985-25d11c17e812"), U("1499636136210-6f4ee915583e"), U("1600891964092-4316c288032e"),
    U("1567620905732-2d1ec7ab7445"), U("1565958011703-44f9829ba187"), U("1481391319762-47dff72954d9"),
    U("1533089860892-a7c6f0a88666"), U("1517686469429-8bdb88b9f907"), U("1558961363-fa8fdf82db35"),
    U("1550547660-d9450f859349"), U("1571091718767-18b5b1457add"), U("1541599468348-e96984315921"),
    U("1509722747041-616f39b57569"), U("1488477181946-6428a0291777"), U("1466978913421-dad2ebd01d17"),
    U("1524350876685-274059332603"), U("1601050690597-df0568f70950"), U("1470337458703-46ad1756a187"),
    U("1499028344343-cd173ffc68a9"),
  ],
  /** 店景 / 生活方式(咖啡店内景、出品、摆盘)— 14 张,curl 200 */
  storefront: [
    U("1470124182917-cc6e71b22ecc"), U("1504674900247-0877df9cc836"), U("1476224203421-9ac39bcb3327"),
    U("1414235077428-338989a2e8c0"), U("1517248135467-4c7edcad34c4"), U("1495474472287-4d71bcdd2085"),
    U("1554118811-1e0d58224f24"), U("1521017432531-fbd92d768814"), U("1559925393-8be0ec4767c8"),
    U("1554520735-0a6b8b6ce8b7"), U("1509042239860-f550ce710b93"), U("1447933601403-0c6688de566e"),
    U("1513104890138-7c749659a591"), U("1554679665-f5537f187268"),
  ],
  /** campaign 主视觉(hero)— 6 张,curl 200 */
  campaign: [
    U("1546069901-ba9599a7e63c"), U("1540189549336-e6e99c3679fe"), U("1467003909585-2f8a72700288"),
    U("1432139555190-58524dae6a55"), U("1502741224143-90386d7f8c82"), U("1522336572468-97b06e8ef143"),
  ],
  /** 人像头像(联系人/团队)— i.pravatar.cc,30 张,curl 200 */
  portrait: [
    "https://i.pravatar.cc/150?img=1", "https://i.pravatar.cc/150?img=3", "https://i.pravatar.cc/150?img=5",
    "https://i.pravatar.cc/150?img=8", "https://i.pravatar.cc/150?img=11", "https://i.pravatar.cc/150?img=12",
    "https://i.pravatar.cc/150?img=13", "https://i.pravatar.cc/150?img=14", "https://i.pravatar.cc/150?img=15",
    "https://i.pravatar.cc/150?img=16", "https://i.pravatar.cc/150?img=20", "https://i.pravatar.cc/150?img=22",
    "https://i.pravatar.cc/150?img=24", "https://i.pravatar.cc/150?img=25", "https://i.pravatar.cc/150?img=26",
    "https://i.pravatar.cc/150?img=27", "https://i.pravatar.cc/150?img=28", "https://i.pravatar.cc/150?img=31",
    "https://i.pravatar.cc/150?img=32", "https://i.pravatar.cc/150?img=33", "https://i.pravatar.cc/150?img=36",
    "https://i.pravatar.cc/150?img=40", "https://i.pravatar.cc/150?img=45", "https://i.pravatar.cc/150?img=47",
    "https://i.pravatar.cc/150?img=51", "https://i.pravatar.cc/150?img=52", "https://i.pravatar.cc/150?img=56",
    "https://i.pravatar.cc/150?img=58", "https://i.pravatar.cc/150?img=60", "https://i.pravatar.cc/150?img=65",
  ],
} as const;

export type NsImageCategory = keyof typeof NS_IMAGES;

/** 确定性取图:按分类循环索引,永不越界(i 可传任意非负整数)。 */
export function nsImage(cat: NsImageCategory, i: number): string {
  const arr = NS_IMAGES[cat];
  return arr[((i % arr.length) + arr.length) % arr.length];
}

// ── 品牌 ────────────────────────────────────────────────────────────────────
export const NS_BRAND = {
  name: "Roti Bulan Bakery",
  tagline: "Fresh bakes, KL heart",
  city: "Kuala Lumpur",
  owner: "Aisyah Rahman",
  email: "aisyah@rotibulan.my",
  languages: ["English", "Bahasa Melayu", "中文"],
  voice: "Warm, neighbourly, a little playful. Never salesy.",
  currency: "MYR",
  creditBalance: 1240,
} as const;

// ── 产品 ────────────────────────────────────────────────────────────────────
export interface NsProduct {
  id: string;
  name: string;
  category: string;
  priceMyr: number;
  description: string;
  image: string;
  bestSeller: boolean;
}

export const NS_PRODUCTS: NsProduct[] = [
  { id: "prod-01", name: "Pandan gula melaka cake", category: "Cakes", priceMyr: 88, description: "Signature pandan sponge layered with gula melaka cream.", image: nsImage("bakery", 5), bestSeller: true },
  { id: "prod-02", name: "Kaya butter croissant", category: "Pastries", priceMyr: 8.5, description: "Flaky croissant with house-made kaya and cold butter.", image: nsImage("bakery", 1), bestSeller: true },
  { id: "prod-03", name: "Milo dinosaur cookie", category: "Cookies", priceMyr: 6, description: "Chewy cookie loaded with Milo crunch.", image: nsImage("bakery", 7), bestSeller: false },
  { id: "prod-04", name: "Onde-onde cream puff", category: "Pastries", priceMyr: 7.5, description: "Choux puff with pandan cream and coconut flakes.", image: nsImage("bakery", 12), bestSeller: false },
  { id: "prod-05", name: "Kopi-O tiramisu cup", category: "Desserts", priceMyr: 14, description: "Local twist on tiramisu with kopitiam-brew espresso.", image: nsImage("bakery", 10), bestSeller: true },
  { id: "prod-06", name: "Raya cookie gift box", category: "Seasonal", priceMyr: 68, description: "12-piece assorted festive box, ribbon included.", image: nsImage("bakery", 20), bestSeller: false },
  { id: "prod-07", name: "Matcha croffle", category: "Pastries", priceMyr: 12, description: "Croissant-waffle hybrid, dusted matcha and gula melaka drizzle.", image: nsImage("bakery", 2), bestSeller: false },
];

// ── Campaign 日历条目 ──────────────────────────────────────────────────────
export interface NsCampaignEntry {
  id: string;
  date: string; // ISO date
  platform: "instagram" | "facebook" | "tiktok" | "x";
  format: "image" | "video" | "carousel";
  hook: string;
  status: "proposed" | "approved" | "scheduled" | "published";
  estCredits: number;
}

export const NS_CAMPAIGN = {
  id: "camp-merdeka-01",
  name: "Merdeka week bakes",
  goal: "Drive pre-orders for the Merdeka gift box",
  period: "2026-08-24 to 2026-08-31",
  budgetCredits: 320,
  platforms: ["instagram", "facebook", "tiktok"],
  status: "proposed" as const,
};

export const NS_CAMPAIGN_ENTRIES: NsCampaignEntry[] = [
  { id: "ce-01", date: "2026-08-24", platform: "instagram", format: "video", hook: "The box that sells out every Merdeka", status: "approved", estCredits: 40 },
  { id: "ce-02", date: "2026-08-25", platform: "facebook", format: "image", hook: "Pandan and gula melaka, made for sharing", status: "approved", estCredits: 12 },
  { id: "ce-03", date: "2026-08-26", platform: "tiktok", format: "video", hook: "POV: your office order arrives at 3pm", status: "proposed", estCredits: 40 },
  { id: "ce-04", date: "2026-08-27", platform: "instagram", format: "carousel", hook: "6 bakes, 1 box, zero regrets", status: "proposed", estCredits: 24 },
  { id: "ce-05", date: "2026-08-28", platform: "facebook", format: "image", hook: "Last 3 days for pre-orders", status: "proposed", estCredits: 12 },
  { id: "ce-06", date: "2026-08-30", platform: "instagram", format: "video", hook: "Packing day at the bakery", status: "proposed", estCredits: 40 },
  { id: "ce-07", date: "2026-08-31", platform: "instagram", format: "image", hook: "Selamat Hari Merdeka from Roti Bulan", status: "proposed", estCredits: 12 },
];

// ── 排期帖子 ────────────────────────────────────────────────────────────────
export interface NsScheduledPost {
  id: string;
  scheduledAt: string; // ISO datetime, Asia/Kuala_Lumpur
  platform: "instagram" | "facebook" | "tiktok" | "x";
  caption: string;
  media: string;
  status: "draft" | "scheduled" | "published" | "failed";
  campaignId?: string;
  firstComment?: string;
  /** 图片 alt(无障碍 + 断链检查演示;F1 世界圣经补) */
  altText?: string;
  /** 失败原因(status="failed" 时;排期区「防双发/断链」自愈演示读它) */
  failReason?: string;
  /** 该帖已发的其它平台变体 id(逐平台变体归组;排期区读它显示「+2 platforms」) */
  crossPostIds?: string[];
}

/**
 * 排期帖 30 天密度(2026-06-26 → 2026-07-26,Asia/Kuala_Lumpur)。
 * published 12+ / scheduled 8+ / draft 5+ / failed 1(防双发/断链自愈样例)。逐平台变体、
 * first comment、campaign 归组角标(campaignId → 深链回容器)。media 全部取自 NS_IMAGES。
 */
export const NS_SCHEDULED_POSTS: NsScheduledPost[] = [
  // ── 稳定 id(post-01..06,既有页面/kit 直接引用:share-preview 默认 post-04、
  //    queue 重试样例 post-06;id 保持不变,只把占位图换成 NS_IMAGES) ──────────────
  { id: "post-01", scheduledAt: "2026-07-08T09:00:00+08:00", platform: "instagram", caption: "Fresh out of the oven: kaya butter croissants till 11am only.", media: nsImage("bakery", 8), status: "scheduled", altText: "Croissants fresh from the oven" },
  { id: "post-02", scheduledAt: "2026-07-08T12:30:00+08:00", platform: "facebook", caption: "Lunch treat idea: kopi-O tiramisu cups, RM14 each.", media: nsImage("bakery", 13), status: "scheduled", campaignId: "camp-office-01", altText: "Tiramisu cups on a tray" },
  { id: "post-03", scheduledAt: "2026-07-09T10:00:00+08:00", platform: "tiktok", caption: "How we fold 200 croissants before sunrise.", media: nsImage("storefront", 4), status: "draft", altText: "Baker folding croissant dough" },
  { id: "post-04", scheduledAt: "2026-07-10T09:00:00+08:00", platform: "instagram", caption: "Weekend pre-orders open now. Link in bio.", media: nsImage("bakery", 4), status: "draft", firstComment: "Pre-order closes Friday 6pm!", altText: "Assorted weekend pastries" },
  { id: "post-05", scheduledAt: "2026-07-06T09:00:00+08:00", platform: "instagram", caption: "Thank you KL, sold out by noon again.", media: nsImage("bakery", 0), status: "published", altText: "Fresh baked bread loaves" },
  { id: "post-06", scheduledAt: "2026-07-05T18:00:00+08:00", platform: "facebook", caption: "New week, new bakes. What should we bring back?", media: nsImage("storefront", 0), status: "published", altText: "Bakery counter display" },
  // ── 已发(published,过去两周) ──────────────────────────────────────────────
  { id: "post-p01", scheduledAt: "2026-06-26T09:00:00+08:00", platform: "instagram", caption: "Friday bakes are out — kaya croissants till 11am only.", media: nsImage("bakery", 1), status: "published", altText: "Golden kaya butter croissants on a tray" },
  { id: "post-p02", scheduledAt: "2026-06-27T10:30:00+08:00", platform: "tiktok", caption: "How we fold 200 croissants before sunrise 🥐", media: nsImage("storefront", 4), status: "published", altText: "Baker folding croissant dough at dawn" },
  { id: "post-p03", scheduledAt: "2026-06-28T18:00:00+08:00", platform: "facebook", caption: "New week, new bakes. What should we bring back?", media: nsImage("storefront", 0), status: "published", altText: "Bakery counter display" },
  { id: "post-p04", scheduledAt: "2026-06-30T09:00:00+08:00", platform: "instagram", caption: "Pandan gula melaka, made for sharing.", media: nsImage("bakery", 5), status: "published", altText: "Slice of pandan gula melaka cake" },
  { id: "post-p05", scheduledAt: "2026-07-01T12:30:00+08:00", platform: "facebook", caption: "Lunch treat idea: kopi-O tiramisu cups, RM14 each.", media: nsImage("bakery", 10), status: "published", campaignId: "camp-office-01", altText: "Kopi-O tiramisu cups" },
  { id: "post-p06", scheduledAt: "2026-07-02T09:00:00+08:00", platform: "instagram", caption: "POV: your office order arrives at 3pm 📦", media: nsImage("storefront", 1), status: "published", campaignId: "camp-office-01", altText: "Office pastry delivery box" },
  { id: "post-p07", scheduledAt: "2026-07-03T08:30:00+08:00", platform: "tiktok", caption: "Milo dinosaur cookie, but make it dramatic.", media: nsImage("bakery", 7), status: "published", altText: "Milo dinosaur cookie" },
  { id: "post-p08", scheduledAt: "2026-07-04T17:00:00+08:00", platform: "facebook", caption: "Weekend pre-orders open now. Link in comments.", media: nsImage("bakery", 12), status: "published", firstComment: "Order here → rotibulan.my/order", altText: "Onde-onde cream puffs" },
  { id: "post-p09", scheduledAt: "2026-07-05T09:00:00+08:00", platform: "instagram", caption: "Sunday slow mornings call for kopitiam brew.", media: nsImage("storefront", 5), status: "published", altText: "Coffee cup on a marble table" },
  { id: "post-p10", scheduledAt: "2026-07-06T09:00:00+08:00", platform: "instagram", caption: "Thank you KL, sold out by noon again.", media: nsImage("bakery", 0), status: "published", altText: "Fresh baked bread loaves" },
  { id: "post-p11", scheduledAt: "2026-07-06T13:00:00+08:00", platform: "facebook", caption: "Missed us? Pre-order for tomorrow before 8pm.", media: nsImage("storefront", 8), status: "published", altText: "Bakery display window" },
  { id: "post-p12", scheduledAt: "2026-07-07T08:00:00+08:00", platform: "tiktok", caption: "3am at the bakery — the croissant proofing timelapse.", media: nsImage("storefront", 12), status: "published", altText: "Bakery kitchen at night" },
  // ── 已排(scheduled,未来两周) ──────────────────────────────────────────────
  { id: "post-s01", scheduledAt: "2026-07-09T09:00:00+08:00", platform: "instagram", caption: "Fresh out of the oven: kaya butter croissants till 11am only.", media: nsImage("bakery", 8), status: "scheduled", altText: "Croissants fresh from the oven" },
  { id: "post-s02", scheduledAt: "2026-07-09T12:30:00+08:00", platform: "facebook", caption: "Lunch treat idea: kopi-O tiramisu cups, RM14 each.", media: nsImage("bakery", 13), status: "scheduled", campaignId: "camp-office-01", altText: "Tiramisu cups on a tray" },
  { id: "post-s03", scheduledAt: "2026-07-10T10:00:00+08:00", platform: "instagram", caption: "Weekend pre-orders open now. Link in bio.", media: nsImage("bakery", 4), status: "scheduled", firstComment: "Pre-order closes Friday 6pm!", altText: "Assorted pastries" },
  { id: "post-s04", scheduledAt: "2026-07-11T09:00:00+08:00", platform: "tiktok", caption: "The matcha croffle test batch — new drop soon 👀", media: nsImage("bakery", 2), status: "scheduled", campaignId: "camp-croffle-01", altText: "Matcha croffle close-up" },
  { id: "post-s05", scheduledAt: "2026-07-12T09:00:00+08:00", platform: "instagram", caption: "Selamat pagi! Onde-onde cream puffs back this weekend.", media: nsImage("bakery", 12), status: "scheduled", altText: "Onde-onde cream puffs" },
  { id: "post-s06", scheduledAt: "2026-07-14T09:00:00+08:00", platform: "facebook", caption: "Corporate orders for July — lock your slot now.", media: nsImage("storefront", 1), status: "scheduled", campaignId: "camp-office-01", altText: "Office catering box" },
  { id: "post-s07", scheduledAt: "2026-07-16T18:00:00+08:00", platform: "instagram", caption: "Meet the team behind your morning bakes.", media: nsImage("storefront", 3), status: "scheduled", altText: "Bakery team at the counter" },
  { id: "post-s08", scheduledAt: "2026-07-18T09:00:00+08:00", platform: "tiktok", caption: "Croffle assembly line — ASMR edition.", media: nsImage("bakery", 2), status: "scheduled", campaignId: "camp-croffle-01", altText: "Croffle being assembled" },
  { id: "post-s09", scheduledAt: "2026-07-20T09:00:00+08:00", platform: "instagram", caption: "Merdeka gift box previews start this week 🇲🇾", media: nsImage("campaign", 0), status: "scheduled", campaignId: "camp-merdeka-01", altText: "Merdeka gift box hero shot" },
  // ── 草稿(draft) ────────────────────────────────────────────────────────────
  { id: "post-d01", scheduledAt: "2026-07-13T10:00:00+08:00", platform: "instagram", caption: "The box that sells out every Merdeka.", media: nsImage("campaign", 1), status: "draft", campaignId: "camp-merdeka-01", altText: "Merdeka gift box" },
  { id: "post-d02", scheduledAt: "2026-07-15T09:00:00+08:00", platform: "tiktok", caption: "Packing day at the bakery — Merdeka boxes.", media: nsImage("storefront", 12), status: "draft", campaignId: "camp-merdeka-01", altText: "Packing gift boxes" },
  { id: "post-d03", scheduledAt: "2026-07-17T09:00:00+08:00", platform: "facebook", caption: "6 bakes, 1 box, zero regrets.", media: nsImage("campaign", 2), status: "draft", campaignId: "camp-merdeka-01", altText: "Assorted bakes in a box" },
  { id: "post-d04", scheduledAt: "2026-07-22T09:00:00+08:00", platform: "instagram", caption: "Croffle launch day — first 50 get a free kopi.", media: nsImage("bakery", 2), status: "draft", campaignId: "camp-croffle-01", altText: "Matcha croffle launch" },
  { id: "post-d05", scheduledAt: "2026-07-24T09:00:00+08:00", platform: "instagram", caption: "Behind the croffle: 48 layers, one waffle iron.", media: nsImage("storefront", 12), status: "draft", campaignId: "camp-croffle-01", altText: "Croffle dough layers" },
  // ── 失败(防双发/断链自愈样例) ───────────────────────────────────────────────
  { id: "post-f01", scheduledAt: "2026-07-07T15:00:00+08:00", platform: "facebook", caption: "Flash sale: last kopi-O tiramisu cups, 30% off till 5pm.", media: nsImage("bakery", 10), status: "failed", failReason: "Facebook token expired — reconnect to retry", campaignId: "camp-office-01", altText: "Tiramisu cups flash sale" },
  // ── Raya open house 礼盒(camp-raya-01,DONE:已发历史帖,Feb–Mar 2026) ──────────
  //    该战役已完结(售罄早 3 天、312 盒),日历 tab 读这些 published 帖,非空状态。
  { id: "post-r01", scheduledAt: "2026-02-24T09:00:00+08:00", platform: "instagram", caption: "Raya pre-orders open — our open house cookie boxes, early-bird pricing till Mar 1.", media: nsImage("campaign", 3), status: "published", campaignId: "camp-raya-01", altText: "Raya open house cookie gift box" },
  { id: "post-r02", scheduledAt: "2026-02-27T12:00:00+08:00", platform: "facebook", caption: "Corporate Raya hampers for the office — bulk orders close Mar 10.", media: nsImage("bakery", 24), status: "published", campaignId: "camp-raya-01", altText: "Raya hamper for corporate gifting" },
  { id: "post-r03", scheduledAt: "2026-03-02T18:00:00+08:00", platform: "instagram", caption: "The lid reveal everyone waits for. Raya open house box, packed by hand.", media: nsImage("campaign", 3), status: "published", campaignId: "camp-raya-01", altText: "Hands opening a Raya cookie gift box" },
  { id: "post-r04", scheduledAt: "2026-03-06T09:00:00+08:00", platform: "instagram", caption: "Eight kuih raya favourites, one box. Made for the open house table.", media: nsImage("bakery", 20), status: "published", campaignId: "camp-raya-01", altText: "Flat lay of assorted raya cookies" },
  { id: "post-r05", scheduledAt: "2026-03-12T12:00:00+08:00", platform: "facebook", caption: "Last call — Raya boxes close this Friday. A few slots left.", media: nsImage("bakery", 24), status: "published", campaignId: "camp-raya-01", altText: "Raya cookie box last-call card" },
  { id: "post-r06", scheduledAt: "2026-03-17T17:00:00+08:00", platform: "instagram", caption: "Sold out 3 days early. Terima kasih — 312 boxes off to your open houses.", media: nsImage("bakery", 25), status: "published", campaignId: "camp-raya-01", altText: "Stacked raya gift boxes ready to ship" },
];

// ── 联系人 ──────────────────────────────────────────────────────────────────
export type NsLifecycle = "lead" | "new" | "active" | "regular" | "vip" | "dormant";
export type NsHeat = "hot" | "warm" | "cold";

export interface NsContact {
  id: string;
  name: string;
  channels: ("whatsapp" | "instagram" | "facebook")[];
  lastSeen: string;
  tags: string[];
  doNotDisturb: boolean;
  /** 单一源:同一客户在 contacts 页与 deals 页显示同一笔钱(dealAmountMyr 从此派生) */
  totalOrdersMyr: number;
  // ── F1 世界圣经补(全部可选:store 内联构造的联系人不需要它们) ──────────────
  /** 头像(取自 NS_IMAGES.portrait;无则回落姓名首字母) */
  avatar?: string;
  /** 生命周期阶段(CRM lifecycle 列 / 分群) */
  lifecycle?: NsLifecycle;
  /** 热度标签(CRM 热度 chip;派生自最近活动 + 订单额的产品口径) */
  heat?: NsHeat;
  /** 来源(哪个 campaign / 渠道把这个人带进来;CRM「来源」列 + campaign 归属) */
  source?: string;
  /** 预测下次消费(CRM 预测字段;产品口径,非真实预测) */
  predictedNextMyr?: number;
  /** 订单次数(平均客单价 = totalOrdersMyr / orderCount) */
  orderCount?: number;
  /** 手机(WhatsApp 身份 + 群发受众展示;+60 马来西亚号段) */
  phone?: string;
  /** 备注(店主手记 / Otto 观察) */
  note?: string;
}

/**
 * 联系人 22 人(马来 / 华 / 印裔真实感姓名混合)。ct-01..ct-05 是既有稳定 id(deals /
 * 对话 / 分群直接引用),只补可选字段;ct-06..ct-22 新增。deals 金额与 totalOrdersMyr
 * 同源一致(dealAmountMyr(id) 就是这里的 totalOrdersMyr,永不漂移)。
 */
export const NS_CONTACTS: NsContact[] = [
  { id: "ct-01", name: "Mei Ling Tan", channels: ["whatsapp", "instagram"], lastSeen: "2026-07-06", tags: ["regular", "office orders"], doNotDisturb: false, totalOrdersMyr: 640, avatar: nsImage("portrait", 0), lifecycle: "regular", heat: "hot", source: "Weekday office orders", predictedNextMyr: 170, orderCount: 8, phone: "+60 12-334 8821", note: "Orders croissants for her office every Friday." },
  { id: "ct-02", name: "Hafiz Abdullah", channels: ["whatsapp"], lastSeen: "2026-07-05", tags: ["wholesale"], doNotDisturb: false, totalOrdersMyr: 2180, avatar: nsImage("portrait", 1), lifecycle: "vip", heat: "hot", source: "Referral", predictedNextMyr: 720, orderCount: 14, phone: "+60 13-220 4471", note: "Cafe reseller, 60 boxes weekly. Delivery Tuesdays." },
  { id: "ct-03", name: "Priya Nair", channels: ["instagram"], lastSeen: "2026-07-07", tags: ["new"], doNotDisturb: false, totalOrdersMyr: 88, avatar: nsImage("portrait", 2), lifecycle: "new", heat: "warm", source: "Instagram · Merdeka week bakes", predictedNextMyr: 88, orderCount: 1, note: "Asked about halal cert — first order pending." },
  { id: "ct-04", name: "Jason Wong", channels: ["facebook", "whatsapp"], lastSeen: "2026-06-30", tags: ["catering"], doNotDisturb: true, totalOrdersMyr: 1450, avatar: nsImage("portrait", 3), lifecycle: "vip", heat: "warm", source: "Catering enquiry", predictedNextMyr: 480, orderCount: 6, phone: "+60 16-778 1290", note: "Corporate platters. Prefers Facebook. Do-not-disturb on weekends." },
  { id: "ct-05", name: "Nurul Izzah", channels: ["whatsapp"], lastSeen: "2026-07-04", tags: ["regular"], doNotDisturb: false, totalOrdersMyr: 320, avatar: nsImage("portrait", 4), lifecycle: "regular", heat: "warm", source: "Walk-in", predictedNextMyr: 60, orderCount: 5, phone: "+60 19-445 3308" },
  { id: "ct-06", name: "Arjun Ramasamy", channels: ["whatsapp", "facebook"], lastSeen: "2026-07-07", tags: ["office orders"], doNotDisturb: false, totalOrdersMyr: 540, avatar: nsImage("portrait", 5), lifecycle: "active", heat: "hot", source: "Weekday office orders", predictedNextMyr: 150, orderCount: 6, phone: "+60 12-901 7745", note: "Tower nearby, 3pm pickups." },
  { id: "ct-07", name: "Siti Aminah", channels: ["instagram"], lastSeen: "2026-07-06", tags: ["new"], doNotDisturb: false, totalOrdersMyr: 68, avatar: nsImage("portrait", 6), lifecycle: "new", heat: "warm", source: "Instagram · CTWA ad", predictedNextMyr: 68, orderCount: 1, note: "Came in from the Merdeka box ad." },
  { id: "ct-08", name: "Daniel Lim", channels: ["facebook"], lastSeen: "2026-06-28", tags: ["regular"], doNotDisturb: false, totalOrdersMyr: 410, avatar: nsImage("portrait", 7), lifecycle: "active", heat: "warm", source: "Facebook", predictedNextMyr: 90, orderCount: 5 },
  { id: "ct-09", name: "Farah Zulkifli", channels: ["whatsapp", "instagram"], lastSeen: "2026-07-07", tags: ["vip", "office orders"], doNotDisturb: false, totalOrdersMyr: 1980, avatar: nsImage("portrait", 8), lifecycle: "vip", heat: "hot", source: "Weekday office orders", predictedNextMyr: 320, orderCount: 12, phone: "+60 17-662 1122", note: "Books the boardroom breakfast every month." },
  { id: "ct-10", name: "Kavitha Menon", channels: ["whatsapp"], lastSeen: "2026-06-22", tags: ["catering"], doNotDisturb: false, totalOrdersMyr: 760, avatar: nsImage("portrait", 9), lifecycle: "active", heat: "cold", source: "Catering enquiry", predictedNextMyr: 250, orderCount: 4, phone: "+60 14-338 9910" },
  { id: "ct-11", name: "Aiman Rosli", channels: ["instagram"], lastSeen: "2026-07-05", tags: ["new"], doNotDisturb: false, totalOrdersMyr: 42, avatar: nsImage("portrait", 10), lifecycle: "new", heat: "warm", source: "Instagram · Merdeka week bakes", predictedNextMyr: 42, orderCount: 1 },
  { id: "ct-12", name: "Grace Chong", channels: ["facebook", "whatsapp"], lastSeen: "2026-07-03", tags: ["regular"], doNotDisturb: false, totalOrdersMyr: 895, avatar: nsImage("portrait", 11), lifecycle: "regular", heat: "warm", source: "Walk-in", predictedNextMyr: 140, orderCount: 9, phone: "+60 12-556 4432" },
  { id: "ct-13", name: "Muthu Krishnan", channels: ["whatsapp"], lastSeen: "2026-05-30", tags: ["wholesale"], doNotDisturb: false, totalOrdersMyr: 3120, avatar: nsImage("portrait", 12), lifecycle: "dormant", heat: "cold", source: "Referral", predictedNextMyr: 0, orderCount: 18, phone: "+60 13-889 2200", note: "Big wholesale account gone quiet 6 weeks — worth a nudge." },
  { id: "ct-14", name: "Aisyah Karim", channels: ["instagram", "whatsapp"], lastSeen: "2026-07-06", tags: ["regular"], doNotDisturb: false, totalOrdersMyr: 520, avatar: nsImage("portrait", 13), lifecycle: "regular", heat: "hot", source: "Instagram", predictedNextMyr: 80, orderCount: 7, phone: "+60 18-220 7788" },
  { id: "ct-15", name: "Ethan Teoh", channels: ["facebook"], lastSeen: "2026-06-19", tags: [], doNotDisturb: true, totalOrdersMyr: 130, avatar: nsImage("portrait", 14), lifecycle: "dormant", heat: "cold", source: "Facebook", predictedNextMyr: 0, orderCount: 2 },
  { id: "ct-16", name: "Zulaikha Hassan", channels: ["whatsapp"], lastSeen: "2026-07-07", tags: ["office orders", "vip"], doNotDisturb: false, totalOrdersMyr: 1240, avatar: nsImage("portrait", 15), lifecycle: "vip", heat: "hot", source: "Weekday office orders", predictedNextMyr: 210, orderCount: 11, phone: "+60 19-771 3345" },
  { id: "ct-17", name: "Rajesh Pillai", channels: ["instagram"], lastSeen: "2026-07-02", tags: ["new"], doNotDisturb: false, totalOrdersMyr: 96, avatar: nsImage("portrait", 16), lifecycle: "new", heat: "warm", source: "Instagram · CTWA ad", predictedNextMyr: 96, orderCount: 1 },
  { id: "ct-18", name: "Chloe Tan", channels: ["whatsapp", "instagram"], lastSeen: "2026-07-04", tags: ["regular"], doNotDisturb: false, totalOrdersMyr: 680, avatar: nsImage("portrait", 17), lifecycle: "regular", heat: "warm", source: "Walk-in", predictedNextMyr: 110, orderCount: 8, phone: "+60 12-443 9987" },
  { id: "ct-19", name: "Firdaus Iskandar", channels: ["facebook", "whatsapp"], lastSeen: "2026-06-15", tags: ["catering"], doNotDisturb: false, totalOrdersMyr: 2260, avatar: nsImage("portrait", 18), lifecycle: "dormant", heat: "cold", source: "Catering enquiry", predictedNextMyr: 600, orderCount: 7, phone: "+60 16-220 5511", note: "Office party caterer — quiet since last raya." },
  { id: "ct-20", name: "Divya Suresh", channels: ["instagram"], lastSeen: "2026-07-07", tags: ["new", "office orders"], doNotDisturb: false, totalOrdersMyr: 155, avatar: nsImage("portrait", 19), lifecycle: "new", heat: "hot", source: "Instagram · Merdeka week bakes", predictedNextMyr: 155, orderCount: 2 },
  { id: "ct-21", name: "Marcus Lee", channels: ["whatsapp"], lastSeen: "2026-06-26", tags: ["regular"], doNotDisturb: false, totalOrdersMyr: 470, avatar: nsImage("portrait", 20), lifecycle: "active", heat: "warm", source: "Referral", predictedNextMyr: 85, orderCount: 6, phone: "+60 17-334 2091" },
  { id: "ct-22", name: "Noraini Yusof", channels: ["whatsapp", "facebook"], lastSeen: "2026-07-05", tags: ["vip"], doNotDisturb: false, totalOrdersMyr: 1610, avatar: nsImage("portrait", 21), lifecycle: "vip", heat: "hot", source: "Walk-in", predictedNextMyr: 260, orderCount: 13, phone: "+60 13-556 7742", note: "Family bulk orders every fortnight." },
];

// ── 对话 ────────────────────────────────────────────────────────────────────
export interface NsMessage {
  id: string;
  from: "customer" | "owner" | "otto";
  text: string;
  at: string;
  /** 图片消息(取自 NS_IMAGES;对话气泡渲染图片 + text 当 caption)。F1 世界圣经补。 */
  imageUrl?: string;
}

export interface NsConversation {
  id: string;
  contactId: string;
  channel: "whatsapp" | "instagram" | "facebook";
  subject: string;
  unread: boolean;
  aiHandled: boolean;
  messages: NsMessage[];
  // ── F1 世界圣经补(全部可选:store 内联构造的对话不需要它们) ─────────────────
  /** 对话状态(收件箱清单角标:未答清单/超时读它) */
  state?: "open" | "otto-handling" | "waiting-owner" | "resolved" | "overdue";
  /** CTWA / 广告进线来源(收件箱溯源 chip:「来自 Merdeka box 广告」) */
  source?: { via: "ctwa" | "comment" | "organic"; label: string; campaignId?: string };
  /** 关联 campaign(D1:对话切片自动长在 campaign 上;campaign 详情「对话」tab 过滤) */
  campaignId?: string;
  /** 最近一条客户消息距今(收件箱排序 / 超时判断的展示串) */
  waitingFor?: string;
}

/**
 * 对话 14 条(WhatsApp / IG / FB 混合)。覆盖:在聊、Otto 接管中、已解决、超时未答、
 * 公开评论转私信、CTWA 广告进线带来源、图片消息样例。cv-01..cv-03 是既有稳定 id
 * (campaign 输出引用),补可选字段;cv-04+ 新增。
 */
export const NS_CONVERSATIONS: NsConversation[] = [
  {
    id: "cv-01", contactId: "ct-01", channel: "whatsapp", subject: "Office order for Friday", unread: true, aiHandled: true, state: "otto-handling", campaignId: "camp-office-01", waitingFor: "3m",
    messages: [
      { id: "m-01", from: "customer", text: "Hi, can I order 20 croissants for Friday 9am pickup?", at: "2026-07-07T08:12:00+08:00" },
      { id: "m-02", from: "otto", text: "Yes we can do 20 kaya butter croissants for Friday 9am. That comes to RM170. Shall I confirm the order?", at: "2026-07-07T08:12:40+08:00" },
      { id: "m-03", from: "customer", text: "Confirm please, thank you!", at: "2026-07-07T08:15:00+08:00" },
    ],
  },
  {
    id: "cv-02", contactId: "ct-03", channel: "instagram", subject: "Pandan cake availability", unread: true, aiHandled: false, state: "waiting-owner", waitingFor: "1h",
    messages: [
      { id: "m-04", from: "customer", text: "Is the pandan gula melaka cake halal certified?", at: "2026-07-07T10:02:00+08:00" },
    ],
  },
  {
    id: "cv-03", contactId: "ct-02", channel: "whatsapp", subject: "Wholesale restock", unread: false, aiHandled: false, state: "resolved",
    messages: [
      { id: "m-05", from: "customer", text: "Boss, next week same order, 60 boxes.", at: "2026-07-05T14:20:00+08:00" },
      { id: "m-06", from: "owner", text: "Can do. Delivery Tuesday morning as usual.", at: "2026-07-05T14:45:00+08:00" },
    ],
  },
  {
    id: "cv-04", contactId: "ct-07", channel: "instagram", subject: "Merdeka gift box enquiry", unread: true, aiHandled: true, state: "otto-handling",
    source: { via: "ctwa", label: "From the Merdeka box ad", campaignId: "camp-merdeka-01" }, campaignId: "camp-merdeka-01", waitingFor: "8m",
    messages: [
      { id: "m-07", from: "customer", text: "Saw your Merdeka box ad — how much and can you deliver to Ampang?", at: "2026-07-07T13:20:00+08:00" },
      { id: "m-08", from: "otto", text: "Hi Siti! The Merdeka gift box is RM68 (12 pieces). We deliver to Ampang for RM8, free over RM120. Want me to reserve one?", at: "2026-07-07T13:20:35+08:00" },
    ],
  },
  {
    id: "cv-05", contactId: "ct-09", channel: "whatsapp", subject: "Boardroom breakfast — photo", unread: true, aiHandled: false, state: "waiting-owner", waitingFor: "22m",
    messages: [
      { id: "m-09", from: "customer", text: "Morning! Can you do this spread for 15 pax next Wednesday?", at: "2026-07-07T09:05:00+08:00", imageUrl: nsImage("storefront", 1) },
      { id: "m-10", from: "customer", text: "Budget around RM300.", at: "2026-07-07T09:05:30+08:00" },
    ],
  },
  {
    id: "cv-06", contactId: "ct-16", channel: "whatsapp", subject: "Weekly office croissants", unread: false, aiHandled: true, state: "otto-handling", campaignId: "camp-office-01",
    messages: [
      { id: "m-11", from: "customer", text: "Same as last week please — 24 croissants Thursday 8:30am.", at: "2026-07-07T16:40:00+08:00" },
      { id: "m-12", from: "otto", text: "Got it Zulaikha — 24 kaya butter croissants, Thursday 8:30am pickup, RM204. Confirmed 🥐", at: "2026-07-07T16:40:20+08:00" },
      { id: "m-13", from: "customer", text: "Perfect, thanks!", at: "2026-07-07T16:41:10+08:00" },
    ],
  },
  {
    id: "cv-07", contactId: "ct-13", channel: "whatsapp", subject: "Haven't ordered in a while", unread: false, aiHandled: false, state: "overdue", waitingFor: "3d",
    messages: [
      { id: "m-14", from: "customer", text: "Hi, still doing the wholesale cookie boxes?", at: "2026-07-04T11:00:00+08:00" },
    ],
  },
  {
    id: "cv-08", contactId: "ct-20", channel: "instagram", subject: "First time — what to try?", unread: true, aiHandled: true, state: "otto-handling",
    source: { via: "comment", label: "Moved from a post comment" }, waitingFor: "15m",
    messages: [
      { id: "m-15", from: "customer", text: "Everything looks so good! What should I try first?", at: "2026-07-07T14:10:00+08:00" },
      { id: "m-16", from: "otto", text: "Welcome Divya! Our best sellers are the pandan gula melaka cake, kaya butter croissant, and kopi-O tiramisu. Want me to put together a starter box?", at: "2026-07-07T14:10:40+08:00" },
    ],
  },
  {
    id: "cv-09", contactId: "ct-04", channel: "facebook", subject: "Catering — 4 platters", unread: false, aiHandled: false, state: "resolved",
    messages: [
      { id: "m-17", from: "customer", text: "Need 4 platters for an office event on the 30th.", at: "2026-06-28T10:20:00+08:00" },
      { id: "m-18", from: "owner", text: "Sure Jason — 4 assorted platters, RM1,450 total, delivered 9am on the 30th. Sent you the quote.", at: "2026-06-28T10:45:00+08:00" },
      { id: "m-19", from: "customer", text: "Approved, see you then.", at: "2026-06-28T11:02:00+08:00" },
    ],
  },
  {
    id: "cv-10", contactId: "ct-06", channel: "whatsapp", subject: "3pm office pickup", unread: false, aiHandled: true, state: "otto-handling", campaignId: "camp-office-01",
    messages: [
      { id: "m-20", from: "customer", text: "Can I grab 10 tiramisu cups at 3pm today?", at: "2026-07-07T12:30:00+08:00" },
      { id: "m-21", from: "otto", text: "Yes Arjun — 10 kopi-O tiramisu cups, RM140, ready for 3pm pickup. See you then!", at: "2026-07-07T12:30:25+08:00" },
    ],
  },
  {
    id: "cv-11", contactId: "ct-17", channel: "instagram", subject: "Croffle launch date?", unread: true, aiHandled: true, state: "otto-handling",
    source: { via: "ctwa", label: "From the croffle teaser ad", campaignId: "camp-croffle-01" }, campaignId: "camp-croffle-01", waitingFor: "5m",
    messages: [
      { id: "m-22", from: "customer", text: "When does the matcha croffle drop??", at: "2026-07-07T15:50:00+08:00" },
      { id: "m-23", from: "otto", text: "Launching July 22! First 50 orders get a free kopi. Want me to add you to the early list?", at: "2026-07-07T15:50:30+08:00" },
    ],
  },
  {
    id: "cv-12", contactId: "ct-14", channel: "whatsapp", subject: "Birthday cake photo", unread: true, aiHandled: false, state: "waiting-owner", waitingFor: "40m",
    messages: [
      { id: "m-24", from: "customer", text: "Can you make a cake like this for Saturday?", at: "2026-07-07T11:15:00+08:00", imageUrl: nsImage("bakery", 5) },
      { id: "m-25", from: "customer", text: "For 10 people 🎂", at: "2026-07-07T11:15:40+08:00" },
    ],
  },
  {
    id: "cv-13", contactId: "ct-10", channel: "whatsapp", subject: "Corporate catering follow-up", unread: false, aiHandled: false, state: "overdue", waitingFor: "5d",
    messages: [
      { id: "m-26", from: "customer", text: "Following up on the quote for our June event — still valid?", at: "2026-07-02T09:30:00+08:00" },
    ],
  },
  {
    id: "cv-14", contactId: "ct-22", channel: "facebook", subject: "Fortnightly family order", unread: false, aiHandled: true, state: "otto-handling",
    messages: [
      { id: "m-27", from: "customer", text: "Usual fortnightly box please, deliver Saturday.", at: "2026-07-05T17:20:00+08:00" },
      { id: "m-28", from: "otto", text: "On it Noraini — your usual family box, RM124, Saturday delivery. Confirmed 🙌", at: "2026-07-05T17:20:30+08:00" },
    ],
  },
];

// ── 分析序列(28 天,固定种子确定性生成) ──────────────────────────────────
export interface NsSeriesPoint {
  date: string;
  value: number;
}

function genSeries(seed: number, days: number, base: number, swing: number, trend: number): NsSeriesPoint[] {
  const rand = mulberry32(seed);
  const out: NsSeriesPoint[] = [];
  // fixed anchor: 2026-06-09 + i days → ends 2026-07-06
  const anchor = Date.UTC(2026, 5, 9);
  for (let i = 0; i < days; i++) {
    const d = new Date(anchor + i * 86400000);
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6 ? 1.25 : 1;
    const value = Math.round((base + i * trend + (rand() - 0.5) * swing) * weekend);
    out.push({ date: d.toISOString().slice(0, 10), value: Math.max(0, value) });
  }
  return out;
}

export const NS_ANALYTICS = {
  period: "2026-06-09 to 2026-07-06",
  reach: genSeries(1101, 28, 1850, 700, 22),
  engagement: genSeries(1102, 28, 240, 120, 3),
  adSpendMyr: genSeries(1103, 28, 45, 20, 0.4),
  kpis: [
    { label: "Reach", value: "68.4K", delta: { dir: "up" as const, text: "▲ 18%" } },
    { label: "Engagement", value: "7,920", delta: { dir: "up" as const, text: "▲ 6%" } },
    { label: "Link clicks", value: "1,240", delta: { dir: "down" as const, text: "▼ 4%" } },
    { label: "New followers", value: "486", delta: { dir: "flat" as const, text: "· flat" } },
  ],
  insight: "Reach climbed 18% this period. Your Sunday croissant reels drove most of it.",
};

// ── Credit 流水 ─────────────────────────────────────────────────────────────
export interface NsCreditRow {
  id: string;
  at: string;
  category: "Otto chat" | "Image" | "Video" | "Search" | "Top up";
  description: string;
  credits: number; // 负 = 消费,正 = 充值
}

export const NS_CREDIT_LEDGER: NsCreditRow[] = [
  { id: "cl-01", at: "2026-07-07T09:14:00+08:00", category: "Video", description: "Croissant fold reel · 6s 720p", credits: -40 },
  { id: "cl-02", at: "2026-07-07T09:02:00+08:00", category: "Image", description: "Merdeka box hero shot · 4 variants", credits: -12 },
  { id: "cl-03", at: "2026-07-06T16:40:00+08:00", category: "Otto chat", description: "Campaign planning session", credits: -6 },
  { id: "cl-04", at: "2026-07-06T11:20:00+08:00", category: "Search", description: "Merdeka trends research", credits: -4 },
  { id: "cl-05", at: "2026-07-05T10:00:00+08:00", category: "Top up", description: "Top up · RM120", credits: 1200 },
  { id: "cl-06", at: "2026-07-04T15:30:00+08:00", category: "Image", description: "Kopi tiramisu menu card", credits: -8 },
  { id: "cl-07", at: "2026-07-07T14:05:00+08:00", category: "Image", description: "Croffle hero · matcha", credits: -12 },
  { id: "cl-08", at: "2026-07-07T08:40:00+08:00", category: "Otto chat", description: "Inbox replies · 6 order questions", credits: -6 },
  { id: "cl-09", at: "2026-07-06T19:20:00+08:00", category: "Video", description: "Packing day reel · 8s", credits: -40 },
  { id: "cl-10", at: "2026-07-06T10:10:00+08:00", category: "Image", description: "Croffle variants · batch of 2", credits: -24 },
  { id: "cl-11", at: "2026-07-05T16:00:00+08:00", category: "Search", description: "Croffle trend scan · TikTok MY", credits: -4 },
  { id: "cl-12", at: "2026-07-04T09:30:00+08:00", category: "Video", description: "Office lunch box reel · 6s", credits: -40 },
  { id: "cl-13", at: "2026-07-03T11:45:00+08:00", category: "Image", description: "Weekday lunch set · 3 variants", credits: -24 },
  { id: "cl-14", at: "2026-07-02T15:20:00+08:00", category: "Otto chat", description: "Analytics readout · weekly", credits: -6 },
  { id: "cl-15", at: "2026-07-01T08:00:00+08:00", category: "Top up", description: "Top up · RM50", credits: 500 },
  { id: "cl-16", at: "2026-06-30T13:10:00+08:00", category: "Image", description: "Macaron colour set", credits: -8 },
  { id: "cl-17", at: "2026-06-28T10:00:00+08:00", category: "Video", description: "Bread proofing timelapse", credits: -40 },
  { id: "cl-18", at: "2026-06-27T09:15:00+08:00", category: "Search", description: "Office order audience research", credits: -4 },
  { id: "cl-19", at: "2026-06-25T14:30:00+08:00", category: "Image", description: "Shopfront morning shot", credits: -8 },
  { id: "cl-20", at: "2026-06-24T11:00:00+08:00", category: "Otto chat", description: "Weekly plan · content calendar", credits: -6 },
];

// ── 生成产物卡(Library / My Stuff / Canvas 共用) ──────────────────────────
export interface NsAsset {
  id: string;
  title: string;
  kind: "image" | "video" | "storyboard";
  createdAt: string;
  thumb: string;
  credits: number;
  byOtto: boolean;
  status: "ready" | "generating" | "failed";
  // ── F1 世界圣经补(全部可选) ──────────────────────────────────────────────
  /** 关联 campaign(D1:画布产物可升格挂进 campaign;资产卡显示归属) */
  campaignId?: string;
  /** 生成 prompt(asset-viewer / 谱系读它;英文,生成层口径) */
  prompt?: string;
  /** 画幅(1:1 / 9:16 / 4:5 / 16:9;工厂矩阵 + viewer 读它) */
  aspectRatio?: "1:1" | "9:16" | "4:5" | "16:9";
  /** 失败可重试(status="failed" 时;工厂/库「重试」按钮读它) */
  retryable?: boolean;
  /** 失败原因(status="failed") */
  failReason?: string;
  /** 工厂批次 id(同批变体归组;factory 出片间矩阵读它) */
  batchId?: string;
}

/**
 * 资产 / 生成历史 42 条(图 / 视频 / 分镜 / 工厂批次,含失败可重试样例)。thumb 全部取自
 * NS_IMAGES;as-01..as-06 是既有稳定 id(campaign 输出 / 首页引用),补真图 + 可选字段。
 */
export const NS_ASSETS: NsAsset[] = [
  { id: "as-01", title: "Merdeka box hero shot", kind: "image", createdAt: "2026-07-07", thumb: nsImage("campaign", 0), credits: 12, byOtto: true, status: "ready", campaignId: "camp-merdeka-01", prompt: "Festive Merdeka gift box of assorted bakes, warm daylight, top-down", aspectRatio: "1:1" },
  { id: "as-02", title: "Croissant fold reel", kind: "video", createdAt: "2026-07-07", thumb: nsImage("storefront", 4), credits: 40, byOtto: true, status: "ready", prompt: "Baker folding croissant dough at dawn, cinematic slow motion", aspectRatio: "9:16" },
  { id: "as-03", title: "Pandan cake close-up", kind: "image", createdAt: "2026-07-06", thumb: nsImage("bakery", 5), credits: 8, byOtto: false, status: "ready", prompt: "Slice of pandan gula melaka cake, macro, soft light", aspectRatio: "1:1" },
  { id: "as-04", title: "Weekend promo storyboard", kind: "storyboard", createdAt: "2026-07-06", thumb: nsImage("storefront", 0), credits: 0, byOtto: true, status: "ready" },
  { id: "as-05", title: "Kopi tiramisu menu card", kind: "image", createdAt: "2026-07-04", thumb: nsImage("bakery", 10), credits: 8, byOtto: false, status: "ready", campaignId: "camp-office-01", prompt: "Kopi-O tiramisu cups menu card, kopitiam styling", aspectRatio: "4:5" },
  { id: "as-06", title: "Office order teaser", kind: "video", createdAt: "2026-07-08", thumb: nsImage("storefront", 1), credits: 40, byOtto: true, status: "generating", campaignId: "camp-office-01", prompt: "POV office pastry delivery arriving at 3pm", aspectRatio: "9:16" },
  // ── Merdeka campaign 批次(工厂矩阵:同批变体) ──────────────────────────────
  { id: "as-07", title: "Merdeka box · variant A", kind: "image", createdAt: "2026-07-07", thumb: nsImage("campaign", 2), credits: 12, byOtto: true, status: "ready", campaignId: "camp-merdeka-01", batchId: "batch-merdeka", aspectRatio: "4:5", prompt: "Merdeka gift box, flag ribbon, studio light" },
  { id: "as-08", title: "Merdeka box · variant B", kind: "image", createdAt: "2026-07-07", thumb: nsImage("campaign", 3), credits: 12, byOtto: true, status: "ready", campaignId: "camp-merdeka-01", batchId: "batch-merdeka", aspectRatio: "4:5", prompt: "Merdeka gift box, hands holding, lifestyle" },
  { id: "as-09", title: "Merdeka box · variant C", kind: "image", createdAt: "2026-07-07", thumb: nsImage("campaign", 4), credits: 12, byOtto: true, status: "ready", campaignId: "camp-merdeka-01", batchId: "batch-merdeka", aspectRatio: "4:5", prompt: "Merdeka gift box on marble, top-down" },
  { id: "as-10", title: "Merdeka box · variant D", kind: "image", createdAt: "2026-07-07", thumb: nsImage("campaign", 5), credits: 12, byOtto: true, status: "failed", campaignId: "camp-merdeka-01", batchId: "batch-merdeka", aspectRatio: "4:5", retryable: true, failReason: "Generation timed out — safe to retry", prompt: "Merdeka gift box, dramatic side light" },
  { id: "as-11", title: "Merdeka packing day reel", kind: "video", createdAt: "2026-07-06", thumb: nsImage("storefront", 12), credits: 40, byOtto: true, status: "ready", campaignId: "camp-merdeka-01", aspectRatio: "9:16", prompt: "Packing gift boxes at the bakery, hands and ribbon" },
  { id: "as-12", title: "Merdeka carousel storyboard", kind: "storyboard", createdAt: "2026-07-06", thumb: nsImage("campaign", 1), credits: 0, byOtto: true, status: "ready", campaignId: "camp-merdeka-01" },
  // ── Croffle 上市批次(DRAFT campaign) ──────────────────────────────────────
  { id: "as-13", title: "Matcha croffle · hero", kind: "image", createdAt: "2026-07-07", thumb: nsImage("bakery", 2), credits: 12, byOtto: true, status: "ready", campaignId: "camp-croffle-01", aspectRatio: "1:1", prompt: "Matcha croffle, dusted, gula melaka drizzle, macro" },
  { id: "as-14", title: "Croffle assembly reel", kind: "video", createdAt: "2026-07-08", thumb: nsImage("storefront", 12), credits: 40, byOtto: true, status: "generating", campaignId: "camp-croffle-01", aspectRatio: "9:16", prompt: "Croffle assembly line, ASMR, waffle iron press" },
  { id: "as-15", title: "Croffle launch storyboard", kind: "storyboard", createdAt: "2026-07-08", thumb: nsImage("bakery", 2), credits: 0, byOtto: true, status: "ready", campaignId: "camp-croffle-01" },
  { id: "as-16", title: "Croffle · variant A", kind: "image", createdAt: "2026-07-08", thumb: nsImage("bakery", 15), credits: 12, byOtto: true, status: "ready", campaignId: "camp-croffle-01", batchId: "batch-croffle", aspectRatio: "4:5" },
  { id: "as-17", title: "Croffle · variant B", kind: "image", createdAt: "2026-07-08", thumb: nsImage("bakery", 22), credits: 12, byOtto: true, status: "ready", campaignId: "camp-croffle-01", batchId: "batch-croffle", aspectRatio: "4:5" },
  // ── Raya campaign(DONE,历史资产) ──────────────────────────────────────────
  { id: "as-18", title: "Raya box lid reveal", kind: "video", createdAt: "2026-03-02", thumb: nsImage("campaign", 3), credits: 40, byOtto: true, status: "ready", campaignId: "camp-raya-01", aspectRatio: "9:16", prompt: "Raya cookie gift box lid reveal, festive" },
  { id: "as-19", title: "Raya cookie flat lay", kind: "image", createdAt: "2026-02-26", thumb: nsImage("bakery", 20), credits: 12, byOtto: false, status: "ready", campaignId: "camp-raya-01", aspectRatio: "1:1", prompt: "Assorted raya cookies flat lay, top-down" },
  { id: "as-20", title: "Raya early-bird card", kind: "image", createdAt: "2026-02-24", thumb: nsImage("bakery", 24), credits: 8, byOtto: true, status: "ready", campaignId: "camp-raya-01", aspectRatio: "4:5" },
  { id: "as-21", title: "Raya last-call story", kind: "image", createdAt: "2026-03-18", thumb: nsImage("bakery", 25), credits: 8, byOtto: true, status: "ready", campaignId: "camp-raya-01", aspectRatio: "9:16" },
  // ── 日常出品(Studio 随手创作,不挂 campaign) ──────────────────────────────
  { id: "as-22", title: "Kaya croissant macro", kind: "image", createdAt: "2026-07-05", thumb: nsImage("bakery", 1), credits: 8, byOtto: false, status: "ready", aspectRatio: "1:1" },
  { id: "as-23", title: "Milo dinosaur cookie", kind: "image", createdAt: "2026-07-05", thumb: nsImage("bakery", 7), credits: 8, byOtto: true, status: "ready", aspectRatio: "1:1" },
  { id: "as-24", title: "Onde-onde cream puff", kind: "image", createdAt: "2026-07-04", thumb: nsImage("bakery", 12), credits: 8, byOtto: false, status: "ready", aspectRatio: "1:1" },
  { id: "as-25", title: "Sunday brew flat lay", kind: "image", createdAt: "2026-07-05", thumb: nsImage("storefront", 5), credits: 8, byOtto: true, status: "ready", aspectRatio: "4:5" },
  { id: "as-26", title: "Shopfront morning shot", kind: "image", createdAt: "2026-07-03", thumb: nsImage("storefront", 8), credits: 8, byOtto: false, status: "ready", aspectRatio: "16:9" },
  { id: "as-27", title: "Team behind the counter", kind: "image", createdAt: "2026-07-03", thumb: nsImage("storefront", 3), credits: 8, byOtto: true, status: "ready", aspectRatio: "4:5" },
  { id: "as-28", title: "Bread proofing timelapse", kind: "video", createdAt: "2026-07-02", thumb: nsImage("storefront", 12), credits: 40, byOtto: true, status: "ready", aspectRatio: "9:16" },
  { id: "as-29", title: "Cupcake tower", kind: "image", createdAt: "2026-07-01", thumb: nsImage("bakery", 14), credits: 8, byOtto: false, status: "ready", aspectRatio: "1:1" },
  { id: "as-30", title: "Macaron colour set", kind: "image", createdAt: "2026-06-30", thumb: nsImage("bakery", 10), credits: 8, byOtto: true, status: "ready", aspectRatio: "1:1" },
  { id: "as-31", title: "Donut wall", kind: "image", createdAt: "2026-06-29", thumb: nsImage("bakery", 3), credits: 8, byOtto: false, status: "ready", aspectRatio: "16:9" },
  { id: "as-32", title: "Cinnamon roll close-up", kind: "image", createdAt: "2026-06-28", thumb: nsImage("bakery", 6), credits: 8, byOtto: true, status: "ready", aspectRatio: "1:1" },
  { id: "as-33", title: "Weekday lunch storyboard", kind: "storyboard", createdAt: "2026-06-28", thumb: nsImage("storefront", 1), credits: 0, byOtto: true, status: "ready", campaignId: "camp-office-01" },
  { id: "as-34", title: "Office lunch box reel", kind: "video", createdAt: "2026-06-27", thumb: nsImage("storefront", 1), credits: 40, byOtto: true, status: "ready", campaignId: "camp-office-01", aspectRatio: "9:16" },
  { id: "as-35", title: "Cafe interior mood", kind: "image", createdAt: "2026-06-26", thumb: nsImage("storefront", 2), credits: 8, byOtto: false, status: "ready", aspectRatio: "16:9" },
  { id: "as-36", title: "Kopitiam marble table", kind: "image", createdAt: "2026-06-25", thumb: nsImage("storefront", 6), credits: 8, byOtto: true, status: "ready", aspectRatio: "4:5" },
  { id: "as-37", title: "Fresh loaves rack", kind: "image", createdAt: "2026-06-24", thumb: nsImage("bakery", 0), credits: 8, byOtto: false, status: "ready", aspectRatio: "1:1" },
  { id: "as-38", title: "Dessert of the week", kind: "image", createdAt: "2026-06-23", thumb: nsImage("bakery", 21), credits: 8, byOtto: true, status: "ready", aspectRatio: "1:1" },
  { id: "as-39", title: "Waffle breakfast set", kind: "image", createdAt: "2026-06-22", thumb: nsImage("bakery", 18), credits: 8, byOtto: false, status: "ready", aspectRatio: "4:5" },
  { id: "as-40", title: "Behind the bakery reel", kind: "video", createdAt: "2026-06-21", thumb: nsImage("storefront", 12), credits: 40, byOtto: true, status: "failed", retryable: true, failReason: "Model queue full — retry anytime", aspectRatio: "9:16" },
  { id: "as-41", title: "Menu refresh flat lay", kind: "image", createdAt: "2026-06-20", thumb: nsImage("bakery", 11), credits: 8, byOtto: true, status: "ready", aspectRatio: "1:1" },
  { id: "as-42", title: "Coffee art close-up", kind: "image", createdAt: "2026-06-19", thumb: nsImage("storefront", 11), credits: 8, byOtto: false, status: "ready", aspectRatio: "1:1" },
];

// ── Otto 动作历史(dock 共用) ──────────────────────────────────────────────
export interface NsOttoAction {
  id: string;
  text: string;
  at: string; // 显示用相对时间
  href?: string;
}

export const NS_OTTO_ACTIONS: NsOttoAction[] = [
  { id: "oa-01", text: "Generated Merdeka box hero shot", at: "2m ago", href: "/northstar/assets/library" },
  { id: "oa-02", text: "Drafted 7 campaign posts for review", at: "18m ago", href: "/northstar/campaign/calendar" },
  { id: "oa-03", text: "Answered Mei Ling's order question", at: "1h ago", href: "/northstar/inbox/shared" },
  { id: "oa-04", text: "Pulled Merdeka trend research", at: "3h ago", href: "/northstar/campaign/trends" },
  { id: "oa-05", text: "Scheduled Tuesday croissant post", at: "yesterday", href: "/northstar/schedule/plan" },
];

// ── 常用叙述条步骤(演示用) ────────────────────────────────────────────────
export const NS_NARRATION_STEPS = [
  "Reading your brand memory…",
  "Drafting campaign posts…",
  "Estimating credits…",
  "Laying out the calendar…",
] as const;

/* ═══════════════════════════════════════════════════════════════════════════
 * F1 世界圣经扩容(ENDGAME-CITY-ORDER §一)—— 以下为世界圣经的新增权威源。
 * 既有导出保持不动;新导出供各区 read(D1 campaign 容器 / D2 Otto 单流 / D3 research 燃料)。
 * ═══════════════════════════════════════════════════════════════════════════ */

// ── NS_CAMPAIGNS:三个 campaign 三状态(D1 唯一「事」容器的世界圣经源) ──────────
export type NsCampaignStatus = "DRAFT" | "ACTIVE" | "DONE";

/** campaign 一句话生命周期的每个阶段(详情页「总览」时间线读它)。 */
export interface NsCampaignPhase {
  key: "goal" | "research" | "proposal" | "content" | "schedule" | "results";
  label: string;
  done: boolean;
}

/** DONE campaign 的效果回流(详情页「结果」tab + 喂下一次提案的 learnings)。 */
export interface NsCampaignResult {
  headline: string;
  /** 归因订单额(MYR;ROI 一行结论从此派生,不再硬编码字面量) */
  attributedRevenueMyr: number;
  kpis: { label: string; value: string; delta?: string }[];
  learnings: string[];
}

export interface NsCampaignSummary {
  id: string;
  name: string;
  status: NsCampaignStatus;
  goal: string;
  /** 目标进度(详情页顶栏 + 列表卡进度条) */
  goalProgress: { label: string; current: number; target: number };
  period: string;
  budgetCredits: number;
  spentCredits: number;
  platforms: NsCampaignEntry["platform"][];
  /** 主视觉(取自 NS_IMAGES.campaign;列表卡 + 详情页头图) */
  hero: string;
  /** 引用的 research(D3:燃料;详情「资料」tab 读它,指向 NS_TRENDS) */
  trendIds: string[];
  phases: NsCampaignPhase[];
  /** DONE 才有:完整效果 + learnings(喂下一次提案) */
  result?: NsCampaignResult;
}

/**
 * 三个 canonical campaign(走城看全生命周期):
 * - Merdeka Week Bakes = ACTIVE(部分已发有结果、部分排期、待批)
 * - Raya Open House 礼盒 = DONE(完整效果 + 复盘 learnings)
 * - Matcha croffle 上市 = DRAFT(提案刚出、日历待批、预估总价)
 * 另保留 office / mooncake(既有页面引用的旁支)在 campaign/_data.ts,本表只立三主线。
 */
export const NS_CAMPAIGNS: NsCampaignSummary[] = [
  {
    id: "camp-merdeka-01",
    name: "Merdeka week bakes",
    status: "ACTIVE",
    goal: "Drive pre-orders for the Merdeka gift box",
    goalProgress: { label: "Gift box pre-orders", current: 38, target: 100 },
    period: "Aug 24 to Aug 31, 2026",
    budgetCredits: 320,
    spentCredits: 104,
    platforms: ["instagram", "facebook", "tiktok"],
    hero: nsImage("campaign", 0),
    trendIds: ["ts-01", "ts-02"],
    phases: [
      { key: "goal", label: "Goal set", done: true },
      { key: "research", label: "Research pulled", done: true },
      { key: "proposal", label: "Proposal approved", done: true },
      { key: "content", label: "Content generating", done: true },
      { key: "schedule", label: "Scheduling", done: false },
      { key: "results", label: "Results", done: false },
    ],
  },
  {
    id: "camp-raya-01",
    name: "Raya open house gift boxes",
    status: "DONE",
    goal: "Sell out 300 Raya cookie gift boxes before Hari Raya",
    goalProgress: { label: "Gift boxes sold", current: 312, target: 300 },
    period: "Feb 24 to Mar 20, 2026",
    budgetCredits: 380,
    spentCredits: 362,
    platforms: ["instagram", "facebook"],
    hero: nsImage("campaign", 3),
    trendIds: ["ts-05"],
    phases: [
      { key: "goal", label: "Goal set", done: true },
      { key: "research", label: "Research pulled", done: true },
      { key: "proposal", label: "Proposal approved", done: true },
      { key: "content", label: "Content made", done: true },
      { key: "schedule", label: "Scheduled & posted", done: true },
      { key: "results", label: "Results in", done: true },
    ],
    result: {
      headline: "Sold out 3 days early — 312 boxes, RM21,216 in orders",
      attributedRevenueMyr: 21216,
      kpis: [
        { label: "Boxes sold", value: "312", delta: "104% of goal" },
        { label: "Order value", value: "RM21,216" },
        { label: "Reach", value: "94.2K", delta: "▲ 22%" },
        { label: "Cost per order", value: "1.2 credits" },
      ],
      learnings: [
        "Early-bird framing 6 weeks out captured most volume — start the Merdeka push earlier.",
        "Unboxing reels outperformed flat lays 3:1 on saves — lead with process video.",
        "Facebook drove the corporate bulk orders; keep a B2B post in the mix.",
      ],
    },
  },
  {
    id: "camp-croffle-01",
    name: "Matcha croffle launch",
    status: "DRAFT",
    goal: "Launch the matcha croffle and build a 200-strong early list",
    goalProgress: { label: "Early list signups", current: 0, target: 200 },
    period: "Jul 22 to Aug 5, 2026",
    budgetCredits: 180,
    spentCredits: 0,
    platforms: ["instagram", "tiktok"],
    hero: nsImage("bakery", 2),
    trendIds: ["ts-03"],
    phases: [
      { key: "goal", label: "Goal set", done: true },
      { key: "research", label: "Research pulled", done: true },
      { key: "proposal", label: "Proposal ready for review", done: false },
      { key: "content", label: "Content", done: false },
      { key: "schedule", label: "Scheduling", done: false },
      { key: "results", label: "Results", done: false },
    ],
  },
];

export function campaignSummaryById(id: string): NsCampaignSummary | undefined {
  return NS_CAMPAIGNS.find((c) => c.id === id);
}

// ── NS_TRENDS:TrendSnapshot 资料库(D3 燃料;research 产出的市场记忆,可独立存在) ──
export interface NsTrendSnapshot {
  id: string;
  capturedAt: string; // ISO date
  title: string;
  summary: string;
  /** 来源引用(标题 + 域名;资料库卡显示可点来源) */
  sources: { title: string; domain: string }[];
  via: "Deep research" | "Quick search";
  /** 关联 campaign(可空:趋势可完全独立于任何 campaign 存在,D3) */
  campaignId?: string;
  /** 关键数字(资料库卡的数据点) */
  stat?: { label: string; value: string };
}

/**
 * 6 条 TrendSnapshot(Merdeka 烘焙趋势、KL 咖啡店 TikTok 趋势等)。这是 D3 的燃料:
 * 任何 campaign 引用(NS_CAMPAIGNS.trendIds),也可完全独立("这周什么在火")。
 */
export const NS_TRENDS: NsTrendSnapshot[] = [
  {
    id: "ts-01", capturedAt: "2026-07-06", via: "Deep research", campaignId: "camp-merdeka-01",
    title: "Merdeka gifting peaks Aug 24–31",
    summary: "Merdeka-themed food and gifting posts concentrate in the final week of August. Gift box unboxings outperform static product shots 2–3× on saves. Recommended pre-order window: Aug 24 to 31.",
    sources: [
      { title: "TikTok Creative Center · MY trending week 34", domain: "ads.tiktok.com" },
      { title: "Google Trends · \"merdeka gift\" Malaysia", domain: "trends.google.com" },
    ],
    stat: { label: "Peak window", value: "Aug 24–31" },
  },
  {
    id: "ts-02", capturedAt: "2026-07-06", via: "Deep research", campaignId: "camp-merdeka-01",
    title: "Office order POV videos win on TikTok MY",
    summary: "POV-style clips of office deliveries and 3pm pickups are the top-performing food format for small F&B accounts in Malaysia this month. Works best under 15 seconds with an on-screen price.",
    sources: [
      { title: "TikTok Creative Center · food category, MY", domain: "ads.tiktok.com" },
      { title: "Deep research · SEA short-video food formats", domain: "fikirtive research" },
    ],
    stat: { label: "Best length", value: "< 15s" },
  },
  {
    id: "ts-03", capturedAt: "2026-06-28", via: "Quick search", campaignId: "camp-croffle-01",
    title: "Croffle & hybrid pastries trending in KL cafes",
    summary: "Croissant-waffle hybrids and matcha-forward pastries keep climbing in KL cafe content. Launch teasers with a countdown and a first-50 incentive convert best for new SKUs.",
    sources: [
      { title: "Instagram hashtag velocity · #croffle #klcafe", domain: "instagram.com" },
      { title: "Quick search digest · 2026-06-28", domain: "fikirtive research" },
    ],
    stat: { label: "Format", value: "Croffle + matcha" },
  },
  {
    id: "ts-04", capturedAt: "2026-06-14", via: "Quick search",
    title: "Weekday pre-order posts convert best 9–10am",
    summary: "For KL office-area food businesses, pre-order CTA posts published between 9 and 10am on weekdays drive the most same-day orders. Weekend mornings favour lifestyle content over direct offers.",
    sources: [
      { title: "Meta insights export · Roti Bulan page, 90 days", domain: "facebook.com" },
      { title: "Quick search digest · 2026-06-14", domain: "fikirtive research" },
    ],
    stat: { label: "Best time", value: "9–10am" },
  },
  {
    id: "ts-05", capturedAt: "2026-05-20", via: "Deep research", campaignId: "camp-raya-01",
    title: "Raya cookie searches start 6 weeks out",
    summary: "Search interest for festive cookie gifting builds around 6 weeks ahead of Hari Raya and collapses the week after. Early-bird pre-order framing captured most of the volume for bakery accounts.",
    sources: [
      { title: "Google Trends · \"kuih raya gift\" Malaysia", domain: "trends.google.com" },
      { title: "Deep research · Raya gifting window", domain: "fikirtive research" },
    ],
    stat: { label: "Lead time", value: "6 weeks" },
  },
  {
    id: "ts-06", capturedAt: "2026-07-01", via: "Quick search",
    title: "Kopitiam nostalgia aesthetics keep rising",
    summary: "Marble tables, enamel cups and hand-written menu boards continue to gain in KL cafe content. Accounts leaning into kopitiam styling see steadier follower growth than minimal-modern styling. Independent of any single campaign — a standing brand-look cue.",
    sources: [
      { title: "Instagram hashtag velocity · #kopitiam", domain: "instagram.com" },
      { title: "Quick search digest · 2026-07-01", domain: "fikirtive research" },
    ],
    stat: { label: "Aesthetic", value: "Kopitiam" },
  },
];

export function trendSnapshotById(id: string): NsTrendSnapshot | undefined {
  return NS_TRENDS.find((t) => t.id === id);
}

// ── NS_OTTO_STREAM:Otto 全局单流历史(D2 的血;一条时间线,零线程管理) ──────────
/**
 * D2:Otto = 一条连续对话流。每条消息自动带 context chip(发生在哪个区 / 哪个 campaign)。
 * dock 小窗与 /otto 全屏 = 同一条流的两种看法;campaign 详情「对话」tab = 这条流按
 * campaignId 过滤后的视图。F2 的 store 以此为种子接管 append + 按 context 过滤。
 */
export type NsOttoZone =
  | "Home" | "Studio" | "Canvas" | "Campaign" | "Schedule" | "Inbox" | "CRM" | "Analytics" | "Assets" | "Settings";

export interface NsOttoStreamContext {
  zone: NsOttoZone;
  /** 人话标签(chip 显示;如 "Merdeka week bakes" / "Mei Ling Tan") */
  label: string;
  /** 关联 campaign(campaign 详情「对话」tab 按它过滤同一条流) */
  campaignId?: string;
  /** 深链回现场(点 chip 跳转) */
  href?: string;
}

export interface NsOttoStreamMessage {
  id: string;
  role: "otto" | "owner";
  text: string;
  /** 显示用相对时间(确定性字符串,无 Date.now) */
  at: string;
  context: NsOttoStreamContext;
}

/**
 * 跨三周 62 条(campaign 策划 / canvas 生成 / inbox 接管 / 分析解读 / 审批请求…)。
 * 时间从旧到新(index 0 = 最早;dock 显示末尾几条,/otto 全屏显示整条)。
 */
export const NS_OTTO_STREAM: NsOttoStreamMessage[] = [
  // ── 三周前:Raya 复盘 → Merdeka 启动 ────────────────────────────────────────
  { id: "os-01", role: "otto", at: "3 weeks ago", text: "Raya open house wrapped — 312 boxes sold, 104% of your goal. I saved the full readout to the campaign.", context: { zone: "Campaign", label: "Raya open house", campaignId: "camp-raya-01", href: "/northstar/campaign/list" } },
  { id: "os-02", role: "owner", at: "3 weeks ago", text: "Great. What did we learn for Merdeka?", context: { zone: "Campaign", label: "Raya open house", campaignId: "camp-raya-01" } },
  { id: "os-03", role: "otto", at: "3 weeks ago", text: "Three things: start earlier (6 weeks out), lead with unboxing reels, keep one B2B post for corporate bulk. Want me to open a Merdeka campaign with those baked in?", context: { zone: "Campaign", label: "Raya open house", campaignId: "camp-raya-01" } },
  { id: "os-04", role: "owner", at: "3 weeks ago", text: "Yes, do it.", context: { zone: "Campaign", label: "Merdeka week bakes", campaignId: "camp-merdeka-01" } },
  { id: "os-05", role: "otto", at: "3 weeks ago", text: "Opened Merdeka week bakes. Goal set to 100 gift box pre-orders, Aug 24–31. I'll pull fresh trends next.", context: { zone: "Campaign", label: "Merdeka week bakes", campaignId: "camp-merdeka-01", href: "/northstar/campaign/list" } },
  { id: "os-06", role: "otto", at: "3 weeks ago", text: "Trends in: Merdeka gifting peaks Aug 24–31, unboxings beat flat lays 2–3× on saves. Saved 2 snapshots to the campaign's research.", context: { zone: "Campaign", label: "Merdeka trends", campaignId: "camp-merdeka-01", href: "/northstar/campaign/trends" } },
  // ── 两周前:提案 + 内容 ────────────────────────────────────────────────────
  { id: "os-07", role: "owner", at: "2 weeks ago", text: "Draft the proposal.", context: { zone: "Campaign", label: "Merdeka week bakes", campaignId: "camp-merdeka-01" } },
  { id: "os-08", role: "otto", at: "2 weeks ago", text: "Proposal ready: 7 posts across IG, FB, TikTok, ~320 credit budget, one rest day Aug 29. Every post is a draft until you approve.", context: { zone: "Campaign", label: "Merdeka proposal", campaignId: "camp-merdeka-01", href: "/northstar/campaign/proposal-card" } },
  { id: "os-09", role: "owner", at: "2 weeks ago", text: "Approved.", context: { zone: "Campaign", label: "Merdeka week bakes", campaignId: "camp-merdeka-01" } },
  { id: "os-10", role: "otto", at: "2 weeks ago", text: "Generated the Merdeka box hero shot — 4 variants in your Library.", context: { zone: "Canvas", label: "Merdeka box hero", campaignId: "camp-merdeka-01", href: "/northstar/assets/library" } },
  { id: "os-11", role: "owner", at: "2 weeks ago", text: "Make the hero a bit warmer, more daylight.", context: { zone: "Canvas", label: "Merdeka box hero", campaignId: "camp-merdeka-01" } },
  { id: "os-12", role: "otto", at: "2 weeks ago", text: "Warmed it up and re-rendered. I noted \"warmer daylight\" as a brand preference.", context: { zone: "Canvas", label: "Merdeka box hero", campaignId: "camp-merdeka-01", href: "/northstar/assets/brand-memory" } },
  { id: "os-13", role: "otto", at: "2 weeks ago", text: "Packing day reel is ready — 8s, 9:16. Attached to the campaign.", context: { zone: "Canvas", label: "Packing day reel", campaignId: "camp-merdeka-01", href: "/northstar/assets/library" } },
  { id: "os-14", role: "owner", at: "2 weeks ago", text: "Schedule the first three for next week.", context: { zone: "Schedule", label: "Merdeka week bakes", campaignId: "camp-merdeka-01" } },
  { id: "os-15", role: "otto", at: "2 weeks ago", text: "Scheduled 3 Merdeka posts. Best times: IG 9am, FB 12:30pm, TikTok 10am. All queued as drafts for your approval.", context: { zone: "Schedule", label: "Merdeka week bakes", campaignId: "camp-merdeka-01", href: "/northstar/schedule/plan" } },
  // ── 上周:office campaign 日常 + inbox ─────────────────────────────────────
  { id: "os-16", role: "otto", at: "last week", text: "Weekday office orders is pacing at 46 of 60 this month. The 3pm pickup reel is your top post.", context: { zone: "Campaign", label: "Weekday office orders", campaignId: "camp-office-01", href: "/northstar/campaign/list" } },
  { id: "os-17", role: "otto", at: "last week", text: "Answered Mei Ling's order — 20 croissants Friday 9am, RM170. She confirmed.", context: { zone: "Inbox", label: "Mei Ling Tan", href: "/northstar/inbox/shared" } },
  { id: "os-18", role: "otto", at: "last week", text: "Zulaikha reordered her weekly 24 croissants. Confirmed for Thursday 8:30am.", context: { zone: "Inbox", label: "Zulaikha Hassan", campaignId: "camp-office-01", href: "/northstar/inbox/shared" } },
  { id: "os-19", role: "owner", at: "last week", text: "Who hasn't ordered in a while?", context: { zone: "CRM", label: "Contacts" } },
  { id: "os-20", role: "otto", at: "last week", text: "Muthu Krishnan (wholesale, RM3,120 lifetime) has gone quiet 6 weeks. Want me to draft a win-back message?", context: { zone: "CRM", label: "Muthu Krishnan", href: "/northstar/crm/contacts" } },
  { id: "os-21", role: "owner", at: "last week", text: "Yes, keep it casual.", context: { zone: "CRM", label: "Muthu Krishnan" } },
  { id: "os-22", role: "otto", at: "last week", text: "Drafted a friendly \"still doing wholesale boxes?\" note. It's waiting for your approval.", context: { zone: "Inbox", label: "Muthu Krishnan", href: "/northstar/inbox/shared" } },
  { id: "os-23", role: "otto", at: "last week", text: "A comment on your sold-out post asked about Bangsar delivery — I can move it to a DM.", context: { zone: "Inbox", label: "faridah.kl", href: "/northstar/inbox/comments" } },
  { id: "os-24", role: "owner", at: "last week", text: "Move it to DM and offer the RM8 delivery.", context: { zone: "Inbox", label: "faridah.kl" } },
  { id: "os-25", role: "otto", at: "last week", text: "Done — started a DM with Faridah and added her to contacts.", context: { zone: "CRM", label: "faridah.kl", href: "/northstar/crm/contacts" } },
  { id: "os-26", role: "otto", at: "last week", text: "Weekly analytics: reach up 18%, Sunday croissant reels drove most of it. Link clicks dipped 4% — want me to test a stronger CTA?", context: { zone: "Analytics", label: "Weekly overview", href: "/northstar/analytics/overview" } },
  { id: "os-27", role: "owner", at: "last week", text: "Yes, test a clearer \"order now\" on the next batch.", context: { zone: "Analytics", label: "Weekly overview" } },
  { id: "os-28", role: "otto", at: "last week", text: "Noted. I'll apply the stronger CTA to the next three drafts.", context: { zone: "Schedule", label: "Next drafts" } },
  // ── 本周:croffle 启动 ─────────────────────────────────────────────────────
  { id: "os-29", role: "owner", at: "5 days ago", text: "I want to launch the matcha croffle.", context: { zone: "Campaign", label: "Matcha croffle launch", campaignId: "camp-croffle-01" } },
  { id: "os-30", role: "otto", at: "5 days ago", text: "Opened a Matcha croffle launch campaign. Croffles and matcha pastries are climbing in KL — I pulled a trend snapshot for it.", context: { zone: "Campaign", label: "Croffle trends", campaignId: "camp-croffle-01", href: "/northstar/campaign/trends" } },
  { id: "os-31", role: "otto", at: "5 days ago", text: "Generated a croffle hero shot and an assembly reel is rendering now.", context: { zone: "Canvas", label: "Matcha croffle hero", campaignId: "camp-croffle-01", href: "/northstar/assets/library" } },
  { id: "os-32", role: "owner", at: "5 days ago", text: "Give me two more hero variants.", context: { zone: "Canvas", label: "Matcha croffle hero", campaignId: "camp-croffle-01" } },
  { id: "os-33", role: "otto", at: "5 days ago", text: "Added variants A and B to the batch. Which direction do you like?", context: { zone: "Canvas", label: "Croffle batch", campaignId: "camp-croffle-01", href: "/northstar/create/factory" } },
  { id: "os-34", role: "owner", at: "5 days ago", text: "A. Draft a launch proposal with a first-50 free kopi hook.", context: { zone: "Campaign", label: "Matcha croffle launch", campaignId: "camp-croffle-01" } },
  { id: "os-35", role: "otto", at: "4 days ago", text: "Proposal drafting — 2 IG posts, 2 TikToks, launch Jul 22, first-50 free kopi. Budget ~180 credits. Ready for your review shortly.", context: { zone: "Campaign", label: "Croffle proposal", campaignId: "camp-croffle-01", href: "/northstar/campaign/proposal-card" } },
  { id: "os-36", role: "otto", at: "4 days ago", text: "New enquiry from the croffle teaser ad — Rajesh asked the launch date. I told him Jul 22 and offered the early list.", context: { zone: "Inbox", label: "Rajesh Pillai", campaignId: "camp-croffle-01", href: "/northstar/inbox/shared" } },
  { id: "os-37", role: "otto", at: "4 days ago", text: "The croffle assembly reel finished rendering. It's in your Library.", context: { zone: "Assets", label: "Croffle assembly reel", campaignId: "camp-croffle-01", href: "/northstar/assets/library" } },
  // ── 近几天:Merdeka 推进 + 日常 ────────────────────────────────────────────
  { id: "os-38", role: "otto", at: "3 days ago", text: "Merdeka pre-orders hit 38 of 100. The ad is bringing in warm DMs — 3 this week from the box ad.", context: { zone: "Campaign", label: "Merdeka week bakes", campaignId: "camp-merdeka-01", href: "/northstar/campaign/list" } },
  { id: "os-39", role: "otto", at: "3 days ago", text: "Siti asked about Ampang delivery from the Merdeka ad. I quoted RM8 and offered to reserve a box.", context: { zone: "Inbox", label: "Siti Aminah", campaignId: "camp-merdeka-01", href: "/northstar/inbox/shared" } },
  { id: "os-40", role: "owner", at: "3 days ago", text: "Reserve it for her.", context: { zone: "Inbox", label: "Siti Aminah", campaignId: "camp-merdeka-01" } },
  { id: "os-41", role: "otto", at: "3 days ago", text: "Reserved. She's now tagged as a Merdeka pre-order lead.", context: { zone: "CRM", label: "Siti Aminah", campaignId: "camp-merdeka-01", href: "/northstar/crm/contacts" } },
  { id: "os-42", role: "otto", at: "2 days ago", text: "Farah sent a photo asking for a 15-pax boardroom spread next Wednesday, ~RM300. That needs your call — I flagged it.", context: { zone: "Inbox", label: "Farah Zulkifli", href: "/northstar/inbox/shared" } },
  { id: "os-43", role: "owner", at: "2 days ago", text: "Quote her RM280 and confirm.", context: { zone: "Inbox", label: "Farah Zulkifli" } },
  { id: "os-44", role: "otto", at: "2 days ago", text: "Sent the RM280 quote. I'll move the deal to Quote sent.", context: { zone: "CRM", label: "Farah Zulkifli", href: "/northstar/crm/deals" } },
  { id: "os-45", role: "otto", at: "2 days ago", text: "Generated the Kopi tiramisu menu card for the office campaign.", context: { zone: "Canvas", label: "Kopi tiramisu menu card", campaignId: "camp-office-01", href: "/northstar/assets/library" } },
  { id: "os-46", role: "otto", at: "2 days ago", text: "One Merdeka variant (D) timed out during generation — it's safe to retry whenever.", context: { zone: "Assets", label: "Merdeka variant D", campaignId: "camp-merdeka-01", href: "/northstar/assets/library" } },
  { id: "os-47", role: "owner", at: "2 days ago", text: "Retry it.", context: { zone: "Assets", label: "Merdeka variant D", campaignId: "camp-merdeka-01" } },
  { id: "os-48", role: "otto", at: "2 days ago", text: "Retried and it came through this time.", context: { zone: "Assets", label: "Merdeka variant D", campaignId: "camp-merdeka-01", href: "/northstar/assets/library" } },
  { id: "os-49", role: "otto", at: "yesterday", text: "Divya (new, from a post comment) asked what to try first. I suggested a starter box of your 3 best sellers.", context: { zone: "Inbox", label: "Divya Suresh", href: "/northstar/inbox/shared" } },
  { id: "os-50", role: "otto", at: "yesterday", text: "A Facebook post failed to publish — the token expired. Reconnect Facebook and I'll retry the flash sale.", context: { zone: "Schedule", label: "Flash sale post", campaignId: "camp-office-01", href: "/northstar/account/connections" } },
  { id: "os-51", role: "owner", at: "yesterday", text: "Reconnected. Retry it.", context: { zone: "Settings", label: "Connections", href: "/northstar/account/connections" } },
  { id: "os-52", role: "otto", at: "yesterday", text: "Facebook is back and the flash sale post is re-queued.", context: { zone: "Schedule", label: "Flash sale post", campaignId: "camp-office-01", href: "/northstar/schedule/queue" } },
  { id: "os-53", role: "otto", at: "yesterday", text: "Your Sunday croissant reel is your best performer this week — 12.4K reach. Want me to make a follow-up in the same style?", context: { zone: "Analytics", label: "Top post", href: "/northstar/analytics/overview" } },
  { id: "os-54", role: "owner", at: "yesterday", text: "Yes, same style.", context: { zone: "Canvas", label: "Croissant reel follow-up" } },
  { id: "os-55", role: "otto", at: "yesterday", text: "Drafted a follow-up reel in the croissant-fold style. It's in your Library as a draft.", context: { zone: "Canvas", label: "Croissant reel follow-up", href: "/northstar/assets/library" } },
  { id: "os-56", role: "otto", at: "6h ago", text: "Merdeka is pacing well — at this rate you'll pass 100 pre-orders by Aug 26. Want me to raise the goal?", context: { zone: "Campaign", label: "Merdeka week bakes", campaignId: "camp-merdeka-01", href: "/northstar/campaign/list" } },
  { id: "os-57", role: "otto", at: "5h ago", text: "Arjun grabbed 10 tiramisu cups for 3pm pickup — logged the order.", context: { zone: "Inbox", label: "Arjun Ramasamy", campaignId: "camp-office-01", href: "/northstar/inbox/shared" } },
  { id: "os-58", role: "otto", at: "3h ago", text: "Pulled this week's numbers into a shareable report — reach, orders, top posts. Ready to send.", context: { zone: "Analytics", label: "Weekly report", href: "/northstar/analytics/reports" } },
  { id: "os-59", role: "owner", at: "2h ago", text: "Schedule the croffle launch post for Jul 22.", context: { zone: "Schedule", label: "Croffle launch", campaignId: "camp-croffle-01" } },
  { id: "os-60", role: "otto", at: "2h ago", text: "Scheduled the croffle launch post for Jul 22, 9am. It's a draft pending your approval.", context: { zone: "Schedule", label: "Croffle launch", campaignId: "camp-croffle-01", href: "/northstar/schedule/plan" } },
  { id: "os-61", role: "otto", at: "1h ago", text: "Drafted 2 replies to order questions on WhatsApp — both waiting for your approval.", context: { zone: "Inbox", label: "Order questions", href: "/northstar/inbox/shared" } },
  { id: "os-62", role: "otto", at: "18m ago", text: "Merdeka box hero and the packing reel are both attached to the campaign. You're set to start scheduling the back half.", context: { zone: "Campaign", label: "Merdeka week bakes", campaignId: "camp-merdeka-01", href: "/northstar/campaign/list" } },
];
