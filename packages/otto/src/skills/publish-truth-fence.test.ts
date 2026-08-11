/**
 * #851 —— Otto 谈到「发出去」时,说的必须和按钮说的是同一句话。
 *
 * 双面验收的另一半:人手那一面由 apps/web 的 publish-honest-preview.test.ts 守(可见面 +
 * 词族),这一面守的是 Otto 嘴里的口径。两面读的是**同一个**权威 ——
 * `@fikirtive/core/schedule-draft` 的 `ottoPublishTruth()`。
 *
 * 为什么钉在技能描述上:技能描述是每一轮都进模型上下文的东西,它就是 Otto 关于这件事的
 * 知识。批准技能原来的描述写着「consent to a real, irreversible external publish」,取帖
 * 目标那条写着「an empty list means they have not connected a publishable account yet —
 * tell them to connect one」。前一句承诺了一个产品此刻做不到的结果;后一句把商家指向一扇
 * 打不开的门(#554 之后没有人连得上)。屏幕已经改口,Otto 不改口,就是同一个产品两套说法。
 *
 * ── 威胁模型边界(如实声明)────────────────────────────────────────────────
 * · 这里钉的是**描述文本**,不是模型的输出。Otto 仍可能在一句自由回答里说错话 —— 那一层
 *   归提示词的 golden 快照与复审。这条挡的是「描述里又写回一句承诺」这种源头。
 * · 词族是词法的:换一种从没见过的英语说法,这里逮不到。它挡的是旧话术回潮与顺手再写一句。
 * · `ottoPublishTruth()` 两态都在这里钉,所以翻开关不会让这个文件变成一条永远为真的断言。
 */
import { describe, expect, it } from "vitest";
import { ottoPublishTruth } from "@fikirtive/core/schedule-draft";
import { approveScheduledPostSkill } from "./approve-scheduled-post.js";
import { schedulePostsSkill } from "./schedule-posts.js";
import { listPublishTargetsSkill } from "./list-publish-targets.js";

/** 会宣称帖子真的到达一个社交账号的写法。 */
const WILL_REALLY_SEND = [
  /\bwill (?:be )?(?:automatically )?(?:publish|post|go out|send|be sent|be posted)\b/i,
  /\bpublishes to\b/i,
  /\bgoes? live\b/i,
  /\bpublish(?:es|ed)? automatically\b/i,
  /\birreversible\s+(?:external\s+)?publish\b/i,
];
/** 工期承诺(#768 文案纪律)。 */
const PROMISES_A_DATE = [
  /\bcoming soon\b/i,
  /\b(?:by|in|from|before|after|starting|until)\s+(?:early |mid(?:-| )|late )?(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b(?:by|in|during)\s*Q[1-4]\b/i,
  /\b(?:by|in|within|from|starting|available|ready|back|live|on)\s+(?:the\s+)?(?:next|this|coming)\s+(?:few\s+)?(?:days?|weeks?|months?|quarters?|years?)\b/i,
];
const OVER_PROMISE = [...WILL_REALLY_SEND, ...PROMISES_A_DATE];

function overPromises(text: string, family = OVER_PROMISE): string[] {
  return family.filter((re) => re.test(text)).map((re) => `${re} → "${re.exec(text)![0]}"`);
}

/** 会说到「这条帖子会怎样」的三个技能 —— Otto 关于发布的全部嘴。 */
const PUBLISH_SKILLS = [
  ["approveScheduledPost", approveScheduledPostSkill],
  ["schedulePosts", schedulePostsSkill],
  ["listPublishTargets", listPublishTargetsSkill],
] as const;

describe("#851 Otto 的发布口径", () => {
  it("词族先自证会响,也自证不误伤正当写法", () => {
    expect(overPromises("Approving is consent to a real, irreversible external publish.")).not.toEqual([]);
    expect(overPromises("The post will publish at its scheduled time.")).not.toEqual([]);
    expect(overPromises("Channels are coming soon.")).not.toEqual([]);
    // 不误伤:诚实地说「不会发」、以及取消技能那句「so it will not publish」。
    expect(overPromises("Cancel a scheduled post so it will not publish.")).toEqual([]);
    expect(overPromises(ottoPublishTruth(false))).toEqual([]);
  });

  it("权威两态各说各的,preview 那套不许留一句承诺", () => {
    const preview = ottoPublishTruth(false);
    const live = ottoPublishTruth(true);
    expect(preview).not.toBe(live);
    expect(overPromises(preview)).toEqual([]);
    // 反面自证:live 那套确实会说「会真发」,所以上一条不是在检一张空网。
    expect(overPromises(live, WILL_REALLY_SEND)).not.toEqual([]);
    // preview 那套必须把三件事都说到:不会发、连不上、不给日期。
    expect(preview).toMatch(/sends nothing/i);
    expect(preview).toMatch(/no account can be connected/i);
    expect(preview).toMatch(/no date/i);
  });

  it.each(PUBLISH_SKILLS)("%s 的描述整句照抄权威,不是自己写一份", (_name, skill) => {
    expect(skill.description).toContain(ottoPublishTruth());
  });

  it.each(PUBLISH_SKILLS)("%s 的描述里没有第二句「会真发」的承诺", (_name, skill) => {
    expect(overPromises(skill.description)).toEqual([]);
  });

  it("批准技能不再把商家指向一个打不开的连接入口", () => {
    // #554 之后没有人连得上,所以「去连一个账号就能发」是一条走不通的路(#851 ③)。
    // 「connect」这个词本身仍可以出现(权威那句话就在解释为什么连不上),这里钉的是
    // 「去连一个 → 就能发」这种指路。
    for (const [, skill] of PUBLISH_SKILLS) {
      expect(skill.description).not.toMatch(/tell them to connect one/i);
      expect(skill.description).not.toMatch(/connect (?:one|an account)[^.]{0,40}(?:so|then)[^.]{0,40}publish/i);
    }
  });

  it("批准这件事仍然是要人点头的 —— 诚实没有顺手放松那道闸", () => {
    // 本票只改口径,不碰授权形状。闸松了会在这里立刻红。
    expect(approveScheduledPostSkill.needsApproval).toBe(true);
    expect(approveScheduledPostSkill.effect).toBe("write");
    expect(approveScheduledPostSkill.reach).toBe("external");
    expect(approveScheduledPostSkill.description).toMatch(/approval card/i);
  });
});
