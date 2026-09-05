import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");

function source(file: string): string {
  return fs.readFileSync(path.join(WEB_ROOT, file), "utf8");
}

describe("Billing and Settings use the shared design system", () => {
  it("composes Billing from shared alerts, empty states, badges, and buttons", () => {
    const page = source("app/billing/page.tsx");
    const button = source("components/billing/BuyPackButton.tsx");

    // 前端基线第⑦段(FRONT-A11):`/CardHeader|CardContent|CardFooter/` 那条撤了。它当初钉的
    // 是「走设计系统,不手搓」,而已冻结的 Settings screen pattern §3.3 现在明写这一面
    // 「默认使用 plain rows / forms,不堆独立 marketing cards」—— 继续要求 Card 就是拿一条
    // 旧围栏顶住新的设计权威。要钉的那件事没松:这一页仍然只由设计系统组件组成(下面几条),
    // 而「不许套 Card」由 `app/settings/__tests__/front-a11-settings-skin.test.ts` 反向钉住。
    expect(page).toMatch(/<Badge/);
    expect(page).toMatch(/<Alert|<Empty/);
    expect(button).toMatch(/<Button|<Spinner|<Alert/);
    expect(page).not.toContain("style={{");
    expect(button).not.toContain("style={{");
  });

  it("renders spend history as the shared table instead of custom row cards", () => {
    const history = source("components/billing/SpendHistory.tsx");

    expect(history).toMatch(/TableHeader|TableBody|TableRow|TableCell/);
    expect(history).toMatch(/<Empty/);
    expect(history).not.toContain("style={{");
  });

  it("composes Settings from Card, Field, Separator, and semantic status components", () => {
    const page = source("components/otto/settings/SettingsPage.tsx");
    const sections = source("components/otto/settings/sections.tsx");

    expect(page).toMatch(/CardHeader|CardContent|FieldGroup|FieldError|Separator/);
    expect(sections).toMatch(/Badge|Button|Table/);
    expect(`${page}\n${sections}`).not.toMatch(/cv-set-|style=\{\{/);
  });

  it("keeps every theme option inside SelectGroup", () => {
    const toggle = source("components/theme-toggle.tsx");

    expect(toggle).toMatch(/<SelectGroup>[\s\S]*<SelectItem/);
  });
});
