/**
 * 视频引擎 13 项能力清单（#437）—— 每项能力经 seedancePromptInput 的现有字段表达，
 * 不需要也不引入并行装配路径（prompt 权威仍是 seedancePrompt 单一 skill）。
 *
 * 纯数据表：id 稳定；fields 必须是 schema 真实字段路径（测试逐条断言）；
 * hintZh 为一行中文写法要点，可能进入用户可见文本 —— 不得出现供应商/模型商号。
 */
export interface VideoCapability {
  id: string;
  labelZh: string;
  /** seedancePromptInput field paths that carry this capability ("shots.action" = per-shot field). */
  fields: readonly string[];
  /** One-line how-to (Chinese). */
  hintZh: string;
}

export const VIDEO_CAPABILITIES: readonly VideoCapability[] = [
  {
    id: "pureT2v",
    labelZh: "纯文本生成",
    fields: ["mode", "shots.subject", "shots.action", "shots.sceneLight"],
    hintZh: "mode:'t2v'，场景自给自足：首个 shot 先立空间与光线，主体外观写到「能画」，缺一处引擎就自行发挥。",
  },
  {
    id: "referenceIdentity",
    labelZh: "@引用一致性",
    fields: ["references"],
    hintZh: "对象进 references（role+name, lock:true），正文只用名字指代、不重复外观；像素另走 propose 的 entityIds，两者都要。",
  },
  {
    id: "cameraReplication",
    labelZh: "运镜复刻",
    fields: ["shots.camera", "style"],
    hintZh: "把口述运镜翻译成行业词并写明起点→路径→终点与速度；一 shot 一运镜，多个运镜拆多 shot。",
  },
  {
    id: "templateReplication",
    labelZh: "创意模板复刻",
    fields: ["shots", "pacing", "constraints"],
    hintZh: "不写模板出处名；拆成节拍数+每拍画面事件+转场方式三件套，用户的主体填进槽位。",
  },
  {
    id: "storyCompletion",
    labelZh: "故事补全",
    fields: ["mode", "shots.action"],
    hintZh: "一句锁定既定前提，因果动词链写续篇；结局写成具体画面，不留给引擎猜。",
  },
  {
    id: "extension",
    labelZh: "视频延长",
    fields: ["continuesFromPrev", "style", "shots.action", "shots.sceneLight"],
    hintZh: "continuesFromPrev:true 且 style 必填（schema 机检：续接缺 style 直接拒 —— 逐字复用才接得上）；不重述场景与外观，只写新增运动；sceneLight 写「延续上一段的光线与色调」。",
  },
  {
    id: "audioControl",
    labelZh: "声音控制",
    fields: ["shots.audio"],
    hintZh: "台词=说话人+语言+语气+引号原文；环境音列具体声源；配乐写风格+节奏+乐器，不写歌名。",
  },
  {
    id: "singleTake",
    labelZh: "一镜到底",
    fields: ["shots.camera", "style", "pacing", "constraints"],
    hintZh: "camera 用 one continuous take 且只用一个 shot（schema 机检：声明 singleTake、或 style/pacing/camera 任一处出现一镜到底/one take，都强制恰好 1 个 shot）；路径写起点→途经（≤3 个点名地标）→终点；constraints 注明全程无剪辑。",
  },
  {
    id: "editInstruction",
    labelZh: "视频编辑",
    fields: ["mode", "editInstruction", "preserve"],
    hintZh: "mode:'edit'；指令动词开头、一次一处修改；preserve 写全三保「其余画面、人物动作与运镜保持不变」。",
  },
  {
    id: "beatSync",
    labelZh: "音乐卡点",
    fields: ["pacing", "style", "shots.action", "shots.shotFraming"],
    hintZh: "引擎听不到歌：pacing 写带时间单位的拍长（每拍约 0.5s / 120 BPM，hard cut）；schema 机检 style/pacing 任一处提到卡点就要求这个数值，「4K」这类裸数字不算；每 shot 一个爆发动作在拍点定格，相邻景别跳变。",
  },
  {
    id: "timestampedShots",
    labelZh: "时间戳分镜",
    fields: ["shots.action"],
    hintZh: "action 以半角时间戳开头（0-2s:）；schema 机检的是升序、不重叠、无零长区间、段段连续无缝隙（总时长由系统参数决定，这里不校验）；一段一动作一运镜。",
  },
  {
    id: "multiSegmentContinuation",
    labelZh: "多段续接",
    fields: ["style", "continuesFromPrev", "references"],
    hintZh: "style 每段逐字复用；末帧即下一段首态；references 每段都传；中途换光要给专门的过渡 shot。",
  },
  {
    id: "negativeExclusion",
    labelZh: "负向排除",
    fields: ["constraints", "cleanFootage"],
    hintZh: "constraints 名词清单≤5 项放最后；动作层面的「不要」改写成正向动词；文字/水印/logo 已由 cleanFootage 默认禁。",
  },
];
