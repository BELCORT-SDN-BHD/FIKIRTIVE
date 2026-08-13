/**
 * #775 —— 视频能力表:「商家能让视频引擎做哪几件事」的**唯一**声明。
 *
 * 两张表,两件不同的事:
 *
 *   ① `VIDEO_ACTIONS` —— **动作**表。一个动作 = 引擎收到什么 + 官方怎么开口。这张表按
 *      「引擎这一趟真收到什么」建格,所以它不可能声明一件付费路上做不到的事:形状不对,
 *      动作就不在候选里(`videoActionsFor`)。
 *
 *   ② `VIDEO_CRAFT` —— **手艺**表。一格 = 一个真实存在的装配字段。每一格都指名道姓地
 *      挂在 `seedancePromptInput` / `seedanceShot` 的某个 key 上,`video-capabilities.test.ts`
 *      两个方向都核:表里的字段必须在 schema 上,schema 上的字段必须在表里。加一个字段
 *      而不加一行,那条测试当场红。
 *
 * 为什么两张表都不许「手抄目录」(本票第 1 条):在册的 seedance 模型档案里
 * `supported_params` **一律是 null**,从 catalog 推不出任何参数事实,手工猜出来的一格
 * 会以「能力」的身份一路走到商家的付费按钮前。所以这里的每一格要么来自官方文档的句式,
 * 要么来自本仓自己送得出去的那个请求形状 —— 两者都可复核,catalog 一格都不参与。
 */

// #775 判官 r3:官方开头与「这段字要做哪件事」的判据住在 `@fikirtive/core`
// (`video-actions.ts`)—— 付费 schema 与卡→请求构造器也要按同一句话把关,而它们在 core。
// 这里只**用**那一份,绝不另抄:抄一份,铸卡侧与执行侧就会在某一天开始各说各话。
import {
  VIDEO_CLIP_TOKEN as CORE_VIDEO_CLIP_TOKEN,
  VIDEO_EDIT_OPENING,
  VIDEO_EXTEND_OPENING,
  anchoredVideoAction,
} from "@fikirtive/core";

// ---------------------------------------------------------------------------
// ① 动作表
// ---------------------------------------------------------------------------

export const VIDEO_ACTION_IDS = [
  "fromText",
  "animateStill",
  "stillToStill",
  "editClip",
  "extendClip",
  "guideFromClip",
] as const;
export type VideoAction = (typeof VIDEO_ACTION_IDS)[number];

/** 这一趟商家给了什么。三个布尔就是付费请求的三种素材位,再没有第四种。 */
export type VideoInputShape = {
  hasStill: boolean;
  hasEndStill: boolean;
  hasClip: boolean;
};

/**
 * 那条片子在提示词里的名字。
 *
 * 官方 `<Video_N>` 句式的价值全在「它说的就是引擎收到的第 N 条」,所以这个数字不许猜。
 * 付费请求里承载整段片子的位置只有一个(`VideoRequest.refVideoUrl`,单值;适配器把它
 * push 成唯一一个 `role:"reference_video"` 的 `video_url` 部件),所以 N 恒为 1 ——
 * 这不是一个我们选的常量,是那个字段的形状决定的。哪天真能送第二条片子,
 * `packages/generation/src/byteplus.test.ts` 里那条「只送得出一条片子」的断言会先红。
 */
export const VIDEO_CLIP_TOKEN = CORE_VIDEO_CLIP_TOKEN;

export type VideoCapability = {
  id: VideoAction;
  /** 商家说这件事时大致是什么意思(给 Otto 读,不上商家面)。 */
  meaning: string;
  /** 这件事**必须**收到什么才成立。形状不对 ⇒ 永远不在候选里。 */
  needs: (shape: VideoInputShape) => boolean;
  /** 官方句式的开头。null = 这件事没有专门句式,照常描述即可。 */
  opening: string | null;
  /** 这件事的提示词里**不许**出现的词 —— 官方明言它们会让引擎把任务读成别的。 */
  bannedWords: readonly string[];
};

/**
 * `reference` 是剪辑/续写的禁词,而且只在这两件事上是禁词。
 *
 * 官方 2.5 代把「照着这条片子做一条新的」和「改这条片子」当成两种任务,而任务类型是从
 * **措辞**读出来的。一条本该是严格编辑的请求里出现 "reference",引擎会读成前者:商家
 * 要的是把衣服改成红色,拿回来的是一条重新生成的片 —— 而这一趟已经扣过钱了。
 */
const EDIT_BANNED_WORDS = ["reference"] as const;

export const VIDEO_ACTIONS: readonly VideoCapability[] = [
  {
    id: "fromText",
    meaning: "make a new clip from words alone (the merchant's saved element photos may ride along)",
    needs: (s) => !s.hasStill && !s.hasEndStill && !s.hasClip,
    opening: null,
    bannedWords: [],
  },
  {
    id: "animateStill",
    meaning: "bring one still picture to life — the picture is the clip's first frame",
    needs: (s) => s.hasStill && !s.hasEndStill && !s.hasClip,
    opening: null,
    bannedWords: [],
  },
  {
    id: "stillToStill",
    meaning: "travel from one still picture to another — first frame and last frame are both given",
    needs: (s) => s.hasStill && s.hasEndStill && !s.hasClip,
    opening: null,
    bannedWords: [],
  },
  {
    id: "editClip",
    meaning: "change something inside a clip the merchant already has, and leave the rest alone",
    needs: (s) => s.hasClip,
    // 官方严格编辑句。后面接的是「改什么」,由装配层补上。
    opening: VIDEO_EDIT_OPENING,
    bannedWords: EDIT_BANNED_WORDS,
  },
  {
    id: "extendClip",
    meaning: "carry a clip the merchant already has further — what happens next (or what came before)",
    needs: (s) => s.hasClip,
    opening: VIDEO_EXTEND_OPENING,
    bannedWords: EDIT_BANNED_WORDS,
  },
  {
    id: "guideFromClip",
    meaning: "make a NEW clip guided by an existing one — its motion, pacing, and feel",
    needs: (s) => s.hasClip,
    // 这一档本来就是「参考」,所以不禁那个词,也没有专门句式。
    opening: null,
    bannedWords: [],
  },
];

const BY_ID = new Map<VideoAction, VideoCapability>(VIDEO_ACTIONS.map((c) => [c.id, c]));

/** 按 id 取一行。取不到就抛 —— 一个空壳能力会以「可以做」的身份继续往下走。 */
export function videoAction(id: VideoAction): VideoCapability {
  const cap = BY_ID.get(id);
  if (!cap) throw new Error(`unknown video action: ${String(id)}`);
  return cap;
}

/** 这个形状下**真做得到**的动作,按表的次序。 */
export function videoActionsFor(shape: VideoInputShape): VideoAction[] {
  return VIDEO_ACTIONS.filter((c) => c.needs(shape)).map((c) => c.id);
}

/** 没有片子时的三种形状 —— 素材位只有三个布尔,所以这个集合是**穷尽**的,不是抽样。 */
const CLIPLESS_SHAPES: readonly VideoInputShape[] = [
  { hasStill: false, hasEndStill: false, hasClip: false },
  { hasStill: true, hasEndStill: false, hasClip: false },
  { hasStill: true, hasEndStill: true, hasClip: false },
];

/** 这件事非要一整条片子不可吗 —— 判据是「没有片子的每一种形状下它都不成立」。 */
export function actionNeedsClip(id: VideoAction): boolean {
  const cap = videoAction(id);
  return CLIPLESS_SHAPES.every((s) => !cap.needs(s));
}

/**
 * #775 判官 r1 P1-2 —— 从**真正会送到引擎的那段提示词**认出这是哪一个动作。
 *
 * 为什么判据必须是提示词,而不是一个跟在旁边的声明字段:
 * 引擎读到的就是这段字,任务类型是它自己从这段字里读出来的。一个平行的声明字段
 * (r1 的 `videoAction`)有两个失败模式,而且都真的会发生 —— 模型**漏传**它(于是一条
 * 严格编辑的提示词带着 16:9 上卡),或者**传错**它(于是卡说的和引擎会做的不是一件事)。
 * 判据换成提示词本身之后,这两种失败在结构上不存在:卡上冻的那段字与引擎收到的那段字
 * 是同一份,中间没有第二次转述。
 *
 * 认的是**官方开头**,不是关键词。开头由 `VIDEO_ACTIONS` 声明,装配层用同一份常量产出,
 * 所以「怎么写」和「怎么认」永远同源。认不出来回 null(不猜)。
 */
export function videoActionFromPrompt(prompt: string): VideoAction | null {
  // 判据不在这里 —— 它在 core,因为付费 schema 与卡→请求构造器读的是同一份
  // (判官 r3 P2 的结束边界也长在那里:开头之后必须紧跟装配器真会写出来的那个空格)。
  return anchoredVideoAction(prompt);
}

/**
 * 教学面上的那句官方句式 —— 与装配层用的是**同一份**声明,只是把片子的编号换成一个词。
 *
 * 为什么不能把 `<Video_1>` 原样写进 skill description:那是给模型读的教材,写上去等于
 * 邀请 Otto 自己去写编号,而编号只能由真正装那条片子的那段代码产出(#774 立的规矩,
 * 编错位比不编号更糟)。顺带也让这段话通过界面地图那道围栏 —— 尖括号会被它读成路径分隔符。
 */
export function openingForTeaching(id: VideoAction): string | null {
  const opening = videoAction(id).opening;
  return opening === null ? null : opening.replace(VIDEO_CLIP_TOKEN, "the clip");
}

/**
 * 成品里混进了禁词就**提醒**,绝不改写。
 *
 * 为什么不静默剔掉那个词:提示词里每一个字都是商家自己要的东西(或 Otto 替他写的),
 * 机器动手改一次,商家批准的和引擎收到的就分家了。提醒交给 Otto 用人话转述,改不改
 * 是商家的事 —— 与 #774 U8 的 `notes` 同一条规矩。
 */
export function videoPromptWarnings(id: VideoAction, prompt: string): string[] {
  // 判官 r1 P3 —— 按**整个词**认,不按子串:`preference` / `dereferenced` 里都含着
  // "reference",子串匹配会在一条完全干净的提示词上报警。误报的代价不是零 —— Otto 会把
  // 这句提醒用人话转述给商家,商家于是被要求去改一句本来没问题的话,几次之后他学会
  // 忽略这类提醒,真的那一条也跟着被忽略。
  // 复数照收(`references` 误导得一模一样);切词按「非字母即分隔」,所以标点贴着也逮得住。
  const words = new Set(prompt.toLowerCase().split(/[^a-z]+/u).filter(Boolean));
  return videoAction(id)
    .bannedWords.filter((w) => words.has(w) || words.has(`${w}s`))
    .map(
      (w) =>
        `This prompt still contains the word "${w}" — on a change-this-clip or carry-this-clip request that word makes the engine start a brand-new clip instead. Say what to change in plain words.`,
    );
}

// ---------------------------------------------------------------------------
// ② 手艺表
// ---------------------------------------------------------------------------

/**
 * 一格手艺 = 一个真字段。
 * `field` 的写法:`shot:<key>` 挂在 `seedanceShot` 上,`clip:<key>` 挂在
 * `seedancePromptInput` 上。这个前缀不是装饰 —— 测试按它去两个 schema 上逐格核对。
 */
export type VideoCraft = {
  field: string;
  /** 这一格让商家能要到什么(给 Otto 读的人话)。 */
  does: string;
};

export const VIDEO_CRAFT: readonly VideoCraft[] = [
  // ── 一个镜头里的东西 ──────────────────────────────────────────────
  { field: "shot:subject", does: "who or what the shot is about" },
  { field: "shot:action", does: "what actually moves — the one thing a clip has that a picture doesn't" },
  { field: "shot:camera", does: "one camera move per shot (dolly in, orbit, handheld follow…)" },
  { field: "shot:shotFraming", does: "how close the camera sits (wide, medium, close-up…)" },
  { field: "shot:sceneLight", does: "light direction and colour temperature" },
  { field: "shot:mood", does: "the feel of the frame" },
  { field: "shot:emotion", does: "a feeling, rewritten as body signals the camera can actually see" },
  { field: "shot:music", does: "music, written in the notation the engine reads" },
  { field: "shot:sfx", does: "sound effects, in their own notation" },
  { field: "shot:dialogue", does: "spoken lines, in their own notation and in the language asked for" },
  { field: "shot:audio", does: "anything about the sound that doesn't fit the three fields above" },
  // ── 整条片子的东西 ────────────────────────────────────────────────
  { field: "clip:mode", does: "which of the engine's actions this clip is — make, animate, change, or carry on" },
  { field: "clip:shots", does: "up to four beats inside ONE continuous clip (separate clips are a storyboard)" },
  { field: "clip:style", does: "the overall look" },
  { field: "clip:pacing", does: "how the clip moves through time (slow motion, hard cuts, one continuous take)" },
  { field: "clip:continuesFromPrev", does: "this clip picks up where the previous one left off" },
  { field: "clip:references", does: "lock a named element's identity by wording (the photos ride via propose's entityIds)" },
  { field: "clip:cleanFootage", does: "ban on-screen text, watermarks, and logos — on by default" },
  { field: "clip:constraints", does: "hard do/don't, each written as a command" },
  { field: "clip:aspect", does: "the shape this clip is delivered in; a vertical clip gets an extra caption-free line" },
  { field: "clip:extendDirection", does: "when carrying a clip on: forward from its end, or backward before its start" },
];
