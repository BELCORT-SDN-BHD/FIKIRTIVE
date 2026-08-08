/**
 * otto-pronoun-consistency.test.ts — #682:Otto 在首跑同一条动线上有三种人称。
 *
 * 病灶(走查 W1-A 实测):商家十分钟内读到三种说法 —— 登录页说 **It** researches your brand、
 * 引导卡说 **Otto** uses it every time、品牌记忆说 **he** uses it in every project。
 * 三屏三种人称,而 it 与 he 直接相邻。
 *
 * 准则(Founder 裁决 2026-08-08,#682 评论,弹窗 P3-Q1):
 *   **Otto 对商家的身份口径一律用名字「Otto」,全站避免代词(it 与 he 都不用)。**
 * 即:对客文案里凡是**指代 Otto** 的第三人称代词,一律改回名字,或把句子改写到不需要代词。
 * 注意准则的边界 —— 它管的是**第三人称指代**:
 *   · Otto 自己说话用第一人称("I'll guide you through it")不在此列,那正是「Otto 像一个
 *     非常强大的真人」该有的说法;
 *   · 一句提到 Otto 的话里的 `it` 未必指 Otto。Founder 亲自点名的正例
 *     "Voice, rules, audience — Otto uses it every time" 里的 it 指的是品牌记忆,是对的。
 *   这就是为什么下面的词法围栏**不能**简单地禁掉 Otto 句里的 it —— 那会把正确文案判红。
 *
 * 两层围栏,各封各的:
 *   ① **词法围栏(全仓)**:产品源码(apps/ + packages/,剥掉整行注释)里,凡是提到 Otto 的
 *      句子不得出现性别代词(he/him/his/she/her/hers);另加三个「代词只可能是 Otto」的句型
 *      黑名单(`Otto … on its own`、`Otto … it'll`、Otto 句后紧跟以 It/He/She 开头的句子)。
 *      这三个句型不是随手写的,是这次全仓扫查里**实际抓到的全部四种形状**——把形状本身封死,
 *      换个文件重写一遍同样红。写这条时在未修的树上实测:四条规则命中 6 句、零误报。
 *   ② **逐处钉板**:本轮改过的每一处,钉住治好的那句话本身,并明令旧的代词写法不得回来。
 *      privacy 两页(英文 + BM)的形状('the contact details **it** is working with')词法围栏
 *      覆盖不到 —— 语义上 it 才是 Otto,句型却与任何通用规则都对不上,只能逐句钉。
 *
 * 为什么 ① 只封性别代词而不封 it:见上。it 需要语义判断,机器判不了;能被机器判死的那一半
 * (性别代词 + 四个专有句型)就封死,判不了的那一半用 ② 逐句钉住。诚实的围栏胜过漂亮的围栏。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");

/** 扫查范围 = 产品源码。docs/ 是历史档案(不改),测试与快照不是对客文案。 */
const SCAN_ROOTS = ["apps/web/app", "apps/web/components", "apps/web/lib", "apps/worker/src", "packages"];

function trackedSources(): string[] {
  return execFileSync("git", ["ls-files", "-z", ...SCAN_ROOTS], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((relative) => /\.tsx?$/.test(relative))
    .filter((relative) => !/\.test\.tsx?$/.test(relative))
    .filter((relative) => !/(^|\/)(__tests__|__snapshots__|__stubs__)\//.test(relative));
}

/**
 * 剥掉注释再扫:票面明写「机器码/注释/内部文档不动」。
 * 只剥**整行**注释与块注释 —— 行尾注释留着,宁可多报也不漏报(漏报是静默的)。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("//") || trimmed.startsWith("*"));
    })
    .join("\n");
}

function sentencesOf(source: string): string[] {
  return stripComments(source)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/);
}

const MENTIONS_OTTO = /\bOtto\b/;
const GENDERED_PRONOUN = /\b(he|him|his|she|her|hers)\b/i;
/** 「on its own」挂在一句提到 Otto 的话上时,its 只可能是 Otto。 */
const OTTO_ON_ITS_OWN = /\bon its own\b/i;
/** 「…and it'll draft…」同理:一句里点了 Otto 的名,it'll 的主语就是 Otto。 */
const OTTO_ITLL = /\bit(?:&apos;|&rsquo;|['’])ll\b/i;
/** Otto 句之后紧跟一句以代词开头 —— 登录页那句的原形。 */
const PRONOUN_SUBJECT_OPENER = /^(?:It|He|She|Its|His|Her)(?:\s|&apos;|&rsquo;|['’])/;

type Offence = { file: string; rule: string; sentence: string };

function scan(): Offence[] {
  const offences: Offence[] = [];
  for (const relative of trackedSources()) {
    const sentences = sentencesOf(readFileSync(path.join(REPO_ROOT, relative), "utf8"));
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i]!;
      const previous = i > 0 ? sentences[i - 1]! : "";
      const mentionsOtto = MENTIONS_OTTO.test(sentence);
      const push = (rule: string) => offences.push({ file: relative, rule, sentence: sentence.slice(0, 240) });

      if (mentionsOtto && GENDERED_PRONOUN.test(sentence)) push("gendered pronoun in an Otto sentence");
      if (mentionsOtto && OTTO_ON_ITS_OWN.test(sentence)) push('"on its own" in an Otto sentence');
      if (mentionsOtto && OTTO_ITLL.test(sentence)) push("\"it'll\" in an Otto sentence");
      if (MENTIONS_OTTO.test(previous) && !mentionsOtto && PRONOUN_SUBJECT_OPENER.test(sentence)) {
        push("a pronoun opens the sentence right after an Otto sentence");
      }
    }
  }
  return offences;
}

function report(offences: Offence[]): string {
  return offences.map((o) => `  ${o.file} [${o.rule}]\n    ${o.sentence}`).join("\n");
}

// ---------------------------------------------------------------------------
// ① 词法围栏 —— 全仓,形状本身封死
// ---------------------------------------------------------------------------
describe("#682 ① no third-person pronoun stands in for Otto anywhere in product copy", () => {
  it("enumerates real copy files (an empty scan would be vacuously green)", () => {
    const tracked = trackedSources();
    expect(tracked.length, "git ls-files returned (almost) nothing — the scan proves nothing").toBeGreaterThan(300);
    // 抽三张真的对客文案页:范围塌成空集或漏掉票面那三屏,这里就红。
    for (const surface of [
      "apps/web/app/login/page.tsx",
      "apps/web/components/otto/OttoMemory.tsx",
      "apps/web/components/otto/OttoOnboarding.tsx",
    ]) {
      expect(tracked, `${surface} fell out of the scan`).toContain(surface);
    }
    // 本文件自身不在扫查范围内 —— 不是靠一条路径豁免,是靠**结构**:测试与快照整类排除。
    // 围栏必须写得出被禁的形状,所以这件事得是真的,不能只是写在注释里。
    expect(tracked.filter((relative) => /(__tests__|__snapshots__)/.test(relative))).toEqual([]);
  });

  it("finds no banned pronoun shape", () => {
    const offences = scan();
    expect(
      offences,
      `Otto is called by name, never by a pronoun (Founder 2026-08-08, #682).\n${report(offences)}`,
    ).toEqual([]);
  });

  it("the rules themselves still bite (a planted offender of each shape is caught)", () => {
    // 围栏的自检:四条规则各喂一个人造违例,证明规则不是空转的。
    const planted = [
      "What Otto remembers about your brand — he uses it in every project.",
      "Auto lets Otto create paused draft campaigns in your ad account on its own.",
      "Ask Otto to research this again — it&apos;ll propose a fresh plan.",
    ];
    for (const sentence of planted) {
      const caught =
        (MENTIONS_OTTO.test(sentence) && GENDERED_PRONOUN.test(sentence)) ||
        (MENTIONS_OTTO.test(sentence) && OTTO_ON_ITS_OWN.test(sentence)) ||
        (MENTIONS_OTTO.test(sentence) && OTTO_ITLL.test(sentence));
      expect(caught, `the fence would let this through: ${sentence}`).toBe(true);
    }
    expect(PRONOUN_SUBJECT_OPENER.test("It researches your brand, writes the copy.")).toBe(true);

    // 反向:Founder 点名的正例不得被判红。
    const goodCopy = "Voice, rules, audience — Otto uses it every time";
    expect(MENTIONS_OTTO.test(goodCopy) && GENDERED_PRONOUN.test(goodCopy)).toBe(false);
    expect(OTTO_ON_ITS_OWN.test(goodCopy) || OTTO_ITLL.test(goodCopy)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ② 逐处钉板 —— 本轮治好的每一句
// ---------------------------------------------------------------------------
describe("#682 ② every cured surface says the name", () => {
  const CURED: Array<{ file: string; says: string[]; neverAgain: RegExp; why: string }> = [
    {
      file: "apps/web/app/login/page.tsx",
      says: ["Otto researches your brand"],
      neverAgain: /It researches your brand/,
      why: "登录页:首跑第一屏,票面的 it",
    },
    {
      file: "apps/web/components/otto/OttoMemory.tsx",
      says: ["What Otto remembers about your brand — Otto uses it in every project."],
      neverAgain: /—\s*he uses it/i,
      why: "品牌记忆:票面的 he,与登录页的 it 在同一条动线上相邻",
    },
    {
      file: "apps/web/components/otto/ResearchCard.tsx",
      says: ["Ask Otto to research this again — Otto will propose a fresh plan."],
      neverAgain: /it(?:&apos;|&rsquo;|['’])ll propose/i,
      why: "研究卡失败态",
    },
    {
      file: "apps/web/components/otto/OttoSchedule.tsx",
      says: ["and Otto will draft a schedule for you to approve"],
      neverAgain: /it(?:&apos;|&rsquo;|['’])ll draft/i,
      why: "排期空状态",
    },
    {
      file: "apps/web/components/otto/settings/sections.tsx",
      says: [
        "How much Otto does without asking you.",
        "in your ad account without asking you — anything that spends or goes live still asks you first.",
      ],
      neverAgain: /on its own/i,
      why: "设置 · Otto behavior 小标题 + Auto 披露句(同一文件两处)",
    },
    {
      file: "apps/web/components/otto/OttoConnections.tsx",
      says: ["account without asking you — anything that spends or goes live still asks"],
      neverAgain: /on its own/i,
      why: "Connections · Auto 披露句(与设置页是同一句文案的第二份拷贝)",
    },
    {
      file: "apps/web/app/privacy/page.tsx",
      says: ["the contact details Otto is working with are sent too"],
      neverAgain: /the contact details it is working with/i,
      why: "隐私政策(英文):词法围栏覆盖不到的形状,只能逐句钉",
    },
    {
      file: "apps/web/app/privacy/bm/page.tsx",
      says: ["butiran kenalan yang sedang dikerjakan Otto"],
      neverAgain: /dikerjakannya/i,
      why: "隐私政策(BM):-nya 是指代 Otto 的代词后缀,同一条准则",
    },
  ];

  it.each(CURED)("$file — $why", ({ file, says, neverAgain }) => {
    const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
    for (const sentence of says) {
      expect(source, `${file} no longer carries the cured sentence`).toContain(sentence);
    }
    expect(source, `${file} brought the pronoun back`).not.toMatch(neverAgain);
  });

  it("the surface Founder named as already correct is left alone", () => {
    // 引导卡本来就用名字,是裁决里的正例。它必须**保持原样** —— 一次「统一」把正确的
    // 那一处也改掉,是这类扫查最常见的副作用。
    const source = readFileSync(path.join(REPO_ROOT, "apps/web/components/otto/OttoOnboarding.tsx"), "utf8");
    expect(source).toContain("Voice, rules, audience — Otto uses it every time");
  });
});
