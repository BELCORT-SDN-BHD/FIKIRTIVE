"use client";

/**
 * VideoSpecPicker —— 「这条片子多长、多清晰、什么形状」,在花钱之前。
 *
 * 与 `ImageShapePicker`(#643 T2)是同一套做法,因为规格这件事在每个入口必须长得一样、
 * 说的一样:选项**永远**来自服务端解析的菜单(`getActiveGenModels()`),这里一格都不写死,
 * 菜单上于是不可能出现一档引擎给不了的规格。
 *
 * 与图片侧唯一的不同:视频**按档计价**,时长和清晰度都会改价。所以这个控件旁边永远跟着
 * 一个价格,而那个价格也来自服务端的同一张表(`videoCreditsBySpec`)—— 商家看见的数字
 * 就是待会儿真会预扣的数字。
 *
 * 不做动画:这是每次生成都要经过的控件(Emil 的判据:高频操作不加动画),原生 select
 * 还顺带拿到键盘操作与移动端系统选择器。
 *
 * #914:「这台引擎会不会自己改写我的提示词」是一个模型能力属性,不是每次生成的动态结果
 * (Founder 裁决,市调见 #909)。视频这条产品线的官方契约会在响应里带 revised_prompt
 * (可空),说一次就够了 —— 放在这里(花钱之前、选规格的同一处),不放进每一条片子各自的
 * 回执里。悬浮态发现,不占位、不打断高频操作。
 */

/**
 * #914 r2(orchestrator 裁定,判官同一条原则贯彻到底):只许主张可证明的**回报行为**
 * （官方契约:视频响应结构可能带 revised_prompt),不许主张「引擎改了才回报」这类内部
 * 触发条件——那是我们证明不了的因果关系,原来的「when it changes what you wrote」正是
 * 这个不可证明的断言(而且与 manage-library.ts 的措辞矛盾:回报了不等于真的改了)。
 */
export const VIDEO_ENGINE_PROMPT_CAPABILITY_NOTE =
  "This engine may report the prompt it runs.";

/**
 * 形状那一格的人话。
 *
 * 比例(16:9 之类)原样显示;**具名**的那一档(adaptive)只做首字母大写 ⇒ "Adaptive"。
 * 这里刻意不认识任何具体的档名 —— 它只做写法转换,所以永远不可能把 adaptive「翻译」成
 * 某个具体比例。那一档是引擎跟着首帧自己挑的,界面不许替它承诺一个它没答应的形状。
 *
 * (这个文件是客户端可达的,不能引 `@fikirtive/core` —— 菜单本身也确实全部来自服务端,
 *  这里一格都不写死。)
 */
export function videoAspectLabel(aspect: string): string {
  if (/^\d+:\d+$/.test(aspect)) return aspect;
  return aspect.charAt(0).toUpperCase() + aspect.slice(1);
}

/** 清晰度那一格的人话 —— 商家不该需要知道 "p" 是什么。
 *  (Creation S2 §8.1①:1080p 从高清槽位上架,菜单第一次会出现它。) */
export function videoResolutionLabel(resolution: string): string {
  if (resolution === "1080p") return "Sharpest (1080p)";
  if (resolution === "720p") return "Sharper (720p)";
  if (resolution === "480p") return "Standard (480p)";
  return resolution;
}

export type VideoSpec = {
  seconds: number;
  resolution: string;
  aspectRatio: string;
};

/**
 * 形状那一格的提示语。**Adaptive 在两条路上是两件事**,所以这里必须分开说(#645 T4,
 * 判官 r1 P2-2):
 *   - 有源图(Animate / 接首帧):引擎跟着那张图就近;
 *   - 没有源图(t2v):引擎按商家的描述挑一个合适的比例。
 *
 * 原来两处共用「follows the source image」—— 在 t2v 那个框里那句话是错的,那个框自己
 * 明说了 no source image needed。卡面说错话和卡面不说话一样,都是替商家做了主。
 */
export function videoShapeHint(hasSourceImage: boolean): string {
  return hasSourceImage
    ? "The shape this video will be made in — Adaptive keeps the shape of your source image"
    : "The shape this video will be made in — Adaptive picks a shape to suit your description";
}

/** 服务端解析的规格菜单 + 商家没选时会交付的那一档。 */
export type VideoSpecMenu = {
  durations: readonly number[];
  resolutions: readonly string[];
  aspectRatios: readonly string[];
};

const selectClass =
  "rounded-[8px] border border-border bg-card px-2 py-1 text-[0.8125rem] text-foreground disabled:opacity-40";

export function VideoSpecPicker({
  value,
  menu,
  onChange,
  disabled = false,
  compact = false,
  hasSourceImage = false,
}: {
  /** 当前会交付的规格。每一格都必须在 `menu` 的对应列表里 —— 显示的就是会发出去的。 */
  value: VideoSpec;
  /** 服务端解析的菜单。任一列表为空 ⇒ 那一格不渲染(模型不暴露这个控件)。 */
  menu: VideoSpecMenu;
  onChange: (next: VideoSpec) => void;
  disabled?: boolean;
  /** 窄条里用:标签只留给读屏器,视觉上只剩下值本身。 */
  compact?: boolean;
  /** 这一次出片有没有源图。只影响**说法**(Adaptive 的含义两条路不同),不影响菜单。 */
  hasSourceImage?: boolean;
}) {
  const field = (label: string, control: React.ReactNode) => {
    if (compact) return control;
    return (
      <label className="flex items-center gap-2 text-[0.75rem] text-muted-foreground">
        <span className="font-semibold text-foreground">{label}</span>
        {control}
      </label>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {menu.durations.length > 0 && field(
        "Length",
        <select
          value={value.seconds}
          disabled={disabled}
          aria-label="Length of the video"
          title="How long this video will be — longer costs more"
          onChange={(event) => onChange({ ...value, seconds: Number(event.target.value) })}
          className={selectClass}
          style={{ flex: "none" }}
        >
          {menu.durations.map((seconds) => (
            <option key={seconds} value={seconds}>{seconds}s</option>
          ))}
        </select>,
      )}
      {menu.resolutions.length > 0 && field(
        "Quality",
        <select
          value={value.resolution}
          disabled={disabled}
          aria-label="Quality of the video"
          title="How sharp this video will be — the price beside this changes with it"
          onChange={(event) => onChange({ ...value, resolution: event.target.value })}
          className={selectClass}
          style={{ flex: "none" }}
        >
          {menu.resolutions.map((resolution) => (
            <option key={resolution} value={resolution}>{videoResolutionLabel(resolution)}</option>
          ))}
        </select>,
      )}
      {menu.aspectRatios.length > 0 && field(
        "Shape",
        <select
          value={value.aspectRatio}
          disabled={disabled}
          aria-label="Shape of the video"
          title={videoShapeHint(hasSourceImage)}
          onChange={(event) => onChange({ ...value, aspectRatio: event.target.value })}
          className={selectClass}
          style={{ flex: "none" }}
        >
          {menu.aspectRatios.map((aspect) => (
            <option key={aspect} value={aspect}>{videoAspectLabel(aspect)}</option>
          ))}
        </select>,
      )}
      {/* #914:一个小图标,悬浮才说话——高频控件旁边不铺一整句常驻文案。 */}
      <span
        aria-label="How this engine handles your prompt"
        title={VIDEO_ENGINE_PROMPT_CAPABILITY_NOTE}
        style={{ fontSize: 12, lineHeight: 1, color: "var(--muted-foreground)", cursor: "help", flex: "none" }}
      >
        ⓘ
      </span>
    </div>
  );
}
