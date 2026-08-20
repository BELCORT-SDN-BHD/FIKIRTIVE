/**
 * C7 r2 —— 「今天做不到什么」这几句话的围栏(判官 r1 [P2-2])。
 *
 * r1 交出来的两句披露,防护是**不对称**的:
 *   · 分群那一句被 `crm-segments.test.ts` 的逐字钉板压着,删一个字就红;
 *   · Routine 那一句**两头不靠**。判官实测:把它整句从 `read-workflows.ts` 的描述末尾摘掉,
 *     `catalog:check` 照报 fresh(渲染器截断在 80 字符,尾部改动根本看不见),
 *     `pnpm --filter @fikirtive/otto test` 84 files / 1275 tests 全绿 —— 一条都不响。
 *   · `save-customer-segment.ts` 上那份拼接同样不在任何板上(旧板只覆盖 readSegments /
 *     buildSegment)。
 *
 * 全册 over-promise 词族(`publish-truth-fence.test.ts`)挡得住「**写回**一句承诺」,挡不住
 * 「**悄悄删掉**一句实话」。而本票的整个论点就是:沉默也是一类漏网。所以这个文件补的是
 * 对称的那一半。
 *
 * ── 两层,各挡一种漂 ────────────────────────────────────────────────────────
 * ① **措辞层**:两个常量的整段文字**逐字**钉在下面。改一个字就得来改这块板,那次编辑就是
 *    人工复审 —— 这几句是 Otto 对商家说的话,而 r1 已经证明过它们可以写得很像真的却是假的。
 * ② **覆盖层**:谁必须带哪一句,由注册表**机械枚举**,不是手抄名单 ——
 *    描述里提到 `CRM Segment` 的技能必须带分群那句,提到 `Routine` 的必须带 Routine 那句。
 *    新加一条谈分群或谈 Routine 的技能,它一进注册表就自动进网。
 *
 * ── 威胁模型边界(如实声明)────────────────────────────────────────────────
 * · ①钉的是文本,不是文本的真假。「这句话今天还成立吗」没有任何测试替得了 —— 那归复审与
 *   下面每条 `evidence` 写着的取证命令。r1 的 channel 半句就是**测试全绿的假话**。
 * · ②的判据是词法的:一条技能整段白话谈分群而一次不写 `CRM Segment`,枚举不到它。
 * · ②只管「带没带」,不管带在哪儿、说得对不对。
 */
import { describe, expect, it } from "vitest";
import { MESSAGING_STATUS_ASSISTANT } from "@fikirtive/core";
import { skillCatalog } from "../registry.js";
import { CRM_SEGMENT_AVAILABILITY, ROUTINE_EXECUTION_AVAILABILITY } from "./_availability.js";

/**
 * ① 措辞层 —— 两段文字的逐字副本。
 *
 * 分群那一段的最后一句拼的是既有权威 `MESSAGING_STATUS_ASSISTANT`(它自己有测试、有自己的
 * 复审归属),所以这里同样拼它而不是抄第三份 —— 修漂移的板子自己制造一次漂移,是 #792 r3
 * 已经踩过的坑。
 */
const APPROVED_AVAILABILITY_COPY = {
  CRM_SEGMENT_AVAILABILITY:
    "Availability, say it plainly whenever segments come up: there is no page in the app today for customer " +
    "segments, contacts or broadcasts, so never send the user to one. Never assume channel or consent data is " +
    "filled in for any given contact. Before saying how many contacts a segment or rule reaches, call preview " +
    "and report only the matchedCount it returns — never a prediction or an estimate. " +
    MESSAGING_STATUS_ASSISTANT,
  ROUTINE_EXECUTION_AVAILABILITY:
    "Availability, say it plainly whenever a rule's effect comes up: there is no page in the app today for " +
    "workflows or routines, so never send the user to one. Nothing in the product starts a routine run — saving a " +
    "rule, moving the definition pointer to a revision, and authorizing a routine all stop at a stored record, and " +
    "the run engine has no live entry point. Every run the engine is able to record is a simulation with delivery " +
    "and spend disconnected, so no routine action reaches a customer. Give no date for when routines start running.",
} as const;

/**
 * 每一条事实主张,配一条**取证命令** —— 「谁验的、跑什么」。
 *
 * 这张表不是断言,是**复判清单**:板子上的文字改动时,改的人要照着这里逐条重跑一遍,而不是
 * 凭印象说「还成立吧」。r1 的 channel 半句之所以能进模型上下文,正是因为当时没有这张表 ——
 * 有人凭「schema 里有 channel 这个 kind」就写了「能用」。
 *
 * ── 三句短版后的收敛(2026-08-20,Founder 裁决:放弃机制解释版)────────────────────
 * 分群那一句从此只剩三句短版事实,不再逐条列举字段级读写者取证或闸门算法 —— 这张表因此只
 * 收还留在披露里的主张。凡是「对某类 contact 恒选中/恒排除」或任何机制细节,一律不进这张
 * 表,也不许回到披露文本里(见下面「三句短版之外的机制解释与人数断言不许回来」)。
 */
const CLAIM_EVIDENCE: ReadonlyArray<{ claim: string; verify: string }> = [
  {
    claim: "there is no page in the app today for customer segments, contacts or broadcasts",
    verify:
      "grep -rn 'redirect(\"/\")' apps/web/app/crm —— 14 个路由文件全中;既有围栏 apps/web/lib/__tests__/route-redirects.test.ts",
  },
  {
    claim: "call preview and report only the matchedCount it returns",
    verify:
      "apps/web/lib/segment-actions.ts:305 matchedCount: matched.length —— preview 真实返回的字段,不是虚构名字",
  },
  {
    claim: "Never assume channel or consent data is filled in for any given contact",
    verify:
      "2026-08-21 编排者裁决(r6):指令形(never assume),不主张任何联系人的数据现状,也不暗示「联系触达依赖 channel/consent」——判官反例是纯 lifetime_spend 规则根本不读 channel,所以句子里已删掉任何 depends-on/reach 式的关联框架;唯一要核的是句子本身不含状态断言词或字段依赖词,读它自己即可核销,不需要数据层证据",
  },
  {
    claim: "Nothing in the product starts a routine run",
    verify:
      "grep -rn resolveWorkerContext —— 生产零传入,requireWorker() 因此恒 fail(\"AUTHORITY_UNAVAILABLE\");apps/worker 的 QUEUES 里无 workflow/routine",
  },
  {
    claim: "Every run the engine is able to record is a simulation",
    verify:
      "packages/db/src/workflow-engine.ts 唯一那次 routineRun.createMany 钉死 simulated: true;既有围栏 apps/web/lib/__tests__/crm-honest-preview.test.ts",
  },
];

/** ② 覆盖层 —— 谁必须带哪一句,判据在这里,名单由注册表算。 */
const CARRIERS = [
  {
    what: "CRM Segment",
    mentions: /\bCRM Segments?\b/,
    truth: CRM_SEGMENT_AVAILABILITY,
    /** 当日快照 —— 不是判据,是「名单变了要有人看见」的提醒。 */
    today: ["buildSegment", "readSegments", "saveCustomerSegment"],
  },
  {
    what: "Routine",
    mentions: /\bRoutines?\b/,
    truth: ROUTINE_EXECUTION_AVAILABILITY,
    today: ["draftWorkflows", "readWorkflows"],
  },
] as const;

describe("C7 Otto 的「今天做不到什么」——措辞层", () => {
  it.each(Object.entries(APPROVED_AVAILABILITY_COPY))(
    // 四轮判官 [P3]:旧断言用 Object.values(live).toContain(approved),只问「approved 在不在
    // live 的某个值里」,两个常量互换内容仍会通过。改成按同名 key 比较,互换必定至少一个 key 红。
    "%s 的整段文字逐字钉在板上(按同名 key 比较)",
    (name, approved) => {
      const live: Record<string, string> = { CRM_SEGMENT_AVAILABILITY, ROUTINE_EXECUTION_AVAILABILITY };
      expect(live[name]).toBe(approved);
    },
  );

  it("板子确实压得住「顺手加一句」——反面自证", () => {
    for (const approved of Object.values(APPROVED_AVAILABILITY_COPY)) {
      // 追加一句(r1 那种「顺手补一句」的形状)。
      expect(`${approved} Routines start running next month.`).not.toBe(approved);
      // 改一个字(两段都含 "today",所以这条变异对两段都真的生效 —— 不是一条空断言)。
      expect(approved).toContain("today");
      expect(approved.replace("today", "tomorrow")).not.toBe(approved);
    }
  });

  it("每一条事实主张都写明了谁验的、跑什么命令", () => {
    for (const { claim, verify } of CLAIM_EVIDENCE) {
      // 主张必须真的出现在某一段披露里 —— 否则这张清单会慢慢变成一堆死条目。
      const both = `${CRM_SEGMENT_AVAILABILITY} ${ROUTINE_EXECUTION_AVAILABILITY}`;
      expect(both, `这条主张已经不在披露里了,该从清单删掉:${claim}`).toContain(claim);
      expect(verify.length, claim).toBeGreaterThan(20);
    }
  });

  it("三句短版之外的机制解释与人数断言不许回来 —— Founder 2026-08-20 裁决后的最后一道网", () => {
    // 删掉的机制词:选择算法的内部分支、known opt-out 定义、字段级读写者取证,一律不许回来。
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/twice for each contact/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/opt-in and once as an opt-out/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/known opt-out/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/unresolvedLegacyOptOut/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/effective_revoke/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/discarded before the check runs/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/graded channel-verified/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/last order recency and tags/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/lifetime spend reads/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/excludeReportedOptOut/i);
    // r1-r4 四轮证伪过的方向/量词形状,仍然不许回来。
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/select real people[^.]*channel/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/channel and contactability/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/not_contactable matches every contact/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/contactable matches nobody/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/that is everyone/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/which today is nobody/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/needs the customer's own verified confirmation/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/matches nobody/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/matches every/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/matches only/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/matches exactly/i);
    // 2026-08-21 编排者裁决(r6 之前一轮):句 2 那一版的软量词数据状态断言也判死 —— 同样不许
    // 回来(依旧留着当历史句禁词,即使下面的类级正则也已经覆盖它)。
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/incomplete for many contacts/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/much of the underlying data/i);
    // r6:句 2 那一版「reach depends on — channel and consent status —」构成可证伪主张
    // (判官反例:纯 lifetime_spend 规则不读 channel)—— 同样不许回来。
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/reach depends on/i);
    // r6 判官绕过样例的类级正则,不是逐句钉死单个措辞,挡的是同一类换皮说法:
    //   ·「Channel data is missing for many customers.」
    //   ·「Each contact is evaluated under both consent states.」
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/\b(is|are)\s+(missing|incomplete|empty|unfilled)\b/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/\bevaluated\s+(twice|under both)\b/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/\bboth consent states\b/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/\bfor\s+(many|most|some|all|every)\s+(contacts|customers)\b/i);
    // 人数/人群断言:披露里(MESSAGING_STATUS_ASSISTANT 那半句同样零数字)不许出现任何数字。
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/\d/);
    // 正面:三句短版要求的三件事确实在场 —— 句 2 是指令形(never assume),不是状态断言,
    // 也不含字段依赖框架。这三条断言本身就是「三句新文案 + MESSAGING_STATUS_ASSISTANT 拼接
    // 全文不踩任何新旧禁词」的自证:CRM_SEGMENT_AVAILABILITY 就是那份拼接全文,上面每一条
    // not.toMatch 已经对它逐条跑过。
    expect(CRM_SEGMENT_AVAILABILITY).toMatch(/there is no page in the app today for customer/);
    expect(CRM_SEGMENT_AVAILABILITY).toMatch(/Never assume channel or consent data is filled in/);
    expect(CRM_SEGMENT_AVAILABILITY).toMatch(/call preview and report only the matchedCount/);
  });
});

describe("C7 Otto 的「今天做不到什么」——覆盖层", () => {
  it("枚举面自检:注册表真的被扫到了", () => {
    expect(skillCatalog.length).toBeGreaterThan(20);
  });

  it.each(CARRIERS)("描述里提到 $what 的技能,今天正好是那几条", ({ mentions, today }) => {
    const found = skillCatalog
      .filter((skill) => mentions.test(skill.description))
      .map((skill) => skill.name)
      .sort();
    expect(found).toEqual([...today].sort());
  });

  it.each(CARRIERS)("凡描述里提到 $what 的技能,都整句带着那一句实话", ({ mentions, truth }) => {
    const carriers = skillCatalog.filter((skill) => mentions.test(skill.description));
    // 空集会让下面那条白白通过。
    expect(carriers.length).toBeGreaterThan(0);
    const offenders = carriers.filter((skill) => !skill.description.includes(truth)).map((s) => s.name);
    expect(offenders, "这些技能谈到了它,却没把「今天做不到什么」一并说出来").toEqual([]);
  });

  it("这条判据拦得住「整句被悄悄删掉」—— 反面自证", () => {
    // 判官 r1 做过的那次变异,固化成断言:把披露从一条真实描述里摘掉,判据必须认定它漏网。
    const victim = skillCatalog.find((skill) => skill.name === "readWorkflows")!;
    const stripped = victim.description.replace(ROUTINE_EXECUTION_AVAILABILITY, "").trim();
    expect(stripped).not.toBe(victim.description);
    expect(/\bRoutines?\b/.test(stripped)).toBe(true);
    expect(stripped.includes(ROUTINE_EXECUTION_AVAILABILITY)).toBe(false);
    // 同款:分群那一侧。
    const segmentVictim = skillCatalog.find((skill) => skill.name === "saveCustomerSegment")!;
    const strippedSegment = segmentVictim.description.replace(CRM_SEGMENT_AVAILABILITY, "").trim();
    expect(/\bCRM Segments?\b/.test(strippedSegment)).toBe(true);
    expect(strippedSegment.includes(CRM_SEGMENT_AVAILABILITY)).toBe(false);
  });
});
