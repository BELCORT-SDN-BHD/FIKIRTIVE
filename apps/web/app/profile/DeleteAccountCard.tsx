"use client";

import { useState } from "react";

import { OttoConfirmDialog } from "@/components/otto/OttoPromptDialog";
import { SupportExit } from "@/components/exits/Exits";
import { supportMailto } from "@/lib/exits";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";

/**
 * 账号删除 —— 个人面(Personal)的唯一危险动作。
 *
 * 前端基线合并(FRONT-A1):这个按钮此前只存在于整屏的 Otto 设置面
 * (`components/otto/OttoAccount.tsx`),而新壳没有任何路由渲染那一面。两份法务页
 * (`/terms`、`/legal/data-deletion`)当时仍在告诉商家「产品里有这个按钮」——一句在产品里
 * 根本点不到的指路。按已批准的信息架构,它落在 Personal 的 Profile 页:删的是这个人的账号。
 *
 * 行为一字未改,照旧是 main 那一份:输入自己的登录邮箱二次确认 → 打开一封发给 support 的
 * 邮件。产品自己**不删任何东西**,所以这里绝不能写成「删除后立即生效」。
 */
export function DeleteAccountCard({ email }: { email: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* 已冻结的 Settings pattern §3.3:普通 setting row 是 plain row(标签 + 一句影响 +
          右侧动作),不是一张独立的 card。危险动作用 destructive 按钮表达,不靠一圈红边框。 */}
      <Field orientation="responsive">
        <FieldContent>
          <FieldTitle>Delete account</FieldTitle>
          <FieldDescription>
            Ending your workspace is a request, not a switch. Hides your workspace.{" "}
            <SupportExit subject="Erase my workspace" label="Contact us" /> to fully erase.
          </FieldDescription>
        </FieldContent>
        <Button type="button" size="sm" variant="destructive" onClick={() => setOpen(true)}>
          Delete
        </Button>
      </Field>

      <OttoConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Request account deletion?"
        description="Otto will open an email request to support. Your workspace is not erased until support handles the request."
        impacts={[
          "You can keep using the account until support confirms deletion.",
          "Billing and credit history may need to be retained for records.",
          "This does not trigger any paid provider action.",
        ]}
        confirmText={email}
        confirmLabel="Open email request"
        tone="danger"
        onConfirm={() => {
          location.assign(supportMailto("Delete my account"));
        }}
      />
    </>
  );
}

export default DeleteAccountCard;
