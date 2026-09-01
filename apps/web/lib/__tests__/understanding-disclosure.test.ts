/**
 * understanding-disclosure — MONEY-A9(规格 §7.3):**披露先于扣费**。
 *
 * Founder 2026-08-31 把「素材理解」从平台自费改成商家照算之后,每一张上传的图、每一段上传的
 * 视频都会自动产生一笔扣费。这一票钉的不是那笔扣费怎么走账(那是 worker 侧的验收),而是
 * **商家在按下选择文件之前有没有被告知**。一笔没被告知的扣费,是商家唯一不会原谅的钱 bug。
 *
 * 四条钉板:
 *   ① 三类价必须逐条出现在那一行小字里,而且是**现算**的 —— 测试自己也调
 *      `pricedUnderstandingCredits` 算期望值,不手抄一个数;两边同源,涨价当天一起动。
 *   ② 组件源码里**一个手抄的价钱都不许有**(源码文本断言)。手抄的那一刻,披露就变成了陷阱:
 *      成本钉点一动,界面上的数字会安静地开始撒谎。
 *   ③ 上传入口挂的是**同一个**组件,而且入口清单是**普查出来的,不是手抄的**:测试自己扫
 *      `source: "UPLOAD"` 的写点、扫谁调了那些写点动作,任一侧多出一个而披露没跟上就红。
 *      连**动作名本身**都是从写点文件里推导的(手抄的动作名会让新增一支 uploadHeroImage()
 *      的整套围栏照样全绿),入口再按**调用点计数**钉一层:同一个文件里多一个上传调用点,
 *      计数就对不上,评审者必须先确认披露覆盖了它才能改登记。
 *      §7.3 明写「施工首件事用 grep 复核入口清单」—— 手抄的清单只在抄它的那一天是对的,
 *      而漏挂一个入口的代价,是商家被收一笔他从没在任何屏幕上见过的钱(顾问复审 2026-09-02
 *      就是这样抓到 Canvas 拖放与裁剪保存两个漏网入口的)。EditDesk 单列豁免:只收音频,
 *      音频不在收费的三类里。
 *   ④ 级联说明必须在(计费四则②):一张图被认出是菜单/价目表时会**再收一次**,
 *      只报第一段价是「真话,但仍然是骗人」。
 *
 * 另外两面:billing 价目区(同源、措辞更详)与 Otto 的 URL 导入(无 UI,披露走动作前报价)。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  UNDERSTANDING_PRICED_INTERNAL,
  displayCredits,
  pricedUnderstandingCredits,
} from "@fikirtive/core/spend";
import { creditsLabel } from "@/lib/credit-format";
import {
  UNDERSTANDING_COST_HINT_TITLE,
  UnderstandingCostHint,
} from "@/components/otto/UnderstandingCostHint";

const WEB_ROOT = process.cwd();
const codeOf = (rel: string) => readFileSync(path.join(WEB_ROOT, rel), "utf8");

/** 一件某类素材的报价,**按测试自己现算的口径** —— 与被测代码同一个函数,不是同一份字面量。 */
const priceOf = (kind: keyof typeof UNDERSTANDING_PRICED_INTERNAL) =>
  creditsLabel(displayCredits(pricedUnderstandingCredits(kind)));

/** 「12 credits」「0.1 credit」这类**手抄的钱数**。className 里的 `text-[0.75rem]` 不会命中
 *  (它后面跟的是 rem,不是 credit),命中的只有真的把价钱写死在文案里的那种写法。 */
const HAND_TYPED_CREDITS = /\d[\d,.]*\s*credits?\b/i;

/** 只扫**会被商家读到的那部分**:注释里举例说明「0.1 credits 是怎么来的」是文档,不是文案,
 *  而且它正是我们希望留在源码里的解释。手抄的价钱如果藏在注释里,一个商家也看不见。 */
function copyLines(src: string): string[] {
  return src
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .map((line) => line.trim());
}

// ────────────────────────── 入口普查(结构性围栏) ──────────────────────────
// 手抄的入口清单是这一票的病根本身:②段照 §7.3 点名的三处挂完就收工,而 Canvas 拖放
// (FlowCanvas → uploadReference)和素材详情的裁剪保存(DetailPanel → saveCroppedGeneration)
// 一直在落同样会被理解计费的 UPLOAD 素材,没人再去数一遍。下面两张表都由测试**当场扫出来**,
// 只有「为什么豁免」这一栏是人写的。

/** `apps/web` 里递归列出源码文件(跳过测试与 node_modules)。 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(WEB_ROOT, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name.startsWith(".")) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(rel, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** 真的写 `source: "UPLOAD"` 的文件 —— 注释里提到这个字样的不算(copyLines 已经把注释滤掉,
 *  otto-media-port 就只在注释里提它:它自己不写行,它转手给 finalizeCandidateUploads)。 */
function writePointFiles(): string[] {
  return sourceFiles("lib")
    .concat(sourceFiles("app"), sourceFiles("components"))
    .filter((f) => copyLines(codeOf(f)).some((line) => /source:\s*"UPLOAD"/.test(line)))
    .sort();
}

/** 写点所在的文件。多一个文件开始写 UPLOAD 素材,这里当场红 —— 那意味着有一条新的计费路径,
 *  而它的 UI 入口还没有人问过「商家看得见价目吗」。 */
const WRITE_POINT_FILES: Record<string, string> = {
  "lib/actions.ts": "ingestFile → createEntity / addReferenceImages / uploadCandidates / uploadReference",
  "lib/asset-actions.ts": "saveCroppedGeneration —— 裁剪保存落一条全新的 UPLOAD 素材",
  "lib/upload-actions.ts": "finalizeCandidateUploads —— 直传落盘的唯一权威(Otto 的 URL 导入也走它)",
};

/** 写点文件里**不导出**的落盘 helper。动作本身常常不写那一行,而是把它交给 helper
 *  (`createEntity` 就一个字面量都没有,它调 `ingestFile`),所以推导必须认这一层;
 *  helper 名单虽然是人列的,但下面有一条断言逼它自己也含 `source: "UPLOAD"` ——
 *  helper 一旦不再是写点,名单当场红,而不是安静地漏掉一整支动作。 */
const WRITE_HELPERS = ["ingestFile"] as const;

/** 一个导出函数的源码片段。函数体的那个 `{` 是**声明行末尾那个**(后面直接换行):
 *  `Promise<{ ok: true } | { error: string }>` 这类返回类型注解里的 `{` 后面跟的是空格,
 *  不会被当成函数体开口(第一版就是栽在这里,把半个类型注解当成了整个函数体)。
 *  再用「下一个顶层 export」当硬边界,括号计数被字符串或注释带偏时也只会多算、不会跑飞。 */
function exportedFunctionBodies(src: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const decl = /^export\s+(?:async\s+)?function\s+(\w+)|^export\s+const\s+(\w+)\s*=\s*(?:async\s*)?[(<]/gm;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(src)) !== null) {
    const name = m[1] ?? m[2];
    const bodyOpen = /\{[ \t]*\r?\n/g;
    bodyOpen.lastIndex = m.index;
    const open = bodyOpen.exec(src);
    if (!open) continue;
    const nextExport = /^export\s/gm;
    nextExport.lastIndex = m.index + 1;
    const next = nextExport.exec(src);
    const hardEnd = next ? next.index : src.length;
    let depth = 0;
    let i = open.index;
    for (; i < src.length && i < hardEnd; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) { i++; break; }
    }
    bodies.set(name, src.slice(m.index, Math.min(i, hardEnd)));
  }
  return bodies;
}

/** 会落 image/video UPLOAD 素材的导出动作 —— **从源码推导,不手抄**。
 *  手抄的动作名和手抄的入口清单是同一个病:将来在 lib/actions.ts 里加一个
 *  `uploadHeroImage()` 并接上新 UI,手抄的名单会让整套围栏照样全绿。
 *  判据两条(满足其一即算):函数体里直接写了 `source: "UPLOAD"`,或者它调了写点 helper。 */
function uploadActionNames(): string[] {
  const names = new Set<string>();
  for (const file of Object.keys(WRITE_POINT_FILES)) {
    for (const [name, body] of exportedFunctionBodies(codeOf(file))) {
      const writesDirectly = /source:\s*"UPLOAD"/.test(body);
      const writesViaHelper = WRITE_HELPERS.some((h) => new RegExp(`\\b${h}\\s*\\(`).test(body));
      if (writesDirectly || writesViaHelper) names.add(name);
    }
  }
  return [...names].sort();
}

/** 一个 UI 文件里对上传动作的**调用点数量**(注释行不算 —— 注释里提到某个动作不是入口)。 */
function callSiteCount(file: string): number {
  const code = copyLines(codeOf(file)).join("\n");
  return uploadActionNames().reduce(
    (n, action) => n + (code.match(new RegExp(`\\b${action}\\s*\\(`, "g"))?.length ?? 0),
    0,
  );
}

/** 调了任何一个上传动作的 UI 文件 —— 这就是「上传入口」的定义,不是谁记得住的那三处。 */
function uploadEntryFiles(): string[] {
  return sourceFiles("app")
    .concat(sourceFiles("components"))
    .filter((f) => callSiteCount(f) > 0)
    .sort();
}

/**
 * 必须挂披露的入口:文件 → 说明 → **该文件里的上传调用点数量**。
 *
 * 计数这一栏是围栏语义,不是逐点证明:grep 证不了「第 3 个调用点旁边有没有披露」,
 * 但它能证「调用点数量变了」。变了就红,评审者必须先确认披露仍然覆盖那个新调用点、
 * 再来更新这个数字 —— 也就是把「在 OttoChatStream 里再塞一个不披露的上传弹层」
 * 从一次静默的合并,变成一次必须有人签字的改动。
 */
const MOUNTS = [
  ["components/asset/DetailPanel.tsx", "素材详情的裁剪保存(saveCroppedGeneration)", 1],
  ["components/canvas/FlowCanvas.tsx", "Canvas 拖放上传(uploadReference)", 1],
  ["components/otto/OttoChatStream.tsx", "Otto 对话的附件入口", 3],
  ["components/otto/TemplateModal.tsx", "模板的产品图上传", 1],
  ["components/otto/stuff/AddAssetDialog.tsx", "素材库的多图上传", 2],
] as const;

/** 明示豁免。豁免要有理由,而且理由要能当场核 —— 不写理由的豁免就是漏挂。
 *  豁免也数调用点:EditDesk 今天只收音频,它哪天多接一个收图的入口,这里同样会红。 */
const EXEMPT: Record<string, { reason: string; callSites: number }> = {
  "components/otto/edit/EditDesk.tsx": {
    reason: "只收音频;audio 不在收费的三类里(§7.3 单列)",
    callSites: 1,
  },
};

describe("MONEY-A9 披露先于扣费:上传入口的价目小字", () => {
  const markup = renderToStaticMarkup(createElement(UnderstandingCostHint));

  it("三类价逐条出现,且与报价函数同源(测试自己现算期望值,不手抄)", () => {
    for (const kind of Object.keys(UNDERSTANDING_PRICED_INTERNAL) as (keyof typeof UNDERSTANDING_PRICED_INTERNAL)[]) {
      expect(markup, `${kind} 的价没有出现在披露行里`).toContain(priceOf(kind));
    }
  });

  it("第四类理解上线时,这句话必须跟着改(枚举长度即闸)", () => {
    // 这一行不是形式主义:三类价是**三个句子槽**,加第四类而不改文案,商家读到的就是一份
    // 缺一档的价目表 —— 而缺的那一档照样扣钱。枚举一变长,这里当场红。
    expect(
      Object.keys(UNDERSTANDING_PRICED_INTERNAL),
      "理解档多了一类:披露行要多一个槽,billing 价目区同样",
    ).toHaveLength(3);
  });

  it("级联说明在(计费四则②:菜单/价目表会被再读一次,两段价一并披露)", () => {
    expect(markup).toContain("menu or price list");
    expect(markup).toContain(priceOf("doc-extract"));
  });

  it("title 说清了什么时候扣、按哪一天的价(四则①:按上传时刻的快照价)", () => {
    expect(markup).toContain(UNDERSTANDING_COST_HINT_TITLE);
    expect(UNDERSTANDING_COST_HINT_TITLE.toLowerCase()).toContain("when you upload");
  });

  it("组件源码里没有手抄的价钱 —— 数值只能来自推导", () => {
    const src = codeOf("components/otto/UnderstandingCostHint.tsx");
    const offenders = copyLines(src).filter((line) => HAND_TYPED_CREDITS.test(line));
    expect(offenders, "披露文案里出现了手抄的钱数").toEqual([]);
    expect(src).toContain("pricedUnderstandingCredits");
  });

  it("样式照抄现成的成本小字(FlowCanvas 的那一行),不是第三种长相", () => {
    expect(markup).toContain("text-[0.75rem] text-muted-foreground");
    expect(codeOf("components/canvas/FlowCanvas.tsx")).toContain(
      'className="text-[0.75rem] text-muted-foreground"',
    );
  });

  it.each(MOUNTS)("%s 挂的是同一个共享组件", (file) => {
    const src = codeOf(file);
    expect(src, `${file} 没有 import 披露组件`).toContain("UnderstandingCostHint");
    expect(src, `${file} import 了却没有渲染`).toContain("<UnderstandingCostHint />");
  });

  it("EditDesk 不挂 —— 它今天只收音频,音频不在收费的三类里(§7.3 单列)", () => {
    expect(codeOf("components/otto/edit/EditDesk.tsx")).not.toContain("UnderstandingCostHint");
  });

  // ── 围栏:两侧各扫一遍,任一侧动了而另一侧没跟上就红 ────────────────────────────
  it("写点普查:落 UPLOAD 素材的文件就是登记的这几个(多一个=多一条没人问过披露的计费路径)", () => {
    expect(
      writePointFiles(),
      "有文件开始写 source:\"UPLOAD\":先追它的 UI 面,再决定挂披露还是写进豁免",
    ).toEqual(Object.keys(WRITE_POINT_FILES).sort());
  });

  it("写点普查:落盘 helper 自己就是写点(helper 名单不许变成第二份手抄清单)", () => {
    // 动作名是推导出来的,但「哪些 helper 算落盘」这一层是人列的。这条把那一层也钉住:
    // helper 一旦不再写 source:"UPLOAD",它就不该再当推导依据 —— 当场红,而不是安静地
    // 把 createEntity 这类「自己一个字面量都没有」的动作整支漏掉。
    const allWritePointCode = Object.keys(WRITE_POINT_FILES).map(codeOf).join("\n");
    for (const helper of WRITE_HELPERS) {
      const body = new RegExp(`(?:async\\s+)?function\\s+${helper}\\b[\\s\\S]*?\\n\\}`).exec(allWritePointCode);
      expect(body, `找不到落盘 helper ${helper} —— 它被改名或删了,推导依据已失效`).not.toBeNull();
      expect(body![0], `${helper} 不再写 source:"UPLOAD",它不该继续当推导依据`).toMatch(/source:\s*"UPLOAD"/);
    }
  });

  it("动作普查:上传动作名由源码推导,登记表只用来核对(新增一支写 UPLOAD 的导出动作当场红)", () => {
    expect(
      uploadActionNames(),
      "写点文件里的上传动作集合变了:先追它的 UI 面,再决定挂披露还是写进豁免",
    ).toEqual([
      "addReferenceImages",
      "createEntity",
      "finalizeCandidateUploads",
      "saveCroppedGeneration",
      "uploadCandidates",
      "uploadReference",
    ]);
  });

  it("入口普查:调上传动作的 UI 文件 = 挂点表 + 豁免表(新入口漏挂当场红)", () => {
    const declared = [...MOUNTS.map(([file]) => file), ...Object.keys(EXEMPT)].sort();
    expect(
      uploadEntryFiles(),
      "有 UI 开始调上传动作:要么挂 <UnderstandingCostHint />,要么进 EXEMPT 并写明理由",
    ).toEqual(declared);
  });

  it.each(MOUNTS)("%s 的上传调用点数量 = 登记值(多一个调用点=强制人工复核披露)", (file, _note, callSites) => {
    expect(
      callSiteCount(file),
      `${file} 的上传调用点数量变了:先确认披露仍覆盖新的调用点,再来更新这个数字`,
    ).toBe(callSites);
  });

  it("入口普查:挂点表与豁免表不重叠,豁免每条都带理由,豁免的调用点数量也钉住", () => {
    for (const [file] of MOUNTS) {
      expect(EXEMPT[file], `${file} 同时出现在挂点表和豁免表`).toBeUndefined();
    }
    for (const [file, { reason, callSites }] of Object.entries(EXEMPT)) {
      expect(reason.length, `${file} 的豁免没写理由`).toBeGreaterThan(10);
      expect(codeOf(file), `${file} 被豁免了却挂着披露`).not.toContain("UnderstandingCostHint");
      expect(
        callSiteCount(file),
        `${file} 的上传调用点数量变了:豁免的理由(只收音频)可能已经不成立`,
      ).toBe(callSites);
    }
  });
});

describe("MONEY-A9 披露先于扣费:billing 页价目区", () => {
  it("Auto-understanding 一节在,三类价同源,级联与上传时刻价都说了", async () => {
    vi.resetModules();
    vi.doMock("@/lib/account-actions", () => ({
      getMyAccount: async () => ({ error: "not signed in" }),
    }));
    vi.doMock("@/lib/billing-actions", () => ({ listCreditPacks: async () => ({ packs: [] }) }));
    vi.doMock("@/lib/spend-history-data", () => ({
      getSpendOverview: async () => ({ error: "unavailable" }),
    }));
    const { default: BillingPage } = await import("@/app/billing/page");

    const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Auto-understanding");
    for (const kind of Object.keys(UNDERSTANDING_PRICED_INTERNAL) as (keyof typeof UNDERSTANDING_PRICED_INTERNAL)[]) {
      expect(html, `${kind} 的价没有出现在 billing 价目区`).toContain(priceOf(kind));
    }
    expect(html).toContain("menu or a price list");
    // 四则①:结算按上传时刻的快照价,所以价目区不能只报价、不说这笔价什么时候锁。
    expect(html.toLowerCase()).toContain("price shown when you upload");
    vi.doUnmock("@/lib/account-actions");
    vi.doUnmock("@/lib/billing-actions");
    vi.doUnmock("@/lib/spend-history-data");
  });

  it("billing 页的数字也是现算的,不是页面里另抄的一份", () => {
    const src = codeOf("app/billing/page.tsx");
    expect(src).toContain("pricedUnderstandingCredits");
    const understandingCopy = copyLines(src).filter(
      (line) => /understanding/i.test(line) && HAND_TYPED_CREDITS.test(line),
    );
    expect(understandingCopy, "价目区出现了手抄的钱数").toEqual([]);
  });
});

describe("MONEY-A9 披露先于扣费:Otto 的 URL 导入走动作前报价", () => {
  const port = codeOf("lib/otto-media-port.ts");

  it("「$0 by construction」的旧说法已废止 —— 导入落的是会被理解计费的 UPLOAD 素材", () => {
    expect(port).not.toContain("$0 by construction");
    expect(port).toContain("MONEY-A9");
  });

  it("成功结果带一句报价,而且是现算的(无 UI 面,披露只能走动作层)", () => {
    expect(port).toContain("pricedUnderstandingCredits");
    expect(port).toContain("creditsLabel");
    expect(port).toContain("note: importUnderstandingQuote(");
    const offenders = copyLines(port).filter((line) => HAND_TYPED_CREDITS.test(line));
    expect(offenders, "导入报价里出现了手抄的钱数").toEqual([]);
  });

  it("级联那一句只给图片 —— 视频不会触发 doc-extract,承诺它就是另一句假话", () => {
    expect(port).toContain('kind === "image-caption"');
  });

  it("**动作前**那一半真的在动作层:Otto 的说明书与 importMedia 工具描述都带着现算的价", async () => {
    // 上面三条钉的是 port 回来那一句(**事后**报价)。规格 §7.3 要的是「动作前报价」——
    // 事后才告诉商家花了多少,正是这一票开头写的那种「商家唯一不会原谅的钱 bug」。
    // 这条把另一半也钉住:模型在**伸手去调这个工具之前**读到的两处文本里都有那个价。
    const { ottoInstructions, skillCatalog } = await import("@fikirtive/otto");
    const importMedia = skillCatalog.find((s) => s.name === "importMedia");
    expect(importMedia, "importMedia 不在 Otto 的动作表里").toBeDefined();

    for (const kind of Object.keys(UNDERSTANDING_PRICED_INTERNAL) as (keyof typeof UNDERSTANDING_PRICED_INTERNAL)[]) {
      const amount = `${displayCredits(pricedUnderstandingCredits(kind))} credits`;
      expect(ottoInstructions, `Otto 说明书缺 ${kind} 的价`).toContain(amount);
      expect(importMedia!.description, `importMedia 描述缺 ${kind} 的价`).toContain(amount);
    }
    // 先报价、再导入 —— 顺序本身就是这条验收
    expect(ottoInstructions).toContain("Say that price BEFORE you import, never after");
    expect(importMedia!.description).toContain("BEFORE CALLING THIS");
  });
});
