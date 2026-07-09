/**
 * 北极星 · 沉浸式 Z3 Studio 量产间 —— 页级展示数据(单一源 = _mock 的 NS_IMAGES / NS_ASSETS /
 * NS_PRODUCTS 派生;零新造品牌事实、零 placeholder 灰块)。
 *
 * ENDGAME-CITY-ORDER §一 图片纪律:全城只从 NS_IMAGES 取图。本文件里每一张缩略图都走
 * nsImage(cat, i)(确定性、curl-200 验证过的热链),不用 nsPlaceholder、不自造 photo id。
 *
 * 铁律:纯 client、零后台 import;这里只组合展示结构,状态一律经 _store.ts。
 */

import { nsImage, NS_ASSETS, type NsAsset } from "@/components/northstar/_mock";

/* ── 首页:Featured 模板横排 ──────────────────────────────────────────────── */
export interface StudioTemplate {
  id: string;
  name: string;
  kind: "image" | "video";
  thumb: string;
  uses: string;
}

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  { id: "tp-hero", name: "Product hero shot", kind: "image", thumb: nsImage("bakery", 5), uses: "2.1K uses" },
  { id: "tp-bts", name: "Behind the counter", kind: "video", thumb: nsImage("storefront", 3), uses: "1.4K uses" },
  { id: "tp-flat", name: "Menu flat lay", kind: "image", thumb: nsImage("bakery", 11), uses: "980 uses" },
  { id: "tp-count", name: "Festive countdown", kind: "video", thumb: nsImage("campaign", 0), uses: "760 uses" },
  { id: "tp-price", name: "Price card", kind: "image", thumb: nsImage("bakery", 24), uses: "610 uses" },
];

/* ── 首页:Discover 瀑布流(真图;video 悬停预览) ──────────────────────────── */
export interface StudioDiscoverItem {
  id: string;
  title: string;
  by: string;
  kind: "image" | "video";
  thumb: string;
  tall: boolean;
}

export const STUDIO_DISCOVER: StudioDiscoverItem[] = [
  { id: "dv-1", title: "Kopitiam morning rush", by: "Featured", kind: "video", thumb: nsImage("storefront", 0), tall: true },
  { id: "dv-2", title: "Pastel cake tower", by: "Community pick", kind: "image", thumb: nsImage("bakery", 14), tall: false },
  { id: "dv-3", title: "Steam over kaya toast", by: "Featured", kind: "video", thumb: nsImage("storefront", 4), tall: true },
  { id: "dv-4", title: "Night market neon", by: "Trending", kind: "image", thumb: nsImage("bakery", 3), tall: true },
  { id: "dv-5", title: "Butter block macro", by: "Community pick", kind: "image", thumb: nsImage("bakery", 6), tall: false },
  { id: "dv-6", title: "Batik table spread", by: "Trending", kind: "image", thumb: nsImage("campaign", 3), tall: true },
  { id: "dv-7", title: "Iced kopi pour", by: "Featured", kind: "video", thumb: nsImage("storefront", 11), tall: true },
  { id: "dv-8", title: "Sunday bake sale", by: "Community pick", kind: "image", thumb: nsImage("bakery", 21), tall: false },
  { id: "dv-9", title: "Croissant fold reel", by: "Featured", kind: "video", thumb: nsImage("storefront", 12), tall: true },
  { id: "dv-10", title: "Macaron colour set", by: "Community pick", kind: "image", thumb: nsImage("bakery", 10), tall: false },
  { id: "dv-11", title: "Fresh loaves rack", by: "Trending", kind: "image", thumb: nsImage("bakery", 0), tall: true },
  { id: "dv-12", title: "Cinnamon roll close-up", by: "Featured", kind: "image", thumb: nsImage("bakery", 32 % 28), tall: false },
];

/* ── [wave-b] 完整流程模板(Grok Workflow templates):选一个 = brief→成片全跑 ── */
export interface StudioWorkflow {
  id: string;
  name: string;
  outcome: string;
  steps: string[];
  thumb: string;
}

export const STUDIO_WORKFLOWS: StudioWorkflow[] = [
  { id: "wf-ugc", name: "UGC product story", outcome: "A customer-style short that sells one bake", steps: ["Brief", "Hook", "Scenes", "Render", "Caption"], thumb: nsImage("storefront", 3) },
  { id: "wf-brand", name: "Brand identity reel", outcome: "A warm 20s intro to your shop", steps: ["Brand memory", "Scenes", "Voice", "Render"], thumb: nsImage("storefront", 1) },
  { id: "wf-promo", name: "Promo countdown", outcome: "Offer + price + deadline, ready to run", steps: ["Offer", "Layout", "Render"], thumb: nsImage("campaign", 4) },
];

/* ── [wave-b] 本地场景启动模板(Canva 垂直薄层):马来西亚商业时刻起手式 ──────── */
export interface StudioStarter {
  id: string;
  name: string;
  moment: string;
  thumb: string;
}

export const STUDIO_LOCAL_MOMENTS: StudioStarter[] = [
  { id: "lm-merdeka", name: "Merdeka pre-order push", moment: "31 Aug · flags & red-white", thumb: nsImage("campaign", 0) },
  { id: "lm-raya", name: "Raya open house box", moment: "Festive gifting", thumb: nsImage("campaign", 3) },
  { id: "lm-mamak", name: "Mamak-style menu card", moment: "Everyday supper crowd", thumb: nsImage("storefront", 6) },
  { id: "lm-ramadan", name: "Ramadan bazaar teaser", moment: "Buka puasa rush", thumb: nsImage("bakery", 20) },
];

/* ── [wave-b] SEA 本地热梗/趋势模板(Higgsfield 热梗层):蹭对梗更容易被看到 ──── */
export const STUDIO_SEA_TRENDS: StudioStarter[] = [
  { id: "tr-glowup", name: "Glow-up transition", moment: "Trending on TikTok MY", thumb: nsImage("bakery", 2) },
  { id: "tr-pov", name: "POV: the 3pm craving", moment: "Trending on TikTok MY", thumb: nsImage("storefront", 5) },
  { id: "tr-asmr", name: "ASMR unbox", moment: "Trending on TikTok MY", thumb: nsImage("bakery", 15) },
];

/* ── 分镜工作台:场景 ────────────────────────────────────────────────────── */
export interface StudioScene {
  id: string;
  order: number;
  title: string;
  shot: string;
  voiceover: string;
  duration: number;
  thumb: string;
  credits: number;
  /** [wave-b] 结构化镜头控制:机位/景别/运镜预设 */
  camera: string;
}

export const STUDIO_SCENES: StudioScene[] = [
  { id: "sc-1", order: 1, title: "Opening hook", shot: "Ribbon pulled off the Merdeka gift box", voiceover: "The box that sells out every Merdeka.", duration: 3, thumb: nsImage("campaign", 0), credits: 16, camera: "Close-up · static" },
  { id: "sc-2", order: 2, title: "Product reveal", shot: "Lid opens on 12 assorted cookies", voiceover: "Twelve bakes. One box.", duration: 4, thumb: nsImage("bakery", 20), credits: 16, camera: "Top-down · slow push" },
  { id: "sc-3", order: 3, title: "Texture moment", shot: "Gula melaka drizzle over pandan cake", voiceover: "Made fresh in KL, every morning.", duration: 4, thumb: nsImage("bakery", 5), credits: 16, camera: "Macro · rack focus" },
  { id: "sc-4", order: 4, title: "People beat", shot: "Office team sharing the box at 3pm", voiceover: "Perfect for the office order.", duration: 4, thumb: nsImage("storefront", 3), credits: 16, camera: "Handheld · medium" },
  { id: "sc-5", order: 5, title: "Urgency", shot: "Text-over: pre-orders close Friday 6pm", voiceover: "Pre-orders close Friday.", duration: 3, thumb: nsImage("campaign", 4), credits: 16, camera: "Static · text card" },
  { id: "sc-6", order: 6, title: "Close", shot: "Logo lockup over warm bakery counter", voiceover: "Roti Bulan Bakery. Fresh bakes, KL heart.", duration: 2, thumb: nsImage("storefront", 1), credits: 16, camera: "Wide · slow drift" },
];

/* ── [wave-b] 结构化镜头控制:运镜/景别预设库(扩到几十个的形态,列头几十项之样例) ── */
export const STUDIO_CAMERA_PRESETS: string[] = [
  "Close-up · static", "Close-up · slow push", "Macro · rack focus", "Top-down · static",
  "Top-down · slow push", "Medium · handheld", "Wide · slow drift", "Wide · drone pull-back",
  "Dolly-in", "Orbit around subject", "Whip pan", "Crane up", "Text card · static",
];

/* ── [wave-b] 多语言口播配音(LTX AI Dubbing):三语默认 + 扩展语言可选 ─────────── */
export const STUDIO_DUB_LANGS: string[] = [
  "English", "Bahasa Melayu", "中文", "தமிழ் (Tamil)", "ไทย (Thai)",
  "Tiếng Việt", "Bahasa Indonesia", "日本語", "한국어", "العربية",
];

/* ── 工厂出片间:模式(Wave 1 可选 + [wave-b] Money Shot + 拍法扩容 locked 票) ── */
export interface StudioMode {
  id: string;
  name: string;
  desc: string;
  wave: 1 | 2 | 3;
  /** money-shot 需要先锁定产品照片(#1) */
  productLock?: boolean;
}

export const STUDIO_MODES: StudioMode[] = [
  { id: "md-showcase", name: "Product showcase", desc: "Clean studio shots, 3 angles", wave: 1 },
  { id: "md-lifestyle", name: "Lifestyle scene", desc: "Your product in a real KL moment", wave: 1 },
  { id: "md-promo", name: "Promo countdown", desc: "Offer, price and deadline, animated", wave: 1 },
  // [wave-b] Money Shot 级产品保真商业片(invideo):先锁产品为资产再合成
  { id: "md-moneyshot", name: "Money shot · product-true", desc: "Lock your packaging & logo from real photos, then a 25–30s film", wave: 1, productLock: true },
  { id: "md-head", name: "Talking head · presenter", desc: "A presenter speaks your pitch", wave: 2 },
  { id: "md-unbox", name: "Talking head · unboxing", desc: "Presenter unboxes and reacts", wave: 2 },
  // [wave-b] 拍法模式库扩容(Higgsfield 10 模式):教程/测评/试穿/TV Spot/Wild Card
  { id: "md-tutorial", name: "Tutorial · how-to", desc: "Show customers how to use it", wave: 3 },
  { id: "md-review", name: "Customer review style", desc: "Honest-review framing", wave: 3 },
  { id: "md-tryon", name: "Virtual try-on", desc: "See it on / in context", wave: 3 },
  { id: "md-tvspot", name: "Broadcast TV spot", desc: "Polished 15s ad", wave: 3 },
  { id: "md-wild", name: "Wild card · Otto directs", desc: "Otto picks the whole treatment", wave: 3 },
];

export interface StudioStyle {
  id: string;
  name: string;
  thumb: string;
}

export const STUDIO_STYLES: StudioStyle[] = [
  { id: "sty-warm", name: "Warm bakery", thumb: nsImage("bakery", 0) },
  { id: "sty-fresh", name: "Pandan fresh", thumb: nsImage("bakery", 5) },
  { id: "sty-retro", name: "Kopitiam retro", thumb: nsImage("storefront", 6) },
  { id: "sty-min", name: "Studio minimal", thumb: nsImage("bakery", 24) },
];

export const STUDIO_HOOKS: string[] = [
  "The box that sells out every Merdeka",
  "RM68 feeds the whole office",
  "12 bakes, 1 box, zero regrets",
  "Your 3pm meeting just got better",
  "Pre-orders close Friday 6pm",
];

export const STUDIO_PLATFORMS = ["Instagram", "Facebook", "TikTok"] as const;
export const STUDIO_SIZES = ["1:1", "4:5", "9:16"] as const;
export const STUDIO_CREDITS_PER_VARIANT = 12;

/* ── [wave-b] 受众画像一键改写(Jasper Audiences):同一素材按客群换措辞 ────────── */
export const STUDIO_AUDIENCES: { id: string; label: string; note: string }[] = [
  { id: "aud-budget", label: "Budget-savvy", note: "Leads with value & bundles" },
  { id: "aud-newness", label: "Chases new drops", note: "Leads with novelty & limited runs" },
  { id: "aud-office", label: "Office orderers", note: "Leads with delivery & sharing" },
  { id: "aud-family", label: "Family & festive", note: "Leads with occasion & gifting" },
];

/* ── [wave-b] 编辑工具箱(Higgsfield Apps + Jasper Image Suite):局部修图不重生成整张 ── */
export const STUDIO_EDIT_TOOLS: { id: string; label: string; note: string }[] = [
  { id: "ed-inpaint", label: "Inpaint", note: "Remove clutter or a stray object" },
  { id: "ed-expand", label: "Expand", note: "Widen the frame / add background" },
  { id: "ed-relight", label: "Relight", note: "Warm or brighten the shot" },
  { id: "ed-upscale", label: "Upscale", note: "Sharper, print-ready" },
  { id: "ed-removebg", label: "Remove background", note: "Cut the product out clean" },
];

/* ── [wave-b] 表格式批量生产(Jasper Grid + Canva Bulk):行=商品,列=任务 ────────── */
export const STUDIO_BULK_TASKS: { id: string; label: string }[] = [
  { id: "bt-desc", label: "Product description" },
  { id: "bt-image", label: "Hero image" },
  { id: "bt-translate", label: "BM + 中文 translation" },
  { id: "bt-caption", label: "Social caption" },
];

/* ── 出片间历史批次(Library 深链锚;真图,派生 NS_ASSETS 的 batchId 组) ────────── */
export function studioBatches(): { batchId: string; title: string; assets: NsAsset[] }[] {
  const groups = new Map<string, NsAsset[]>();
  for (const a of NS_ASSETS) {
    if (!a.batchId) continue;
    const arr = groups.get(a.batchId) ?? [];
    arr.push(a);
    groups.set(a.batchId, arr);
  }
  return [...groups.entries()].map(([batchId, assets]) => ({
    batchId,
    title: assets[0].title.replace(/·.*$/, "").trim(),
    assets,
  }));
}
