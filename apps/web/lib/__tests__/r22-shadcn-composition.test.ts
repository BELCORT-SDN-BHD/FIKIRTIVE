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
  "components/otto-iq/R22OttoIQView.tsx",
  "components/approvals/R22ApprovalsView.tsx",
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
    expect(approvals).toContain("<ToggleGroup");
    expect(approvals).toContain("<RadioGroup");
    expect(approvals).toContain("<Checkbox");
    expect(onboarding).toContain("<ToggleGroup");
    expect(onboarding).toContain("<Switch");
    expect(help).toContain("<Checkbox");
    expect(conversation).toContain("<MessageScrollerProvider");
    expect(conversation).toContain("<MessageScrollerItem");
    expect(conversation).toContain("<Message");
    expect(conversation).toContain("<Bubble");
  });
});
