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
  // 四扇门的等待画面同理:它们是商家真的会看见的一屏,只是活得短。
  "app/approvals/loading.tsx",
  "app/billing/loading.tsx",
  "app/create/loading.tsx",
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
    expect(text, `${relative}: use Dialog/Tabs/Switch/Menu primitives`).not.toMatch(/role=["'](?:dialog|tab|tablist|switch|menu|menuitem)["']/);
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
