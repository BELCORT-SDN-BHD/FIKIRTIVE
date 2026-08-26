import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");

const R22_SURFACES = [
  "app/login/LoginForm.tsx",
  "app/signup/SignupForm.tsx",
  "app/forgot-password/ForgotPasswordForm.tsx",
  "app/reset-password/ResetPasswordForm.tsx",
  "app/verify-email/VerifyEmailLanding.tsx",
  "components/r22/R22DashboardShell.tsx",
  "components/home/HomeView.tsx",
  "components/projects/R22ProjectsView.tsx",
  // 建项目那一层从七格表单换成 Otto 开局对话框之后自成一个文件 —— 上面那段话说的正是
  // 这件事:新文件不上名单,四条通用围栏一条也扫不到它。
  "components/projects/ProjectStartDialog.tsx",
  "components/canvas/R22CanvasSurface.tsx",
  "components/library/R22LibraryView.tsx",
  // Library 从「陈列柜」重建成工作台之后一个组件画不下整面,拆成了壳 + 二级导航 + 工具排 +
  // 卡 + 详情层 + 素材包层。上面那段话说的正是这件事:拆出来的每一个文件都要自己上名单,
  // 否则这几条通用围栏一条也扫不到它们,而这种漏是静默的。
  "components/library/LibraryWorkroom.tsx",
  "components/library/LibraryNav.tsx",
  "components/library/LibraryToolbar.tsx",
  "components/library/LibraryCard.tsx",
  "components/library/LibraryDetailLayer.tsx",
  "components/library/LibraryPackDialog.tsx",
  // 仓库里的快产车间是后加的第七个文件,上一版没跟着上名单 —— 上面那段话说的正是这件事,
  // 而它自己就漏了一次:一整条生成条(输入、分段控件、参数弹层、问题卡单选组)从头到尾
  // 没被这几条围栏扫过。
  "components/library/LibraryQuickCreate.tsx",
  // 单图编辑层是 Creation 终章拆出来的第八个文件,两面(Library 详情、画布逐图动作排)开的
  // 都是它 —— 上面那段话说的正是这件事:新文件不上名单,四条通用围栏一条也扫不到它。
  "components/library/ImageEditLayer.tsx",
  // 起手模板那一排同理:它住在 components/creation/,是画布与 Library 共用的第一个组件。
  "components/creation/CreationTemplateRow.tsx",
  "components/otto-iq/R22OttoIQView.tsx",
  // Approvals 八件升级之后一个组件画不下整面,拆成了壳 + 卡 + 详情 + 时间线 + 改版流。
  // 这几条通用围栏(禁裸交互元素、禁手搓语义、DialogTitle 配对、分组组件)是**逐文件**跑的,
  // 只扫这份名单里点名的路径 —— 拆出来的每一个新文件都必须自己上名单,否则那几条规则
  // 覆盖不到它们,而这种漏是静默的。
  "components/approvals/R22ApprovalsView.tsx",
  "components/approvals/ApprovalCard.tsx",
  // v2 皮肤又拆出一个:点开一张图之后的审阅层。上面那段话说的正是这件事 ——
  // 新文件不上名单,四条通用围栏就一条也扫不到它。
  "components/approvals/ApprovalLayer.tsx",
  "components/approvals/ApprovalDetail.tsx",
  "components/approvals/ApprovalTimeline.tsx",
  "components/approvals/ApprovalThumb.tsx",
  "components/approvals/ReviseFlow.tsx",
  "components/notifications/R22NotificationsView.tsx",
  "components/help/R22HelpView.tsx",
  "components/onboarding/R22Onboarding.tsx",
  "components/routines/R22RoutinesView.tsx",
  "components/settings/R22SettingsShell.tsx",
  "components/schedule/schedule-surface.tsx",
  "components/schedule/r22-schedule-composer.tsx",
  "components/schedule/analytics-surface.tsx",
  "components/campaign/campaign-list-page.tsx",
  "components/campaign/campaign-workbench-page.tsx",
  "components/campaign/campaign-confirm-page.tsx",
  "components/campaign/campaign-detail-page.tsx",
  "components/campaign/campaign-trends-page.tsx",
  "components/otto/panel/OttoPanelConversation.tsx",
  "components/otto/panel/OttoThreadList.tsx",
  // 面板四子流那一波拆出来的两个新面 —— 上面那段注释说的正是这件事,而它上一版没有
  // 兑现:切换器与答案卡从 `OttoPanelHost` / `OttoPanelConversation` 里分出去自成文件,
  // 名单没跟着长,四条通用围栏就一条也扫不到它们了。
  "components/otto/panel/OttoRoomSwitcher.tsx",
  "components/otto/panel/OttoAnswerCard.tsx",
  // 「线程即工作台」拆出来的共用对话零件(2026-08-26)。上面那段注释说的正是这件事:
  // 三处问答卡从此引用**同一份**实现,那一份必须自己上名单 —— 否则四条通用围栏一条也
  // 扫不到全站每一张问答卡真正的画法,而这种漏是静默的。
  "components/otto/conversation/ConversationParts.tsx",
  "components/otto/conversation/OttoResearchCard.tsx",
  // 四扇门的等待画面同理:它们是商家真的会看见的一屏,只是活得短。
  "app/approvals/loading.tsx",
  "app/billing/loading.tsx",
  "app/create/loading.tsx",
  // Library 的等待画面 2026-08-26 从「880px 单栏六方块」重画成落定页真的那副双栏骨架,
  // 一并补进名单 —— 上面那段话说的正是这件事:不上名单,四条通用围栏一条也扫不到它。
  "app/library/loading.tsx",
  "app/routines/loading.tsx",
] as const;

function source(relative: string): string {
  return fs.readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

describe("R22 desktop surfaces use the repository shadcn composition contract", () => {
  it.each(R22_SURFACES)("%s has no native interactive-control escape hatch", (relative) => {
    const text = source(relative);
    expect(text, relative).not.toMatch(/<(?:button|input|select|textarea|dialog)(?:\s|>)/);
  });

  it.each(R22_SURFACES)("%s does not hand-roll component semantics", (relative) => {
    const text = source(relative);
    // `radio` / `radiogroup` 是 2026-08-26 加进来的(Founder:全部 UI 严格用 shadcn)——
    // 一排普通按钮配这两个 role,屏幕上是一组单选、用起来不是,除非把方向键循环、焦点
    // 跟随、Tab 只占一站那一整套自己再写一遍。写第二遍不是错,是**第二份**:两份键盘
    // 行为迟早分家,而分家只有用键盘的人碰得到。
    // `toolbar` 是 2026-08-26 跟着画布那一轮加进来的,理由与 `radio` / `radiogroup` 同一条:
    // 一排普通按钮配 `role="toolbar"` + 一排 `aria-pressed`,屏幕上是一条工具条、用起来
    // 不是 —— 方向键在组内循环、Tab 只占一站、按下的那一颗才是焦点,这一整套得自己再写
    // 一遍。写第二遍不是错,是**第二份**。归位的去处是 `ToggleGroup`(一组里挑一个,
    // 它出的是 radiogroup 语义)或 `ButtonGroup`(一组各自独立的动作)。
    expect(text, `${relative}: use Dialog/Tabs/Switch/Menu/RadioGroup/ToggleGroup primitives`).not.toMatch(/role=["'](?:dialog|tab|tablist|switch|menu|menuitem|radio|radiogroup|toolbar)["']/);
    expect(text, `${relative}: use Separator`).not.toMatch(/<hr(?:\s|\/?>)/);
    expect(text, `${relative}: use gap utilities`).not.toMatch(/\bspace-[xy]-/);
    expect(text, `${relative}: use Checkbox or RadioGroup`).not.toMatch(/<Input\b[^>]*\btype=["'](?:checkbox|radio)["']/);
  });

  it("keeps every DialogContent named", () => {
    for (const relative of R22_SURFACES) {
      const text = source(relative);
      const contentCount = text.match(/<DialogContent\b/g)?.length ?? 0;
      const titleCount = text.match(/<DialogTitle\b/g)?.length ?? 0;
      expect(titleCount, `${relative}: every DialogContent needs DialogTitle`).toBeGreaterThanOrEqual(contentCount);
    }
  });

  it("keeps grouped items inside their shadcn group components", () => {
    for (const relative of R22_SURFACES) {
      const text = source(relative);
      if (text.includes("<SelectItem")) expect(text, `${relative}: SelectItem requires SelectGroup`).toContain("<SelectGroup");
      if (text.includes("<DropdownMenuItem")) expect(text, `${relative}: DropdownMenuItem requires DropdownMenuGroup`).toContain("<DropdownMenuGroup");
      if (text.includes("<TabsTrigger")) expect(text, `${relative}: TabsTrigger requires TabsList`).toContain("<TabsList");
    }
  });

  it("uses shadcn option, switch, selection and chat primitives for the R22 interaction-heavy flows", () => {
    const projects = source("components/projects/R22ProjectsView.tsx");
    const approvals = source("components/approvals/R22ApprovalsView.tsx");
    const onboarding = source("components/onboarding/R22Onboarding.tsx");
    const help = source("components/help/R22HelpView.tsx");
    const conversation = source("components/otto/panel/OttoPanelConversation.tsx");

    expect(projects).toContain("<TabsList");
    // 问题卡是一组**真**单选:不许一排普通按钮加 `role="radio"` 手搓(键盘行为会跟着一起
    // 手搓,而且迟早不一致)。
    //
    // 2026-08-26「线程即工作台」之后,这条断言的落点跟着实现走:Create 弹窗、画布与 Otto
    // 线程三处的选项列表收编成**同一份**零件(`ConversationParts` 的 `AskOptions`),所以
    // 「这是真单选」这句话钉在那一份上,三个调用点各钉「引用的是那一份」。断言的意思没变
    // ——变的是它该指着谁:继续在调用点上扫 `<RadioGroup`,只会把一条已经不指认任何东西的
    // 断言留在这里。Library 快产车间还没收编,照旧自己画,断言也照旧钉在它自己身上。
    expect(source("components/otto/conversation/ConversationParts.tsx"), "共用问答零件必须是真 RadioGroup").toContain("<RadioGroup");
    expect(source("components/projects/ProjectStartDialog.tsx"), "Create 弹窗的问题卡要用共用零件").toContain("<AskOptionCard");
    expect(source("components/library/LibraryQuickCreate.tsx")).toContain("<RadioGroup");
    // 2026-08-26 第 2 件之后,画布那张问题卡整张走共用问卷零件 —— 单选、多选、题号、
    // Previous/Skip/Next 与字母角标全在那一份里。所以这两条断言跟着实现走:
    // 「画布用的是共用零件」钉在画布上,「多选是真 Checkbox」钉在**现在真的画它**的那一份上。
    // 继续在画布上扫 `<Checkbox`,只会把一条已经不指认任何东西的断言留在这里。
    const canvas = source("components/canvas/R22CanvasSurface.tsx");
    expect(canvas, "画布的问题卡要用共用问卷零件").toContain("<QuestionnaireCard");
    expect(source("components/otto/conversation/ConversationParts.tsx"), "共用问卷的多选要用真 Checkbox").toContain("<Checkbox");
    // 2026-08-26 画布一轮:五个手搓的 absolute 弹层(切项目 / 附件 / 素材库 / 参数 /
    // 选素材包)全部归位。判词按形状分:一串**动作**是 menu(上下键 + 首字母跳),
    // 任意**内容**是 popover。手搓的那五层只有 Esc 一条关闭路径,点外面不会关。
    expect(canvas, "画布的弹层要用 Popover(任意内容)").toContain("<Popover");
    expect(canvas, "画布的动作菜单要用 DropdownMenu(带键盘模型)").toContain("<DropdownMenu");
    // 工具条 / 比例 / 张数 / 图还是视频 —— 四组「一组里挑一个」全归 ToggleGroup;
    // 缩放条那五颗是一组各自独立的动作,归 ButtonGroup。
    expect(canvas, "画布的成组单选要用 ToggleGroup").toContain("<ToggleGroup");
    expect(canvas, "画布的缩放条要用 ButtonGroup").toContain("<ButtonGroup");
    // 单图编辑层那六个风格预设同理 —— 它是最后一份手搓 roving,2026-08-26 一起归位。
    expect(source("components/library/ImageEditLayer.tsx")).toContain("<RadioGroup");
    // 这条钉的是「Approvals 这些控件是 shadcn 的,不是手搓的」。八件升级把这一面拆成了
    // 五个文件,于是每个 primitive 钉在**现在真的画它的那个文件**上:筛选留在壳里,
    // 勾选跟着卡走,理由单选跟着改版流走。写成「任意一个 approvals 文件里出现过」会让
    // 这条断言从此不再指认任何东西。
    expect(approvals).toContain("<ToggleGroup");
    expect(approvals).toContain("<Tabs");
    expect(source("components/approvals/ApprovalCard.tsx")).toContain("<Checkbox");
    expect(source("components/approvals/ApprovalDetail.tsx")).toContain("<TabsList");
    expect(source("components/approvals/ReviseFlow.tsx")).toContain("<RadioGroup");
    expect(source("components/approvals/ReviseFlow.tsx")).toContain("<Textarea");
    expect(onboarding).toContain("<ToggleGroup");
    expect(onboarding).toContain("<Switch");
    expect(help).toContain("<Checkbox");
    expect(conversation).toContain("<MessageScrollerProvider");
    expect(conversation).toContain("<MessageScrollerItem");
    expect(conversation).toContain("<Message");
    expect(conversation).toContain("<Bubble");
  });
});
