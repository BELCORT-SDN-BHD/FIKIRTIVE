"use client";

import { NumberField } from "@/components/otto/settings/SettingsPage";
import { setOwnerSetting } from "@/lib/owner-settings-actions";
import { SPEND_CAP_HINT } from "@/lib/credit-format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";

/**
 * 花费上限 —— 商家自己给单次动作设的天花板(#524、MONEY 规格 A2 一族)。
 *
 * 前端基线合并(FRONT-A1):换壳之前这个控件住在整屏的 Otto 设置面
 * `components/otto/OttoAccount.tsx`。新壳把 Settings 拆成四面之后那一面没有任何路由渲染,
 * 于是上限成了一个**只有服务端还在执行、商家却看不见也改不了**的规则 —— 拒绝照旧发生,
 * 商家却无处知道是谁拒的。它跟着它所限制的那个数字搬到 Billing & credits:余额在这一页,
 * 上限也在这一页。
 *
 * 控件本体是 `NumberField`,不是新写的 input:空值 / 负数 / 小数一律不保存、0 一律显示
 * 「No cap set」而不是一个可编辑的 0、取消上限要走独立的二次确认 —— 这四条每一条都在
 * `lib/__tests__/account-settings.test.ts` 里有自己的围栏,重写一个新输入框就是把它们全部
 * 绕过去。写入走 `setOwnerSetting`(服务端仍然独立校验整数与非负)。
 */
export function SpendCapCard({ spendCapCredits }: { spendCapCredits: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Spend cap</CardTitle>
        <CardDescription>
          Your own ceiling on a single action. It never spends anything — it only refuses.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup className="gap-0">
          <NumberField
            field={{
              kind: "number",
              id: "cap",
              label: "Spend cap",
              hint: SPEND_CAP_HINT,
              value: spendCapCredits,
              unit: "credits",
              onSave: (value) => setOwnerSetting("spendCapCredits", value),
            }}
          />
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

export default SpendCapCard;
