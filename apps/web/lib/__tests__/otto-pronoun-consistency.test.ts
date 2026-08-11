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
 *      (#816:第一版按整份源码切句子,句号后面紧跟 `</p><p>` 或 `", "` 时两句黏成一句,
 *      第四条规则整类失灵。现在同一套规则跑在两条流上 —— 详见下面 copyRuns 的注释。)
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
import ts from "typescript";
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

function sentencesOf(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
}

/**
 * #816 —— 句界断在标签上,规则就永远不会命中。
 *
 * 相邻的两句话在源码里几乎从不被空白隔开:一句在 `<p>` 里,下一句在隔壁那个 `<p>` 里;
 * 或者两句是同一个数组里相邻的两个字符串。按整份源码切句子时,句号后面紧跟的是 `</p><p>`
 * 或者 `", "` —— 不是空白,`split(/(?<=[.!?])\s+/)` 于是把两句当成一句,「Otto 句后紧跟
 * 代词开头句」这条规则怎么也命中不了。判官 2026-08-09 复现的就是这个形状:
 *   `<p>Meet Otto.</p><p>It researches…</p>` 不报错。
 *
 * 修法不是放宽规则(那会把正确文案判红),是把**句界**修对:把源码里给人读的那些段
 * 按出现顺序抽出来接成一条流。接起来之后句号后面就真的是空白,同一套规则原样命中。
 *
 * #834 r4 —— **换设计:手搓扫描整类退役,改用 TypeScript 编译器的 AST。**
 *
 * 前三轮这里是一个自己写的字符扫描器,判官连着两轮从同一个方向抓到逃逸:
 *   r2:`{condition && " It researches…"}` —— 非纯表达式被折成一个空格,内层整句丢失;
 *   r3:同一个容器换成跨行写法 —— 外层的 `Meet Otto.` 反而丢失(容器判定失败即整段作废)。
 * 两次都不是规则错了,是**「这段源码里哪些字符是给人读的」这个判断本身不该手写**:
 * 括号配对、引号、模板、注释、JSX 文本边界,每一条都是语言语法,补丁只会补出下一个形状。
 *
 * 现在直接问编译器:`ts.createSourceFile` 解析,按源顺序走整棵树,收两类叶子 ——
 *   · `JsxText`(标签之间给人读的文本);
 *   · 一切字符串字面量与模板字面量的文本(属性值、数组元素、条件/三元的分支、模板片段)。
 * 容器嵌几层、跨几行、条件还是三元,对 AST 都是同一件事:它们都是子节点,顺序天然正确。
 * `typescript` 是仓库现成依赖(apps/web 5.9.3),零新增。
 *
 * 换实现最怕的是**悄悄少抓** —— 少抓是静默的,不会有任何东西变红。
 * `scripts/tools/audit-copy-stream-equivalence.mjs` 把退役的那个扫描器与这一份在全仓
 * tracked 源码上各跑一遍、逐条比差集,AST 一旦漏掉旧实现抓得到的条目就非零退出。
 * 它证明不了两份实现**共有**的盲区(r5 的模板顺序错就是共有盲区),那种只能靠下面
 * 那些人造反例钉住 —— 两样都要,少一样都不够。
 */
function scriptKindOf(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/**
 * 按源顺序收「给人读的文本」。注释不是节点,天然不进流。
 *
 * #834 r5 —— **模板字符串必须按源顺序交错着收**。
 * r4 先把 head 与全部 span 的静态片段一次推完,再靠 `forEachChild` 走到 `${…}` 里的
 * 表达式 —— 于是静态尾巴排到了插值前面。判官的反例:
 *   `aria-label={`Meet Otto. ${ready ? "It researches…" : "Nothing is sent."} Today.`}`
 * 收成 `["Meet Otto.", "Today.", "It researches…", "Nothing is sent."]`:句子顺序被打乱,
 * 「Otto 句后紧跟代词开头句」这条规则一次也命中不了,而屏幕上读到的正是被禁的那句。
 * 这条流的全部价值就是**顺序**,顺序错了等于没有这条流。
 * TemplateHead / TemplateSpan 本来就带着源顺序:head → (表达式, literal) → (表达式,
 * literal) …… 照着走一趟即可,走完直接返回,不再让 forEachChild 重走一遍。
 */
function copyRuns(source: string, file = "planted.tsx"): string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, scriptKindOf(file));
  const runs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      runs.push(node.text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      runs.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      runs.push(node.head.text);
      for (const span of node.templateSpans) {
        visit(span.expression);
        runs.push(span.literal.text);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(parsed, visit);
  return runs.map((run) => run.trim()).filter((run) => /[A-Za-z]/.test(run));
}

/**
 * 两条流:整份源码(剥掉整行注释)+ 只有文案、句界落在真句号上的那一条(#816)。
 *
 * 文案流喂的是**原始源码**,不是剥过注释的那份:注释在 AST 里本来就不是节点,而
 * `stripComments` 是按行删的,删完可能不再是合法语法。让解析器读它本来的样子。
 */
function streamsOf(source: string, file = "planted.tsx"): string[] {
  return [stripComments(source), copyRuns(source, file).join(" ")];
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

/** 对一条流跑完四条规则。流是什么(整份源码 / 只有文案)由调用方决定。 */
function offencesIn(file: string, stream: string): Offence[] {
  const offences: Offence[] = [];
  const sentences = sentencesOf(stream);
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]!;
    const previous = i > 0 ? sentences[i - 1]! : "";
    const mentionsOtto = MENTIONS_OTTO.test(sentence);
    const push = (rule: string) => offences.push({ file, rule, sentence: sentence.slice(0, 240) });

    if (mentionsOtto && GENDERED_PRONOUN.test(sentence)) push("gendered pronoun in an Otto sentence");
    if (mentionsOtto && OTTO_ON_ITS_OWN.test(sentence)) push('"on its own" in an Otto sentence');
    if (mentionsOtto && OTTO_ITLL.test(sentence)) push("\"it'll\" in an Otto sentence");
    if (MENTIONS_OTTO.test(previous) && !mentionsOtto && PRONOUN_SUBJECT_OPENER.test(sentence)) {
      push("a pronoun opens the sentence right after an Otto sentence");
    }
  }
  return offences;
}

function scan(): Offence[] {
  const offences = new Map<string, Offence>();
  for (const relative of trackedSources()) {
    const source = readFileSync(path.join(REPO_ROOT, relative), "utf8");
    // 文件名带进去:`.ts` 与 `.tsx` 的解析方式不同(JSX 只在 .tsx 里合法)。
    for (const stream of streamsOf(source, relative)) {
      // 两条流会重复命中同一句;去重后 offenders 才是「几处病」而不是「扫了几遍」。
      for (const offence of offencesIn(relative, stream)) {
        offences.set(`${offence.file} ${offence.rule} ${offence.sentence}`, offence);
      }
    }
  }
  return [...offences.values()];
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
// ①b 句界 —— #816:两句话之间隔的是标签,不是空白
// ---------------------------------------------------------------------------
describe("#816 the sentence boundary survives a tag or a comma between the two sentences", () => {
  const RULE = "a pronoun opens the sentence right after an Otto sentence";

  function rulesFor(source: string): string[] {
    return streamsOf(source).flatMap((stream) => offencesIn("planted.tsx", stream).map((o) => o.rule));
  }

  // 判官 2026-08-09 亲手复现的那一句。第一条断言就是**旧盲区本身**:只有整份源码那一条流
  // 时,这个形状一声不吭 —— 它写在这里,是为了让盲区回来时有人喊。
  it("catches a pronoun that opens the next JSX text node", () => {
    const planted = `<p>Meet Otto.</p><p>It researches your brand.</p>`;
    expect(offencesIn("planted.tsx", stripComments(planted)), "the old single stream").toEqual([]);
    expect(rulesFor(planted)).toContain(RULE);
  });

  it("catches a pronoun that opens the next string in the same list", () => {
    const planted = `const LINES = ["Meet Otto.", "It researches your brand."];`;
    expect(offencesIn("planted.tsx", stripComments(planted)), "the old single stream").toEqual([]);
    expect(rulesFor(planted)).toContain(RULE);
  });

  it("still catches the same shape when a blank line separates the two tags", () => {
    expect(rulesFor(`<p>Meet Otto.</p>\n\n        <p>It researches your brand.</p>`)).toContain(RULE);
  });

  // 修句界不是放宽规则:接起来之后,Founder 点名的正例仍然不得被判红。
  it("leaves the copy Founder named as correct alone", () => {
    expect(rulesFor(`<p>Voice, rules, audience — Otto uses it every time.</p><p>Nothing is sent.</p>`)).toEqual([]);
  });

  it("reads JSX text and string literals in the order they appear, and nothing else", () => {
    expect(copyRuns(`<p>Meet Otto.</p><Foo label="Say hello." />`)).toEqual(["Meet Otto.", "Say hello."]);
    // `don&apos;t` 的撇号不得被当成一个字符串的开头。
    expect(copyRuns(`<p>Otto doesn't ask.</p>`)).toEqual(["Otto doesn't ask."]);
    expect(copyRuns(`const total = a > b ? 1 : 2;`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ①c 表达式容器 —— #830:`{" "}` 是句号后面那个空格,不是一段文案的终点
// ---------------------------------------------------------------------------
describe("#830 an expression container inside JSX text no longer throws the sentence away", () => {
  const RULE = "a pronoun opens the sentence right after an Otto sentence";

  function rulesFor(source: string): string[] {
    return streamsOf(source).flatMap((stream) => offencesIn("planted.tsx", stream).map((o) => o.rule));
  }

  // 判官 2026-08-09 给的那一句。Prettier 换行时自动插的 `{" "}` 把两句钉在一起:
  // 文案流丢了整段(遇 `{` 即弃),整份源码那条流又因为句号后面是 `{` 而不切句。
  it("catches a pronoun that opens the next sentence after a {\" \"} join", () => {
    const planted = `<p>Meet Otto.{" "}It researches your brand.</p>`;
    expect(offencesIn("planted.tsx", stripComments(planted)), "the whole-source stream").toEqual([]);
    // 两段都在流里,顺序不变 —— `{" "}` 本身是一段(纯空白,过滤掉)。
    expect(copyRuns(planted), "the old copy stream dropped both sentences").toEqual([
      "Meet Otto.",
      "It researches your brand.",
    ]);
    expect(rulesFor(planted)).toContain(RULE);
  });

  // 判官 2026-08-10 的反例(#834 r2 P1)。条件渲染是文案最爱藏的地方:表达式不纯,
  // 但那一整句话就写在它里面。r1 把整个容器折成一个空格,第二句连进流的机会都没有。
  it("catches a pronoun that opens a sentence hidden inside a conditional expression", () => {
    const planted = `<p>Meet Otto.{condition && " It researches your brand."}</p>`;
    expect(rulesFor(planted)).toContain(RULE);
    expect(copyRuns(planted)).toEqual(["Meet Otto.", "It researches your brand."]);
  });

  // 判官 2026-08-10 r3 的反例(#834 r4 P1)。同一个条件容器换成跨行写法,r3 的手搓
  // 扫描器判定「不是行内容器」→ 整段作废 → 这次丢的是**外层**那句 Meet Otto.
  // 一个形状修好,换行就换出下一个形状 —— 这正是不再打补丁、改问编译器的理由。
  it("keeps both the outer and the inner sentence when the container spans lines", () => {
    const planted = `<p>Meet Otto.{condition &&\n  " It researches your brand."}</p>`;
    expect(copyRuns(planted)).toEqual(["Meet Otto.", "It researches your brand."]);
    expect(rulesFor(planted)).toContain(RULE);
  });

  // 判官 2026-08-10 r4 的反例(#834 r5 P1)。模板字符串把一句话切成
  // 「静态前缀 + 插值 + 静态后缀」,读屏软件读到的是拼起来的那一句;流的顺序错了,
  // 规则就看不见它。这一条钉的是**顺序**本身。
  it("reads a template string in source order, interpolations in place", () => {
    const planted = '<img aria-label={`Meet Otto. ${ready ? "It researches your brand." : "Nothing is sent."} Today.`} />';
    expect(copyRuns(planted)).toEqual([
      "Meet Otto.",
      "It researches your brand.",
      "Nothing is sent.",
      "Today.",
    ]);
    expect(rulesFor(planted)).toContain(RULE);
  });

  it("keeps order across several interpolations in one template", () => {
    const planted = '<p>{`Otto drafts ${count} posts. ${busy ? "It is still working." : "Done."} Ask ${name}.`}</p>';
    expect(copyRuns(planted)).toEqual([
      "Otto drafts",
      "posts.",
      "It is still working.",
      "Done.",
      "Ask",
    ]);
    expect(rulesFor(planted)).toContain(RULE);
  });

  it("keeps the static prefix in front of a template that opens with an interpolation", () => {
    const planted = '<p>{`${greeting} Otto is ready. It researches your brand.`}</p>';
    expect(rulesFor(planted)).toContain(RULE);
  });

  it("keeps every branch of a ternary in the stream, not just the first", () => {
    const planted = `<p>{ready ? "Otto is ready." : "He is still reading."}</p>`;
    expect(rulesFor(planted)).toContain("gendered pronoun in an Otto sentence");
  });

  it("treats a value expression as the whitespace it occupies, not as a full stop", () => {
    // `{count}` 的值机器读不到,它把一段 JSX 文本切成两段 —— 但切开的两段接回流里
    // 仍由空白隔开,句号还在句号的位置上,句界不受影响。
    expect(copyRuns(`<p>Otto drafted {count} posts. It is waiting.</p>`)).toEqual([
      "Otto drafted",
      "posts. It is waiting.",
    ]);
    expect(rulesFor(`<p>Otto drafted {count} posts.</p><p>It is waiting.</p>`)).toContain(RULE);
  });

  it("reads copy out of a nested, multi-line, mapped JSX subtree", () => {
    // 箭头函数体里 `.map()` 出来的 JSX:手搓扫描器在这里只能整段放弃,AST 照常往下走。
    const planted = `<div>\n  {items.map((item) => (\n    <p>{"Otto waited."}</p>\n  ))}\n</div>`;
    expect(copyRuns(planted)).toContain("Otto waited.");
  });

  it("leaves the copy Founder named as correct alone", () => {
    expect(rulesFor(`<p>Voice, rules, audience — Otto uses it{" "}every time.</p>`)).toEqual([]);
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
