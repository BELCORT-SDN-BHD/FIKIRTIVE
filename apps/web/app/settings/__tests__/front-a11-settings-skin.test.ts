/**
 * FRONT-A11 第⑦段(Settings / Billing 换皮)—— Settings 四面共用的外壳这一半。
 *
 * 规格:`docs/specs/frontend-baseline.md` §2 FRONT-A11。设计权威是已冻结的 Settings screen
 * pattern(`design-system/patterns/settings/README.md`,Founder approved and frozen 2026-08-31)
 * 与它的夹具 `SettingsReference.tsx`。这一段只换外观,所以围栏钉的是几件**看得见的几何与
 * 结构**,而不是逐个 class 抄一遍(那种断言只会锁死重构,不保护任何商家):
 *
 *  ① 页头在最上面一整条,不缩在内容列里 —— 夹具的 `<header className="shrink-0 border-b …">`。
 *  ② 左轨 220px,两个 scope group 之间一条分隔线。
 *  ③ 左轨不再自己写一行 "Settings" 标题(README §2:标题跟随 active destination,
 *     `Settings` 只留在 shell context)。
 *  ④ 四面的表单是裸表单 —— Settings pattern §3.3「默认使用 plain rows / forms,
 *     不堆独立 marketing cards」。
 */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const WEB_ROOT = path.resolve(__dirname, "../../..")
const source = (relativePath: string) => fs.readFileSync(path.join(WEB_ROOT, relativePath), "utf8")

const SHELL = source("components/settings/SettingsShell.tsx")

/** 注释里写着 Card 是历史叙述,不是屏幕上的东西 —— 判定前先剥掉。 */
const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")

describe("FRONT-A11 Settings 外壳与四面的换皮", () => {
  it("FRONT-A11:页头是最上面一整条,左轨 220px,内容列自己滚", () => {
    expect(SHELL, "页头不是 shell 顶上那一条").toMatch(/<header className="shrink-0 border-b border-border/)
    expect(SHELL, "左轨不是夹具的 220px").toContain("lg:w-[220px]")
    expect(SHELL, "两个 scope group 之间没有分隔线").toContain("mt-7 border-t border-border pt-6")
    expect(SHELL, "内容列没有自己的滚动区").toContain("overflow-y-auto")
  })

  it("FRONT-A11:左轨不再自己写一行 Settings 标题(标题跟随 active destination)", () => {
    expect(stripComments(SHELL)).not.toMatch(/>\s*Settings\s*</)
  })

  it("FRONT-A11:四面的表单是裸表单,不套 marketing card", () => {
    for (const route of ["app/settings/page.tsx", "app/profile/page.tsx", "app/billing/page.tsx"]) {
      const code = stripComments(source(route))
      expect(code, `${route} 还在套 Card`).not.toMatch(/<Card[\s>]/)
      expect(code, `${route} 还在 import Card`).not.toContain('from "@/components/ui/card"')
    }
    // 上限控件与删除账号本体也一起脱掉了那层壳。
    for (const leaf of ["app/billing/SpendCapCard.tsx", "app/profile/DeleteAccountCard.tsx"]) {
      expect(stripComments(source(leaf)), `${leaf} 还在套 Card`).not.toMatch(/<Card[\s>]/)
    }
  })

  it("FRONT-A11:每一面都说清楚这次改动影响谁", () => {
    expect(source("app/profile/page.tsx")).toContain("Changes here affect only your account.")
    for (const workspaceRoute of [
      "app/settings/page.tsx",
      "app/settings/connections/page.tsx",
      "app/billing/page.tsx",
    ]) {
      expect(source(workspaceRoute), workspaceRoute).toContain("Changes affect everyone in this workspace.")
    }
  })

  it("FRONT-A11:改名走的仍是 main 的真动作,不是换皮时新写的一条路径", () => {
    const form = source("app/profile/ProfileNames.tsx")
    expect(form).toContain("updateDisplayName")
    expect(form).toContain("updateWorkspaceName")
    // 只有一个明确的 Save changes(Settings pattern §3.4);不在 blur / keystroke 上写。
    expect(form).toContain("Save changes")
    expect(form).not.toContain("onBlur")
  })
})
