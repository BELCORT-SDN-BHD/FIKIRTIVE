/**
 * 换壳后 Settings 四面的收口围栏。
 *
 * 前端基线合并 FRONT-A1(改动理由,判官 P0):这份围栏此前只有**否定**的一半——它钉住
 * 「/settings 的 General 不许长出 spend cap、不许复活 OttoAccount」,却没有任何一条说那两块
 * 该落在哪。合并之后的实际结果是它们哪儿都没落:整屏的 Otto 设置面
 * (components/otto/OttoAccount.tsx)没有任何路由渲染,余额、持有、花费上限、账号删除
 * 四块一起从商家面前消失,而服务端照旧按上限拒绝动作——商家被拒了,却无处知道是谁拒的。
 *
 * 「钱的行为以 main 为准,页面长相以新前端为准」:所以否定的一半一个字不动(General 仍然
 * 不许出现这些),另外补上肯定的一半——花费上限必须真的出现在 Billing & credits 上、必须
 * 可编辑、必须走 main 那条写入路径;账号删除必须真的出现在 Personal 的 Profile 上。
 */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { SETTINGS_SECTIONS, SHELL_ROUTES } from "@fikirtive/core/navigation"

const WEB_ROOT = path.resolve(__dirname, "../..")
const source = (relativePath: string) => fs.readFileSync(path.join(WEB_ROOT, relativePath), "utf8")

describe("Settings Phase 4 production convergence", () => {
  it("keeps the four approved destinations in the navigation authority", () => {
    expect(SETTINGS_SECTIONS.map(({ key, label, href, scope }) => ({ key, label, href, scope }))).toEqual([
      { key: "profile", label: "Profile", href: SHELL_ROUTES.profile, scope: "Personal" },
      { key: "general", label: "General", href: SHELL_ROUTES.preferences, scope: "Workspace" },
      { key: "connections", label: "Connections", href: SHELL_ROUTES.connections, scope: "Workspace" },
      { key: "billing", label: "Billing & credits", href: SHELL_ROUTES.billing, scope: "Workspace" },
    ])
  })

  it("uses one shared production shell on every formal route", () => {
    for (const route of [
      "app/profile/page.tsx",
      "app/settings/page.tsx",
      "app/settings/connections/page.tsx",
      "app/billing/page.tsx",
    ]) {
      const page = source(route)
      expect(page, route).toContain('from "@/components/settings/SettingsShell"')
      expect(page, route).toContain("<SettingsShell")
      expect(page, route).not.toContain("design-system/patterns/settings")
    }
  })

  it("separates personal identity from workspace identity", () => {
    const profile = source("app/profile/page.tsx")
    const general = source("app/settings/page.tsx")

    expect(profile).toContain("<DisplayNameField")
    expect(profile).not.toContain("<WorkspaceNameField")
    expect(profile).toContain("names.email")
    expect(general).toContain("<WorkspaceNameField")
    expect(general).not.toContain("<DisplayNameField")
    expect(general).toContain("Changes affect everyone in this workspace.")
  })

  it("does not revive the retired legacy Settings account surface", () => {
    const general = source("app/settings/page.tsx")
    expect(general).not.toContain("OttoAccount")
    expect(general).not.toMatch(/Schedule|Publishing|Automation|spend cap/i)
  })

  it("puts the spend cap on Billing & credits, editable, on main's own write path", () => {
    const billing = source("app/billing/page.tsx")
    expect(billing, "Billing 页没有挂上限控件").toContain("<SpendCapCard")
    expect(billing, "上限的当前值必须真的读出来,不能渲染一个假的 0").toContain("getOwnerSettings")

    const card = source("app/billing/SpendCapCard.tsx")
    // 写入走 main 的动作,不是新写的一条路径。
    expect(card).toContain('setOwnerSetting("spendCapCredits"')
    // 控件本体是被测过的 NumberField(空值/负数/小数不保存、0 显示 No cap set、取消上限
    // 二次确认),不是一个新手写的 input——重写就等于把那四条围栏全绕过去。
    expect(card).toContain("NumberField")
    expect(card).toContain('from "@/components/otto/settings/SettingsPage"')
  })

  it("puts account deletion on Personal, and it still only opens an email", () => {
    const profile = source("app/profile/page.tsx")
    expect(profile).toContain("<DeleteAccountCard")

    const card = source("app/profile/DeleteAccountCard.tsx")
    // 二次确认输的是自己的登录邮箱,产品自己不删任何东西——两条都是 main 的行为。
    expect(card).toContain("confirmText={email}")
    expect(card).toContain('supportMailto("Delete my account")')
    // 产品自己不删任何东西:这个组件不许碰数据库,也不许调任何删除动作。
    expect(card).not.toMatch(/prisma|@fikirtive\/db/i)
    expect(card).not.toMatch(/deleteAccount\(|deleteOrganization|deleteUser/)
  })

  it("leaves no merchant-facing money control stranded on an unmounted surface", () => {
    // 判官 P0 的根:OttoAccount 没有任何路由渲染。它作为 main 的被测实现暂时留着(整块退役
    // 是另一张票),但它承重的两块必须已经各有真正的家——上面两条钉的就是那两个家。
    const mounted = ["app/billing/page.tsx", "app/profile/page.tsx", "app/settings/page.tsx", "app/settings/connections/page.tsx"]
      .map(source)
      .join("\n")
    expect(mounted).toContain("SpendCapCard")
    expect(mounted).toContain("DeleteAccountCard")
  })

  it("keeps Billing on real balances, packs, checkout status and spend history", () => {
    const billing = source("app/billing/page.tsx")
    for (const truth of ["getMyAccount", "listCreditPacks", "getSpendOverview", "BuyPackButton", "SpendHistory"]) {
      expect(billing).toContain(truth)
    }
    expect(billing).not.toMatch(/payment method|invoice|subscription plan/i)
  })
})
