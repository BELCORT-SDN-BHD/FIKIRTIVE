/**
 * **演员库 v1 —— 人物卡与九套造型 preset 的单一来源**
 * (规格 `docs/specs/creation-engine.md`:九问1⑤、§5 2026-08-30「两轴模型」行、§8.1③)。
 *
 * 商家挑一个角色就能连续出片,而角色本身是**平台自建的虚构代言人** —— 每人一对
 * Seedream 纯文生定妆图(特写＋全身)。真人脸走 A9 的诚实拦截,这里是那条拦截给出的
 * 出路,所以这张名单必须只有一份:Otto 写提示词读它、UI 画角色卡读它、播种脚本
 * 建实体读它(Founder 2026-08-30「一卡三用」)。
 *
 * ── 两轴模型(Founder 2026-08-30 拍板,后续每次加 avatar 一律遵循)──────────────
 *
 *   演员(定妆对 ＋ 人物卡) × 造型 preset(prompt 层 wardrobe 块)= 正交组合。
 *   任何演员可以穿任何 preset,零新图、零重铸 —— 换装发生在**提示词**里,已由
 *   2026-08-30 实测过片(厨师服,task `cgt-20260830213513-zb8zt`)。
 *
 *   preset 定的是**意图**,细节按人物卡适配:Aisyah 一律取 hijab 友好的 modest 版
 *   (厨师装＝围裙版,头巾不动);节庆传统装按各人族裔取自己那件(`festiveWardrobe`)。
 *   所以「穿什么」不是一个字符串常量,而是 `wardrobePromptFor(actor, key)` 这个函数
 *   ——两轴交叉的那一格,只有它算得出来。
 *
 * ── 像素完整性铁律(Founder 2026-08-30,规格 §5 同日行)────────────────────────
 *
 *   血统信任的标记在**像素**里:送进视频端的演员图必须是 Seedream 原始产物的**原字节**。
 *   已实证:原字节重传过门出片;同一张图**裁剪**后提交被拒「may contain real person」。
 *   所以这里为每张图钉死 `sha256` —— 播种时先验字节再入库(`apps/web/lib/actor-library-seed.ts`
 *   fail closed),仓库里的原件被人「顺手压一压」当场就断。缩放/滤镜/加字/转格式一律
 *   未实测＝未验先禁,展示用缩略图只能另存副本、永不回流生成路径。
 *
 *   原件的家:`assets/actor-library/v1/<assetPrefix>-{closeup,fullbody}.bin`(即 JPEG 原字节)。
 *   同目录的 `-card.json` 是**归档凭据**(定妆那次真正用过的卡),本文件是**权威**;
 *   两者由 `actor-library.test.ts` 逐字对住,任何一边先动都会红。
 *
 * 本文件是**叶子模块**:不 import 本包任何其他模块,也不碰 fs —— 它同时被浏览器侧
 * 的 UI 和服务端的播种脚本读,任何 node 依赖都会把它锁死在服务端。
 */

/* ───────────────────────────── 形状 ───────────────────────────── */

/** 演员库版本号。落在 `Entity.descriptionJson.catalog` 与 `catalogKey` 前缀里。 */
export const ACTOR_CATALOG_VERSION = "v1";

/**
 * 九套造型 preset(Founder 2026-08-30「就先这九套」)。
 *
 * 顺序即规格 §5 那一行的 ①–⑨,不重排:商家面按这个顺序排,Otto 的取用也按它。
 * 每套上架前 mini 480p 各验一条同脸(约 $0.05/套,帽饰头饰类重点盯同脸稳定性),
 * 验过才挂给商家 —— 那一步是运营动作,不在本文件里。
 */
export const WARDROBE_PRESET_KEYS = [
  "plain",
  "streetwear",
  "chef",
  "storefront",
  "business",
  "clinical",
  "salon",
  "gym",
  "festive",
] as const;

export type WardrobePresetKey = (typeof WARDROBE_PRESET_KEYS)[number];

export interface WardrobePreset {
  key: WardrobePresetKey;
  /** 商家读到的名字。English sentence case(项目 UI copy 规矩)。 */
  label: string;
  /** 商家读到的一句话:这套穿去哪儿。 */
  useCase: string;
  /**
   * 提示词里的换装块。`null` ＝ 素装:穿人物卡自己的 `WARDROBE`,定妆原样。
   * 每块都是一段完整的英文名词短语,直接接在角色描述后面即可。
   */
  prompt: string | null;
  /**
   * modest 版(hijab 友好):**意图不变**,只改覆盖度并明写头巾不动。
   * `null` ＝ 这套本来就够 modest,两版同文。
   */
  modestPrompt: string | null;
}

export interface ActorImage {
  /** 相对 `assets/actor-library/v1/` 的文件名。`.bin` ＝ JPEG 原字节。 */
  file: string;
  /** 落进 `ReferenceImage.viewTag`。 */
  viewTag: "closeup" | "fullbody";
  /** 原字节的 sha256,像素完整性的钉子。 */
  sha256: string;
  /** 入库时写给 storage 的扩展名 —— 字节是 JPEG,`.bin` 只是归档时的保护色。 */
  ext: "jpg";
}

/**
 * 一位演员的人物卡。
 *
 * 字段名对着定妆卡 `-card.json` 的六个键(ID/FACE/HAIR/H/BUILD/WARDROBE)一一落位。
 * 加新演员的铸造法(Founder 2026-08-30):人物卡先行、与库内全部现役演员两两互认
 * QC 过才收编;组图 `sequential auto, max_images=2` 一次出「特写＋全身」同身份对;
 * 素装统一制服 ＋ `#8a8a8a` 棚灰背景 ＋ photorealism 拉满。
 */
export interface ActorCard {
  /** 目录键,(ownerId, catalogKey) 在 `Entity` 上唯一 —— 幂等播种认的就是它。 */
  catalogKey: string;
  /** 资产文件前缀,如 `A1-aisyah`。 */
  assetPrefix: string;
  /** 商家看到的名字。 */
  name: string;
  /** 卡面 ID:族裔与年龄。对应 `-card.json` 的 `ID`。 */
  identity: string;
  /** 卡面 FACE:防撞脸的独有特征都在这一段里。 */
  face: string;
  /** 卡面 HAIR(戴头巾的演员这里写头巾)。 */
  hair: string;
  /** 卡面 H,厘米。 */
  heightCm: number;
  /** 卡面 BUILD。 */
  build: string;
  /** 卡面 WARDROBE ＝ 素装 preset 的内容。 */
  wardrobe: string;
  /** true ⇒ 所有 preset 一律取 modest 分支(hijab 友好)。 */
  modest: boolean;
  /** 节庆传统装(preset ⑨)按族裔适配的那一件。 */
  festiveWardrobe: string;
  closeup: ActorImage;
  fullbody: ActorImage;
}

/* ─────────────────────────── 九套 preset ─────────────────────────── */

const PRESETS: Readonly<Record<WardrobePresetKey, WardrobePreset>> = {
  // ① 素装(默认定妆原样)—— prompt 为 null,由人物卡的 WARDROBE 顶上。
  plain: {
    key: "plain",
    label: "Plain",
    useCase: "The look the cast member was shot in — nothing added.",
    prompt: null,
    modestPrompt: null,
  },
  // ② Street wear(UGC/年轻向)
  streetwear: {
    key: "streetwear",
    label: "Street wear",
    useCase: "Handheld, creator-style clips and everyday product talk.",
    prompt:
      "wearing relaxed contemporary street wear: an oversized plain cotton t-shirt, "
      + "loose light-wash denim jeans, and clean chunky white sneakers",
    modestPrompt:
      "wearing relaxed contemporary street wear in a modest cut: an oversized plain cotton "
      + "long-sleeve top, loose light-wash denim jeans, and clean chunky white sneakers, "
      + "her hijab exactly as in the reference and fully covering the hair",
  },
  // ③ 厨师后厨白制服(已实测过片)
  chef: {
    key: "chef",
    label: "Chef whites",
    useCase: "Kitchens, food prep, restaurant and catering shops.",
    prompt:
      "wearing a professional back-of-house chef uniform: a white double-breasted cotton chef "
      + "jacket with the sleeves rolled to the forearm, a charcoal cotton apron tied at the waist, "
      + "and dark kitchen trousers",
    modestPrompt:
      "wearing a professional back-of-house chef uniform: a white double-breasted cotton chef "
      + "jacket with full-length sleeves, a charcoal cotton apron tied at the waist, and dark "
      + "kitchen trousers, her hijab exactly as in the reference and no chef hat",
  },
  // ④ 门店服务(polo/围裙前场,咖啡/零售/便利店)
  storefront: {
    key: "storefront",
    label: "Storefront service",
    useCase: "Front-of-house counters — cafés, retail, convenience stores.",
    prompt:
      "wearing a front-of-house service uniform: a plain short-sleeve navy cotton piqué polo "
      + "shirt, a mid-length canvas work apron over it, and dark trousers",
    modestPrompt:
      "wearing a front-of-house service uniform: a plain long-sleeve navy cotton piqué polo "
      + "shirt, a mid-length canvas work apron over it, and dark trousers, her hijab exactly as "
      + "in the reference",
  },
  // ⑤ 商务(blazer/smart casual,房产/金融/B2B)
  business: {
    key: "business",
    label: "Business",
    useCase: "Property, finance, professional services and B2B pitches.",
    prompt:
      "wearing smart-casual business clothes: a well-fitted charcoal wool blazer over a crisp "
      + "white cotton shirt, tailored dark trousers, and polished leather shoes",
    modestPrompt:
      "wearing smart-casual business clothes in a modest cut: a well-fitted charcoal wool blazer "
      + "over a crisp long-sleeve white cotton shirt buttoned to the collar, tailored dark "
      + "trousers, and polished leather shoes, her hijab exactly as in the reference",
  },
  // ⑥ 医护(白袍/刷手服,诊所/牙科/药房)
  clinical: {
    key: "clinical",
    label: "Clinical",
    useCase: "Clinics, dental practices and pharmacies.",
    prompt:
      "wearing clinical work clothes: light blue cotton scrubs under an open white medical coat "
      + "with the sleeves at the wrist, and plain white shoes",
    modestPrompt:
      "wearing clinical work clothes in a modest cut: long-sleeve light blue cotton scrubs under "
      + "an open white medical coat, and plain white shoes, her hijab exactly as in the reference",
  },
  // ⑦ 美容沙龙(黑制服围裙)
  salon: {
    key: "salon",
    label: "Salon",
    useCase: "Hair, beauty, nail and spa studios.",
    prompt:
      "wearing a salon uniform: an all-black short-sleeve fitted top, a black cotton stylist "
      + "apron with front pockets, and black trousers",
    modestPrompt:
      "wearing a salon uniform: an all-black long-sleeve fitted top, a black cotton stylist "
      + "apron with front pockets, and black trousers, her hijab exactly as in the reference",
  },
  // ⑧ 健身(运动装)
  gym: {
    key: "gym",
    label: "Gym",
    useCase: "Gyms, studios, sportswear and wellness brands.",
    prompt:
      "wearing training clothes: a breathable athletic t-shirt, fitted performance shorts, and "
      + "running shoes",
    modestPrompt:
      "wearing modest training clothes: a breathable long-sleeve athletic top, loose "
      + "full-length performance leggings, and running shoes, her hijab exactly as in the "
      + "reference in a sports-jersey fabric",
  },
  // ⑨ 节庆传统装(Raya baju kurung/melayu、CNY 旗袍、Deepavali kurta)
  //    这套的衣服本身来自人物卡的 `festiveWardrobe` —— 见 wardrobePromptFor。
  festive: {
    key: "festive",
    label: "Festive",
    useCase: "Raya, Chinese New Year, Deepavali and other seasonal campaigns.",
    prompt: null,
    modestPrompt: null,
  },
};

/** 九套 preset,按规格里的 ①–⑨ 顺序。 */
export const WARDROBE_PRESETS: readonly WardrobePreset[] = WARDROBE_PRESET_KEYS.map((key) => PRESETS[key]);

export function wardrobePreset(key: WardrobePresetKey): WardrobePreset {
  return PRESETS[key];
}

export function isWardrobePresetKey(value: string | null | undefined): value is WardrobePresetKey {
  return (WARDROBE_PRESET_KEYS as readonly string[]).includes(value ?? "");
}

/* ───────────────────────────── 五人组 ───────────────────────────── */

/**
 * 创始五名即全量(Founder 2026-08-30 把「首发 50 名」改裁为此)。
 *
 * 五脸两两互认 QC 已过,定妆原件与 QC 记录归档在
 * `assets/actor-library/v1/` 与 preserved/actor-library-v1-2026-08-30/README.md。
 * 扩产与否 beta 后再裁 —— 加人要走上面「新增演员铸造法」的五步。
 */
export const ACTOR_LIBRARY: readonly ActorCard[] = [
  {
    catalogKey: "actor-v1-aisyah",
    assetPrefix: "A1-aisyah",
    name: "Aisyah",
    identity: "Malay woman, 28 years old",
    face:
      "soft round face with full cheeks, gentle almond-shaped warm brown eyes, naturally full "
      + "straight eyebrows, small rounded nose, small beauty mark near the left corner of her lips, "
      + "warm medium-tan skin, light natural makeup, kind approachable expression",
    hair:
      "plain sand-beige hijab in matte cotton voile, soft natural folds neatly framing the face, "
      + "no hair visible",
    heightCm: 158,
    build: "petite and evenly proportioned",
    wardrobe:
      "fitted long-sleeve off-white top in lightweight cotton jersey, modest cut that still shows "
      + "the overall silhouette; slim charcoal cotton twill trousers; plain white canvas sneakers",
    modest: true,
    festiveWardrobe:
      "wearing a festive Raya baju kurung in soft emerald with subtle woven texture, a matching "
      + "long skirt to the ankle, and simple flat shoes, her hijab exactly as in the reference in "
      + "a matching tone",
    closeup: {
      file: "A1-aisyah-closeup.bin",
      viewTag: "closeup",
      sha256: "f31d4a36a58266c0508e72ba42b2d5f34aa62f742001f617f073e1a7dd240c76",
      ext: "jpg",
    },
    fullbody: {
      file: "A1-aisyah-fullbody.bin",
      viewTag: "fullbody",
      sha256: "3c91319eae13dc01b04fe8393f433ab7f47d8303298221aa742d2cf64ba480ad",
      ext: "jpg",
    },
  },
  {
    catalogKey: "actor-v1-weijie",
    assetPrefix: "A2-weijie",
    name: "Weijie",
    identity: "Chinese man, 30 years old",
    face:
      "oval face with defined jawline, single-lid narrow dark brown eyes, straight black eyebrows, "
      + "medium flat nose bridge, faint dimple on the left cheek, light neutral-toned skin, "
      + "clean-shaven, calm friendly business-owner look",
    hair: "short black hair with a slightly spiky fringe, clean-trimmed sides",
    heightCm: 175,
    build: "average build with lean shoulders",
    wardrobe:
      "fitted plain off-white crew-neck t-shirt in lightweight cotton jersey, slim charcoal cotton "
      + "twill trousers, plain white canvas sneakers",
    modest: false,
    festiveWardrobe:
      "wearing a festive Chinese New Year mandarin-collar silk jacket in deep red with subtle "
      + "tonal embroidery, dark trousers, and simple dark shoes",
    closeup: {
      file: "A2-weijie-closeup.bin",
      viewTag: "closeup",
      sha256: "86a65781e590cd04ec9ab2a0daaea6a95b5078449b99ac727577cc716f1e8b54",
      ext: "jpg",
    },
    fullbody: {
      file: "A2-weijie-fullbody.bin",
      viewTag: "fullbody",
      sha256: "72410610eb97de9f53c72984390fb9161c99941e486258d894e965c224f9b49e",
      ext: "jpg",
    },
  },
  {
    catalogKey: "actor-v1-arjun",
    assetPrefix: "A3-arjun",
    name: "Arjun",
    identity: "Indian man, 35 years old",
    face:
      "long angular face, deep-set dark brown eyes, thick arched black eyebrows, prominent straight "
      + "nose, short neat boxed beard, deep warm brown skin, composed confident consultant look",
    hair: "short black hair with a slight widow's peak, neatly side-parted, tidy fade",
    heightCm: 178,
    build: "athletic with broad shoulders",
    wardrobe:
      "fitted plain off-white crew-neck t-shirt in lightweight cotton jersey, slim charcoal cotton "
      + "twill trousers, plain white canvas sneakers",
    modest: false,
    festiveWardrobe:
      "wearing a festive Deepavali kurta in warm gold-toned silk with a mandarin collar, matching "
      + "straight-cut trousers, and simple leather sandals",
    closeup: {
      file: "A3-arjun-closeup.bin",
      viewTag: "closeup",
      sha256: "20ab1527532d482bf33030b01b02c5ad08b5d96218fa97339a4d88deb2259161",
      ext: "jpg",
    },
    fullbody: {
      file: "A3-arjun-fullbody.bin",
      viewTag: "fullbody",
      sha256: "f8f4724d75d524b64821fa121280f0f3b41d9d42d6de0090e96d1651d9858cd5",
      ext: "jpg",
    },
  },
  {
    catalogKey: "actor-v1-rahman",
    assetPrefix: "A4-rahman",
    name: "Rahman",
    identity: "Malay man, 52 years old",
    face:
      "square weathered face, hooded warm dark eyes with deep smile lines, broad rounded nose, "
      + "neat salt-and-pepper moustache, medium-dark tan skin, trustworthy relaxed elder look",
    hair: "short neatly combed black hair, slightly receding hairline with clear gray at the temples",
    heightCm: 170,
    build: "average build with a slight belly and relaxed shoulders",
    wardrobe:
      "fitted plain off-white crew-neck t-shirt in lightweight cotton jersey, slim charcoal cotton "
      + "twill trousers, plain white canvas sneakers",
    modest: false,
    festiveWardrobe:
      "wearing a festive Raya baju melayu in muted sage with a matching samping wrapped at the "
      + "waist, a plain songkok, and simple dark shoes",
    closeup: {
      file: "A4-rahman-closeup.bin",
      viewTag: "closeup",
      sha256: "17ad9aa89ec89e7d582fe7941ee47184980b6e2a280712476cf4a2e2181c5c29",
      ext: "jpg",
    },
    fullbody: {
      file: "A4-rahman-fullbody.bin",
      viewTag: "fullbody",
      sha256: "c447707136f0dc1f790475fc51b36307866debf85ed577fa681792a4935f39dd",
      ext: "jpg",
    },
  },
  {
    catalogKey: "actor-v1-xinyi",
    assetPrefix: "A5-xinyi",
    name: "Xinyi",
    identity: "Chinese woman, 24 years old",
    face:
      "heart-shaped face with a pointed chin, large double-lid bright dark eyes, soft arched "
      + "eyebrows, small round-tipped nose, light freckles across the nose bridge, fair cool-toned "
      + "skin, fresh energetic creator look",
    hair: "shoulder-length straight black hair with thin wispy fringe, center parting",
    heightCm: 162,
    build: "slim and light-framed",
    wardrobe:
      "fitted plain off-white crew-neck t-shirt in lightweight cotton jersey, slim charcoal cotton "
      + "twill trousers, plain white canvas sneakers",
    modest: false,
    festiveWardrobe:
      "wearing a festive Chinese New Year qipao in deep red silk with a mandarin collar and subtle "
      + "tonal floral weave, and simple low heels",
    closeup: {
      file: "A5-xinyi-closeup.bin",
      viewTag: "closeup",
      sha256: "d46cf79a2c18e79be2d5a7ebff20e96e49f243b09ffaba62c030ffbf75bc9e45",
      ext: "jpg",
    },
    fullbody: {
      file: "A5-xinyi-fullbody.bin",
      viewTag: "fullbody",
      sha256: "bf16d2f40520f175b24354a9eb19c36f40d92e4aa2813b8ef01fe064e95efcfe",
      ext: "jpg",
    },
  },
];

/** 演员库原件在仓库里的家(相对仓库根)。播种脚本与测试共用这一份路径。 */
export const ACTOR_LIBRARY_ASSET_DIR = `assets/actor-library/${ACTOR_CATALOG_VERSION}`;

export function findActorByCatalogKey(catalogKey: string): ActorCard | null {
  return ACTOR_LIBRARY.find((actor) => actor.catalogKey === catalogKey) ?? null;
}

/* ─────────────────────── 两轴交叉:演员 × preset ─────────────────────── */

/**
 * 这位演员穿这套 preset,提示词里该写的那一段。
 *
 * 三条分支,分别对应规格里那句「preset 定的是意图,细节按人物卡适配」:
 *   · `plain`   → 人物卡自己的 WARDROBE(定妆原样);
 *   · `festive` → 人物卡自己的 `festiveWardrobe`(族裔适配那一件);
 *   · 其余七套 → preset 的 prompt,`modest` 演员取 modestPrompt(有的话)。
 *
 * 返回的永远是一段可以直接接在角色描述后面的英文名词短语,绝不为空。
 */
export function wardrobePromptFor(actor: ActorCard, key: WardrobePresetKey): string {
  if (key === "plain") return `wearing ${actor.wardrobe}`;
  if (key === "festive") return actor.festiveWardrobe;
  const preset = PRESETS[key];
  const chosen = actor.modest ? (preset.modestPrompt ?? preset.prompt) : preset.prompt;
  // 七套非特例 preset 的 prompt 在上面都是非空字面量;这一句只是让类型收敛,
  // 顺带保证「返回值绝不为空」是结构上成立的,不是靠人记住。
  return chosen ?? `wearing ${actor.wardrobe}`;
}

/**
 * 这位演员的九套造型,resolve 好了直接落进 `Entity.descriptionJson.presets`。
 *
 * 为什么要 resolve 后落盘:Otto 与 UI 读的是**实体行**,不 import 本包 —— 一卡三用的
 * 「三用」里有两用在数据库那一侧。落的是结果而不是 key,才不会有人在别处重写一遍
 * modest 与族裔的适配规则(那正是 7.3 要防的第二份真相)。
 */
export function actorPresetBlocks(actor: ActorCard): Record<WardrobePresetKey, string> {
  const out = {} as Record<WardrobePresetKey, string>;
  for (const key of WARDROBE_PRESET_KEYS) out[key] = wardrobePromptFor(actor, key);
  return out;
}
