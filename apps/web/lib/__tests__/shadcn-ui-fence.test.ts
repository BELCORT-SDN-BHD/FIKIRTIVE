/**
 * #840 立法围栏 —— shadcn/ui 是 FIKIRTIVE 唯一的 UI 组件基座。
 *
 * Founder 裁定 2026-08-11:「我要我们都用 shadcn/ui,从今以后」。裁定要落成机器能
 * 执行的东西,否则它只是一句写在票上的话:202 个界面文件里只有 38% 走 `@/components/ui`,
 * 其余手搓,而手搓的代价不是「不好看」,是每一处都要自己重新实现 focus ring、disabled、
 * 键盘模型和可访问名字 —— 走查里的无障碍缺陷几乎全部出在这些手搓件上(#739 / #813)。
 *
 * 这道围栏管的是**商家可见面里裸写的交互原语**:`<button>`、`<input>`、`<select>`、
 * `<textarea>`、原生 `<dialog>`。它们各自在 `@/components/ui` 里都有对位组件
 * (Button / Input / Select / Textarea / Dialog),新写的界面必须走对位组件。
 *
 * 结构性豁免只有一条,窄到可以一句话说完:`components/ui/` 自己。那 21 个文件正是把
 * 原语包起来的地方 —— 包装件内部当然要有原语,围栏管的是它们的**调用点**。
 * 非商家面(纯逻辑组件、server action、lib/)本来就不出现在扫描范围里(只扫
 * app/ 与 components/ 下的 .tsx),不需要另立豁免。
 *
 * 存量违例进下面这块**逐文件带理由的豁免板**,按界面族分组 —— 分组不是装饰,它就是
 * #840 那 12-15 张并行打磨 PR 的切分:一族一 worker 一分支,那张 PR 迁完自己这一族,
 * 就把自己这几行从板上划掉。板上的数字是**上限**,只减不增(退役色围栏 design-tokens
 * 用的是同一种棘轮:存量列出来,新的一个都不许加)。
 *
 * 红→绿演练(逐一实做,做完全部还原):
 *   - 往板外文件 components/crm/contacts-page.tsx 插一个 `<button>` ⇒ 第一闸红,
 *     报 `components/crm/contacts-page.tsx:1 <button> → <Button>`,第四闸也红(226 > 225)。
 *   - 把 FlowCanvas 的记账从 22 调成 21 ⇒ 第二闸红,报「实测 22 > 记账 21」。
 *   - 往板上挂一个已经零违例的文件 ⇒ 第三闸红,报「已清零,请从豁免板删除这一行」。
 *   - 判官 r1 的绕法(见下面 FROZEN_2026_08_11 的注释):给板外文件加一颗、写进豁免板,
 *     同时从 FlowCanvas 迁走一颗 ⇒ 前四闸确实全绿,第五闸红。
 *   - 判官 r2 的绕法(见下面 FROZEN_FINGERPRINT 的注释):把冻结表里一个 1 处的历史键
 *     **换成**新文件,60 行 / 合计 225 都不动 ⇒ 五闸全绿,指纹闸红并点名换掉的两个键。
 * 五条都验过会红,才敢说它绿的时候是在说事实。
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");

/**
 * 裸写就算违例的交互原语,以及它们在 `@/components/ui` 里的对位组件。
 * `dialog` 今天全树零处 —— 留在名单里是为了它永远保持零处:原生 `<dialog>` 的焦点陷阱
 * 与 Escape 行为各浏览器不一,Radix 的 Dialog 才是我们要的那一套。
 */
const NATIVE_CONTROLS = {
  button: "Button",
  input: "Input",
  select: "Select",
  textarea: "Textarea",
  dialog: "Dialog",
} as const;

/** 唯一的结构性豁免:包装件自己。围栏管的是它们的调用点。 */
const UI_PRIMITIVES = "components/ui/";

type Family = { family: string; why: string; files: Record<string, number> };

/**
 * 豁免板 —— 2026-08-11 全量扫描的实测结果:60 个文件、225 处裸原语。
 * 每一行的数字是那个文件当天的实测数,作为上限记账。
 */
const EXEMPT: Family[] = [
  // canvas is gone from this board — #840 第 3 步第四车 migrated the whole family to
  // @/components/ui: FlowCanvas.tsx (the image-count row, the composer's Generate/Close, the
  // five batch-bar keys, the eight bottom-toolbar tools, the legacy-skin prompt bar, the
  // animate dialog's motion keys and its custom-motion box), nodes/ImageNode.tsx and
  // nodes/VideoNode.tsx (card toolbars + the evolve/remake bars + the poster play key),
  // nodes/TextNode.tsx, nodes/GeneratingBody.tsx (Check again), nodes/NodeLineagePanel.tsx
  // (Copy), NorthstarCanvasWorkspace.tsx (side search + the Chat/Projects tabs),
  // CanvasLineagePanel.tsx, CanvasComparePanel.tsx and NorthstarHome.tsx. All sweep to 0 now.
  // Three call sites keep a canvas-only CSS class next to the shadcn primitive — `.cv-tb`,
  // `.cv-play`, `.cv-lineage-row`. Those are two- and three-class selectors, so they keep
  // winning the cascade over Button's own utilities and the geometry is untouched; every place
  // a utility DOES reach (svg sizing, disabled opacity, the row's size/alignment/colour) is
  // pinned back explicitly at the call site rather than left to a precedence guess. Their rows
  // stay in FROZEN_2026_08_11 below — that table is the 2026-08-11 historical snapshot and
  // never shrinks — but the live board only lists what is still owed, same as auth/navigation's
  // departure above.
  // otto-chat, otto-shell, and otto-memory are gone from this board — #840 第 3 步第二车
  // migrated all three families to @/components/ui in full: OttoChatStream, OttoConversation,
  // OttoFrontDoor, OttoResult, OttoPlanCard, parts/ReasoningPart (otto-chat); OttoNav, OttoApp,
  // OttoView, ConvoTabs, OttoOnboarding, settings/SettingsPage, settings/Switch (otto-shell —
  // Switch.tsx now wraps @/components/ui/switch instead of a hand-rolled
  // `<button role="switch">`); memory/ProductShowcase, memory/SegmentCards, memory/OfferList,
  // memory/FactSection, memory/UndoBar, OttoMemory (otto-memory). All sweep to 0 now. Their rows
  // stay in FROZEN_2026_08_11 below — that table is the 2026-08-11 historical snapshot and never
  // shrinks — but the live board only lists what is still owed, same as auth/navigation's
  // departure above. otto-schedule shrank from 19 to 1 (see its own row below) rather than
  // leaving the board entirely. otto-creation is gone from the live board too: Templates and
  // Ideas use the shared catalog controls, QuickBrief uses Button/Input/Field/Card/Alert, and
  // TemplateModal's file picker now wraps @/components/ui/input. Their frozen rows below stay
  // untouched as the historical 2026-08-11 snapshot.
  // otto-schedule is gone from this board — its account/target picker now uses the
  // NativeSelect wrapper, preserving the real select element its behavior tests depend on.
  // otto-stuff is gone from this board — #840 第 3 步第三车 migrated all three files to
  // @/components/ui in full: components/otto/stuff/StuffLibrary.tsx (picker tiles, filter
  // pills, open-item overlay, label row), components/otto/stuff/AddAssetDialog.tsx (Dialog,
  // Tabs, Field, Alert, the file Input with its file: classes preserved, format-picker Buttons),
  // components/otto/OttoStuff.tsx (product-pick
  // list rows). The hand-rolled `<div role="dialog">` overlay in both files is untouched — it
  // is not a native <dialog> element, so it was never on this board. Sweeps to 0 now. Their
  // rows stay in FROZEN_2026_08_11 below — that table is the 2026-08-11 historical snapshot
  // and never shrinks — but the live board only lists what is still owed, same as
  // auth/navigation's departure above.
  // analytics is gone from this board — its range selector and all actions now use
  // @/components/ui, while the frozen row below remains the historical 2026-08-11 snapshot.
  // crm is gone from this board — all remaining selects now compose the Radix-backed shadcn
  // Select, the segments picker uses Button with aria-pressed, and the authorization checkboxes
  // use Checkbox. The frozen rows below remain the historical 2026-08-11 snapshot.
  {
    family: "admin",
    why: "内部后台:不是商家面,优先级最低,但同样要迁 —— 手搓 checkbox 与筛选框的无障碍缺陷在哪一侧都是缺陷。",
    files: {
      "components/admin/AdminDashboardV2.tsx": 5,
      "components/admin/SettingsAdmin.tsx": 3,
      "components/admin/ImpersonationBanner.tsx": 1,
    },
  },
  // auth (login/signup) and navigation (global-navigation / immersive shell) are gone
  // from this board — #840 第 3 步第一车 migrated both families to @/components/ui in
  // full (app/login/LoginForm.tsx, app/signup/SignupForm.tsx, components/global-navigation.tsx,
  // components/northstar/immersive/immersive-shell.tsx all sweep to 0 now). Their rows stay in
  // FROZEN_2026_08_11 below — that table is the 2026-08-11 historical snapshot and never shrinks —
  // but the live board only lists what is still owed, same as immersive-nav.tsx's departure above.
  // asset is gone from this board — #840 第 3 步第三车 migrated it in full:
  // components/asset/DetailPanel.tsx now uses @/components/ui/sheet for the inspector shell and
  // @/components/ui/button for the action rail and variant thumbnail switcher. Sweeps to 0 now.
  // Its row stays in
  // FROZEN_2026_08_11 below — that table is the 2026-08-11 historical snapshot and never
  // shrinks — but the live board only lists what is still owed, same as auth/navigation's
  // departure above.
  // gen-pickers is gone from this board — the image/video spec controls now use
  // @/components/ui/native-select. NativeSelect deliberately wraps a real <select>, so the
  // money-adjacent suites keep their HTMLSelectElement .options, .textContent and native
  // change-event coverage while the visible control follows the shadcn design language.
  // The four historical rows stay in FROZEN_2026_08_11 below; that snapshot never shrinks.
];

/** 2026-08-11 实测总数,棘轮的刻度。只许调小。 */
const EXEMPT_TOTAL_BASELINE = 225;

/**
 * ══════════════════════════════════════════════════════════════════════════
 * 冻结基线 —— 2026-08-11 那一次全量扫描的原始账。这是**历史记录,一行都不许动**:
 * 不加行、不删行、数字不改。上面那块豁免板是「今天还欠多少」,会随每一族迁完而缩;
 * 这一块是「当初欠多少」,历史不会因为今天干了活就改变。
 * 钉子是下面 FROZEN_FINGERPRINT 那条 SHA-256 断言 —— 它钉的是**内容**,不是行数与总和
 * 这两个聚合数(判官 r2:只钉聚合数时,把一个 1 处的历史键换成新文件,60/225 纹丝不动)。
 *
 * 为什么要有第二份看起来一样的清单(判官 r1 P1 复现的绕法):
 * 只有「总数 ≤ 225」这道闸时,**给一个新文件加违例并把它写进豁免板,同时在别处
 * 迁走等量的一颗**,四道闸会全绿 —— 板确实没变大,但板上多了一个当初不欠账的
 * 文件,「只减不增」就成了「可以换着欠」。冻结集把「谁可以在板上」钉死在历史上,
 * 与总数无关:新文件一上板就红。逐文件的数字也一并冻死,堵住同一招的兄弟版本
 * (把 A 的记账调大、把 B 迁走,总数不变)。
 * ══════════════════════════════════════════════════════════════════════════
 */
const FROZEN_2026_08_11: Readonly<Record<string, number>> = {
  "app/login/LoginForm.tsx": 3,
  "app/signup/SignupForm.tsx": 2,
  "components/admin/AdminDashboardV2.tsx": 5,
  "components/admin/ImpersonationBanner.tsx": 1,
  "components/admin/SettingsAdmin.tsx": 4,
  "components/admin/TenantDetail.tsx": 3,
  "components/asset/DetailPanel.tsx": 2,
  "components/canvas/CanvasComparePanel.tsx": 1,
  "components/canvas/CanvasLineagePanel.tsx": 2,
  "components/canvas/FlowCanvas.tsx": 22,
  "components/canvas/NorthstarCanvasWorkspace.tsx": 2,
  "components/canvas/NorthstarHome.tsx": 1,
  "components/canvas/nodes/GeneratingBody.tsx": 1,
  "components/canvas/nodes/ImageNode.tsx": 9,
  "components/canvas/nodes/NodeLineagePanel.tsx": 1,
  "components/canvas/nodes/TextNode.tsx": 2,
  "components/canvas/nodes/VideoNode.tsx": 9,
  "components/crm/broadcasts/broadcast-composer-page.tsx": 4,
  "components/crm/broadcasts/broadcast-detail-page.tsx": 1,
  "components/crm/inbox/inbox-conversation-page.tsx": 1,
  "components/crm/inbox/inbox-templates-page.tsx": 1,
  "components/crm/segments-page.tsx": 1,
  "components/crm/workflows/archive-workflow-dialog.tsx": 1,
  "components/crm/workflows/routine-authorization-panel.tsx": 4,
  "components/crm/workflows/workflow-detail-page.tsx": 1,
  "components/crm/workflows/workflow-list-page.tsx": 1,
  "components/gen/ImageShapePicker.tsx": 1,
  "components/gen/VideoSpecPicker.tsx": 3,
  "components/global-navigation.tsx": 3,
  "components/northstar/immersive/immersive-nav.tsx": 1,
  "components/northstar/immersive/immersive-shell.tsx": 2,
  "components/otto/ConvoTabs.tsx": 2,
  "components/otto/OttoAnalytics.tsx": 5,
  "components/otto/OttoApp.tsx": 3,
  "components/otto/OttoChatStream.tsx": 9,
  "components/otto/OttoConversation.tsx": 3,
  "components/otto/OttoDiscover.tsx": 1,
  "components/otto/OttoFrontDoor.tsx": 3,
  "components/otto/OttoMemory.tsx": 2,
  "components/otto/OttoNav.tsx": 15,
  "components/otto/OttoOnboarding.tsx": 2,
  "components/otto/OttoPlanCard.tsx": 2,
  "components/otto/OttoResult.tsx": 5,
  "components/otto/OttoSchedule.tsx": 19,
  "components/otto/OttoStuff.tsx": 1,
  "components/otto/OttoTemplates.tsx": 1,
  "components/otto/OttoView.tsx": 2,
  "components/otto/QuickBrief.tsx": 7,
  "components/otto/StoryboardCard.tsx": 7,
  "components/otto/TemplateModal.tsx": 1,
  "components/otto/memory/FactSection.tsx": 3,
  "components/otto/memory/OfferList.tsx": 4,
  "components/otto/memory/ProductShowcase.tsx": 8,
  "components/otto/memory/SegmentCards.tsx": 6,
  "components/otto/memory/UndoBar.tsx": 1,
  "components/otto/parts/ReasoningPart.tsx": 1,
  "components/otto/settings/SettingsPage.tsx": 7,
  "components/otto/settings/Switch.tsx": 1,
  "components/otto/stuff/AddAssetDialog.tsx": 5,
  "components/otto/stuff/StuffLibrary.tsx": 4,
};

/**
 * 规范序列化:键排序,每行 `路径\t处数\n`。排序是为了让指纹与书写顺序无关 ——
 * 有人重排这张表不该红,改内容才该红。
 */
function canonicalize(table: Readonly<Record<string, number>>): string {
  return Object.keys(table)
    .sort()
    .map((key) => `${key}\t${table[key]}\n`)
    .join("");
}

function fingerprintOf(table: Readonly<Record<string, number>>): string {
  return createHash("sha256").update(canonicalize(table), "utf8").digest("hex");
}

/**
 * ── 2026-08-11 历史基线校验和 —— 除非 Founder 重新立法,永不修改 ──────────────
 *
 * FROZEN_2026_08_11 规范序列化后的 SHA-256(60 行、2406 字节、合计 225 处)。
 *
 * 为什么光钉「60 行 / 合计 225」不够(判官 r2 内存重放复现):那是两个**聚合数**。
 * 把冻结表里 `components/otto/OttoDiscover.tsx: 1` 这样一个 1 处的历史键,直接
 * **换成** `components/crm/contacts-page.tsx: 1` —— 行数还是 60,总和还是 225,
 * 五闸全绿,债务照样迁进了一个当初不欠账的新文件。指纹钉的是内容,换任何一个
 * 键或数字都会变。
 *
 * ⚠️ 认识论,别声称做不到的事:**围栏和它守的常量在同一个文件里,防不住篡改** ——
 * 谁改了表、顺手把这一行指纹也改了,测试照样绿。这道闸买到的不是「改不了」,
 * 是「**改必吵闹**」:任何一次改动都必须连这一行历史校验和一起改,而这一行在
 * diff 里是刺眼的、无法用「顺手整理一下」解释的一处修改,审阅者一眼就看见。
 * 真正的不可篡改要靠仓库外的东西(受保护分支 + 人审),不在这个文件的能力范围内。
 * ──────────────────────────────────────────────────────────────────────────
 */
const FROZEN_FINGERPRINT = "c6f15c6598b4504a491ea5963e585c6e9f065caf338178799151ccadea255b0d";

/**
 * 指纹对不上时,把「多了/少了/变了哪个键」指出来 —— 报一串十六进制没法让人动手改。
 *
 * 参照物取自 git:同一个文件在 origin/main / main / HEAD 里的那一份。这是**诊断**,
 * 不是闸门 —— 闸门是上面那个指纹断言,永远会红;这里拿不到 git 就退回打印重算值,
 * 不影响判定。
 */
function diffAgainstGit(current: Readonly<Record<string, number>>): string[] {
  const relative = path.relative(path.resolve(WEB_ROOT, "../.."), path.join(__dirname, "shadcn-ui-fence.test.ts"));
  for (const ref of ["origin/main", "main", "HEAD"]) {
    let committed: string;
    try {
      committed = execFileSync("git", ["show", `${ref}:${relative}`], {
        cwd: WEB_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      continue;
    }
    const block = committed.match(/const FROZEN_2026_08_11[^{]*\{([\s\S]*?)\n\};/)?.[1];
    if (!block) continue;
    const before: Record<string, number> = {};
    for (const entry of block.matchAll(/"([^"]+)":\s*(\d+),/g)) before[entry[1]] = Number(entry[2]);
    if (Object.keys(before).length === 0) continue;
    if (fingerprintOf(before) === fingerprintOf(current)) continue; // 这一版和现在一样,换下一个 ref

    const lines = [`对照 ${ref} 里的同一张表:`];
    for (const key of Object.keys(current).sort()) {
      if (!(key in before)) lines.push(`  + 多了 ${key}: ${current[key]}(当初不在冻结基线里)`);
      else if (before[key] !== current[key]) lines.push(`  ~ 变了 ${key}: ${before[key]} → ${current[key]}`);
    }
    for (const key of Object.keys(before).sort()) {
      if (!(key in current)) lines.push(`  - 少了 ${key}: ${before[key]}(历史条目被删掉了)`);
    }
    return lines;
  }
  return ["(拿不到 git 里的参照版本,无法逐键对比 —— 指纹不符这件事本身仍然成立)"];
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    const isDirectory = entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(full).isDirectory());
    if (isDirectory) return entry.name === "node_modules" ? [] : walk(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

function markupFiles(): string[] {
  return [...walk(path.join(WEB_ROOT, "app")), ...walk(path.join(WEB_ROOT, "components"))];
}

/**
 * 一段源码里所有裸写的交互原语。跟在标签名后面必须是空白、`>` 或 `/` —— 否则
 * `<selection>` 之类会被误判成 `<select>`。
 */
export function scanSource(text: string): { line: number; tag: keyof typeof NATIVE_CONTROLS }[] {
  const token = new RegExp(`<(${Object.keys(NATIVE_CONTROLS).join("|")})[\\s>/]`, "g");
  return [...text.matchAll(token)].map((match) => ({
    line: text.slice(0, match.index ?? 0).split("\n").length,
    tag: match[1] as keyof typeof NATIVE_CONTROLS,
  }));
}

type Sweep = { scanned: number; byFile: Map<string, number>; hits: string[] };

function sweep(): Sweep {
  const byFile = new Map<string, number>();
  const hits: string[] = [];
  const files = markupFiles();

  for (const file of files) {
    const relative = path.relative(WEB_ROOT, file);
    if (relative.startsWith(UI_PRIMITIVES)) continue;
    const found = scanSource(fs.readFileSync(file, "utf8"));
    if (found.length === 0) continue;
    byFile.set(relative, found.length);
    for (const hit of found) hits.push(`${relative}:${hit.line} <${hit.tag}> → <${NATIVE_CONTROLS[hit.tag]}>`);
  }

  return { scanned: files.length, byFile, hits };
}

const board = new Map<string, { family: string; allowed: number }>(
  EXEMPT.flatMap(({ family, files }) =>
    Object.entries(files).map(([file, allowed]) => [file, { family, allowed }] as const),
  ),
);

describe("#840 — 商家可见面的交互原语一律走 @/components/ui", () => {
  it("豁免板之外的文件里,一个裸写的原语都没有", () => {
    const { byFile, hits } = sweep();
    const offenders = hits.filter((hit) => !board.has(hit.slice(0, hit.indexOf(":"))));
    // 报的是具体行和该用哪个组件,不是「有违例」四个字 —— 修的人不该再去猜。
    expect(offenders).toEqual([]);
    // 顺带证明板上的文件确实在扫描结果里,而不是靠扫描器什么都没扫到才绿。
    expect(byFile.size).toBeGreaterThan(0);
  });

  it("板上每个文件只减不增", () => {
    const { byFile } = sweep();
    const grown: string[] = [];
    for (const [file, { family, allowed }] of board) {
      const actual = byFile.get(file) ?? 0;
      if (actual > allowed) grown.push(`${file}(${family}):实测 ${actual} > 记账 ${allowed}`);
    }
    expect(grown).toEqual([]);
  });

  it("板上没有陈账:清零或删掉的文件必须从板上划掉", () => {
    const { byFile } = sweep();
    const stale: string[] = [];
    for (const [file, { family }] of board) {
      if (!fs.existsSync(path.join(WEB_ROOT, file))) {
        stale.push(`${file}(${family}):文件已不存在`);
        continue;
      }
      if ((byFile.get(file) ?? 0) === 0) stale.push(`${file}(${family}):已清零,请从豁免板删除这一行`);
    }
    expect(stale).toEqual([]);
  });

  it("总数只减不增(棘轮的刻度)", () => {
    const { byFile } = sweep();
    let total = 0;
    for (const count of byFile.values()) total += count;
    expect(total).toBeLessThanOrEqual(EXEMPT_TOTAL_BASELINE);
  });

  /**
   * 第五闸 —— 判官 r1 P1:前四闸只看「板有多大」,不看「板上是谁」。给一个当初不欠账的
   * 文件加违例、把它写进豁免板,同时在别处迁走等量的一颗 —— 总数不变,四闸全绿,
   * 「只减不增」被换成了「可以换着欠」。这一闸把「谁可以在板上」钉死在冻结基线上,
   * 与总数无关:任何新文件一上板就红,任何记账数字一调大就红。
   */
  it("豁免板只能是冻结基线的子集:不许上新文件,不许把记账调大", () => {
    const intruders: string[] = [];
    for (const [file, { family, allowed }] of board) {
      const frozen = FROZEN_2026_08_11[file];
      if (frozen === undefined) {
        intruders.push(
          `${file}(${family}):不在 2026-08-11 冻结基线里。` +
            `新文件不许上豁免板 —— 它该走 @/components/ui,不是进账本。`,
        );
        continue;
      }
      if (allowed > frozen) {
        intruders.push(`${file}(${family}):记账 ${allowed} > 冻结基线 ${frozen},账本只能往下走`);
      }
    }
    expect(intruders).toEqual([]);
  });
});

describe("#840 — 围栏自身的可信度", () => {
  /**
   * 第五闸只有在冻结基线本身不可动的前提下才成立。r2 这里只钉了「60 行 / 合计 225」
   * 两个聚合数 —— 判官重放:把一个 1 处的历史键换成新文件,两个数纹丝不动,五闸全绿。
   * r3 改钉**内容**:规范序列化后的 SHA-256。换任何一个键、动任何一个数字都会红。
   * 两个聚合数留着,是因为它们红的时候比一串十六进制更快说明发生了什么。
   */
  it("冻结基线一个字都没被动过:SHA-256 指纹对得上", () => {
    const actual = fingerprintOf(FROZEN_2026_08_11);
    if (actual !== FROZEN_FINGERPRINT) {
      const report = [
        "冻结基线被改了 —— 它是 2026-08-11 的历史账,不该随任何一次迁移变动。",
        `  记录在案:${FROZEN_FINGERPRINT}`,
        `  现在重算:${actual}`,
        ...diffAgainstGit(FROZEN_2026_08_11),
        "如果这次改动确实是 Founder 重新立法,请连同这一行指纹一起改,并在 PR 里说清为什么。",
      ].join("\n");
      expect.fail(report);
    }
    // 聚合数照旧断言:指纹说「变了」,这两条说「变成了什么样」。
    const entries = Object.entries(FROZEN_2026_08_11);
    expect(entries.length).toBe(60);
    expect(entries.reduce((sum, [, count]) => sum + count, 0)).toBe(EXEMPT_TOTAL_BASELINE);
  });

  /**
   * 指纹机制本身的两条:排序让它对书写顺序免疫,规范序列化让它对内容敏感。
   * 断言的是「重排 == 原表」而不是「重排 == 常量」—— 后者在上面那条已经红过一次时
   * 会跟着一起红,一个原因报两次,看的人得多花一次力气分辨。
   */
  it("规范序列化与书写顺序无关:重排冻结表不该红,换键才该红", () => {
    const reordered = Object.fromEntries(Object.entries(FROZEN_2026_08_11).reverse());
    expect(fingerprintOf(reordered)).toBe(fingerprintOf(FROZEN_2026_08_11));

    // 判官 r2 的换键绕法,就地演一遍:60 行 / 合计 225 都不变,指纹必须变。
    const swapped = { ...FROZEN_2026_08_11 };
    delete (swapped as Record<string, number>)["components/otto/OttoDiscover.tsx"];
    swapped["components/crm/contacts-page.tsx"] = 1;
    expect(Object.keys(swapped).length).toBe(60);
    expect(Object.values(swapped).reduce((a, b) => a + b, 0)).toBe(EXEMPT_TOTAL_BASELINE);
    expect(fingerprintOf(swapped)).not.toBe(FROZEN_FINGERPRINT);
  });

  it("扫描器仍然在扫整棵界面树", () => {
    // 2026-08-11 实测 211 个 .tsx。地板是为了抓「扫描范围塌了」,不是为了冻结数量。
    expect(sweep().scanned).toBeGreaterThanOrEqual(190);
  });

  it("结构性豁免只有 components/ui/ 一条,而且它真的在包原语", () => {
    const wrappers = markupFiles()
      .map((file) => path.relative(WEB_ROOT, file))
      .filter((file) => file.startsWith(UI_PRIMITIVES));
    expect(wrappers.length).toBeGreaterThanOrEqual(20);
    // 包装件里必须找得到原语 —— 找不到就说明豁免的不是「包原语的地方」。
    for (const file of ["components/ui/input.tsx", "components/ui/textarea.tsx"]) {
      expect(scanSource(fs.readFileSync(path.join(WEB_ROOT, file), "utf8")).length, file).toBeGreaterThan(0);
    }
  });

  it("底座包的 9 件新组件都在 components/ui/ 里就位", () => {
    for (const name of [
      "alert", "checkbox", "dropdown-menu", "label", "popover",
      "separator", "sheet", "skeleton", "tabs",
    ]) {
      expect(fs.existsSync(path.join(WEB_ROOT, "components/ui", `${name}.tsx`)), name).toBe(true);
    }
  });

  it("ds.tsx 这套平行设计系统已经退役,不许回来", () => {
    expect(fs.existsSync(path.join(WEB_ROOT, "components/ds.tsx"))).toBe(false);
    const importers = markupFiles().filter((file) =>
      /from\s+["']@\/components\/ds["']/.test(fs.readFileSync(file, "utf8")),
    );
    expect(importers).toEqual([]);
  });
});

describe("扫描机制", () => {
  it("认得四种写法的开标签", () => {
    expect(scanSource("<button>x</button>").map((h) => h.tag)).toEqual(["button"]);
    expect(scanSource('<input type="text" />').map((h) => h.tag)).toEqual(["input"]);
    expect(scanSource("<textarea\n  rows={3}\n/>").map((h) => h.tag)).toEqual(["textarea"]);
    expect(scanSource("<dialog open>hi</dialog>").map((h) => h.tag)).toEqual(["dialog"]);
  });

  it("不把 <Button> / <Select> 这些对位组件算成违例", () => {
    expect(scanSource("<Button /><Input /><Select /><Textarea /><Dialog />")).toEqual([]);
  });

  it("不把名字以原语开头的标签算成违例", () => {
    expect(scanSource("<selection /><inputs /><buttonGroup />")).toEqual([]);
  });

  it("报的行号是原语所在的那一行", () => {
    expect(scanSource("line1\nline2\n<button>")).toEqual([{ line: 3, tag: "button" }]);
  });
});
