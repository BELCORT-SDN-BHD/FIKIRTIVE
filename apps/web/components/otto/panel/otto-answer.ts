/**
 * otto-answer.ts —— 面板里 Otto 那张**答案卡**的模型(纯函数,没有 React、没有取数)。
 *
 * 视觉与文案权威 = R22 原型
 * `preserved/prototype-2026-08-24-r22/fikirtive-prototype-r22.html` 的 `responseFor()`
 * (L6692-6706)。原型里 Otto 回的不是一段散文,而是一张结构化的卡:
 * **标题 / 导语 / 要点 / 一句诚实注脚**。上一版实现把这一整套压成了一句自己编的话 ——
 * 那句话既不按话题分路,也没有把「这一轮什么都没动」写成一条可断言的事实。
 *
 * 原型五条路按它的顺序与正则逐字搬过来(顺序有意义:`schedule` 走审批那一路,而不是
 * 兜底那一路)。分路读的是**上下文 + 商家这句话**拼起来的小写串,与原型同一条。
 * beta 卫生那一票在这五条**之后**、兜底之前又补了两条(花多少 / 做完的去哪儿),
 * 排在后面就意味着原型那五路的分路结果一个字都没变 —— 理由写在那两条自己头上。
 *
 * 两处与原型不同,各自的理由写在它自己的位置上:
 *   ① 原型从 `window.RT` / `window.FK` 这两个全局读工作区信号;这里改成入参
 *      (`OttoAnswerSignals`),读不到就是 `null` —— 读不到就不替商家说话,而不是猜一个。
 *   ② 「Do-not-say rules」那一条加了一个连字符,见该行注释。
 */

/** 一张答案卡的四段。顺序就是它画出来的顺序,也是 Copy 出去的顺序。 */
export type OttoAnswer = {
  title: string;
  lead: string;
  bullets: string[];
  /** 诚实注脚:这一轮**没有**改什么、没有花什么。每一路都有,一条都不许省。 */
  note: string;
};

/**
 * 答案要用到的两个工作区信号。
 *
 * `null` 是一个**真状态**,不是「还没做」:面板今天没有这两条读数的时候,Otto 说
 * 「我还确认不了」比说「没有例程在跑」诚实 —— 后者可能正好说反。
 */
export type OttoAnswerSignals = {
  /** 此刻有几条例程在跑;读不到就是 `null`。 */
  activeRoutines: number | null;
  /** 这个工作区有没有已连上的发布渠道;读不到就是 `null`。 */
  channelConnected: boolean | null;
};

/** 面板拿不到任何信号时用这一份 —— 三条回答里最保守的那一条。 */
export const OTTO_ANSWER_SIGNALS_UNKNOWN: OttoAnswerSignals = {
  activeRoutines: null,
  channelConnected: null,
};

/** 等待态那一行字(原型 L6724;措辞归真 2026-08-26 —— 原句在替商家解释我们内部怎么读上下文)。 */
export const OTTO_ANSWER_WAIT_LABEL = "Reading this page…";

/** 读不出来时那两句(原型 L6729,去掉只有写代码的人才懂的那个词)。 */
export const OTTO_ANSWER_ERROR_TITLE = "I couldn’t read this just now.";
export const OTTO_ANSWER_ERROR_NOTE = "No action ran and no credits were spent.";

/** 想一想要多久。照原型 560ms(L6733 的 `setTimeout(...,560)`)。 */
export const OTTO_ANSWER_WAIT_MS = 560;

/**
 * 答案卡底下那一排动作按下去之后 `aria-live` 说的话。
 *
 * 每一句都只描述**真的发生了的事**:Copy 真的写进了剪贴板;两颗反馈只记在这一张卡上;
 * Get support 只是把求助入口摆好,一条消息都没有发出去。
 */
export const OTTO_ANSWER_CONFIRM = {
  copied: "Copied",
  helpful: "Thanks — marked helpful",
  notHelpful: "Thanks — feedback recorded",
  support: "Support is ready to open. Nothing has been sent yet.",
} as const;

/**
 * 这一句话该不该走「读不出来」那一路。
 *
 * 这是 fixture 那一面的开关(原型 L6726 同一条正则):商家想看看读不出来长什么样,
 * 打一句带 error / fail 的话就能看到,重试一次就正常。真接后端的那条路不经过这里。
 */
export function ottoAnswerShouldFail(prompt: string): boolean {
  return /\b(error|fail)\b/i.test(prompt);
}

/** Copy 出去的全文 —— 标题、导语、每一条要点、注脚,各占一行(原型 L6705)。 */
export function ottoAnswerCopyText(answer: OttoAnswer): string {
  return [answer.title, answer.lead, ...answer.bullets, answer.note].join("\n");
}

/**
 * 按话题给一张真答案。
 *
 * @param context 商家此刻在看的那一页的名字(导航里的名字,例如 "Approvals")。
 * @param prompt  商家自己打的那句话。
 */
export function responseFor(context: string, prompt: string, signals: OttoAnswerSignals): OttoAnswer {
  const low = `${String(context ?? "")} ${String(prompt ?? "")}`.toLowerCase();

  if (/approval|review|schedule/.test(low)) {
    const connected = signals.channelConnected;
    return {
      title: "Why this needs review",
      lead: "This is an explanation only. The approval stays where it is until someone approves it in Approvals.",
      bullets: [
        "Approving something schedules it; it does not publish it.",
        "Auto-publish is off, so nothing goes out before approval.",
        // 渠道那一条只在**知道**答案时才说。读不到就少说一句 —— 少说一句不会骗人,
        // 猜一句会:说反了商家会照着那句话去做决定。
        ...(connected === null
          ? []
          : [connected
            ? "A channel is connected, but approval is still required."
            : "No channel is connected, so approval holds work in Schedule."]),
      ],
      note: "This chat did not change the approval or spend credits.",
    };
  }

  if (/routine|prepare/.test(low)) {
    const active = signals.activeRoutines;
    if (active === null) {
      return {
        title: "What Otto does without you",
        lead: "I cannot see your routines from here, so I cannot tell you whether one is running.",
        bullets: [
          "Otto makes work and spends credits without you only inside a routine you switched on.",
          "You can still ask me to explain something here.",
          "Anything that costs credits shows the price first, and you are only charged when it finishes.",
        ],
        note: "This chat did not start or change a routine.",
      };
    }
    if (active === 0) {
      return {
        title: "What Otto does without you",
        lead: "No routine is switched on right now, so Otto will not make anything, spend credits, schedule, or publish without you.",
        bullets: [
          "You can still ask me to explain something here.",
          "Otto only works while you are away once you switch a routine on.",
          "Anything that costs credits shows the price first, and you are only charged when it finishes.",
        ],
        note: "This chat did not start or change a routine.",
      };
    }
    return {
      title: "What Otto does without you",
      lead: `${active} routine${active === 1 ? " is" : "s are"} switched on right now. Otto only makes work inside ${active === 1 ? "it" : "them"}.`,
      bullets: [
        "Approving something still schedules it; it does not publish it.",
        "Auto-publish is off, so scheduled work waits for approval.",
        "Asking me something here does not run a routine.",
      ],
      note: "This chat did not change the running routine or spend credits.",
    };
  }

  if (/otto iq|provenance|learn|source|knowledge/.test(low)) {
    return {
      title: "Where Otto learned this",
      lead: "Otto IQ is what you have taught Otto in this workspace. Every saved item shows where it came from, so you can check what Otto is using.",
      bullets: [
        "Suggestions are not saved until you accept them.",
        // 原型作 "Do not say rules remain under merchant control"。讲的是品牌记忆里那种
        // 「绝对不要说」的规则(`Rule.kind === "never"`)—— 原句里 "do not say rules" 与
        // "merchant control" 都是内部说法,商家读到的要么是一条祈使句,要么是一个他没听过
        // 的词。措辞归真 2026-08-26:把规则讲成「Otto 绝不许说的话」,把归属讲成「是你的」。
        "Rules about what Otto must never say stay yours; Otto cannot remove one.",
        "Open Otto IQ to read the source before you accept a suggestion.",
      ],
      note: "This chat did not save, remove, or change anything in Otto IQ.",
    };
  }

  if (/analytics|last .*days|metric|performance/.test(low)) {
    return {
      title: "About these numbers",
      lead: "You asked this, so it is an explanation only — nothing runs unless you run it.",
      bullets: [
        "If I am not sure of a number, I say so instead of inventing one.",
        "Paid analysis shows its price before it runs, and you are only charged when it finishes.",
        "Open Analytics for a priced insight; nothing here has run one.",
      ],
      note: "No analysis was started and no credits were spent.",
    };
  }

  /* ── beta 卫生(2026-08-26)新增的两路 ────────────────────────────────────────
   *
   * 这两路是为空态起手卡补的**落点**,不是改既有回答:它们排在原型五路**之后**,所以
   * 原型那五路一句话、一个字都没有换路。补的理由是 beta 只卖创作 —— 审批 / 例程 /
   * 分析三扇门已经藏起来,起手卡不能再把商家的第一句话送进那三路;而创作线上商家最先
   * 问的两件事(这一下要花多少、做完的东西去哪儿了)在原型里根本没有路,不补就只能落到
   * 兜底那一路,而兜底那一路正好又在讲例程与审批。
   *
   * 这两路读的是 `said`(**只有商家这句话**),不是上面五路那个「上下文 + 这句话」的串。
   * 理由是一条实测:按串走的话,商家人在 Library 上随便打一句 "hello",页名里那个
   * library 就会把这一路点着,答非所问。页名说明的是他在看什么,不是他在问什么;
   * 这两个问题只该由他自己问出口才算数。
   */
  const said = String(prompt ?? "").toLowerCase();

  if (/cost|price|charge|credit|spend|how much/.test(said)) {
    return {
      title: "What this costs",
      lead: "Nothing here starts paid work. Anything that costs credits shows you the price first and waits for you to say yes.",
      bullets: [
        "You see the price before the work starts, not after it finishes.",
        "Credits leave your balance only when the work finishes.",
        "Work you cancel, and work that fails, is never charged.",
      ],
      note: "This chat did not start any work or spend credits.",
    };
  }

  if (/librar|finished|picture|image|photo|where do my|saved work/.test(said)) {
    return {
      title: "Where your finished work is kept",
      lead: "Everything Otto finishes is saved in your Library, filed under the project it was made for.",
      bullets: [
        "Open Library to see every finished picture, newest first.",
        "Each picture keeps the project it came from, so you can trace where it came from.",
        "Closing this panel does not delete anything you have made.",
      ],
      note: "This chat did not move, delete, or download anything.",
    };
  }

  return {
    title: "Workspace help",
    lead: "I can explain what you are looking at and point you to the button that makes the change.",
    bullets: [
      "Otto only works while you are away once you switch a routine on.",
      "Approving something schedules it; it does not publish it.",
      "You see the price before anything costs credits, and cancelled or failed work is never charged.",
    ],
    note: "This chat did not change anything or spend credits.",
  };
}
