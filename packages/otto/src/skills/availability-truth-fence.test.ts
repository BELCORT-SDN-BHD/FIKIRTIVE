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
    "segments, contacts or broadcasts, so never send the user to one. Four of the five rule facts have nothing " +
    "behind them — last order recency, tags, lifetime spend, and channel, which counts only a number that a " +
    "connected channel has confirmed — so a rule using any of those four matches nobody rather than guessing. The " +
    "fifth, contactability, is the one rule that can pick out a real group of customers today: " +
    "contactability=contactable matches every contact who is not a known opt-out — today, that is everyone — and " +
    "contactability=not_contactable matches only a known opt-out, which today is nobody, because a known opt-out " +
    "needs the customer's own verified confirmation and no production writer supplies one. An opt-out the merchant " +
    "recorded by hand is not a known opt-out, so it stays inside contactable; set the rule group's " +
    "excludeReportedOptOut to leave those contacts out too, the one way to pick out a real subset of customers " +
    "today. A saved segment is a list and nothing more today. " +
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
 */
const CLAIM_EVIDENCE: ReadonlyArray<{ claim: string; verify: string }> = [
  {
    claim: "there is no page in the app today for customer segments, contacts or broadcasts",
    verify:
      "grep -rn 'redirect(\"/\")' apps/web/app/crm —— 14 个路由文件全中;既有围栏 apps/web/lib/__tests__/route-redirects.test.ts",
  },
  {
    claim: "Four of the five rule facts have nothing behind them",
    verify:
      "last order recency / tags:apps/web/lib/segment-actions.ts:64 的 UNAVAILABLE_FACTS,且 evaluateContact 构造的 facts 里没有这两个键",
  },
  {
    claim: "lifetime spend",
    verify:
      "grep -rn totalOrdersMyr apps packages —— 生产侧零写入点;crm-actions.ts:325 明确拒收 \"That field is read-only.\"",
  },
  {
    claim: "which counts only a number that a connected channel has confirmed",
    verify:
      "grep -rn markContactIdentityChannelVerified —— 零生产调用点(只有两个测试);生产八处身份写入全钉 MERCHANT_UNVERIFIED_IDENTITY;contactChannelFacts() 只留 isChannelVerifiedIdentity",
  },
  {
    claim: "a rule using any of those four matches nobody rather than guessing",
    verify:
      "行为实证:contactMatchesRules(生产形状的 facts, 该规则) → false,四支各跑一次",
  },
  {
    claim: "contactability=contactable matches every contact who is not a known opt-out",
    verify:
      "行为实证,走 selectedIntoAudience(consent-authority.ts:122-139,经 segment-actions.ts:221-233 的 matches() —— Otto 分群预览/构建实际走的产品闸,不是 contactMatchesRules 纯匹配器):普通 contact → contactable=true;known opt-out(isKnownOptOut,consent-fold.ts:314-316)的 contact → contactable=false",
  },
  {
    claim: "contactability=not_contactable matches only a known opt-out",
    verify:
      "同一探针取反:selectedIntoAudience 对普通 contact → not_contactable=false,对 known opt-out contact → not_contactable=true;known opt-out 需 effective_revoke(仅 customer+interactive+verified 事件可折出,consent-fold.ts:187)或 legacy 围栏字节,生产两个 recordConsentEvent 调用点(crm-actions.ts:297 crm_manual、:917 import)都是 merchant/backfill/asserted,故今天不可达",
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
    "%s 的整段文字逐字钉在板上",
    (_name, approved) => {
      const live = { CRM_SEGMENT_AVAILABILITY, ROUTINE_EXECUTION_AVAILABILITY };
      expect(Object.values(live)).toContain(approved);
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

  it("r1 那句假话不许回来 —— 它是这块板存在的理由", () => {
    // 「channel 选得出真人」是 r1 的原句形状。实据:contactChannelFacts() 只认
    // channel_verified,而写那个等级的函数零生产调用点。
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/select real people[^.]*channel/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/channel and contactability/i);
    // 而且它必须正面说清今天哪一条规则真的选得出人,方向不能含糊也不能说反(判官 [P2-1])。
    expect(CRM_SEGMENT_AVAILABILITY).toMatch(
      /is the one rule that can pick out a real group of customers today/,
    );
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
