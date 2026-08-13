import { z } from "zod";
import {
  promptRef,
  identityLockClause,
  soundNotation,
  externalizeEmotion,
  imperativeConstraints,
  isPortraitAspect,
  VIDEO_QUALITY,
  PORTRAIT_CAPTION_BAN,
  PORTRAIT_CAPTION_BAN_KEEPING_LOGO,
} from "./prompt-vocab.js";
import { videoAction } from "./video-capabilities.js";

export const seedanceShot = z.object({
  subject: z.string().min(1),
  action: z.string().min(1),
  camera: z.string().optional(),
  shotFraming: z.string().optional(),
  sceneLight: z.string().optional(),
  mood: z.string().optional(),
  /** 自由文本声音描述（沿用）。结构化的三项在下面，两者可并存。 */
  audio: z.string().optional(),
  /** #774 U3 声音符号规范 —— 音乐 `（）`、音效 `<>`、台词 `{}`。字幕 `【】` 只作为禁令存在。 */
  music: z.string().optional(),
  sfx: z.string().optional(),
  dialogue: z.string().optional(),
  /** #774 U3 情绪外化 —— 传情绪词，装配时换成镜头看得见的身体信号。 */
  emotion: z.string().optional(),
});

export const seedancePromptInput = z.object({
  /**
   * #775 —— 这条 prompt 是给哪一个动作写的。
   *
   * `i2v` / `t2v` 是原来那两档,一个字没动。新增的两档都要求商家手上**已经有一条片子**:
   *   · `edit`   —— 改这条片子里的某个东西,别的一律别动;
   *   · `extend` —— 把这条片子接下去(或往前接)。
   *
   * 这两档与前两档的分界不在措辞喜好上,在**引擎收到什么**:它们收的是一整条片子
   * (`referenceVideoGenerationId` 那条路),而不是一张首帧。写错档 = 拿一条根本没收到
   * 首帧的请求去说「从给定的首帧开始」。
   */
  mode: z.enum(["i2v", "t2v", "edit", "extend"]).default("i2v"),
  /** #775 —— 续写往哪边接。只在 `extend` 档有意义,官方句式里是明写的一个词。 */
  extendDirection: z.enum(["forward", "backward"]).default("forward"),
  style: z.string().optional(),
  pacing: z.string().optional(),
  shots: z.array(seedanceShot).min(1).max(4),
  continuesFromPrev: z.boolean().default(false),
  references: z.array(promptRef).max(8).default([]),
  cleanFootage: z.boolean().default(true),
  constraints: z.string().optional(),
  /** #774 U4：这条片子会以什么画幅交付。竖版加重 caption-free 约束 —— 官方明言竖版
   *  出现烧录字幕的概率显著更高。传的必须是**同一趟** propose 的 `desiredAspect`；
   *  认不出来一律当非竖版（**不猜**）。 */
  aspect: z.string().optional(),
})
  // #775 —— 改一条片子、或者把它接下去,都是**一件**事,不是四个节拍。多个 shot 在这两档
  // 上没有可表达的意思(严格编辑没有「第二个镜头」),放行只会让装配层去猜要把哪一段塞进
  // 官方句式里。拒在 schema 上,Otto 收到的是一条明确的形状错误,不是一段悄悄少了一半的
  // prompt。旧两档一个字不变。
  .refine((v) => !(v.mode === "edit" || v.mode === "extend") || v.shots.length === 1, {
    message: "an edit or an extension describes ONE change — pass exactly one shot",
    path: ["shots"],
  });
export type SeedancePromptInput = z.infer<typeof seedancePromptInput>;

/**
 * #775 —— 锚在一条已有片子上的开场:官方句式 + 一句边界。
 *
 * 句式逐字来自官方指南(票 #775 第 2 条),两处刻意:
 *   · 片子的编号 `<Video_1>` 来自 `VIDEO_CLIP_TOKEN`,而那个 1 是**付费请求只送得出
 *     一条片子**这个事实决定的,不是我们挑的数字;
 *   · 两句都不出现 "reference" —— 那个词会把任务读成「照着它做一条新的」。
 *
 * 第二句(边界)与第一句同等重要:少了它,「严格编辑」只是一个形容词。
 */
function anchoredOpening(i: SeedancePromptInput, seg: string): string[] {
  if (i.mode === "extend") {
    return [
      `${videoAction("extendClip").opening} ${i.extendDirection}, ${seg}.`,
      "Continue the same characters, wardrobe, setting, and lighting.",
    ];
  }
  return [
    `${videoAction("editClip").opening} ${seg}.`,
    "Keep every other part of the clip exactly as it is.",
  ];
}

/**
 * 纯：结构化意图 → Seedance 创作 prompt（英文，无技术 flag —— 时长/清晰度/画幅/声音都由
 *  provider 作为严格顶层字段发送，#646 T5 起 prompt 文本里一个 flag 都不再有）。
 *
 * #774 U3 三件要件，逐条落在这里：
 *   ① 画质段 —— 第一行给质感基调，再进分镜；
 *   ② 约束词表 —— `constraints` 逐条规整成祈使句（官方要求约束是命令，不是形容词堆）；
 *   ③ 声音符号规范 + 情绪外化 —— `music/sfx/dialogue` 走官方符号；`emotion` 换成镜头
 *      拍得到的身体信号，而不是一个感受词。
 *
 * #774 U2 刻意**不**在这里编号参考图：元素参考照根本到不了视频引擎
 * （`apps/worker/src/jobs/gen.ts:636-644` 的 `generateVideo` 只吃 `imageUrl` /
 * `tailImageUrl` / `refVideoUrl`，`packages/core/src/reference-budget.ts` 对同一件事
 * 记了同样一笔）。给一条根本没收到 `<Image_2>` 的请求写 `<Image_2>`，是把编号从
 * 「有用」变成「说谎」—— 视频侧照旧只用措辞锁身份，身份的真凭据是首帧。
 *
 * #775 补充：`edit` / `extend` 两档由 `anchoredOpening` 起头 —— 那两档的编号说的是**片子**
 * (`<Video_1>`)，而片子的编号与图片编号的处境正相反：付费请求承载整段片子的位置只有一个，
 * 所以 1 是结构决定的，不是猜的。
 */
export function assembleSeedance(i: SeedancePromptInput): string {
  const lines: string[] = [];
  const anchored = i.mode === "edit" || i.mode === "extend";
  // #775 —— 锚在一条已有片子上的两档**不写**画质/风格开场白。
  //
  // 那一行说的是「这条片子该长成什么质感」,而这两档的全部要求正好相反:除了商家点名要改
  // 的那一处,其它一切都得照原样。一句重新调色的指令与「严格编辑」当场打架,而打架的结果
  // 是引擎自己挑一边 —— 商家批准的是改三个字,可能拿回来一条被重新润色过的片。
  // 商家真想改风格?那就是他要改的**那件事**,写在 shot 里,走同一句官方句式。
  if (!anchored) lines.push([i.style, VIDEO_QUALITY].filter(Boolean).join(", "));
  const single = i.shots.length === 1;
  i.shots.forEach((s, idx) => {
    // ③ 情绪外化：表里查得到就写身体信号；查不到不猜，原样带上那个词。
    const emotion = s.emotion ? (externalizeEmotion(s.emotion) ?? s.emotion) : undefined;
    const seg = [
      // 尾逗号由 join 负责 —— 自己再带一个就成了 "first frame,, a cat"。
      idx === 0 && i.continuesFromPrev && "continuing from the previous frame",
      idx === 0 && !i.continuesFromPrev && i.mode === "i2v" && "starting from the given first frame",
      s.shotFraming,
      s.subject,
      s.action,
      emotion,
      s.camera,
      s.sceneLight,
      s.mood,
    ].filter(Boolean).join(", ");
    // #775 —— 锚在一条已有片子上的两档,第一段进的是**官方句式**,不是一段自由描述。
    // 句式与「保住其余部分」那句话是一对:前者说改什么/接什么,后者划出边界。
    if (anchored) lines.push(...anchoredOpening(i, seg));
    else lines.push(single ? seg : `Shot ${idx + 1}: ${seg}`);
    // ③ 声音符号规范：结构化三项在前（官方符号），自由文本描述在后。
    const audio = [soundNotation(s), s.audio?.trim()].filter(Boolean).join(" ");
    if (audio) lines.push(`Audio: ${audio}`);
  });
  if (i.mode === "i2v") lines.push("keep the subject consistent with the source frame");
  // #775 —— 锚在片子上的两档**一句身份锁都不写**。
  //
  // 身份锁那几句话的主语是「参考照里的那个人/那件东西」,而这条路上引擎收到的参考照
  // 数量是 **0**:整段参考视频与 @元素参考照是互斥场景(`videoReferencesRide`,付费前
  // 由适配器拒绝混用),卡面也照实说「你的参考照这一趟一张都用不上」。对一个手上没有
  // 任何参考照的请求说「keep Mia identical to the reference」,既是一句谎,又正好把
  // 官方禁词 "reference" 写进了严格编辑的指令里 —— 两错叠一处。
  // 这两档的身份凭据是那条片子本身,不需要我们再说一遍。
  const locks = anchored ? "" : identityLockClause(i.references);
  if (locks) lines.push(locks);
  if (i.pacing) lines.push(i.pacing);
  const hasLockedBrandmark = i.references.some((r) => r.role === "brandmark" && r.lock);
  // #775 判官 r1 P1-3 —— 锚在商家自己那条片子上时,**一条「别让画面上有那个东西」的指令
  // 都不下**(清底片那一行、竖版防字幕那一行,两条都是)。
  //
  // 它们与这两档的边界句直接打架:上面刚说完「其余完全不变」,下面又要求画面上不许有
  // 文字、水印或 logo —— 商家只想把衬衫改成红色,却可能连自家片头的 logo 一起被抹掉。
  // 而那枚 logo 是**商家自己的东西**(Founder 原则:商家的 data 商家的权利),我们没有
  // 立场替他决定它该不该留在自己的片子里。
  //
  // 判据是 `anchored`,不是 `cleanFootage` 的取值 —— 这条规矩不该由一个默认值来兜底:
  // 商家(或 Otto)显式把 cleanFootage 设成 true,同样不下。
  // 清底片的指令只属于**从零生成**那两档:那里画面上的每一样东西都是我们造出来的,
  // 说「别造字幕」才有对象。
  if (i.cleanFootage && !anchored) {
    if (!hasLockedBrandmark) lines.push("no on-screen text, watermark, or logo");
    // ④ 竖版防字幕：竖版再说一次，并点名 `【】` 这个符号。商家锁了品牌标识时，
    //   禁的是字幕，不是那枚 logo。
    if (isPortraitAspect(i.aspect)) {
      lines.push(hasLockedBrandmark ? PORTRAIT_CAPTION_BAN_KEEPING_LOGO : PORTRAIT_CAPTION_BAN);
    }
  }
  // ② 约束词表：逐条祈使句，一句一行。
  lines.push(...imperativeConstraints(i.constraints));
  return lines.join("\n");
}
