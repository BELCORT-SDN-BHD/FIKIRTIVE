/**
 * FRONT-A1 §7.1① —— 新前端合入主干后,钱引擎那 14 条验收在测试树里**一条都不许丢**。
 *
 * 为什么需要这一条:①段是纯合并段,把一整套新前端压到一棵已经交付过钱引擎的主干上。合并里
 * 最安静的一种损失不是冲突,是**某一条钱的行为测试被整文件带走了**——CI 照样全绿,因为绿的
 * 是剩下的那些。钱引擎 S5 已经由 Founder 逐条勾过(2026-09-02),所以这 14 个编号从此是主干
 * 的资产:合并可以改页面长相,不可以让任何一条失去它的落点。
 *
 * 判官 2026-09-02 P1 打回的正是第一版:它只做「编号在测试树里出现过」的存在性扫描,而
 * `packages/core/src/money-engine-acceptance.test.ts` 是一份**只有注释**的 M3 占位索引
 * (全文只有 1 个可执行的 `it(`,14 个编号全在注释里)—— 它一个人就把 14 条全满足了。
 * 也就是说:把 refund-actions / gen-ledger / stripe-webhook 这些**真行为测试整文件删掉**,
 * 第一版围栏照样全绿 —— 它挡不住它自称要挡的那件事。
 *
 * 所以这一版有三层,一层比一层硬:
 *   ① **认领**:每条编号仍要在测试树里有落点,但那份注释索引与本文件**都不算数**
 *      (自证与索引不是落点)。删掉真测试文件,这一层立刻红。
 *   ② **点名**:每条编号钉死它的**行为测试文件**(下表来自钱引擎自己的落点索引),
 *      文件必须在、必须逐字带着那个编号、而且必须有**真的会跑的用例**——
 *      只剩 `it.todo` 或被 `.skip` 掉,等于这条验收今天没人跑,一样红。
 *   ③ **交付面**:FRONT-A1 验收行点名的四处钱交付面(`/admin/reconcile`、账单页
 *      「Credits don't expire」、上传入口价目小字、聊天搜索成本提示)在新壳上仍然在,
 *      而且**仍然挂着**——组件文件还在但没人挂,商家一样看不见。
 *
 * 三层都不替代那些测试各自的断言(它们各自有自己的文件);这里只回答合并段自己的问题:
 * 钱引擎那 14 条,今天还有人真的在跑吗,商家还看得见那四处吗。
 *
 * 第二段钉的是六条钱旅程(e2e/journeys/02–07)。它们是唯一在真浏览器里证明「商家看到的钱是
 * 真的」的东西,而 e2e 不在单测 CI 的默认跑道上——一条 e2e 被删掉,没有任何一次红会告诉你。
 * 所以文件本身的存在与它自报的旅程编号,由一条单测看着。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

/** 钱引擎规格 docs/specs/money-engine.md 的验收表:A1–A14,Founder 2026-09-02 全部勾过。 */
const MONEY_ROWS = Array.from({ length: 14 }, (_, i) => `MONEY-A${i + 1}`);

/** 测试树:单测(apps/web、packages、apps/worker)加上 e2e 旅程。 */
const TEST_ROOTS = ["apps/web", "packages", "apps/worker", "e2e"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "generated", ".turbo", "coverage"]);

function collectTestFiles(dir: string, out: string[]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectTestFiles(full, out);
    else if (/\.(test|spec)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const TEST_FILES = TEST_ROOTS.flatMap((root) => collectTestFiles(path.join(REPO_ROOT, root), []));
const TEST_SOURCES = TEST_FILES.map((file) => ({ file, text: readFileSync(file, "utf8") }));

/** `MONEY-A1` 不许被 `MONEY-A10` 冒认——后面紧跟数字的不算。 */
function rowPattern(row: string): RegExp {
  return new RegExp(`${row}(?![0-9])`);
}

/**
 * **不算落点**的两份文件。
 *
 * - `packages/core/src/money-engine-acceptance.test.ts`:M3 的注释索引。它的用处是让机器闸
 *   grep 得到编号,不是证明那条验收有人跑;判官实证它一个人满足全部 14 条。
 * - 本文件:自证不是证据(`MONEY_ROWS` 与下面那张表里逐字写着编号)。
 */
const NOT_A_LANDING = new Set([
  "packages/core/src/money-engine-acceptance.test.ts",
  "apps/web/lib/__tests__/front-a1-money-rows.test.ts",
]);

const rel = (file: string) => path.relative(REPO_ROOT, file).split(path.sep).join("/");

/**
 * 注释里的编号是**历史,不是落点**。
 *
 * 判官 2026-09-02(j):`e2e/journeys/07` 的标题原来挂着 `MONEY-A1`,而 A1 是钱引擎的定价
 * 推导验收行,与两处钱面读同一个余额无关 —— 标题改掉之后,那个编号只剩在说明为什么改掉的
 * 注释里。一条只在注释里被提到的验收,不是有人在守它。所以判定前先把注释剥掉
 * (与 library-real-route-986 / edit-desk-two-surfaces 同一个做法)。
 */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** 这个编号今天由哪些**真文件**认领(索引、自证与纯注释提及都不算)。 */
function ownersOf(row: string): string[] {
  return TEST_SOURCES.filter(({ text }) => rowPattern(row).test(stripComments(text)))
    .map(({ file }) => rel(file))
    .filter((file) => !NOT_A_LANDING.has(file));
}

/**
 * 会**真的跑起来**的用例条数。
 *
 * `it.todo(` / `it.skip(` / `describe.skip(` 都不算 —— 一条验收如果只剩占位,它在 CI 上不产生
 * 任何一次判定,与被删掉的差别只在于 grep 还找得到它。**注释掉的也不算**:一条被行注释或
 * 块注释包起来的 `it(` 在 CI 上同样一次都不跑 —— 这正是判官指定的变异,所以先剥注释。
 */
function liveCaseCount(text: string): number {
  const code = stripComments(text);
  const plain = code.match(/\b(?:it|test)\s*\(/g) ?? [];
  const parametrised = code.match(/\b(?:it|test)\.(?:each|concurrent|for)\b/g) ?? [];
  return plain.length + parametrised.length;
}

/**
 * 一份测试文件里所有 `it(...)` / `test(...)` 的**标题字符串**。
 *
 * M3 闸只要编号 fixed-string 出现在文件里 —— 注释里也算。这里比它严一格:编号必须出现在
 * 一条**真用例的标题**上,因为那才是 CI 报红时会念出来的那句话。`describe(` 不算(它是分组),
 * `it.todo(` 也不算(下面的正则要求 `it`/`test` 后面直接是括号或 each/concurrent/for),
 * **被注释掉的 `it(` 也不算**(先剥注释 —— 判官指定的变异就是「把某条 MONEY 测试改成注释」,
 * 认原文的话那条变异照样绿)。
 */
function caseTitles(text: string): string[] {
  const pattern =
    /\b(?:it|test)(?:\.each\s*\((?:[^()]|\([^()]*\))*\)|\.concurrent|\.for\s*\((?:[^()]|\([^()]*\))*\))?\s*\(\s*(["`'])((?:\\.|(?!\1)[\s\S])*)\1/g;
  const titles: string[] = [];
  for (const match of stripComments(text).matchAll(pattern)) titles.push(match[2]!);
  return titles;
}

/** 这个编号今天被哪些文件写进了**真用例标题**里。 */
function titleClaimantsOf(row: string): string[] {
  return TEST_SOURCES.filter(({ file, text }) =>
    !NOT_A_LANDING.has(rel(file)) && caseTitles(text).some((title) => rowPattern(row).test(title)),
  ).map(({ file }) => rel(file));
}

/**
 * 编号 → 它的**行为测试文件**。
 *
 * 来源不是我自己挑的:这张表逐条抄自钱引擎自己的落点索引
 * (`packages/core/src/money-engine-acceptance.test.ts` 的清单,S5 2026-09-02 照它逐行走过)。
 * 这里只收「删掉它这条验收就没人跑了」的那几份,不收顺带提到编号的旁证文件。
 */
const MONEY_ROW_LANDINGS: Record<string, string[]> = {
  "MONEY-A1": ["packages/core/src/money-derivation.test.ts", "packages/core/src/money-anchor.test.ts"],
  "MONEY-A2": ["packages/core/src/pricing-config.test.ts", "packages/core/src/llm-prices.test.ts"],
  "MONEY-A3": ["packages/core/src/video-tiers.test.ts", "packages/core/src/menu-truth.test.ts"],
  "MONEY-A4": ["packages/core/src/cost-pins.test.ts"],
  "MONEY-A5": ["apps/web/lib/__tests__/money-a5-credits-never-expire.test.ts"],
  "MONEY-A6": [
    "packages/core/src/money-a6-actor-pricing.test.ts",
    "packages/db/src/money-a6-actor-ledger-db.test.ts",
    "apps/web/lib/__tests__/gen-ledger.test.ts",
  ],
  "MONEY-A7": ["packages/db/src/money-a7-a8-db.test.ts"],
  "MONEY-A8": ["packages/db/src/money-a7-a8-db.test.ts"],
  "MONEY-A9": ["apps/worker/src/jobs/understand.test.ts", "apps/worker/src/jobs/understand-db.test.ts"],
  "MONEY-A10": ["packages/otto/src/skills/research-web.test.ts", "packages/otto/src/runtime.test.ts"],
  "MONEY-A11": ["apps/web/lib/__tests__/gen-actions.test.ts", "packages/core/src/money-anchor.test.ts"],
  "MONEY-A12": [
    "apps/web/lib/__tests__/billing-actions.test.ts",
    "apps/web/lib/__tests__/reconcile-actions.test.ts",
    "apps/worker/src/jobs/stripe-reconcile-db.test.ts",
  ],
  "MONEY-A13": [
    "apps/web/lib/__tests__/stripe-webhook.test.ts",
    "apps/web/lib/__tests__/tenant-actions.test.ts",
    "packages/db/src/credits.test.ts",
  ],
  "MONEY-A14": [
    "apps/web/lib/__tests__/refund-actions.test.ts",
    "packages/db/src/credits.test.ts",
    "apps/worker/src/jobs/llm-reservation-reaper.test.ts",
  ],
};

describe("FRONT-A1 §7.1①a — 14 条编号各有**真**落点(注释索引不算数)", () => {
  it("测试树本身找得到(围栏没有在空集上假绿)", () => {
    expect(TEST_FILES.length).toBeGreaterThan(300);
  });

  it("那两份不算落点的文件确实在树里 —— 排除表没有指着空气", () => {
    const present = new Set(TEST_SOURCES.map(({ file }) => rel(file)));
    for (const file of NOT_A_LANDING) {
      expect(present.has(file), `${file} 不在测试树里,排除表已经过期`).toBe(true);
    }
  });

  it("M3 注释索引一个人满足不了任何一条 —— 第一版围栏的假绿在这里被钉死", () => {
    const indexFile = "packages/core/src/money-engine-acceptance.test.ts";
    const indexText = TEST_SOURCES.find(({ file }) => rel(file) === indexFile)!.text;
    // 它确实逐字带着 14 个编号(M3 闸要的就是这个,所以第一版围栏被它一个人喂饱了)……
    expect(MONEY_ROWS.filter((row) => rowPattern(row).test(indexText))).toEqual(MONEY_ROWS);
    // ……但把它排除之后,14 条仍然各有真落点。这一条就是那次假绿的变异证明:
    // 如果哪条验收只剩这份注释在撑,它此刻会红。
    const orphaned = MONEY_ROWS.filter((row) => ownersOf(row).length === 0);
    expect(orphaned, "排除注释索引后有验收成了孤儿 —— 它今天只靠一份注释活着").toEqual([]);
  });

  it.each(MONEY_ROWS)("%s 仍有测试认领", (row) => {
    expect(
      ownersOf(row),
      `${row} 在整棵测试树里没有任何落点 —— 合并把它的测试带走了`,
    ).not.toEqual([]);
  });

  it.each(MONEY_ROWS)("%s 的编号写在一条**真用例的标题**上,不是只躺在注释里", (row) => {
    expect(
      titleClaimantsOf(row),
      `${row} 在整棵测试树里找不到任何一条 it()/test() 标题带着它 —— ` +
        "剩下的那些命中全在注释、describe 名或 it.todo 上,CI 报红时没有一句话会念出这个编号",
    ).not.toEqual([]);
  });

  it("标题抽取本身是活的(它没有在空集上假绿)", () => {
    // 自证:真用例抽得出来,而 `describe(`、`it.todo(` 与**被注释掉的用例**都抽不出来。
    // 最后两行就是判官指定的那个变异(把一条 MONEY 测试改成注释)的最小复现。
    const sample = [
      'it("MONEY-A99 真用例", () => {});',
      'describe("MONEY-A98 分组", () => {});',
      'it.todo("MONEY-A97 占位");',
      'it.each([1])("MONEY-A96 参数化 %s", () => {});',
      '// it("MONEY-A95 行注释掉的用例", () => {});',
      ['/*', 'it("MONEY-A94 块注释掉的用例", () => {});', '*/'].join("\n"),
    ].join("\n");
    expect(caseTitles(sample)).toEqual(["MONEY-A99 真用例", "MONEY-A96 参数化 %s"]);
  });

  it("整份文件被注释掉之后,认领与「会跑的用例」都归零(变异的第二半)", () => {
    const live = 'it("MONEY-A93 真用例", () => { expect(1).toBe(1); });';
    expect(caseTitles(live)).toEqual(["MONEY-A93 真用例"]);
    expect(liveCaseCount(live)).toBe(1);
    // 同一段代码整块注释掉:CI 上它一次都不跑,所以这里也必须当它不在。
    const commented = ["/*", live, "*/"].join("\n");
    expect(caseTitles(commented)).toEqual([]);
    expect(liveCaseCount(commented)).toBe(0);
    expect(rowPattern("MONEY-A93").test(stripComments(commented))).toBe(false);
  });
});

describe("FRONT-A1 §7.1①b — 每条验收点名的行为测试还在,而且真的会跑", () => {
  it("点名表覆盖 14 条,一条不落", () => {
    expect(Object.keys(MONEY_ROW_LANDINGS).sort()).toEqual([...MONEY_ROWS].sort());
  });

  it.each(MONEY_ROWS)("%s 点名的行为测试文件都在,带着编号,并且有会跑的用例", (row) => {
    const landings = MONEY_ROW_LANDINGS[row]!;
    expect(landings.length, `${row} 一个点名的落点都没有`).toBeGreaterThan(0);

    for (const landing of landings) {
      const source = TEST_SOURCES.find(({ file }) => rel(file) === landing);
      expect(source, `${row} 的行为测试 ${landing} 不见了 —— 合并把整份文件带走了`).toBeTruthy();
      expect(
        liveCaseCount(source!.text),
        `${landing} 里一条会跑的用例都没有(只剩 it.todo / .skip)—— ${row} 今天没人跑`,
      ).toBeGreaterThan(0);
      expect(
        /\b(?:describe|it|test)\.skip\s*\(/.test(source!.text),
        `${landing} 里有 .skip —— 压绿不算通过`,
      ).toBe(false);
    }

    // 点名表不许和现实脱节:至少有一份点名文件真的逐字带着这个编号。
    const claiming = landings.filter((landing) =>
      rowPattern(row).test(TEST_SOURCES.find(({ file }) => rel(file) === landing)!.text),
    );
    expect(claiming, `${row} 点名的文件里没有一份逐字提到它 —— 点名表过期了`).not.toEqual([]);
  });
});

/**
 * FRONT-A1 验收行(规格 §2)点名的四处钱交付面 —— 「在新壳上仍在」。
 *
 * 每一处钉两件:**东西还在**,以及**还挂着**。只钉前者会漏掉最安静的一种损失:组件文件
 * 原封不动,合并顺手把挂它的那一行删了,商家从此看不见那行小字。
 */
const WEB = path.join(REPO_ROOT, "apps/web");
const webSource = (relative: string) => readFileSync(path.join(WEB, relative), "utf8");

/**
 * 四处交付面各自的**真围栏**——本文件不重写它们的断言,只保证它们还在、还会跑。
 *
 * 判官 2026-09-02(k):这四条的深度断言早就各有文件(价目现算、禁字面量、入口普查、
 * 级联披露…),在这里再写一遍等于把同一件事钉两处,改一次要改两处,迟早各说各话。
 * 所以这里只做合并段该做的事:那份围栏文件被合并带走 / 只剩占位,当场红。
 */
const SURFACE_GUARDS: Record<string, string> = {
  "/admin/reconcile": "apps/web/lib/__tests__/reconcile-actions.test.ts",
  "账单页「Credits don't expire」": "apps/web/lib/__tests__/money-a5-credits-never-expire.test.ts",
  "上传入口价目小字": "apps/web/lib/__tests__/understanding-disclosure.test.ts",
  "聊天搜索成本提示": "apps/web/lib/__tests__/money-a10-search-disclosure.test.ts",
};

describe("FRONT-A1 §7.1①c — 四处钱交付面各自的围栏还在,而且真的会跑", () => {
  it.each(Object.entries(SURFACE_GUARDS))("%s 的围栏文件在,并且有会跑的用例", (surface, guard) => {
    const source = TEST_SOURCES.find(({ file }) => rel(file) === guard);
    expect(source, `${surface} 的围栏 ${guard} 不见了 —— 这一面从此没人守`).toBeTruthy();
    expect(
      liveCaseCount(source!.text),
      `${guard} 里一条会跑的用例都没有 —— ${surface} 今天没人守`,
    ).toBeGreaterThan(0);
    expect(
      /\b(?:describe|it|test)\.skip\s*\(/.test(source!.text),
      `${guard} 里有 .skip —— 压绿不算通过`,
    ).toBe(false);
  });
});

describe("FRONT-A1 §7.1①c — 四处钱交付面在新壳上仍然看得见", () => {
  it("`/admin/reconcile` 还是一页真的对账台", () => {
    const page = webSource("app/admin/reconcile/page.tsx");
    expect(page, "对账台没有渲染看板").toContain("<ReconcileBoard");
    expect(page, "对账台没有读真实审计行").toContain("listReconcileObservations");
    expect(page, "对账台的权限闸没了").toContain('requireRole("credits", "mutate")');
  });

  it("账单页仍然当面说「Credits don't expire」", () => {
    const billing = webSource("app/billing/page.tsx");
    expect(billing, "「credits 永不过期」这句话从商家面上消失了").toContain(
      "Credits don&apos;t expire",
    );
  });

  it("上传入口的价目小字还在,而且仍然挂在上传面上", () => {
    expect(webSource("components/otto/UnderstandingCostHint.tsx")).toContain(
      "UnderstandingCostHint",
    );
    const mounts = [
      "components/otto/OttoChatStream.tsx",
      "components/otto/stuff/AddAssetDialog.tsx",
      "components/otto/TemplateModal.tsx",
      "components/canvas/FlowCanvas.tsx",
      "components/asset/DetailPanel.tsx",
    ];
    for (const mount of mounts) {
      expect(webSource(mount), `${mount} 不再挂上传价目小字 —— 那个入口的扣费从此没被告知`)
        .toContain("<UnderstandingCostHint");
    }
  });

  it("聊天搜索的成本提示还在,而且仍然挂在输入框下", () => {
    expect(webSource("components/otto/SearchCostHint.tsx")).toContain("SearchCostHint");
    expect(
      webSource("components/otto/OttoChatStream.tsx"),
      "输入框下那行搜索价目小字没挂了",
    ).toContain("<SearchCostHint");
    expect(
      webSource("app/billing/page.tsx"),
      "billing 价目区不再念搜索那一行",
    ).toContain("SEARCH_UNIT_LABEL");
  });
});

/** 六条钱旅程:文件名里的编号,与文件自报的 `Journey <n>`。 */
const MONEY_JOURNEYS = [
  { file: "02-balance-and-hold.spec.ts", journey: 2 },
  { file: "03-charge-is-traceable.spec.ts", journey: 3 },
  { file: "04-refund-exactly-once.spec.ts", journey: 4 },
  { file: "05-topup-shelf-honesty.spec.ts", journey: 5 },
  { file: "06-spend-history-counts-charges.spec.ts", journey: 6 },
  { file: "07-money-surfaces-agree.spec.ts", journey: 7 },
];

describe("FRONT-A1 §7.1① — 六条钱旅程在真浏览器那一侧还在", () => {
  it.each(MONEY_JOURNEYS)("旅程 $journey($file)还在,并且自报的就是这个编号", ({ file, journey }) => {
    const full = path.join(REPO_ROOT, "e2e/journeys", file);
    const text = readFileSync(full, "utf8");
    expect(text, `${file} 自报的旅程编号与文件名对不上`).toContain(`Journey ${journey}`);
    expect(text, `${file} 里一个 test() 都没有`).toMatch(/\btest\(/);
  });

  it("旅程 7 认领 FRONT-A1 —— 换壳后两处钱面仍然说同一个数", () => {
    const text = readFileSync(path.join(REPO_ROOT, "e2e/journeys/07-money-surfaces-agree.spec.ts"), "utf8");
    expect(text).toContain("FRONT-A1");
  });
});
