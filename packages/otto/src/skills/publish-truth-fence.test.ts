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
 * ── C7 补的那一半:**沉默** ─────────────────────────────────────────────────
 * 原来这个文件只做「不许说大话」。可 #851 之后仍有一整类漏网:一条技能提到帖子的发布、
 * 却对「今天发不出去」只字不提 —— 它一句大话也没写,所以词族全绿,而模型读完这段描述得到
 * 的印象仍然是「排好就会出去」。实测:同一天注册表里八条技能的描述提到发帖,带着权威那一句
 * 的只有三条。
 *
 * 所以「谁必须带」从**手抄名单**改成**机械枚举**:判据是「描述里提到帖子的发布」,枚举源是
 * 注册表全册。下个月新加一条排程技能,它一进注册表就自动进网。
 *
 * ── 威胁模型边界(如实声明)────────────────────────────────────────────────
 * · 这里钉的是**描述文本**,不是模型的输出。Otto 仍可能在一句自由回答里说错话 —— 那一层
 *   归提示词的 golden 快照与复审。这条挡的是「描述里又写回一句承诺」这种源头。
 * · 词族是词法的:换一种从没见过的英语说法,这里逮不到。它挡的是旧话术回潮与顺手再写一句。
 * · 枚举判据同样是词法的:一条技能用整段白话描述发帖而一次不写 publish 这个词,枚举不到它。
 * · 扫描面是 `description`,不含 `parameters`。参数里的枚举值(例如
 *   `readWorkflows` 的 policyStatus `"published"`)是业务状态名,不是「帖子会出去」的承诺;
 *   把它们一起扫会逼出一堆与发帖无关的豁免,那正是名单式围栏烂掉的方式。
 * · `ottoPublishTruth()` 两态都在这里钉,所以翻开关不会让这个文件变成一条永远为真的断言。
 */
import { describe, expect, it } from "vitest";
import { ottoPublishTruth } from "@fikirtive/core/schedule-draft";
import { skillCatalog } from "../registry.js";
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
  // 「can publish」形(r2 判官)。「will publish」被逮住之后,同一个承诺换个助动词就照常进
  // 模型上下文 —— 而且不是理论上的:注册表里真有两条这么写(editScheduledPost 的
  // 「before it can publish again」、listPublishTargets 的「accounts the user can publish to」),
  // 上面五条规则一条都没响。
  //
  // 前置否定要放行:「cannot publish」「can't publish」自带词形,`can publish` 根本匹配不到;
  // 但「no account can publish」这类**分开写**的诚实否定会被裸规则误伤,所以看它前面 30 字符
  // 内(不跨句号)有没有否定词。两侧都在下面的自证断言里钉着。
  /(?<!\b(?:no|not|never|nothing|cannot|can['’]t|won['’]t)\b[^.]{0,30})\bcan (?:be )?publish(?:ed)?\b/i,
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

/**
 * #851 改过口的三条技能 —— 下面几组「不许再写回承诺」的断言钉在它们身上。
 *
 * **它不再是「谁必须带那句实话」的名单**(C7):名单会漂,而且已经漂过 —— 同一天注册表里
 * 有八条技能的描述提到发帖,只有这三条带着权威那一句,另外五条(cancelScheduledPost、
 * listScheduledPosts、suggestPostTimes、planCampaign,以及本来就该带的
 * listPublishTargets)照旧各说各话。谁必须带,现在由下面 `PUBLISH_TRUTH_REQUIRED` 从
 * 注册表**机械枚举**,不再手抄。
 */
const PUBLISH_SKILLS = [
  ["approveScheduledPost", approveScheduledPostSkill],
  ["schedulePosts", schedulePostsSkill],
  ["listPublishTargets", listPublishTargetsSkill],
] as const;

/**
 * 「发帖」意义上的 publish —— 与 Workflow **修订版**的 publish 是同一个词、两件事。
 *
 * `draftWorkflows` 的描述里那两处(`publish one immutable revision`、
 * `Publishing a revision NEVER activates or authorizes a Routine`)说的是把定义指针移到某个
 * 修订版,和帖子会不会到达 Instagram 毫无关系 —— 给它拼上排程那句实话只会把模型搞糊涂。
 * 所以先把这个词义**从文本里摘掉**,剩下的才算「这条帖子会怎样」的口径。
 *
 * 这是一条**词义**豁免,不是一份技能名单:任何技能只要写的是修订版发布就自动落在外面,
 * 只要写的是帖子发布就自动落在里面 —— 下面的自证断言两个方向都钉着。
 */
const REVISION_SENSE = /\bpublish(?:ing|es|ed)?\b(?:\s+(?:one|a|an|the|new|immutable|workflow))*\s+revisions?\b/gi;

/** 这段文本里「这条帖子会怎样」的说法,逐个回报(空 = 这条技能对发帖只字未提)。 */
function postPublishMentions(text: string): string[] {
  return [...text.replace(REVISION_SENSE, " ").matchAll(/\bpublish\w*/gi)].map((m) => m[0]);
}

/**
 * **谁必须带那句实话 —— 从注册表机械枚举出来的,不是手抄的名单。**
 *
 * 判据只有一条:这条技能的描述里提到了帖子的发布。提到了,商家就可能据此以为帖子会出去,
 * 那就必须在同一段文字里读到权威那一句。今天枚举出七条;下个月新加一条排程技能,它一进
 * 注册表就自动进这张网,没有人需要记得来改这里。
 */
const PUBLISH_TRUTH_REQUIRED = skillCatalog.filter(
  (skill) => postPublishMentions(skill.description).length > 0,
);

describe("#851 Otto 的发布口径", () => {
  it("词族先自证会响,也自证不误伤正当写法", () => {
    expect(overPromises("Approving is consent to a real, irreversible external publish.")).not.toEqual([]);
    expect(overPromises("The post will publish at its scheduled time.")).not.toEqual([]);
    expect(overPromises("Channels are coming soon.")).not.toEqual([]);
    // 「can publish」形 —— 这两句是 r2 判官在注册表里找到的**原句**,不是我编的样本。
    expect(overPromises("it must be re-approved before it can publish again")).not.toEqual([]);
    expect(overPromises("List the accounts the user can publish to")).not.toEqual([]);
    expect(overPromises("A saved revision can be published.")).not.toEqual([]);
    // 不误伤:诚实地说「不会发」、以及取消技能那句「so it will not publish」。
    expect(overPromises("Cancel a scheduled post so it will not publish.")).toEqual([]);
    expect(overPromises(ottoPublishTruth(false))).toEqual([]);
    // 不误伤:诚实否定的三种写法。前两种自带词形(can publish 匹配不到),第三种是分开写的
    // 否定 —— 前置否定词那条前瞻就是为它加的,少了它这三句会被判成承诺。
    expect(overPromises("This connection cannot publish right now.")).toEqual([]);
    expect(overPromises("Publishing is not switched on, so nothing can publish.")).toEqual([]);
    expect(overPromises("No account can publish while publishing is off.")).toEqual([]);
    expect(overPromises("Publishing is not available, and no post can be published.")).toEqual([]);
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

  // ── C7:谁必须带那句实话,由注册表说了算 ──────────────────────────────────
  it("词义豁免自证:修订版发布落在外面,帖子发布落在里面", () => {
    // 外面:Workflow 修订版的两种真实写法(`draftWorkflows` 的原句)。
    expect(postPublishMentions("publish one immutable revision as the definition pointer")).toEqual([]);
    expect(postPublishMentions("Publishing a revision NEVER activates or authorizes a Routine.")).toEqual([]);
    expect(postPublishMentions("save a revision, then publish the revision")).toEqual([]);
    // 里面:帖子发布的各种写法,一个都不许被豁免吞掉。
    expect(postPublishMentions("The post will publish at its scheduled time.")).not.toEqual([]);
    expect(postPublishMentions("Suggest good times to publish on a channel")).not.toEqual([]);
    expect(postPublishMentions("drafts, queued, published, needs-attention")).not.toEqual([]);
    expect(postPublishMentions("it NEVER dispatches publishing")).not.toEqual([]);
    // 一句话里两种词义并存时,帖子那一半照样看得见 —— 豁免摘的是词义,不是整句。
    expect(postPublishMentions("publish a revision, then the post will publish")).not.toEqual([]);
  });

  it("枚举面自检:注册表真的被扫到了,而且今天七条都在", () => {
    expect(skillCatalog.length).toBeGreaterThan(20);
    const required = PUBLISH_TRUTH_REQUIRED.map((skill) => skill.name).sort();
    // 一份**当日快照**,不是判据:判据是上面那条 filter。名单变了要有人看见 ——
    // 新加一条谈发帖的技能会红在这里,提醒把它记进 PR 正文,而不是悄悄溜进模型上下文。
    expect(required).toEqual([
      "approveScheduledPost",
      "cancelScheduledPost",
      "listPublishTargets",
      "listScheduledPosts",
      "planCampaign",
      "schedulePosts",
      "suggestPostTimes",
    ]);
  });

  it("凡描述里谈到帖子发布的技能,都整句带着权威那一句", () => {
    const offenders = PUBLISH_TRUTH_REQUIRED.filter(
      (skill) => !skill.description.includes(ottoPublishTruth()),
    ).map((skill) => `${skill.name} → ${postPublishMentions(skill.description).join(", ")}`);
    expect(offenders, "这些技能谈到帖子会不会发出去,却没读到权威那一句").toEqual([]);
  });

  it("这条判据拦得住新长出来的沉默 —— 反面自证", () => {
    // 一条形状真实的新技能:谈发帖、不带权威那一句。判据必须认定它是漏网的。
    const planted = {
      name: "plantedSkill",
      description: "List the posts that are waiting to publish this week. $0 read-only.",
    };
    expect(postPublishMentions(planted.description)).not.toEqual([]);
    expect(planted.description.includes(ottoPublishTruth())).toBe(false);
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

// ── 全册扫描:承诺不许从任何一条技能长回来 ────────────────────────────────────
//
// 上面那几条钉的是**我们已经改过的三条**技能。可承诺回潮最自然的样子不是有人回去改这三条,
// 而是**下个月新加一条**技能,描述里顺手写一句「will publish at its scheduled time」——
// 那条新技能不在 PUBLISH_SKILLS 里,上面每一条都照常绿。
//
// 所以这一组扫的是注册表**全册**:今天 56 条,以后有多少扫多少,新技能自动进网。这是「防回潮」
// 这四个字唯一站得住的实现方式。
//
// 词族边界(与上面同一套,如实声明):它是**词法**的,换一种没见过的英语说法逮不到;而且刻意
// 不含 apps/web 那条 `sends them/it` 规则 —— 仓库里三条正当描述会命中它
// (editScheduledPost「sends it back to DRAFT」、manageMedia「send it back to the candidate
// zone」、sharePostPreview「send it for external review」),那三处说的都不是送去社交账号。
// 与其为了塞进一条规则去改三条无关技能的措辞,不如把这条规则留在它不误伤的那一面。
describe("#851 全册技能描述:没有第二处在替产品说大话", () => {
  it("注册表不是空的 —— 空册会让下面那条白白通过", () => {
    expect(skillCatalog.length).toBeGreaterThan(20);
    const names = skillCatalog.map((m) => m.name);
    for (const [name] of PUBLISH_SKILLS) expect(names).toContain(name);
  });

  it("全册没有一条技能描述宣称帖子会真的发出去,或给了工期", () => {
    const offenders = skillCatalog
      .map((m) => ({ name: m.name, hits: overPromises(m.description) }))
      .filter((r) => r.hits.length > 0)
      .map((r) => `${r.name} → ${r.hits.join(" ; ")}`);
    expect(offenders, "这些技能描述替产品许了一个此刻做不到的结果").toEqual([]);
  });

  it("这张网确实拦得住新长出来的承诺 —— 反面自证", () => {
    // 把一条真实形状的违规描述喂进同一个判定:它必须响。否则上一条只是在遍历一个
    // 对什么都不响的空网。
    const planted = "Draft a post and it will publish to Instagram automatically at its scheduled time.";
    expect(overPromises(planted)).not.toEqual([]);
  });
});
