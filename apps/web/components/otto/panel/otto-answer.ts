/**
 * otto-answer.ts —— 面板里 Otto 那张**答案卡**的模型(纯函数,没有 React、没有取数)。
 *
 * 视觉与文案权威 = R22 原型
 * `preserved/prototype-2026-08-24-r22/fikirtive-prototype-r22.html` 的 `responseFor()`
 * (L6692-6706)。原型里 Otto 回的不是一段散文,而是一张结构化的卡:
 * **标题 / 导语 / 要点 / 一句诚实注脚**。上一版实现把这一整套压成了一句自己编的话 ——
 * 那句话既不按话题分路,也没有把「这一轮什么都没动」写成一条可断言的事实。
 *
 * 五条路按原型的顺序与正则逐字搬过来(顺序有意义:`schedule` 走审批那一路,而不是
 * 兜底那一路)。分路读的是**上下文 + 商家这句话**拼起来的小写串,与原型同一条。
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

/** 等待态那一行字(原型 L6724)。 */
export const OTTO_ANSWER_WAIT_LABEL = "Thinking through the workspace context…";

/** 读不出来时那两句(原型 L6729,去掉只有写代码的人才懂的那个词)。 */
export const OTTO_ANSWER_ERROR_TITLE = "Couldn’t load the workspace detail.";
export const OTTO_ANSWER_ERROR_NOTE = "No action ran and no credits were spent.";

/** 想一想要多久。原型是 560ms;UI 反馈留在 300ms 以内的是**动效**,这是一次真的等待。 */
export const OTTO_ANSWER_WAIT_MS = 700;

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
  support: "Support handoff is ready; no message was sent.",
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
      lead: "This is an explanation only. The approval remains in the shared Approvals state until someone uses its real action.",
      bullets: [
        "Approve means schedule, not publish.",
        "Auto-publish is off, so nothing publishes before approval.",
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
        title: "Routine boundary",
        lead: "I cannot confirm routine state yet, so I will not claim autonomous work is running.",
        bullets: [
          "Autonomous preparation and spending require an active routine.",
          "You can still request an explanation or analysis in this chat.",
          "Any paid action still shows cost first and settles only on completion.",
        ],
        note: "This chat did not start a routine or change a routine state.",
      };
    }
    if (active === 0) {
      return {
        title: "Routine boundary",
        lead: "No routine is active right now, so Otto cannot autonomously prepare work, spend credits, schedule, or publish.",
        bullets: [
          "You can still request an explanation or analysis in this chat.",
          "User-invoked help is clearly separate from routine work.",
          "Any paid action still shows cost first and settles only on completion.",
        ],
        note: "This chat did not start a routine or change a routine state.",
      };
    }
    return {
      title: "Routine boundary",
      lead: `${active} routine${active === 1 ? " is" : "s are"} active right now. Autonomous preparation stays within those routine boundaries.`,
      bullets: [
        "Approve still means schedule, not publish.",
        "Auto-publish is off, so scheduled work waits for approval.",
        "User-invoked help here does not execute a routine action.",
      ],
      note: "This chat did not change the running routine or spend credits.",
    };
  }

  if (/otto iq|provenance|learn|source|knowledge/.test(low)) {
    return {
      title: "Otto IQ provenance",
      lead: "Otto IQ is workspace-scoped, merchant-controlled knowledge. Each saved fact carries its source so you can inspect what Otto is using.",
      bullets: [
        "Pending suggestions are not saved yet.",
        // 原型作 "Do not say rules remain under merchant control"。讲的是品牌记忆里那种
        // 「绝对不要说」的规则(`Rule.kind === "never"`),可是不带连字符时整句会被读成
        // 一条祈使句(「不要说 rules 仍归商家控制」),意思正好拧过来。这一个连字符是本
        // 文件与原型唯一的字面差异,加它是为了让原意读得出来。
        "Do-not-say rules remain under merchant control; Otto cannot remove them.",
        "Use Otto IQ to review the source before accepting a suggestion.",
      ],
      note: "This chat did not save, remove, or alter any Otto IQ record.",
    };
  }

  if (/analytics|last .*days|metric|performance/.test(low)) {
    return {
      title: "Analytics context",
      lead: "This is a user-invoked question about the current analytics view, not an autonomous routine action.",
      bullets: [
        "I will keep uncertainty visible instead of inventing a metric.",
        "Paid analysis must show cost before it runs and settles only when complete.",
        "Use the Analytics action for a priced insight; this chat has not run it.",
      ],
      note: "No analytics job was started and no credits were spent.",
    };
  }

  return {
    title: "Workspace help",
    lead: "I can explain this workspace and point you to the shared action that owns a change.",
    bullets: [
      "Routine work stays within an active routine.",
      "Approval schedules; it does not publish.",
      "Costs are shown before paid actions and never charged for cancelled or failed work.",
    ],
    note: "This chat did not change workspace state or spend credits.",
  };
}
