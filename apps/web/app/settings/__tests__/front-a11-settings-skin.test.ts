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
    // 第 1 轮判官 P1②:这条围栏原本只 grep 三个 route 源文件,而 `Spend history` 那张卡片
    // 是子组件渲染进 `/billing` 的 —— 围栏名叫「四面的表单是裸表单」,却保护不了商家在这
    // 四面上真正看见的东西。改成连 route 渲染进去的叶子组件一起钉。
    const RENDERED_INTO_THE_FOUR_SCREENS = [
      "app/settings/page.tsx",
      "app/profile/page.tsx",
      "app/billing/page.tsx",
      "app/settings/connections/page.tsx",
      // 上限控件与删除账号本体也一起脱掉了那层壳。
      "app/billing/SpendCapCard.tsx",
      "app/profile/DeleteAccountCard.tsx",
      "app/profile/ProfileNames.tsx",
      "components/billing/SpendHistory.tsx",
      "components/settings/SettingsShell.tsx",
    ]
    for (const file of RENDERED_INTO_THE_FOUR_SCREENS) {
      const code = stripComments(source(file))
      expect(code, `${file} 还在套 Card`).not.toMatch(/<Card[\s>]/)
      expect(code, `${file} 还在 import Card`).not.toContain('from "@/components/ui/card"')
    }
  })

  it("FRONT-A11:Spend history 用的是同一套 section 词汇,不是自己一张卡片", () => {
    const history = stripComments(source("components/billing/SpendHistory.tsx"))
    // 图标 + `text-base font-semibold` 标题 + 说明在盒子外面,下面才是那张表。
    expect(history, "标题不是 section 的 text-base font-semibold").toMatch(
      /<h2 className="text-base font-semibold">Spend history<\/h2>/,
    )
    expect(history, "section 图标不在标题这一行外面").toMatch(/<ReceiptText className="mt-0\.5 size-5 shrink-0"/)
    expect(history, "表格没有装进夹具那种边框盒子").toMatch(/rounded-\[var\(--radius-card\)\] border border-border/)
  })

  it("FRONT-A11:内容列里的分栏按盒子自己的宽度判断,不按视口断点", () => {
    // 第 1 轮判官 P1①:`sm:`(640px 视口)与 Settings 内容列的实际宽度是两件不相干的事 ——
    // 1100×800 且 Otto 面板打开时内容列只有 280px,视口断点照样命中,`On hold` 的 Badge 与
    // 那段冻结额说明会画到边框外面。设计系统自己的做法是容器查询(components/ui/field.tsx)。
    for (const file of [
      "app/billing/page.tsx",
      "components/billing/SpendHistory.tsx",
      "app/settings/page.tsx",
      "app/profile/page.tsx",
      "app/settings/connections/page.tsx",
      "app/billing/SpendCapCard.tsx",
      "app/profile/DeleteAccountCard.tsx",
      "app/profile/ProfileNames.tsx",
    ]) {
      const code = stripComments(source(file))
      const viewportBreakpoints = code.match(/className="[^"]*(?:^|[\s"])(?:sm|md|lg|xl):[^"]*"/g) ?? []
      expect(viewportBreakpoints, `${file} 还在用视口断点排 Settings 内容列里的东西`).toEqual([])
    }
    // 换上来的确实是容器查询,不是把断点删了了事。
    expect(source("app/billing/page.tsx")).toContain("@container/credits")
    expect(source("app/billing/page.tsx")).toContain("@sm/credits:grid-cols-2")
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
