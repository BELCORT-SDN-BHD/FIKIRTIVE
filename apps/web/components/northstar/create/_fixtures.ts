/**
 * 北极星原型 · 创作区 — 页面级示例数据(全部由共享 mock 模块组合而来)
 *
 * 规矩:本文件不发明新数据源 — 只从 `../_mock`(唯一 mock 模块)组合出创作区
 * 页面需要的展示结构(画布对象 / 会话 / 分镜 / 模板 / 想法)。零后台 import,
 * 全部确定性(无 Date.now / 无随机)。
 */

import { NS_ASSETS, NS_BRAND, NS_PRODUCTS, nsImage, nsPlaceholder } from "../_mock";
import { resolveCanvasFromSeed } from "../assets/_data";

export { NS_ASSETS, NS_BRAND, NS_PRODUCTS, nsImage, nsPlaceholder };

// ── 画布产物真图(§一 图片纪律:全城只从 NS_IMAGES 取图,零 placeholder 灰块) ──────
// canvas 对象 / viewer take 的确定性取图:图→烘焙产品,视频海报→店景/出品过程。seed 稳定,
// 同一对象跨会话/重生成图不跳。种子对象与运行时新生成对象(canvas-page)共用这一个入口。
export function cvImage(kind: CvKind, seed: number): string {
  return kind === "video" ? nsImage("storefront", seed) : nsImage("bakery", seed);
}

// ── Canvas 画布对象(GOAL B/C/D:对象 = 有状态一等公民) ────────────────────
export type CvKind = "image" | "video";
export type CvStatus = "ready" | "generating" | "failed" | "timeout" | "missing";

export interface CvObject {
  id: string;
  /** 可寻址名(C2):Image 1 / Video 2 … */
  ref: string;
  kind: CvKind;
  title: string;
  prompt: string;
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  status: CvStatus;
  /** 真实 Canvas runtime 的持久化关联；示例 fixture 不伪造这些字段。 */
  generationId?: string;
  genJobId?: string;
  threadId?: string;
  /** 同一次用户意图在 uncertain/failed retry 时保持不变。 */
  actionId?: string;
  variantIndex?: number;
  variantCount?: number;
  /** Server/job 返回的真实进度与失败说明。 */
  progress?: number;
  error?: string;
  /** 明确区分历史示例和真实项目节点，避免把 fixture 冒充 live output。 */
  example?: boolean;
  /** 谱系(D3):父对象 id → 画连线 */
  parentId?: string;
  /** A/B 分叉标签 */
  fork?: "A" | "B";
  /** 视频时长(秒) */
  duration?: number;
  credits: number;
}

export const CV_SEED_OBJECTS: CvObject[] = [
  {
    id: "cv-img-1", ref: "Image 1", kind: "image", title: "Merdeka box hero shot",
    prompt: "Overhead studio shot of a festive Malaysian cookie gift box, warm morning light, red and white ribbon, marble table",
    src: cvImage("image", 14),
    x: 40, y: 60, w: 224, h: 224, status: "ready", credits: 12,
  },
  {
    id: "cv-img-2", ref: "Image 2", kind: "image", title: "Hero shot · warmer light",
    prompt: "Same gift box, golden hour side light, steam rising from fresh bakes in the background",
    src: cvImage("image", 17),
    x: 320, y: 24, w: 200, h: 200, status: "ready", parentId: "cv-img-1", fork: "A", credits: 12,
  },
  {
    id: "cv-img-3", ref: "Image 3", kind: "image", title: "Hero shot · top-down flat lay",
    prompt: "Same gift box, top-down flat lay with scattered cookies and batik cloth",
    src: cvImage("image", 10),
    x: 320, y: 260, w: 200, h: 200, status: "ready", parentId: "cv-img-1", fork: "B", credits: 12,
  },
  {
    id: "cv-vid-1", ref: "Video 1", kind: "video", title: "Croissant fold reel",
    prompt: "Hands folding croissant dough on a floured counter, close-up, 6 seconds, soft kitchen light",
    src: cvImage("video", 4),
    x: 590, y: 60, w: 168, h: 300, status: "ready", duration: 6, credits: 40,
  },
];

// ── Chat 会话(GOAL A2/H0/H4) ──────────────────────────────────────────────
export interface CvChatTurn {
  id: string;
  from: "user" | "otto";
  text: string;
  /** H0 命名思考子步骤 */
  steps?: string[];
  /** 该回合关联的画布对象(chat 缩略图镜像) */
  objectIds?: string[];
}

export const CV_SESSIONS = [
  { id: "ss-1", name: "Merdeka box shots" },
  { id: "ss-2", name: "Croissant reel ideas" },
  { id: "ss-3", name: "Menu card refresh" },
] as const;

export const CV_SEED_TURNS: CvChatTurn[] = [
  { id: "t-1", from: "user", text: "I need a hero shot of the Merdeka gift box for Instagram." },
  {
    id: "t-2", from: "otto",
    text: "Here's a first hero shot of the gift box. I kept the light warm and the ribbon in frame.",
    steps: ["Thinking", "Reading brand memory", "Generating Image 1"],
    objectIds: ["cv-img-1"],
  },
  { id: "t-3", from: "user", text: "Nice. Try two directions: warmer golden light, and a top-down flat lay." },
  {
    id: "t-4", from: "otto",
    text: "Done. Image 2 is the golden-hour take, Image 3 the flat lay. Both branch from Image 1 so you can compare.",
    steps: ["Analyzing Image 1", "Generating Image 2", "Generating Image 3"],
    objectIds: ["cv-img-2", "cv-img-3"],
  },
];

// ── 每 session 独立的画布 / chat 池(切换即换内容;GOAL A3 sessions 真实化) ──
// 各 session 有自己的 objects/turns;切会话 = 换整块工作区内容,不再共用一份 seed。
export interface CvSessionSeed {
  objects: CvObject[];
  turns: CvChatTurn[];
}

const CV_SEED_OBJECTS_SS2: CvObject[] = [
  {
    id: "cv2-vid-1", ref: "Video 1", kind: "video", title: "6am croissant fold",
    prompt: "Hands folding croissant dough on a floured counter at dawn, slow reel, warm kitchen light",
    src: cvImage("video", 6),
    x: 40, y: 60, w: 168, h: 300, status: "ready", duration: 6, credits: 40,
  },
  {
    id: "cv2-vid-2", ref: "Video 2", kind: "video", title: "Lamination close-up",
    prompt: "Macro of butter layers in laminated dough being rolled, steam, soft morning light",
    src: cvImage("video", 9),
    x: 280, y: 40, w: 168, h: 300, status: "ready", parentId: "cv2-vid-1", fork: "A", duration: 6, credits: 40,
  },
  {
    id: "cv2-img-1", ref: "Image 1", kind: "image", title: "Finished croissant hero",
    prompt: "A single glossy croissant on brown paper, top light, crumbs, shallow depth of field",
    src: cvImage("image", 1),
    x: 520, y: 80, w: 224, h: 224, status: "ready", credits: 12,
  },
];

const CV_SEED_TURNS_SS2: CvChatTurn[] = [
  { id: "t2-1", from: "user", text: "Let's build the croissant reel. Start with the 6am fold." },
  {
    id: "t2-2", from: "otto",
    text: "Here's the fold clip. I kept it slow and warm so the lamination reads.",
    steps: ["Thinking", "Reading brand memory", "Generating Video 1"],
    objectIds: ["cv2-vid-1"],
  },
];

const CV_SEED_OBJECTS_SS3: CvObject[] = [
  {
    id: "cv3-img-1", ref: "Image 1", kind: "image", title: "Menu card base",
    prompt: "Clean menu card layout on kraft paper, batik border, hand-lettered header, top-down",
    src: cvImage("image", 11),
    x: 40, y: 60, w: 224, h: 224, status: "ready", credits: 12,
  },
  {
    id: "cv3-img-2", ref: "Image 2", kind: "image", title: "Card · pandan palette",
    prompt: "Same menu card, pandan-green accent palette, softer type, morning light",
    src: cvImage("image", 14),
    x: 320, y: 24, w: 200, h: 200, status: "ready", parentId: "cv3-img-1", fork: "A", credits: 12,
  },
  {
    id: "cv3-img-3", ref: "Image 3", kind: "image", title: "Card · kopi palette",
    prompt: "Same menu card, warm kopi-brown palette, retro kopitiam type, top-down",
    src: cvImage("image", 21),
    x: 320, y: 260, w: 200, h: 200, status: "ready", parentId: "cv3-img-1", fork: "B", credits: 12,
  },
];

const CV_SEED_TURNS_SS3: CvChatTurn[] = [
  { id: "t3-1", from: "user", text: "Refresh the menu card. Try a pandan and a kopi palette." },
  {
    id: "t3-2", from: "otto",
    text: "Two directions branched from the base card: Image 2 is pandan-green, Image 3 is kopi-brown.",
    steps: ["Reading the base card", "Generating Image 2", "Generating Image 3"],
    objectIds: ["cv3-img-2", "cv3-img-3"],
  },
];

/** 每 session 的初始画布内容(首次切入时用;之后 canvas 在内存里保留本会话编辑)。 */
export const CV_SESSION_SEEDS: Record<string, CvSessionSeed> = {
  "ss-1": { objects: CV_SEED_OBJECTS.map((object) => ({ ...object, example: true })), turns: CV_SEED_TURNS },
  "ss-2": { objects: CV_SEED_OBJECTS_SS2.map((object) => ({ ...object, example: true })), turns: CV_SEED_TURNS_SS2 },
  "ss-3": { objects: CV_SEED_OBJECTS_SS3.map((object) => ({ ...object, example: true })), turns: CV_SEED_TURNS_SS3 },
};

/** 全 session 的种子对象拍平 —— 深链(?asset=id)按 id 查找的单一源。 */
export const CV_ALL_SEED_OBJECTS: CvObject[] = [
  ...CV_SEED_OBJECTS,
  ...CV_SEED_OBJECTS_SS2,
  ...CV_SEED_OBJECTS_SS3,
];

// ── Projects / History(GOAL A3/I2) ────────────────────────────────────────
// project → 打开对应 session(点缩略图切工作区;campaign/archive 各映到一个会话)。
export const CV_PROJECTS = [
  { id: "pj-1", name: "Merdeka week bakes", count: 9, thumb: nsImage("campaign", 0), sessionId: "ss-1" },
  { id: "pj-2", name: "Everyday menu", count: 14, thumb: nsImage("bakery", 11), sessionId: "ss-3" },
  { id: "pj-3", name: "Raya archive", count: 22, thumb: nsImage("campaign", 3), sessionId: "ss-2" },
] as const;

export const CV_HISTORY = NS_ASSETS.map((a) => ({
  id: a.id,
  title: a.title,
  thumb: a.thumb,
  kind: a.kind,
  status: a.status,
}));

// ── 首页模板 + Discover(GOAL A0) ─────────────────────────────────────────
export interface NsTemplate {
  id: string;
  name: string;
  kind: "image" | "video";
  thumb: string;
  uses: string;
}

export const NS_TEMPLATES: NsTemplate[] = [
  { id: "tp-1", name: "Product hero shot", kind: "image", thumb: nsPlaceholder("Hero template", 480, 360, "crust"), uses: "2.1K uses" },
  { id: "tp-2", name: "Behind the counter", kind: "video", thumb: nsPlaceholder("BTS template", 480, 360, "video"), uses: "1.4K uses" },
  { id: "tp-3", name: "Menu flat lay", kind: "image", thumb: nsPlaceholder("Flat lay", 480, 360, "pandan"), uses: "980 uses" },
  { id: "tp-4", name: "Festive countdown", kind: "video", thumb: nsPlaceholder("Countdown", 480, 360, "kopi"), uses: "760 uses" },
  { id: "tp-5", name: "Price card", kind: "image", thumb: nsPlaceholder("Price card", 480, 360, "neutral"), uses: "610 uses" },
];

export interface NsDiscoverItem {
  id: string;
  title: string;
  by: string;
  kind: "image" | "video";
  thumb: string;
  tall: boolean;
}

export const NS_DISCOVER: NsDiscoverItem[] = [
  { id: "dv-1", title: "Kopitiam morning rush", by: "Featured", kind: "video", thumb: nsPlaceholder("Reel 9:16", 360, 560, "video"), tall: true },
  { id: "dv-2", title: "Pastel cake tower", by: "Community pick", kind: "image", thumb: nsPlaceholder("Cake", 360, 360, "pandan"), tall: false },
  { id: "dv-3", title: "Steam over kaya toast", by: "Featured", kind: "video", thumb: nsPlaceholder("Reel 9:16", 360, 560, "video"), tall: true },
  { id: "dv-4", title: "Night market neon", by: "Trending", kind: "image", thumb: nsPlaceholder("Neon", 360, 440, "kopi"), tall: true },
  { id: "dv-5", title: "Butter block macro", by: "Community pick", kind: "image", thumb: nsPlaceholder("Macro", 360, 360, "crust"), tall: false },
  { id: "dv-6", title: "Batik table spread", by: "Trending", kind: "image", thumb: nsPlaceholder("Spread", 360, 440, "crust"), tall: true },
  { id: "dv-7", title: "Iced kopi pour", by: "Featured", kind: "video", thumb: nsPlaceholder("Reel 9:16", 360, 560, "video"), tall: true },
  { id: "dv-8", title: "Sunday bake sale", by: "Community pick", kind: "image", thumb: nsPlaceholder("Bake sale", 360, 360, "pandan"), tall: false },
];

// ── ?from=<id> 落地画布(GOAL A2/I2:断头路全通)──────────────────────────
// 模板 / Discover / Library / 画布资产的 id → 一个真实画布对象。canvas 挂载时预载它,
// 让「Use template / Make this yours / Open in canvas」落地的画布真有那个对象,而不是
// 随便新开一个种子会话(create gap#4 根因)。null = 无法解析 → canvas 回落默认会话。
function seedFromExternal(
  id: string,
  kind: CvKind,
  title: string,
  prompt: string,
  src: string,
  credits = kind === "video" ? 40 : 12,
): CvObject {
  const isVid = kind === "video";
  return {
    id: `cv-from-${id}`,
    ref: isVid ? "Video 1" : "Image 1",
    kind,
    title,
    prompt,
    src,
    x: 96,
    y: 120,
    w: isVid ? 168 : 240,
    h: isVid ? 300 : 240,
    status: "ready",
    example: true,
    credits,
  };
}

export function resolveCanvasSeed(fromId: string | null): CvObject | null {
  if (!fromId) return null;
  // 1) 画布种子对象(Library / asset-viewer 深链)—— 原样搬上一张干净画布
  const seed = CV_ALL_SEED_OBJECTS.find((o) => o.id === fromId);
  if (seed) return { ...seed, x: 96, y: 120, parentId: undefined, fork: undefined, status: "ready", example: true };
  // 2) 首页模板
  const tpl = NS_TEMPLATES.find((t) => t.id === fromId);
  if (tpl) return seedFromExternal(tpl.id, tpl.kind, tpl.name, `Start from the “${tpl.name}” template`, tpl.thumb);
  // 3) Discover
  const dv = NS_DISCOVER.find((d) => d.id === fromId);
  if (dv) return seedFromExternal(dv.id, dv.kind, dv.title, `Make “${dv.title}” your own`, dv.thumb);
  // 4) Library 资产(storyboard 归到 image 处理)
  const asset = NS_ASSETS.find((a) => a.id === fromId);
  if (asset) {
    const kind: CvKind = asset.kind === "video" ? "video" : "image";
    return seedFromExternal(asset.id, kind, asset.title, asset.title, asset.thumb, asset.credits);
  }
  // 5) 资产区 nav 可达页(Templates/Discover/Library/My-stuff 全量表,id 空间 tpl-/dv-0/gen-/st-)
  //    —— 与 create/home 内联迷你货架(tp-/dv-)不同 id 空间,委托资产区单一解析源补齐。
  const fromAssets = resolveCanvasFromSeed(fromId);
  if (fromAssets) {
    const kind: CvKind = fromAssets.kind === "video" ? "video" : "image";
    return seedFromExternal(fromAssets.id, kind, fromAssets.title, fromAssets.firstMessage, fromAssets.thumb);
  }
  return null;
}

// ── 全屏查看器(GOAL G1):版本 / 帧轨 ─────────────────────────────────────
export interface NsViewerVersion {
  id: string;
  label: string;
  thumb: string;
  note: string;
  current: boolean;
}

export const NS_VIEWER_ASSET = {
  id: "as-02",
  title: "Croissant fold reel",
  kind: "video" as const,
  duration: 6,
  resolution: "720p",
  credits: 40,
  prompt: "Hands folding croissant dough on a floured counter, close-up, 6 seconds, soft kitchen light",
  poster: cvImage("video", 4),
};

export const NS_VIEWER_VERSIONS: NsViewerVersion[] = [
  { id: "vv-3", label: "v3 · current", thumb: cvImage("video", 4), note: "Slower fold, warmer light", current: true },
  { id: "vv-2", label: "v2", thumb: cvImage("video", 12), note: "Added flour dust", current: false },
  { id: "vv-1", label: "v1", thumb: cvImage("video", 0), note: "First take", current: false },
];

export const NS_VIEWER_FRAMES = [0, 1, 2, 3, 4, 5].map((s) => ({
  id: `fr-${s}`,
  at: `${s}s`,
  thumb: cvImage("video", s),
}));

// ── 分镜工作台(storyboard F1-F4) ─────────────────────────────────────────
export interface NsScene {
  id: string;
  order: number;
  title: string;
  shot: string;
  voiceover: string;
  duration: number;
  thumb: string;
  credits: number;
}

export const NS_SCENES: NsScene[] = [
  { id: "sc-1", order: 1, title: "Opening hook", shot: "Close-up: ribbon pulled off the Merdeka gift box", voiceover: "The box that sells out every Merdeka.", duration: 3, thumb: nsPlaceholder("Scene 1", 320, 180, "crust"), credits: 16 },
  { id: "sc-2", order: 2, title: "Product reveal", shot: "Top-down: lid opens on 12 assorted cookies", voiceover: "Twelve bakes. One box.", duration: 4, thumb: nsPlaceholder("Scene 2", 320, 180, "pandan"), credits: 16 },
  { id: "sc-3", order: 3, title: "Texture moment", shot: "Macro: gula melaka drizzle over pandan cake", voiceover: "Made fresh in KL, every morning.", duration: 4, thumb: nsPlaceholder("Scene 3", 320, 180, "kopi"), credits: 16 },
  { id: "sc-4", order: 4, title: "People beat", shot: "Handheld: office team sharing the box at 3pm", voiceover: "Perfect for the office order.", duration: 4, thumb: nsPlaceholder("Scene 4", 320, 180, "neutral"), credits: 16 },
  { id: "sc-5", order: 5, title: "Urgency", shot: "Text-over: pre-orders close Friday 6pm", voiceover: "Pre-orders close Friday.", duration: 3, thumb: nsPlaceholder("Scene 5", 320, 180, "crust"), credits: 16 },
  { id: "sc-6", order: 6, title: "Close", shot: "Logo lockup over warm bakery counter", voiceover: "Roti Bulan Bakery. Fresh bakes, KL heart.", duration: 2, thumb: nsPlaceholder("Scene 6", 320, 180, "pandan"), credits: 16 },
];

// ── 工厂出片间(harmony-03 Wave 1-2;判决 7-2/7-3/7-7) ────────────────────
export const NS_FACTORY_MODES = [
  { id: "md-1", name: "Product showcase", desc: "Clean studio shots of one product, 3 angles", wave: 1 },
  { id: "md-2", name: "Lifestyle scene", desc: "Your product in a real KL moment", wave: 1 },
  { id: "md-3", name: "Promo countdown", desc: "Offer, price and deadline, animated", wave: 1 },
  { id: "md-4", name: "Talking head · presenter", desc: "A presenter speaks your pitch to camera", wave: 2 },
  { id: "md-5", name: "Talking head · unboxing", desc: "Presenter unboxes and reacts", wave: 2 },
] as const;

export const NS_FACTORY_STYLES = [
  { id: "st-1", name: "Warm bakery", thumb: nsPlaceholder("Warm", 320, 200, "crust") },
  { id: "st-2", name: "Pandan fresh", thumb: nsPlaceholder("Fresh", 320, 200, "pandan") },
  { id: "st-3", name: "Kopitiam retro", thumb: nsPlaceholder("Retro", 320, 200, "kopi") },
  { id: "st-4", name: "Studio minimal", thumb: nsPlaceholder("Minimal", 320, 200, "neutral") },
] as const;

export const NS_FACTORY_HOOKS = [
  "The box that sells out every Merdeka",
  "RM68 feeds the whole office",
  "12 bakes, 1 box, zero regrets",
  "Your 3pm meeting just got better",
  "Pre-orders close Friday 6pm",
] as const;

export const NS_FACTORY_PLATFORMS = ["Instagram", "Facebook", "TikTok"] as const;
export const NS_FACTORY_SIZES = ["1:1", "4:5", "9:16"] as const;
export const NS_FACTORY_CREDITS_PER_VARIANT = 12;

// ── 想法清单(N (Buffer) Ideas 判决:极轻,不建管道) ───────────────────────
export interface NsIdea {
  id: string;
  text: string;
  source: "you" | "otto";
  addedAt: string;
  converted: boolean;
  /** campaign 备选点子自动落入(campaign spec §一.3)→ 标注来源 campaign */
  campaign?: string;
}

export const NS_IDEAS: NsIdea[] = [
  { id: "id-1", text: "Film the 6am croissant fold as a slow reel", source: "you", addedAt: "2026-07-06", converted: false },
  { id: "id-2", text: "Merdeka box unboxing from a customer's desk", source: "otto", addedAt: "2026-07-06", converted: false },
  { id: "id-3", text: "Pandan cake cross-section macro for the menu", source: "you", addedAt: "2026-07-05", converted: true },
  { id: "id-4", text: "Ask regulars which retired bake to bring back", source: "otto", addedAt: "2026-07-04", converted: false },
  { id: "id-5", text: "Kopi pairing chart: which brew with which bake", source: "otto", addedAt: "2026-07-03", converted: false },
];

/** campaign 备选点子(Otto 策划时的落选备胎,自动落入想法清单) */
export const NS_IDEA_DROPS: NsIdea[] = [
  { id: "id-c1", text: "Office pre-order bundle teaser: one box on every desk", source: "otto", addedAt: "2026-07-07", converted: false, campaign: "Merdeka week bakes" },
  { id: "id-c2", text: "Morning timelapse: flag up, ovens on, first batch out", source: "otto", addedAt: "2026-07-07", converted: false, campaign: "Merdeka week bakes" },
];
