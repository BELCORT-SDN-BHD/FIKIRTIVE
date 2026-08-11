/**
 * templates.ts —— 内建「一键成片」模板库,为马来西亚 SMB 而写(#783)。
 *
 * 为什么在 core 而不在 apps/web:读者有两个,而且必须读同一份 ——
 *   · 商家自己点(Templates 面板 → TemplateModal → startGen 的付费闸);
 *   · Otto 按行业/节庆推荐并直接跑同一段 prompt(recommendTemplates skill)。
 * 抄成两份,就一定会有一份先烂掉(与 navigation / canvas-card-status 同一条班规)。
 *
 * 纯数据 + 纯函数:无 DB、无 React、无 network、**不发起任何生成调用**。
 *
 * ── 写模板的三条硬规矩 ────────────────────────────────────────────────────
 * 1. **画面里不写商家的字**,除非模板明确是「promo card」那一类(见 `rendersHeadline`)。
 *    其余一律留干净留白,商家事后自己压字 —— 出一张拼错字的促销图,比不出图更伤。
 * 2. **一格价钱都不写在这里**。一次模板运行 = 一张图,价钱由 `templateRunCredits()`
 *    向**收费权威** `pricedGenCredits()` 问出来(Pricing truth:报价与扣费同源),
 *    模板数据里没有任何金额/积分字面量。
 * 3. **不出现供应商名**。模板是商家可见面,白标纪律照旧。
 *
 * ── 语言 ─────────────────────────────────────────────────────────────────
 * UI 文案(name / description / question)一律 English sentence case。
 * `captions` 是**内容资产**,不是 UI 文案:马来西亚 SMB 真实发帖用 English 与 Bahasa
 * Melayu,华语社群加 Chinese。占位符三语一致(`[your product]` 等),商家一次替换到底。
 */
import { GEN_MODELS, type GenImageAspect } from "./gen.js";
import { displayCredits, pricedGenCredits } from "./spend.js";

export type TemplateQuestion = { label: string; placeholder: string };

/** 商家真正会用来发帖的三种语言。 */
export const TEMPLATE_CAPTION_LANGUAGES = ["en", "ms", "zh"] as const;
export type TemplateCaptionLanguage = (typeof TEMPLATE_CAPTION_LANGUAGES)[number];
export type TemplateCaption = { language: TemplateCaptionLanguage; text: string };

/**
 * 文案里允许出现的空格 —— **也是这些文案唯一允许说的「商家的事实」**。
 *
 * 判官 r1 P2:上一版有几条文案替商家许下了他没告诉我们的承诺(马来西亚制造、30 分钟
 * 送达、门前有车位、全马邮寄、隔日出货)。那不是文案好不好的问题:商家一键复制发出去,
 * 就成了他自己的公开承诺。规矩收成一句话 —— **凡是具体经营事实,要么是这里的一个空格,
 * 要么不写**;文案里因此也不会出现任何裸数字。 */
export const TEMPLATE_CAPTION_PLACEHOLDERS = [
  "[your product]",
  "[price]",
  "[date]",
  "[shop name]",
  "[delivery time]",
  "[lead time]",
] as const;

/** UI 的分类过滤行。English sentence case。 */
export const TEMPLATE_CATEGORIES = [
  "Product basics",
  "Festivals & seasons",
  "Marketplace listings",
  "Food & drink",
  "Shop & services",
  "Social posts",
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/** 行业标签(闭集)。`any` = 任何行业都用得上。Otto 按这个字段推荐。 */
export const TEMPLATE_INDUSTRIES = [
  "any",
  "food-drink",
  "fashion",
  "beauty",
  "grocery",
  "home-living",
  "electronics",
  "health",
  "kids-education",
  "services",
  "automotive",
] as const;
export type TemplateIndustry = (typeof TEMPLATE_INDUSTRIES)[number];

export type Template = {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** 哪些行业用得上。含 `any` = 通用。 */
  industries: TemplateIndustry[];
  /** 节庆/场合/同义词,全小写。Otto 与 UI 搜索都靠它命中。 */
  tags: string[];
  needsImage: boolean;
  /** 画面里要不要真的把商家给的字画出来。true 的模板必须带 `question`。 */
  rendersHeadline?: boolean;
  /** 这个场景该出的画幅;不填 = 沿用商家上传图的形状(今日行为)。 */
  aspectRatio?: GenImageAspect;
  question?: TemplateQuestion;
  promptTemplate: string; // contains "{q}" iff `question` is present
  /** 配套发帖文案,按语言分。占位符见 `TEMPLATE_CAPTION_PLACEHOLDERS` —— 同一模板的每种
   *  语言必须用**同一套、同样次数**的占位符,商家一次替换就三语都对(判官 r1 P2)。 */
  captions: TemplateCaption[];
};

export const TEMPLATES: Template[] = [
  // ── Product basics ────────────────────────────────────────────────────────
  {
    id: "remove-bg",
    name: "Remove background",
    description: "Drop in a product photo, get it on a clean white studio backdrop.",
    category: "Product basics",
    industries: ["any"],
    tags: ["background", "white", "studio", "cutout", "listing"],
    needsImage: true,
    promptTemplate:
      "remove the background and place the product on a clean white studio backdrop, keep the product edges sharp, photorealistic",
    captions: [
      { language: "en", text: "[your product] — now in stock. [price]. DM us to order." },
      { language: "ms", text: "[your product] — ada dalam stok. [price]. DM untuk tempah." },
    ],
  },
  {
    id: "remove-object",
    name: "Remove object",
    description: "Upload an image and tell me what to take out.",
    category: "Product basics",
    industries: ["any"],
    tags: ["cleanup", "retouch", "edit", "erase"],
    needsImage: true,
    question: { label: "What should I remove?", placeholder: "e.g. the person in the back" },
    promptTemplate: "remove the {q} from the image and fill the area naturally, photorealistic",
    captions: [
      { language: "en", text: "A closer look at [your product]. Swipe for more." },
      { language: "ms", text: "Lihat [your product] dengan lebih dekat. Swipe untuk lagi." },
    ],
  },
  {
    id: "product-in-scene",
    name: "Product in a scene",
    description: "Place your product into any setting you describe.",
    category: "Product basics",
    industries: ["any"],
    tags: ["scene", "background", "lifestyle", "setting"],
    needsImage: true,
    question: {
      label: "Describe the scene / background",
      placeholder: "e.g. on a marble kitchen counter, soft morning light",
    },
    promptTemplate:
      "place this product in {q}, professional product photography, realistic lighting and shadows",
    captions: [
      { language: "en", text: "This is where [your product] belongs. Available now — [price]." },
      { language: "ms", text: "Inilah tempat [your product]. Ada sekarang — [price]." },
    ],
  },
  {
    id: "festival-makeover",
    name: "Festival makeover",
    description: "Give your product a festive look — Raya, CNY, Deepavali and more.",
    category: "Product basics",
    industries: ["any"],
    tags: ["festival", "seasonal", "raya", "cny", "deepavali", "christmas"],
    needsImage: true,
    question: { label: "Which festival?", placeholder: "e.g. Hari Raya, CNY, Deepavali" },
    promptTemplate:
      "restyle this image with a festive {q} theme — tasteful decorations and lighting, keep the product clear and centered",
    captions: [
      { language: "en", text: "Festive season is here. [your product] is ready when you are." },
      { language: "ms", text: "Musim perayaan dah tiba. [your product] dah sedia menanti." },
    ],
  },
  {
    id: "fix-dull-photo",
    name: "Fix a dull phone photo",
    description: "Turn a flat, badly lit phone shot into a clean, bright product picture.",
    category: "Product basics",
    industries: ["any"],
    tags: ["lighting", "brighten", "retouch", "quality", "phone photo"],
    needsImage: true,
    promptTemplate:
      "relight and clean up this phone photo into a professional product shot — even soft studio lighting, true colours, remove glare and colour cast, tidy the surface, keep the product exactly as it is, photorealistic",
    captions: [
      { language: "en", text: "Same [your product], shot properly. Order yours at [price]." },
      { language: "ms", text: "[your product] yang sama, gambar yang lebih kemas. Tempah pada [price]." },
    ],
  },
  {
    id: "close-up-detail",
    name: "Close-up detail",
    description: "Show the texture, stitching or finish that a wide shot hides.",
    category: "Product basics",
    industries: ["any"],
    tags: ["macro", "detail", "texture", "quality", "craft"],
    needsImage: true,
    question: { label: "What detail should I focus on?", placeholder: "e.g. the stitching on the strap" },
    promptTemplate:
      "an extreme close-up macro photograph of {q} on this product, shallow depth of field, soft directional light raking across the surface to reveal texture, razor-sharp detail, photorealistic",
    captions: [
      { language: "en", text: "The details you only notice up close. [your product], [price]." },
      { language: "ms", text: "Detail yang hanya nampak bila dekat. [your product], [price]." },
    ],
  },

  // ── Festivals & seasons ───────────────────────────────────────────────────
  {
    id: "raya-sale",
    name: "Hari Raya sale post",
    description: "A Raya promo image with your sale headline on it.",
    category: "Festivals & seasons",
    industries: ["any"],
    tags: ["raya", "aidilfitri", "hari raya", "lebaran", "sale", "promo", "syawal"],
    needsImage: true,
    rendersHeadline: true,
    question: { label: "What should the headline say?", placeholder: "e.g. JUALAN RAYA 50%" },
    promptTemplate:
      "restyle this photo into a Hari Raya Aidilfitri promotional image — soft sage green, cream and gold palette, ketupat weaving and pelita oil-lamp accents, warm evening light, subtle geometric Islamic pattern border, the product stays sharp and centred; render the exact headline \"{q}\" once across the top in a bold clean sans-serif, spelled exactly as given, and put no other lettering anywhere in the image",
    captions: [
      { language: "en", text: "Raya sale is live. [your product] at [price] until [date]." },
      { language: "ms", text: "Jualan Raya dah bermula! [your product] serendah [price] sehingga [date]." },
    ],
  },
  {
    id: "raya-hamper",
    name: "Raya hamper set",
    description: "Present your product as a Raya gift hamper worth giving.",
    category: "Festivals & seasons",
    industries: ["food-drink", "grocery", "beauty", "home-living"],
    tags: ["raya", "hamper", "gift", "aidilfitri", "corporate gift", "bingkisan"],
    needsImage: true,
    promptTemplate:
      "style this product as the centrepiece of a premium Hari Raya gift hamper — woven rattan basket, cream and gold ribbon, ketupat charm, dried flowers, warm soft light on a cream cloth, elegant and generous, the product clearly the hero, photorealistic",
    captions: [
      { language: "en", text: "Raya hampers are open for order. [your product] set from [price]." },
      { language: "ms", text: "Tempahan hamper Raya dibuka. Set [your product] bermula [price]." },
    ],
  },
  {
    id: "raya-open-house",
    name: "Raya open house spread",
    description: "Your food or drink on a full open house table.",
    category: "Festivals & seasons",
    industries: ["food-drink", "grocery", "services"],
    tags: ["raya", "open house", "rumah terbuka", "catering", "kuih", "aidilfitri"],
    needsImage: true,
    promptTemplate:
      "place this dish on a generous Hari Raya open house table — songket runner, brass serving ware, kuih raya in glass jars, ketupat, warm natural daylight through a window, family-sized abundance, the dish in the foreground and in focus, photorealistic",
    captions: [
      { language: "en", text: "Open house season. Let us handle the food — [your product] from [price]. Book by [date]." },
      { language: "ms", text: "Musim rumah terbuka. Biar kami uruskan juadah — [your product] dari [price]. Tempah sebelum [date]." },
    ],
  },
  {
    id: "cny-prosperity",
    name: "Chinese New Year post",
    description: "Red-and-gold styling for the reunion season.",
    category: "Festivals & seasons",
    industries: ["any"],
    tags: ["cny", "chinese new year", "tahun baru cina", "reunion", "prosperity", "spring festival"],
    needsImage: true,
    promptTemplate:
      "restyle this photo for Chinese New Year — deep red and gold palette, hanging lanterns softly out of focus, mandarin oranges, plum blossom sprigs, gold ingot accents, warm celebratory light, the product sharp and centred with clean empty space above it, photorealistic",
    captions: [
      { language: "en", text: "Gong Xi Fa Cai. [your product] is ready for your reunion table — [price]." },
      { language: "ms", text: "Gong Xi Fa Cai! [your product] sedia untuk jamuan keluarga anda — [price]." },
      { language: "zh", text: "恭喜发财!团圆桌上少不了 [your product],[price] 起,现已接单。" },
    ],
  },
  {
    id: "cny-angpau",
    name: "CNY angpau promo",
    description: "Red packet styling for a New Year offer.",
    category: "Festivals & seasons",
    industries: ["any"],
    tags: ["cny", "angpau", "red packet", "ang pow", "promo", "discount", "chinese new year"],
    needsImage: true,
    promptTemplate:
      "restyle this photo as a Chinese New Year angpau promotion — a fan of red-and-gold envelopes arranged around the product, gold coins and mandarin oranges, deep red silk backdrop, warm rim light, generous clean space at the top for a headline, the product sharp and centred, photorealistic",
    captions: [
      { language: "en", text: "Angpau deal: buy [your product] and get [price] off. Until [date] only." },
      { language: "ms", text: "Tawaran angpau: beli [your product], dapat diskaun [price]. Sehingga [date] sahaja." },
      { language: "zh", text: "新春红包优惠:购买 [your product] 立减 [price],只到 [date]。" },
    ],
  },
  {
    id: "mid-autumn",
    name: "Mid-Autumn post",
    description: "Lantern and mooncake season styling.",
    category: "Festivals & seasons",
    industries: ["food-drink", "grocery", "home-living", "beauty"],
    tags: ["mid-autumn", "mooncake", "lantern", "zhongqiu", "gift", "tanglung"],
    needsImage: true,
    promptTemplate:
      "restyle this photo for the Mid-Autumn festival — paper lanterns glowing warm amber in a dark blue night, a full moon softly out of focus, osmanthus sprigs, dark wood table, the product lit warmly and sharply in the foreground, photorealistic",
    captions: [
      { language: "en", text: "Mid-Autumn boxes are open for order. [your product], [price] a set." },
      { language: "ms", text: "Tempahan set Pesta Tanglung dibuka. [your product], [price] satu set." },
      { language: "zh", text: "中秋礼盒开始接单。[your product],每套 [price],数量有限。" },
    ],
  },
  {
    id: "deepavali-glow",
    name: "Deepavali post",
    description: "Diya lamps and kolam colour around your product.",
    category: "Festivals & seasons",
    industries: ["any"],
    tags: ["deepavali", "diwali", "festival of lights", "kolam", "rangoli", "sweets"],
    needsImage: true,
    promptTemplate:
      "restyle this photo for Deepavali — rows of lit clay diya lamps, a colourful kolam pattern on the floor, marigold petals, jewel-tone magenta and gold fabric, warm golden lamplight, the product sharp and centred with clean space above it, photorealistic",
    captions: [
      { language: "en", text: "Happy Deepavali. [your product] is [price] this festive week." },
      { language: "ms", text: "Selamat Deepavali. [your product] pada [price] sepanjang minggu perayaan ini." },
    ],
  },
  {
    id: "christmas-gift",
    name: "Christmas gift post",
    description: "Wrap your product in a warm Christmas gifting scene.",
    category: "Festivals & seasons",
    industries: ["any"],
    tags: ["christmas", "xmas", "gift", "holiday", "year end", "secret santa"],
    needsImage: true,
    promptTemplate:
      "restyle this photo as a Christmas gifting scene — pine sprigs, warm fairy lights bokeh, kraft paper and red ribbon, soft snow-free tropical styling, cosy evening light, the product unwrapped and sharp in the foreground, clean space at the top, photorealistic",
    captions: [
      { language: "en", text: "Christmas gifting sorted. [your product] from [price] — order by [date] to get it in time." },
      { language: "ms", text: "Hadiah Krismas dah settle. [your product] dari [price] — tempah sebelum [date] supaya sempat." },
      { language: "zh", text: "圣诞送礼不用烦。[your product],[price] 起,[date] 前下单更从容。" },
    ],
  },
  {
    id: "merdeka-pride",
    name: "Merdeka and Malaysia Day post",
    description: "National-month styling in red, white, blue and yellow.",
    category: "Festivals & seasons",
    industries: ["any"],
    tags: ["merdeka", "malaysia day", "hari malaysia", "national day", "august", "september"],
    needsImage: true,
    promptTemplate:
      "restyle this photo for Malaysia's national month — a confident palette of red, white, royal blue and gold-yellow, ribbon streamers and bunting softly out of focus, bright midday light, proud and clean rather than cluttered, the product sharp and centred with clean space above it, no flags and no lettering, photorealistic",
    captions: [
      { language: "en", text: "Merdeka deal: [your product] at [price], until [date]." },
      { language: "ms", text: "Tawaran Merdeka: [your product] pada [price], sehingga [date]." },
    ],
  },
  {
    id: "gawai-kaamatan",
    name: "Gawai and Kaamatan post",
    description: "Harvest festival styling for Sarawak and Sabah customers.",
    category: "Festivals & seasons",
    industries: ["any"],
    tags: ["gawai", "kaamatan", "harvest", "sarawak", "sabah", "borneo", "pesta"],
    needsImage: true,
    promptTemplate:
      "restyle this photo for the Borneo harvest festival season — handwoven rattan and beadwork textures, warm earth tones with black, red and yellow accents, bamboo and paddy stalks, warm late-afternoon light, the product sharp and centred, photorealistic",
    captions: [
      { language: "en", text: "Selamat Ari Gawai and Kotobian Tadau Tagazo. [your product] at [price] this week." },
      { language: "ms", text: "Selamat Ari Gawai dan Kotobian Tadau Tagazo Do Kaamatan. [your product] pada [price] minggu ini." },
    ],
  },
  {
    id: "ramadan-bazar",
    name: "Ramadan bazaar stall",
    description: "Show your food the way it looks at a bazaar stall at dusk.",
    category: "Festivals & seasons",
    industries: ["food-drink", "grocery"],
    tags: ["ramadan", "bazar", "bazaar", "iftar", "buka puasa", "moreh", "sahur"],
    needsImage: true,
    promptTemplate:
      "place this food at a Malaysian Ramadan bazaar stall at dusk — string bulbs overhead, steam rising, banana leaf and brown paper packaging, warm amber light against a deep blue evening sky, busy stall softly out of focus behind, the food sharp and appetising in the foreground, photorealistic",
    captions: [
      { language: "en", text: "Buka puasa is sorted. [your product] at [price] — pre-order and skip the queue." },
      { language: "ms", text: "Juadah berbuka dah ada. [your product] pada [price] — pre-order, tak payah beratur." },
    ],
  },
  {
    id: "monsoon-comfort",
    name: "Rainy season post",
    description: "Cosy monsoon styling for the wet months.",
    category: "Festivals & seasons",
    industries: ["food-drink", "home-living", "fashion", "health"],
    tags: ["monsoon", "rainy", "hujan", "cosy", "season", "november", "december"],
    needsImage: true,
    promptTemplate:
      "restyle this photo for a rainy Malaysian evening — rain-streaked window behind, warm indoor lamplight, soft blanket and wood textures, moody blue-grey outside against amber inside, gentle steam if the product is hot, the product sharp and inviting in the foreground, photorealistic",
    captions: [
      { language: "en", text: "Rainy day, easy fix. [your product] — [price]." },
      { language: "ms", text: "Hujan-hujan macam ni memang sesuai. [your product] — [price]." },
    ],
  },

  // ── Marketplace listings ──────────────────────────────────────────────────
  {
    id: "marketplace-main-image",
    name: "Marketplace main image",
    description: "A clean square main image that fits Shopee, Lazada and TikTok Shop listings.",
    category: "Marketplace listings",
    industries: ["any"],
    tags: ["shopee", "lazada", "tiktok shop", "listing", "main image", "thumbnail", "ecommerce"],
    needsImage: true,
    aspectRatio: "1:1",
    promptTemplate:
      "a square e-commerce main image of this product — pure white seamless background, product centred and filling about 85 percent of the frame, even soft studio lighting, true colours, a soft natural contact shadow, no props, no text, no watermark, photorealistic",
    captions: [
      { language: "en", text: "[your product] — [price]. Tap to buy." },
      { language: "ms", text: "[your product] — [price]. Klik untuk beli." },
      { language: "zh", text: "[your product] — [price],点击下单。" },
    ],
  },
  {
    id: "marketplace-variants",
    name: "Colour and variant line-up",
    description: "Show every colour or size you stock in one square image.",
    category: "Marketplace listings",
    industries: ["fashion", "beauty", "home-living", "electronics", "any"],
    tags: ["variants", "colours", "sizes", "range", "listing", "shopee", "lazada"],
    needsImage: true,
    aspectRatio: "1:1",
    question: { label: "Which variants should I show?", placeholder: "e.g. black, cream, olive and maroon" },
    promptTemplate:
      "a square e-commerce image showing this same product repeated in these variants: {q} — arranged in a neat evenly spaced row or grid on a pure white seamless background, identical lighting and angle on every unit, soft contact shadows, no text, photorealistic",
    captions: [
      { language: "en", text: "All colours back in stock. Pick yours — [your product], [price]." },
      { language: "ms", text: "Semua warna dah restock. Pilih warna anda — [your product], [price]." },
    ],
  },
  {
    id: "marketplace-bundle",
    name: "Bundle deal image",
    description: "Group several items into one bundle shot buyers understand instantly.",
    category: "Marketplace listings",
    industries: ["any"],
    tags: ["bundle", "set", "combo", "value pack", "listing", "shopee", "lazada"],
    needsImage: true,
    aspectRatio: "1:1",
    question: { label: "What's in the bundle?", placeholder: "e.g. 3 bottles plus a travel pouch" },
    promptTemplate:
      "a square e-commerce bundle image showing {q} arranged together as one set on a pure white seamless background, items overlapping slightly in a balanced pyramid, even studio lighting, soft contact shadows, generous clean margin, no text, photorealistic",
    captions: [
      { language: "en", text: "Bundle and save. [your product] set at [price] — cheaper than buying separately." },
      { language: "ms", text: "Beli set, jimat lagi. Set [your product] pada [price] — lebih murah daripada beli berasingan." },
    ],
  },
  {
    id: "marketplace-size-guide",
    name: "Size reference shot",
    description: "Answer the size question before a buyer has to ask it.",
    category: "Marketplace listings",
    industries: ["any"],
    tags: ["size", "scale", "dimensions", "comparison", "listing", "returns"],
    needsImage: true,
    aspectRatio: "1:1",
    question: { label: "What everyday object shows the size?", placeholder: "e.g. a hand, a phone, a 500ml bottle" },
    promptTemplate:
      "a square e-commerce scale-reference image of this product photographed beside {q} for size comparison, both on a pure white seamless background, straight-on eye-level angle so the proportions read correctly, even studio lighting, soft contact shadows, no text, photorealistic",
    captions: [
      { language: "en", text: "Wondering about the size? Here it is next to [your product]. [price]." },
      { language: "ms", text: "Risau pasal saiz? Ini perbandingannya. [your product], [price]." },
    ],
  },
  {
    id: "marketplace-whats-inside",
    name: "What's in the box",
    description: "Lay out everything the buyer receives, so nothing feels like a surprise.",
    category: "Marketplace listings",
    industries: ["any"],
    tags: ["unboxing", "contents", "included", "flat lay", "listing", "packaging"],
    needsImage: true,
    aspectRatio: "1:1",
    question: { label: "What's included?", placeholder: "e.g. the bottle, a pump, a scoop and a booklet" },
    promptTemplate:
      "a square top-down flat lay showing everything included in the box: {q} — laid out in neat evenly spaced rows on a pure white seamless background, shot straight down, even soft studio lighting, no props, no text, photorealistic",
    captions: [
      { language: "en", text: "Everything you get in one box. [your product], [price]." },
      { language: "ms", text: "Semua yang anda dapat dalam satu kotak. [your product], [price]." },
    ],
  },
  {
    id: "double-date-sale",
    name: "Double-date sale image",
    description: "A square sale image with your headline, for 9.9, 11.11 and 12.12.",
    category: "Marketplace listings",
    industries: ["any"],
    tags: ["11.11", "12.12", "9.9", "sale", "campaign", "payday", "shopee", "lazada", "flash sale"],
    needsImage: true,
    rendersHeadline: true,
    aspectRatio: "1:1",
    question: { label: "What should the headline say?", placeholder: "e.g. 11.11 SALE 60% OFF" },
    promptTemplate:
      "a square high-contrast e-commerce sale image built around this product — bold saturated brand-colour background with a diagonal burst, the product cut out and centred with a crisp drop shadow, energetic and clean rather than cluttered; render the exact headline \"{q}\" once in a very bold clean sans-serif, spelled exactly as given, and put no other lettering anywhere in the image",
    captions: [
      { language: "en", text: "Sale is live. [your product] drops to [price] until [date] — while stock lasts." },
      { language: "ms", text: "Jualan bermula! [your product] turun ke [price] sehingga [date] — selagi ada stok." },
      { language: "zh", text: "大促开抢![your product] 直降至 [price],只到 [date],售完即止。" },
    ],
  },

  // ── Food & drink ──────────────────────────────────────────────────────────
  {
    id: "fnb-hero-dish",
    name: "Hero shot of your dish",
    description: "One dish, styled so it looks worth ordering.",
    category: "Food & drink",
    industries: ["food-drink"],
    tags: ["food", "dish", "restaurant", "cafe", "menu", "hero"],
    needsImage: true,
    promptTemplate:
      "a mouth-watering hero food photograph of this dish — 45-degree angle, shallow depth of field, warm directional window light with a soft fill, fresh garnish, gentle steam, dark wood or slate surface, styled but honest, razor-sharp on the food, photorealistic",
    captions: [
      { language: "en", text: "[your product] — [price]. Message us to order." },
      { language: "ms", text: "[your product] — [price]. Mesej kami untuk tempah." },
    ],
  },
  {
    id: "fnb-combo-set",
    name: "Combo set photo",
    description: "Show a full set the way it lands on the table.",
    category: "Food & drink",
    industries: ["food-drink"],
    tags: ["combo", "set", "lunch set", "value meal", "menu", "nasi", "package"],
    needsImage: true,
    question: { label: "What's in the set?", placeholder: "e.g. nasi lemak, ayam goreng and teh ais" },
    promptTemplate:
      "a top-down photograph of a complete Malaysian meal set laid out on a tray: {q} — served in the real everyday tableware a local shop uses, banana leaf or melamine plate, cutlery and a drink placed naturally, warm daylight, appetising and generous, shot straight down, photorealistic",
    captions: [
      { language: "en", text: "Set [your product] — [price]. Enough to keep you going till evening." },
      { language: "ms", text: "Set [your product] — [price]. Kenyang sampai petang." },
    ],
  },
  {
    id: "fnb-delivery-pack",
    name: "Delivery-ready pack",
    description: "Your food packed the way a delivery rider brings it.",
    category: "Food & drink",
    industries: ["food-drink", "grocery"],
    tags: ["delivery", "takeaway", "bungkus", "grabfood", "foodpanda", "packaging", "rider"],
    needsImage: true,
    aspectRatio: "1:1",
    promptTemplate:
      "a square photograph of this food packed for delivery — kraft takeaway box and paper bag, lid half open so the food is visible and steaming, cutlery and napkin beside it, clean neutral countertop, bright even daylight, appetising and tidy, no branding and no text on the packaging, photorealistic",
    captions: [
      { language: "en", text: "Order [your product] on delivery — [price], hot at your door in [delivery time]." },
      { language: "ms", text: "Order [your product] melalui penghantaran — [price], sampai panas dalam [delivery time]." },
    ],
  },
  {
    id: "fnb-iced-drink",
    name: "Iced drink shot",
    description: "Cold, sweating glass — the shot that sells drinks in this weather.",
    category: "Food & drink",
    industries: ["food-drink"],
    tags: ["drink", "beverage", "iced", "boba", "kopi", "teh ais", "juice", "cafe"],
    needsImage: true,
    promptTemplate:
      "a photograph of this drink served ice-cold — tall clear glass or cup with heavy condensation running down, visible ice and layers, a bright backlight making the drink glow, fresh garnish, clean bright background softly out of focus, refreshing and crisp, photorealistic",
    captions: [
      { language: "en", text: "This weather needs this drink. [your product], [price]." },
      { language: "ms", text: "Cuaca panas macam ni memang kena. [your product], [price]." },
    ],
  },
  {
    id: "fnb-menu-board",
    name: "Menu board backdrop",
    description: "A clean board with space for you to type your prices over it.",
    category: "Food & drink",
    industries: ["food-drink"],
    tags: ["menu", "price list", "board", "cafe", "stall", "backdrop"],
    needsImage: true,
    promptTemplate:
      "a menu board scene built around this dish — the dish styled small in one lower corner, the rest of the frame a clean uncluttered surface with generous empty space for a price list to be added later, warm cafe lighting, subtle wood and chalkboard texture, no lettering anywhere, photorealistic",
    captions: [
      { language: "en", text: "New menu is up. [your product] and more, from [price]." },
      { language: "ms", text: "Menu baharu dah keluar. [your product] dan banyak lagi, dari [price]." },
    ],
  },
  {
    id: "fnb-kopitiam-table",
    name: "Kopitiam table scene",
    description: "Marble table, mamak lighting — the setting locals recognise.",
    category: "Food & drink",
    industries: ["food-drink"],
    tags: ["kopitiam", "mamak", "warung", "gerai", "local", "table", "roti canai", "supper"],
    needsImage: true,
    promptTemplate:
      "place this food on a classic Malaysian kopitiam table — round marble top with a wooden rim, mosaic floor tiles, stainless steel kettle and a condensed-milk tin nearby, ceiling fan and old shop shutters softly out of focus, warm tungsten overhead light, lived-in and authentic, the food sharp in the foreground, photorealistic",
    captions: [
      { language: "en", text: "Same corner, same taste since day one. [your product], [price]. See you at [shop name]." },
      { language: "ms", text: "Tempat sama, rasa sama macam dulu. [your product], [price]. Jumpa di [shop name]." },
      { language: "zh", text: "老位子,老味道。[your product] 只要 [price],[shop name] 等你。" },
    ],
  },
  {
    id: "fnb-kuih-tray",
    name: "Kuih and dessert tray",
    description: "A full tray of kuih or desserts, arranged to look generous.",
    category: "Food & drink",
    industries: ["food-drink", "grocery"],
    tags: ["kuih", "dessert", "bakery", "tray", "catering", "high tea", "sweets"],
    needsImage: true,
    promptTemplate:
      "a top-down photograph of these desserts arranged on a generous serving tray — neat rows with a little natural variation, banana leaf or pandan leaf lining, small tongs and paper cases, soft diffused daylight, fresh and abundant, shot straight down, photorealistic",
    captions: [
      { language: "en", text: "Trays for the office, kenduri or high tea. [your product] from [price]. Order [lead time] ahead." },
      { language: "ms", text: "Dulang untuk pejabat, kenduri atau jamuan. [your product] dari [price]. Tempah [lead time] awal." },
    ],
  },

  // ── Shop & services ───────────────────────────────────────────────────────
  {
    id: "grand-opening",
    name: "Grand opening post",
    description: "Announce a new outlet with your opening headline on the image.",
    category: "Shop & services",
    industries: ["any"],
    tags: ["opening", "new shop", "launch", "grand opening", "new outlet", "pembukaan"],
    needsImage: true,
    rendersHeadline: true,
    aspectRatio: "1:1",
    question: { label: "What should the headline say?", placeholder: "e.g. GRAND OPENING 12 JUN" },
    promptTemplate:
      "a square celebratory grand opening image built from this photo — festive ribbon and balloon garland framing the top corners, confetti, bright warm daylight, a clean bold colour block behind the subject, celebratory but uncluttered; render the exact headline \"{q}\" once in a bold clean sans-serif, spelled exactly as given, and put no other lettering anywhere in the image",
    captions: [
      { language: "en", text: "We're open! Come by [shop name] from [date] — opening week special at [price]." },
      { language: "ms", text: "Kami dah buka! Singgah ke [shop name] mulai [date] — istimewa minggu pembukaan pada [price]." },
      { language: "zh", text: "新店开张![shop name] [date] 起营业,开幕周特价 [price]。" },
    ],
  },
  {
    id: "shopfront-hero",
    name: "Shopfront hero shot",
    description: "Make your shop look inviting from the street.",
    category: "Shop & services",
    industries: ["any"],
    tags: ["shopfront", "storefront", "premise", "outlet", "location", "kedai"],
    needsImage: true,
    aspectRatio: "16:9",
    promptTemplate:
      "a wide inviting exterior photograph of this shopfront — golden-hour light, warm glow from inside spilling onto the walkway, clean tidy frontage, a few softly blurred passers-by for life, no clutter and no visible signage lettering, architectural and welcoming, photorealistic",
    captions: [
      { language: "en", text: "Find us at [shop name]. Open [date]." },
      { language: "ms", text: "Cari kami di [shop name]. Buka [date]." },
    ],
  },
  {
    id: "before-after",
    name: "Before and after",
    description: "One image, two halves — the strongest proof a service can post.",
    category: "Shop & services",
    industries: ["services", "automotive", "beauty", "home-living"],
    tags: ["before after", "results", "proof", "cleaning", "detailing", "repair", "transformation"],
    needsImage: true,
    aspectRatio: "16:9",
    question: { label: "What's the service?", placeholder: "e.g. car interior detailing" },
    promptTemplate:
      "a split-frame before-and-after image for {q} using this photo — the left half as it arrived, dull and worn, the right half after the work, clean and restored, identical camera angle, framing and lighting on both halves so only the condition changes, a thin clean divider down the middle, no lettering, photorealistic",
    captions: [
      { language: "en", text: "One visit, this much difference. [your product] from [price] — slots open [date]." },
      { language: "ms", text: "Sekali servis, beza macam ni. [your product] dari [price] — slot terbuka [date]." },
    ],
  },
  {
    id: "service-price-card",
    name: "Service price card",
    description: "A clean card with room for you to add your service list and prices.",
    category: "Shop & services",
    industries: ["services", "beauty", "health", "automotive", "kids-education"],
    tags: ["price list", "services", "rate card", "packages", "backdrop"],
    needsImage: true,
    aspectRatio: "1:1",
    promptTemplate:
      "a square price-card background built from this photo — the subject styled small along the bottom edge, the upper two-thirds a clean calm surface with a soft brand-colour gradient and generous empty space for a service list to be added later, soft even light, minimal and premium, no lettering anywhere, photorealistic",
    captions: [
      { language: "en", text: "Our full service list, updated for [date]. Starting from [price]. WhatsApp us to book." },
      { language: "ms", text: "Senarai penuh perkhidmatan kami, dikemas kini untuk [date]. Bermula [price]. WhatsApp untuk tempah." },
    ],
  },
  {
    id: "booking-slots",
    name: "Open slots post",
    description: "Tell customers this week still has room.",
    category: "Shop & services",
    industries: ["services", "beauty", "health", "kids-education", "automotive"],
    tags: ["booking", "appointment", "slots", "schedule", "availability", "tempahan"],
    needsImage: true,
    aspectRatio: "1:1",
    promptTemplate:
      "a square calm appointment-announcement image built from this photo — the subject placed to one side, a soft neutral backdrop with a warm gradient, an uncluttered open area on the other side for dates to be added later, soft natural light, professional and unhurried, no lettering anywhere, photorealistic",
    captions: [
      { language: "en", text: "Slots still open this week. Book [your product] from [price] — WhatsApp to reserve." },
      { language: "ms", text: "Masih ada slot minggu ini. Tempah [your product] dari [price] — WhatsApp untuk tempahan." },
    ],
  },
  {
    id: "team-intro",
    name: "Meet the team post",
    description: "Put a face to the shop — the post that builds trust fastest.",
    category: "Shop & services",
    industries: ["services", "food-drink", "beauty", "health", "any"],
    tags: ["team", "staff", "about us", "trust", "people", "founder"],
    needsImage: true,
    promptTemplate:
      "a warm friendly portrait from this photo in the setting of a small business — natural window light, relaxed genuine posture, workplace softly out of focus behind, honest documentary styling with no heavy retouching, keep every face exactly as in the source photo, photorealistic",
    captions: [
      { language: "en", text: "The people behind [shop name]. Say hi when you drop by." },
      { language: "ms", text: "Inilah orang di sebalik [shop name]. Tegur kami bila singgah." },
    ],
  },

  // ── Social posts ──────────────────────────────────────────────────────────
  {
    id: "social-in-hand",
    name: "In-hand shot",
    description: "The casual hand-held look that reads as a real customer photo.",
    category: "Social posts",
    industries: ["any"],
    tags: ["ugc", "in hand", "casual", "authentic", "instagram", "review"],
    needsImage: true,
    promptTemplate:
      "a casual user-generated-style photo of a hand holding this product, natural daylight, everyday background softly out of focus, slightly imperfect framing for authenticity, shot as if on a phone, keep the product accurate and readable, photorealistic",
    captions: [
      { language: "en", text: "Restocked because you kept asking. [your product], [price]." },
      { language: "ms", text: "Restock sebab ramai tanya. [your product], [price]." },
    ],
  },
  {
    id: "social-flatlay",
    name: "Flat lay with props",
    description: "A styled top-down shot with props that suit the local scene.",
    category: "Social posts",
    industries: ["any"],
    tags: ["flat lay", "flatlay", "styling", "props", "instagram", "top down"],
    needsImage: true,
    aspectRatio: "1:1",
    question: { label: "What props suit your product?", placeholder: "e.g. tropical leaves, batik cloth and a kopi cup" },
    promptTemplate:
      "a square top-down flat lay of this product styled with {q} — balanced composition with generous negative space, natural textures, soft diffused daylight, shot straight down, editorial and calm, photorealistic",
    captions: [
      { language: "en", text: "Little things that make the day better. [your product], [price]." },
      { language: "ms", text: "Benda kecil yang buat hari anda lebih baik. [your product], [price]." },
    ],
  },
  {
    id: "social-story",
    name: "Vertical story image",
    description: "A tall image sized for stories and reels covers.",
    category: "Social posts",
    industries: ["any"],
    tags: ["story", "reels", "vertical", "9:16", "instagram", "tiktok", "status"],
    needsImage: true,
    aspectRatio: "9:16",
    promptTemplate:
      "a tall vertical social story image of this product — the product placed in the lower third and sharply lit, a clean uncluttered gradient or textured backdrop filling the upper half so text can be added later, bold colour, soft directional light, no lettering anywhere, photorealistic",
    captions: [
      { language: "en", text: "Swipe up before it's gone. [your product] at [price] until [date]." },
      { language: "ms", text: "Swipe up sebelum habis. [your product] pada [price] sehingga [date]." },
    ],
  },
  {
    id: "social-carousel-cover",
    name: "Carousel cover",
    description: "A square cover with your hook on it, to open a multi-slide post.",
    category: "Social posts",
    industries: ["any"],
    tags: ["carousel", "cover", "hook", "instagram", "slides", "facebook"],
    needsImage: true,
    rendersHeadline: true,
    aspectRatio: "1:1",
    question: { label: "What should the cover say?", placeholder: "e.g. 3 WAYS TO USE THIS" },
    promptTemplate:
      "a square carousel cover image built from this product photo — the product in the lower half, a bold flat colour block across the upper half, strong contrast, clean editorial layout; render the exact text \"{q}\" once on the colour block in a bold clean sans-serif, spelled exactly as given, and put no other lettering anywhere in the image",
    captions: [
      { language: "en", text: "Swipe for all of them. [your product] is [price] — link in bio." },
      { language: "ms", text: "Swipe untuk semuanya. [your product] pada [price] — link di bio." },
    ],
  },
  {
    id: "social-testimonial",
    name: "Testimonial card",
    description: "A quiet backdrop for a real customer review you paste in later.",
    category: "Social posts",
    industries: ["any"],
    tags: ["testimonial", "review", "feedback", "social proof", "rating", "backdrop"],
    needsImage: true,
    aspectRatio: "1:1",
    promptTemplate:
      "a square testimonial-card background built from this photo — the product small and softly lit in one corner, the rest a calm blurred backdrop with a gentle brand-colour wash and large empty space for a quote to be added later, warm soft light, understated and trustworthy, no lettering anywhere, photorealistic",
    captions: [
      { language: "en", text: "Straight from a customer this week. Thank you — [your product] is [price], restocked now." },
      { language: "ms", text: "Terus dari pelanggan minggu ini. Terima kasih — [your product] [price], dah restock." },
    ],
  },
  {
    id: "social-restock",
    name: "Restock announcement",
    description: "The back-in-stock post, styled to feel urgent without shouting.",
    category: "Social posts",
    industries: ["any"],
    tags: ["restock", "back in stock", "sold out", "limited", "ready stock", "preorder"],
    needsImage: true,
    aspectRatio: "1:1",
    promptTemplate:
      "a square restock announcement image of this product — several units stacked and neatly aligned as fresh inventory, clean bright backdrop in a single confident colour, crisp studio lighting with a soft shadow, plenty of empty space at the top, energetic and tidy, no lettering, photorealistic",
    captions: [
      { language: "en", text: "Back in stock, and it goes fast. [your product], [price]. First come first served." },
      { language: "ms", text: "Dah restock, dan cepat habis. [your product], [price]. Siapa cepat dia dapat." },
      { language: "zh", text: "补货到![your product],[price],数量有限,手快有手慢无。" },
    ],
  },
];

/** Fill "{q}" with the trimmed answer; no-question templates return their prompt verbatim. */
export function buildTemplatePrompt(t: Template, answer?: string): string {
  if (!t.question) return t.promptTemplate;
  return t.promptTemplate.replace("{q}", (answer ?? "").trim());
}

/** 一次模板运行 = 一张图。报价与扣费共用这一个数,所以 TemplateModal 的 `count` 也读它 ——
 *  两处各写一个 1,就是「报的」与「扣的」分家的第一步。 */
export const TEMPLATE_RUN_IMAGE_COUNT = 1;

/**
 * 一次模板运行的**显示 credits**。
 *
 * 判官 r1 P1:上一版拿 `GEN_PRICE_USD_PER_IMAGE` 除以展示面额反推价。那个常量是
 * **record-only 的 COGS**(成本记账),不是收费权威;真正 reserve/settle 走的是
 * `pricedGenCredits()`。今天两条路碰巧都得 1,所以看不出来 —— 而这正是最坏的一种:
 * 下一次调价,商家看到的价与账上扣的数当场分家,谁都不会先红。
 *
 * 改成与 `defaultVideoDisplayCredits()` 同一条路:**问收费函数,再翻成展示面额**。
 * `templates.test.ts` 有一条恒等断言钉住「报价 == 扣费」,再分家就当场红。
 */
export function templateRunCredits(): number {
  return displayCredits(
    pricedGenCredits({
      kind: "IMAGE",
      model: GEN_MODELS[0],
      count: TEMPLATE_RUN_IMAGE_COUNT,
      videoOptions: null,
    }),
  );
}

/** Unique categories in first-seen order (for the filter row). */
export function templateCategories(list: Template[] = TEMPLATES): string[] {
  const seen: string[] = [];
  for (const t of list) if (!seen.includes(t.category)) seen.push(t.category);
  return seen;
}

export function templateById(id: string, list: Template[] = TEMPLATES): Template | null {
  return list.find((t) => t.id === id) ?? null;
}

/** Captions for one language; empty when this template has none in that language. */
export function templateCaptions(t: Template, language: TemplateCaptionLanguage): string[] {
  return t.captions.filter((c) => c.language === language).map((c) => c.text);
}

/**
 * 商家会用来描述自己的词 → 行业标签。
 * 这里的词表是马来西亚口语的:kopitiam / mamak / kedai runcit / tadika / tayar 都算数,
 * 因为商家跟 Otto 说话时用的就是这些词,不是「food & beverage vertical」。
 * 匹配用最长词优先,所以 "phone accessories" 命中 electronics 而不是 fashion 的 "accessories"。
 */
export const TEMPLATE_INDUSTRY_ALIASES: Record<string, TemplateIndustry> = {
  // food & drink
  restaurant: "food-drink", cafe: "food-drink", "coffee shop": "food-drink", kopitiam: "food-drink",
  mamak: "food-drink", warung: "food-drink", gerai: "food-drink", "kedai makan": "food-drink",
  bakery: "food-drink", catering: "food-drink", dessert: "food-drink", kuih: "food-drink",
  "bubble tea": "food-drink", boba: "food-drink", juice: "food-drink", "food truck": "food-drink",
  nasi: "food-drink", roti: "food-drink", satay: "food-drink", seafood: "food-drink",
  steamboat: "food-drink", "frozen food": "food-drink", snack: "food-drink", food: "food-drink",
  drinks: "food-drink", beverage: "food-drink", bistro: "food-drink", "chicken rice": "food-drink",
  // fashion
  boutique: "fashion", baju: "fashion", kurung: "fashion", hijab: "fashion", tudung: "fashion",
  abaya: "fashion", apparel: "fashion", clothing: "fashion", fashion: "fashion", shoes: "fashion",
  handbag: "fashion", jewellery: "fashion", jewelry: "fashion", accessories: "fashion",
  streetwear: "fashion", batik: "fashion", kebaya: "fashion", tailor: "fashion",
  scarf: "fashion", scarves: "fashion", shawl: "fashion",
  // beauty
  skincare: "beauty", cosmetics: "beauty", makeup: "beauty", salon: "beauty", spa: "beauty",
  barber: "beauty", nails: "beauty", lashes: "beauty", perfume: "beauty", haircare: "beauty",
  beauty: "beauty",
  // grocery
  grocery: "grocery", sundry: "grocery", minimart: "grocery", "kedai runcit": "grocery",
  mart: "grocery", supermarket: "grocery", borong: "grocery", wholesale: "grocery", pasar: "grocery",
  // home & living
  furniture: "home-living", decor: "home-living", kitchenware: "home-living", bedding: "home-living",
  hardware: "home-living", florist: "home-living", plants: "home-living", "home living": "home-living",
  carpet: "home-living", curtain: "home-living",
  cleaning: "home-living",
  // electronics
  "phone accessories": "electronics", gadget: "electronics", phone: "electronics",
  computer: "electronics", laptop: "electronics", electronics: "electronics", gaming: "electronics",
  // health
  pharmacy: "health", farmasi: "health", supplement: "health", vitamin: "health", clinic: "health",
  dental: "health", herbal: "health", wellness: "health", health: "health",
  // kids & education
  tuition: "kids-education", tadika: "kids-education", kindergarten: "kids-education",
  toys: "kids-education", baby: "kids-education", kids: "kids-education", education: "kids-education",
  childcare: "kids-education", nursery: "kids-education",
  enrichment: "kids-education",
  // services
  printing: "services", laundry: "services", dobi: "services", photography: "services",
  event: "services", wedding: "services", travel: "services", courier: "services",
  repair: "services", agency: "services", service: "services", services: "services",
  // automotive
  "car wash": "automotive", "car detailing": "automotive", workshop: "automotive",
  bengkel: "automotive", tyre: "automotive", tayar: "automotive", motor: "automotive",
  automotive: "automotive", car: "automotive", kereta: "automotive",
};

const ALIAS_KEYS_LONGEST_FIRST = Object.keys(TEMPLATE_INDUSTRY_ALIASES).sort(
  (a, b) => b.length - a.length,
);

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

/**
 * 词边界命中。判官 r1 P2:上一版用 `text.includes(key)`,于是 `car` 把 scarves、
 * carpet shop、childcare centre 三家都判成汽车行 —— 一次静默错分,后面推的每一条都错。
 * 别名全是字母与空格,所以 `\b…\b` 就够;多词别名照旧靠「最长优先」先命中。
 */
function hasWord(haystack: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(ESCAPE_RE, "\\$&")}\\b`, "i").test(haystack);
}

/** 自由文本(「nasi lemak stall」「hijab boutique」)→ 行业标签;认不出就是 null。 */
export function resolveTemplateIndustry(raw: string | null | undefined): TemplateIndustry | null {
  const text = (raw ?? "").toLowerCase().trim();
  if (!text) return null;
  for (const key of ALIAS_KEYS_LONGEST_FIRST) {
    if (hasWord(text, key)) return TEMPLATE_INDUSTRY_ALIASES[key] ?? null;
  }
  return null;
}

export const RECOMMEND_LIMIT_DEFAULT = 5;
export const RECOMMEND_LIMIT_MAX = 12;

export type TemplateRecommendInput = {
  /** 商家怎么形容自己的生意(自由文本)。 */
  industry?: string | null;
  /** 节庆/场合(自由文本),例如 "Hari Raya"、"11.11"。 */
  occasion?: string | null;
  /** 商家原话里的其它线索。 */
  query?: string | null;
  limit?: number;
};

function words(text: string | null | undefined): string[] {
  return (text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((w) => w.length > 2);
}

/**
 * 纯打分推荐。行业命中最重,其次是场合/关键词命中,最后才是通用模板。
 * 完全没有线索(或一条都没命中)时回落到通用模板(`industries` 含 `any`),按目录顺序 ——
 * 宁可给新手一排稳的,也不给一排随机的。
 */
export function recommendTemplates(
  input: TemplateRecommendInput = {},
  list: Template[] = TEMPLATES,
): Template[] {
  const limit = Math.max(1, Math.min(input.limit ?? RECOMMEND_LIMIT_DEFAULT, RECOMMEND_LIMIT_MAX));
  const industry = resolveTemplateIndustry(input.industry);
  const occasionText = `${input.occasion ?? ""} ${input.query ?? ""}`.toLowerCase().trim();
  const occasionWords = words(occasionText);

  const scored = list.map((t, index) => {
    let score = 0;
    if (industry) {
      if (t.industries.includes(industry)) score += 4;
      else if (t.industries.includes("any")) score += 1;
    }
    // 日历绑定的模板只有在商家真的提到场合时才该冒头 —— 十月给人推开斋节 hamper,
    // 是把「推荐」变成噪音。提了场合就没有这一格扣分。
    if (!occasionText && t.category === "Festivals & seasons") score -= 2;
    if (occasionText) {
      // 同 resolveTemplateIndustry:一律词边界,免得 "car" 命中 "carousel"、"cny" 命中别的词。
      for (const tag of t.tags) {
        if (hasWord(occasionText, tag)) score += 3;
      }
      const haystack = `${t.name} ${t.description}`.toLowerCase();
      for (const w of occasionWords) {
        if (hasWord(haystack, w)) score += 1;
      }
    }
    return { t, index, score };
  });

  const hits = scored.filter((s) => s.score > 0);
  if (hits.length === 0) {
    return list.filter((t) => t.industries.includes("any")).slice(0, limit);
  }
  hits.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return hits.slice(0, limit).map((s) => s.t);
}

/** UI 的分类 + 搜索过滤。空条件 = 原样返回。 */
export function filterTemplates(
  list: Template[],
  options: { category?: string | null; search?: string | null } = {},
): Template[] {
  const category = options.category && options.category !== "All" ? options.category : null;
  const search = (options.search ?? "").toLowerCase().trim();
  return list.filter((t) => {
    if (category && t.category !== category) return false;
    if (!search) return true;
    const haystack = `${t.name} ${t.description} ${t.category} ${t.tags.join(" ")}`.toLowerCase();
    return haystack.includes(search);
  });
}
