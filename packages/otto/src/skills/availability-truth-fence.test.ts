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
    "segments, contacts or broadcasts, so never send the user to one. This description makes no claim about how " +
    "many contacts any rule or segment matches, or names them as everyone or nobody — that depends entirely on " +
    "this merchant's own data, so call preview and read its matchedCount before saying who a segment reaches or " +
    "how many. Last order recency and tags are never built into the fact object a rule is checked against at " +
    "all — that object has no such keys, by construction. Lifetime spend reads the contact's stored order total; " +
    "the only place this app lets a merchant edit that field rejects the edit, and no other write path for it " +
    "exists in this app's code. Channel reads only identities graded channel-verified — a grade one function " +
    "grants per identity, and this app's migration history has also assigned to every pre-existing identity row " +
    "at once. Contactability's underlying fact is discarded before the check runs: selection re-evaluates the " +
    "whole rule group twice for each contact, once as an opt-in and once as an opt-out, and combines the two " +
    "answers with whether she is a known opt-out — so her final membership can depend on the group's other " +
    "leaves, not on contactability alone. A known opt-out is the customer's own confirmed word that she opted " +
    "out, given through her channel, or — failing that — on file from a verified historical record; a merchant's " +
    "own note that a contact opted out is not itself a known opt-out. The rule group's excludeReportedOptOut can " +
    "additionally leave those merchant-recorded contacts out, but only as a subtraction on top of whatever the " +
    "consent gate already decided, never an addition. A saved segment stores its rule definition only; the " +
    "matching contact list is recalculated live every time it is read, and saving never sends anything. " +
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
 * ── 断路器条款后的收敛(2026-08-20,四轮 codex 复判后)──────────────────────────────
 * 这张表从此**只收静态可证类主张**——某字段生产侧有没有写入路径、某函数被谁调用、某段代码
 * 结构上做了什么。凡是「对某类 contact 恒选中/恒排除」这种从代码推出的结果性主张,一律不进
 * 这张表 —— 那类结论已经证明了两次会被下一批数据或下一处没查到的写入路径推翻(r3 的绝对量
 * 词、r4 的「四事实圈不出人」)。verify 只写「读哪个文件的哪一行,它写的是什么」,不写「所以
 * 对某类输入恒为 X」。
 */
const CLAIM_EVIDENCE: ReadonlyArray<{ claim: string; verify: string }> = [
  {
    claim: "there is no page in the app today for customer segments, contacts or broadcasts",
    verify:
      "grep -rn 'redirect(\"/\")' apps/web/app/crm —— 14 个路由文件全中;既有围栏 apps/web/lib/__tests__/route-redirects.test.ts",
  },
  {
    claim: "Last order recency and tags are never built into the fact object a rule is checked against at all",
    verify:
      "apps/web/lib/segment-actions.ts:64 UNAVAILABLE_FACTS = { lastOrderAt: true, tags: true };evaluateContact(:169-192)构造的 facts 对象字面量(:185-190)里没有 lastOrderAt/tags 这两行 —— 是键不存在,不是值为 undefined",
  },
  {
    claim:
      "the only place this app lets a merchant edit that field rejects the edit, and no other write path for it exists in this app's code",
    verify:
      "apps/web/lib/crm-actions.ts:325 拒收 \"That field is read-only.\";grep -rn totalOrdersMyr apps packages 及全部 migration SQL(packages/db/prisma/migrations)未发现其它写入点。不断言生产数据是否为空 —— packages/db/prisma/schema.prisma:1500 totalOrdersMyr 是 Decimal? 无字段级约束,那是数据层问题",
  },
  {
    claim:
      "Channel reads only identities graded channel-verified — a grade one function grants per identity, and this app's migration history has also assigned to every pre-existing identity row at once",
    verify:
      "packages/db/src/contact-identity.ts:95 markContactIdentityChannelVerified 逐条授予;packages/db/prisma/migrations/20260809100000_contact_identity_verification_grade/migration.sql:36(ADD COLUMN 默认值 channel_verified)与 :42-45(UPDATE 把迁移前全部存量 ContactIdentity 行统一设为该等级)——这条 migration 写入路径是四轮里第一次被查到,此前 r1-r4 都只查了应用代码调用点",
  },
  {
    claim: "Contactability's underlying fact is discarded before the check runs",
    verify:
      "apps/web/lib/consent-authority.ts:122-139 selectedIntoAudience 源码:matchesAs(marketingConsent) 用调用方传入的值覆盖 facts 后才调 contactMatchesRules,函数体从未读取 evaluateContact 算出的原始 facts.marketingConsent",
  },
  {
    claim:
      "selection re-evaluates the whole rule group twice for each contact, once as an opt-in and once as an opt-out",
    verify:
      "consent-authority.ts:134-138:matchesAs(\"opt_in\") 与 matchesAs(\"opt_out\") 都把整条 rules(不是单叶)交给 contactMatchesRules;contactMatchesRules(packages/core/src/segment-rules.ts:382-391)对规则组每一叶取 .every/.some —— 读代码可证,不依赖任何联系人数据或结果",
  },
  {
    claim:
      "A known opt-out is the customer's own confirmed word that she opted out, given through her channel, or — failing that — on file from a verified historical record",
    verify:
      "isKnownOptOut(packages/db/src/consent-fold.ts:313-316)= state===\"effective_revoke\" || unresolvedLegacyOptOut。effective_revoke 的折叠条件(foldConsentEvents,consent-fold.ts:187-218):customer+interactive+verified 的最后一次立场为 revoke,或该立场缺席时 customer+backfill+verified 的三种基线 revoke 事件(historical_verified_revoke/historical_verified_stop/stop_purpose_expansion)生效——interactive 优先于 backfill,反例 packages/db/src/consent-runtime.test.ts:289-323(interactive grant 之后来一条 backfill revoke 基线,state 仍是 verified_grant)",
  },
  {
    claim: "a merchant's own note that a contact opted out is not itself a known opt-out",
    verify:
      "apps/web/lib/crm-actions.ts:297-305(crm_manual)与 :915-926(import)两个 recordConsentEvent 调用点,在 packages/db/src/consent-fold.ts:52-125 的 CONSENT_WRITER_RULES 里都是 actorKind:\"merchant\"、evidenceStatus:\"asserted\";foldConsentEvents(:194-219)只对 evidenceStatus===\"verified\" 的事件改变 state,asserted 事件不产生 effective_revoke",
  },
  {
    claim:
      "The rule group's excludeReportedOptOut can additionally leave those merchant-recorded contacts out, but only as a subtraction",
    verify:
      "apps/web/lib/consent-authority.ts:133:if (rules.excludeReportedOptOut === true && truth.reportedOptOut) return false —— 唯一效果是提前 return false,函数里不存在任何把 false 改判 true 的分支;应用行为反例(非本表断言依据,供交叉核对)apps/web/lib/__tests__/segment-reported-optout-exclusion.test.ts:1280-1295、:1460-1470",
  },
  {
    claim: "A saved segment stores its rule definition only",
    verify:
      "apps/web/lib/segment-actions.ts:603-621(update)与 :664-675(create)的 prisma data 字面量只有 name/phrase/rulesJson(+id/ownerId/kind);list/get/preview 三处(:348-445)各自重新调用 readContacts() 现读联系人,函数体里没有读任何冻结快照",
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

  it("四轮判词证伪过的方向/量词不许回来 —— 断路器条款下最后一道网", () => {
    // r1:「channel 选得出真人」的原句形状。
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/select real people[^.]*channel/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/channel and contactability/i);
    // r2:contactability 方向写反的原句形状。
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/not_contactable matches every contact/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/contactable matches nobody/i);
    // r3:绝对人口量词。
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/that is everyone/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/which today is nobody/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/needs the customer's own verified confirmation/i);
    // r4(断路器触发点):不分是四事实还是 contactability,任何「matches 结果」类断言一律不许
    // 出现 —— 这是新设计的硬边界,不是某一句具体措辞的字眼。四条各自独立断言,不合并成一个
    // 正则,免得改错一处却让整条断言看起来仍然通过。
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/matches nobody/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/matches every/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/matches only/i);
    expect(CRM_SEGMENT_AVAILABILITY).not.toMatch(/matches exactly/i);
    // 正面:新设计要求的三类内容确实在场 —— 类③(行动指令)、类②(闸门机制)。
    expect(CRM_SEGMENT_AVAILABILITY).toMatch(
      /makes no claim about how many contacts any rule or segment matches/,
    );
    expect(CRM_SEGMENT_AVAILABILITY).toMatch(/call preview and read its matchedCount/);
    expect(CRM_SEGMENT_AVAILABILITY).toMatch(/discarded before the check runs/);
    expect(CRM_SEGMENT_AVAILABILITY).toMatch(/only as a subtraction/);
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
