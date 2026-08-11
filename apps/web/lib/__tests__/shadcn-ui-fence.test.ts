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
 * 四条都验过会红,才敢说它绿的时候是在说事实。
 */
import fs from "node:fs";
import path from "node:path";
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
  {
    family: "canvas",
    why: "画布与节点卡:工具条、节点动作、提示词输入全是手搓,且与 @xyflow 的拖拽/选中语义缠在一起,单独一族迁。",
    files: {
      "components/canvas/FlowCanvas.tsx": 22,
      "components/canvas/nodes/ImageNode.tsx": 9,
      "components/canvas/nodes/VideoNode.tsx": 9,
      "components/canvas/nodes/TextNode.tsx": 2,
      "components/canvas/nodes/GeneratingBody.tsx": 1,
      "components/canvas/nodes/NodeLineagePanel.tsx": 1,
      "components/canvas/NorthstarCanvasWorkspace.tsx": 2,
      "components/canvas/CanvasLineagePanel.tsx": 2,
      "components/canvas/CanvasComparePanel.tsx": 1,
      "components/canvas/NorthstarHome.tsx": 1,
    },
  },
  {
    family: "otto-chat",
    why: "Otto 对话流与卡片:composer、附件、卡片动作;这一族同时是 #802 界面地图技能的落点,迁移要与那票对齐。",
    files: {
      "components/otto/OttoChatStream.tsx": 9,
      "components/otto/OttoConversation.tsx": 3,
      "components/otto/OttoFrontDoor.tsx": 3,
      "components/otto/OttoResult.tsx": 5,
      "components/otto/OttoPlanCard.tsx": 2,
      "components/otto/parts/ReasoningPart.tsx": 1,
    },
  },
  {
    family: "otto-shell",
    why: "Otto 外壳:侧边导航(手搓抽屉 + role=\"menu\")、会话页签、设置页、自绘 Switch;底座包的 sheet / tabs / dropdown-menu 就是为这一族补的。",
    files: {
      "components/otto/OttoNav.tsx": 15,
      "components/otto/OttoApp.tsx": 3,
      "components/otto/OttoView.tsx": 2,
      "components/otto/ConvoTabs.tsx": 2,
      "components/otto/OttoOnboarding.tsx": 2,
      "components/otto/settings/SettingsPage.tsx": 7,
      "components/otto/settings/Switch.tsx": 1,
    },
  },
  {
    family: "otto-memory",
    why: "店铺资料(产品/分群/优惠/事实):清一色列表卡 + 行内动作,一族一次迁完最省。",
    files: {
      "components/otto/memory/ProductShowcase.tsx": 8,
      "components/otto/memory/SegmentCards.tsx": 6,
      "components/otto/memory/OfferList.tsx": 4,
      "components/otto/memory/FactSection.tsx": 3,
      "components/otto/memory/UndoBar.tsx": 1,
      "components/otto/OttoMemory.tsx": 2,
    },
  },
  {
    family: "otto-creation",
    why: "创作入口(快速简报/分镜卡/模板/发现):#774-#785 创作波正在重做这些面,按 #840 第 3 条,这一族不单开打磨 PR —— 在各自功能票里直接用 shadcn 做,围栏在那时收账。",
    files: {
      "components/otto/QuickBrief.tsx": 7,
      "components/otto/StoryboardCard.tsx": 7,
      "components/otto/TemplateModal.tsx": 1,
      "components/otto/OttoTemplates.tsx": 1,
      "components/otto/OttoDiscover.tsx": 1,
    },
  },
  {
    family: "otto-stuff",
    why: "素材库与上传弹窗:文件输入与对话框,迁移要连带 Dialog 的焦点行为一起验。",
    files: {
      "components/otto/stuff/StuffLibrary.tsx": 4,
      "components/otto/stuff/AddAssetDialog.tsx": 5,
      "components/otto/OttoStuff.tsx": 1,
    },
  },
  {
    family: "otto-schedule",
    why: "日历:单文件 19 处(月/周/日切换、日期与时间输入、条目编辑),自成一族。",
    files: { "components/otto/OttoSchedule.tsx": 19 },
  },
  {
    family: "analytics",
    why: "Analytics:#792 已裁定收敛到只留 Meta,四个 soon 空格收起 —— 等那票落地后再迁,免得迁掉马上要拆的格子。",
    files: { "components/otto/OttoAnalytics.tsx": 5 },
  },
  {
    family: "crm",
    why: "CRM 各页:#792 要把七入口折叠成一个「Customer(预览版)」入口,折叠后留下来的面才值得打磨,迁移排在那票之后。",
    files: {
      "components/crm/broadcasts/broadcast-composer-page.tsx": 4,
      "components/crm/broadcasts/broadcast-detail-page.tsx": 1,
      "components/crm/inbox/inbox-conversation-page.tsx": 1,
      "components/crm/inbox/inbox-templates-page.tsx": 1,
      "components/crm/segments-page.tsx": 1,
      "components/crm/workflows/routine-authorization-panel.tsx": 4,
      "components/crm/workflows/workflow-list-page.tsx": 1,
      "components/crm/workflows/workflow-detail-page.tsx": 1,
      "components/crm/workflows/archive-workflow-dialog.tsx": 1,
    },
  },
  {
    family: "admin",
    why: "内部后台:不是商家面,优先级最低,但同样要迁 —— 手搓 checkbox 与筛选框的无障碍缺陷在哪一侧都是缺陷。",
    files: {
      "components/admin/AdminDashboardV2.tsx": 5,
      "components/admin/SettingsAdmin.tsx": 4,
      "components/admin/TenantDetail.tsx": 3,
      "components/admin/ImpersonationBanner.tsx": 1,
    },
  },
  {
    family: "auth",
    why: "登录/注册:#840 点名的挡门高频面之一(登录),密码显隐与「换个邮箱」都是裸 button。",
    files: {
      "app/login/LoginForm.tsx": 3,
      "app/signup/SignupForm.tsx": 2,
    },
  },
  {
    family: "navigation",
    why: "主导航与沉浸壳:#840 点名的挡门高频面(主导航),手搓汉堡抽屉与页签,底座包的 sheet / tabs 对位。",
    files: {
      "components/global-navigation.tsx": 3,
      "components/northstar/immersive/immersive-shell.tsx": 2,
      "components/northstar/immersive/immersive-nav.tsx": 1,
    },
  },
  {
    family: "gen-pickers",
    why: "生成参数选择器(视频规格/图片形状):裸 <select> 花钱前最后一屏,迁 Select 时要连带 #643 的形状快照行为一起验。",
    files: {
      "components/gen/VideoSpecPicker.tsx": 3,
      "components/gen/ImageShapePicker.tsx": 1,
    },
  },
  {
    family: "asset",
    why: "资产详情面:#840 本 PR 已把 ds.tsx 的 9 颗按钮迁到 ui/Button,剩下两颗裸 <button> 是 al-iconbtn 关闭键(606)与变体缩略图切换键(659),连同 al-iconbtn 配方一起在这一族收尾。",
    files: { "components/asset/DetailPanel.tsx": 2 },
  },
];

/** 2026-08-11 实测总数,棘轮的刻度。只许调小。 */
const EXEMPT_TOTAL_BASELINE = 225;

/**
 * ══════════════════════════════════════════════════════════════════════════
 * 冻结基线 —— 2026-08-11 那一次全量扫描的原始账。这是**历史记录,一行都不许动**:
 * 不加行、不删行、数字不改。上面那块豁免板是「今天还欠多少」,会随每一族迁完而缩;
 * 这一块是「当初欠多少」,历史不会因为今天干了活就改变。
 * 下面「冻结基线自己没被动过」那条断言(60 行 / 合计 225)就是钉子:谁想靠往这里
 * 加一行来给新文件开后门,那条先红。
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

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
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
   * 第五闸只有在冻结基线本身不可动的前提下才成立 —— 否则「给新文件开后门」只需要
   * 往冻结基线里也加一行。这条断言就是那颗钉子:60 行、合计 225,一个字都不许改。
   */
  it("冻结基线自己没被动过:60 行、合计 225", () => {
    const entries = Object.entries(FROZEN_2026_08_11);
    expect(entries.length).toBe(60);
    expect(entries.reduce((sum, [, count]) => sum + count, 0)).toBe(EXEMPT_TOTAL_BASELINE);
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
