"use client";

import { useState } from "react";
import Link from "next/link";

import { OttoConfirmDialog } from "@/components/otto/OttoPromptDialog";
import { SupportExit } from "@/components/exits/Exits";
import { supportMailto } from "@/lib/exits";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldTitle } from "@/components/ui/field";

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
 *
 * 文案四要素(Founder 2026-09-04 20:45 拍板原话:「删账号 → beta 先改诚实文案。写清这是给客服的
 * 请求、删什么、留什么、多久处理;自助删除另立规格」):这一屏必须写清 ① 这是给客服的请求、
 * ② 删什么、③ 留什么、④ 多久。围栏在 `__tests__/delete-account-honesty.test.tsx`。
 *
 * ④ 里的「留多久」只有一个产地。备份保留窗口那个数字写在 `/legal/data-deletion`
 * (「a snapshot more than about 30 days old is deleted during a later backup run」),这里
 * **链过去**而不是把天数再抄一遍 —— 两处各写一个数字,迟早会各说各的(§7.3)。
 * 「客服多久处理完」今天没有权威来源(没有已定的客服 SLA),所以这里不编一个天数:写的是能指着
 * 的实话 —— 没有自动删除,由人处理,处理完发邮件通知,在那之前账号照常能用。
 * 待办已登记在 `docs/specs/frontend-baseline.md` §5(自助删除另立规格,SLA 待 Founder 定)。
 */
export function DeleteAccountCard({ email }: { email: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* 已冻结的 Settings pattern §3.3:普通 setting row 是 plain row(标签 + 一句影响 +
          右侧动作),不是一张独立的 card。危险动作用 destructive 按钮表达,不靠一圈红边框。 */}
      <FieldGroup>
        <Field orientation="responsive">
          <FieldContent>
            <FieldTitle>Delete account</FieldTitle>
            <FieldDescription>
              Ending your workspace is a request to our support team, not a switch. Nothing is
              deleted automatically: a person handles your request and emails you when it is done,
              and your billing and credit history stay on record.{" "}
              <SupportExit subject="Erase my workspace" label="Contact us" /> to fully erase, or
              read{" "}
              <Link href="/legal/data-deletion" className="underline underline-offset-4">
                how long deleted records are kept
              </Link>
              .
            </FieldDescription>
          </FieldContent>
          <Button type="button" size="sm" variant="destructive" onClick={() => setOpen(true)}>
            Delete
          </Button>
        </Field>
      </FieldGroup>

      <OttoConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Request account deletion?"
        description="Otto will open an email request to support. Your workspace is not erased until support handles the request."
        impacts={[
          "This opens an email to support. Nothing is deleted automatically, and you can keep using the account until support confirms deletion.",
          "What goes: your workspace and the work inside it, once support handles the request.",
          "What stays: billing and credit history, and audit records — they are the account of what was spent and what was done.",
          "How long: there is no automated deletion, so a person handles it and emails you when it is done. Deleted records can still sit in backups afterwards — the Data deletion page says for how long.",
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
