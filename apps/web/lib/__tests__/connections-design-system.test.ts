import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(
  new URL("../../components/otto/OttoConnections.tsx", import.meta.url),
  "utf8",
);
const loading = readFileSync(
  new URL("../../app/settings/connections/loading.tsx", import.meta.url),
  "utf8",
);
/** 姊妹骨架。两份必须画同一个外壳,所以下面拿它当基准,而不是再抄一遍字面量。 */
const settingsLoading = readFileSync(
  new URL("../../app/settings/loading.tsx", import.meta.url),
  "utf8",
);

describe("Connections design-system composition", () => {
  it("uses shadcn primitives for hierarchy, status, data and confirmation", () => {
    for (const primitive of [
      "Alert",
      "AlertDialog",
      "Badge",
      "Button",
      "Card",
      "Separator",
      "Skeleton",
      "Spinner",
      "Table",
      "ToggleGroup",
    ]) {
      expect(component, `${primitive} is missing`).toContain(primitive);
    }
    expect(component).toContain("<AlertDialogTitle>Disconnect Meta?</AlertDialogTitle>");
  });

  it("keeps human connection actions neutral and reserves coral for Otto identity", () => {
    expect(component).not.toContain('variant="otto"');
    expect(component).toContain('variant="otto-soft"');
    expect(component).toContain("Otto control");
  });

  it("uses the icon library and removes the old one-off styling language", () => {
    expect(component).not.toContain("<svg");
    expect(component).not.toContain("style={{");
    expect(component).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  // 第⑦段(FRONT-A11)判官 [P2-2]:这条钉的一直是「骨架和真页面画的是同一个外壳」。
  // 真页面已经从两栏 Card 布局搬到 `SettingsShell`(页头一整条、左轨 220px、内容列自己滚),
  // 所以继续钉旧的 `max-w-6xl` / `lg:grid-cols-` / Card,就是拿旧围栏顶住新的设计权威。
  // 要钉的事没松,反而更紧:改成拿**姊妹骨架** `app/settings/loading.tsx` 当基准逐块比对,
  // 两份骨架从此不可能各自漂移;退役外壳的记号则反向禁止。
  it("keeps the route skeleton aligned with the SettingsShell geometry", () => {
    const headerBand = '<div className="shrink-0 border-b border-border px-5 py-6 sm:px-7">';
    const rail =
      '<div className="shrink-0 border-b border-border px-4 py-6 lg:w-[220px] lg:border-b-0 lg:border-r">';
    for (const [name, block] of [["页头一整条", headerBand], ["220px 左轨", rail]] as const) {
      expect(settingsLoading, `姊妹骨架自己就没有${name},基准失效`).toContain(block);
      expect(loading, `Connections 骨架缺${name}`).toContain(block);
    }
    // 内容列自己滚,不是整页滚。
    expect(loading).toContain("overflow-y-auto");
    expect(loading).toContain("flex h-full min-w-0 flex-col overflow-hidden");
    // 退役外壳的记号一个都不许留下。
    for (const retired of ['from "@/components/ui/card"', "max-w-6xl", "lg:grid-cols-", "min-h-dvh"]) {
      expect(loading, `骨架还留着换皮前的 ${retired}`).not.toContain(retired);
    }
    expect(loading).not.toContain("style={{");
  });
});
