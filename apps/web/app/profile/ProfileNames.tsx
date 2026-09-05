"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { updateDisplayName, updateWorkspaceName } from "@/lib/profile-actions";
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";

type SaveResult = { ok: true; name: string } | { error: string };

/** Convenience cap only — mirrors the signup form's shop-name input. The server action holds
 *  the authoritative cap and echoes back what it actually stored, so this can never be the
 *  thing that decides what lands in the database. */
const MAX_NAME_LENGTH = 80;

/**
 * #542 — one editable name with an EXPLICIT Save button, the same shape #516 settled on for
 * the spend cap: nothing is written on blur or on keystroke, Save stays disabled until the
 * value actually changed and is non-empty, and the field always ends up showing the
 * server-confirmed value (the action returns the trimmed/capped string it really stored).
 *
 * The actions are imported here rather than passed down as props: identity is resolved
 * server-side from the session, so this component has no id to hand them and cannot be
 * pointed at anybody else's row.
 */
function NameField({
  label,
  hint,
  initialValue,
  placeholder,
  autoComplete,
  onSave,
  children,
}: {
  label: string;
  hint: string;
  initialValue: string;
  placeholder: string;
  autoComplete: string;
  onSave: (value: string) => Promise<SaveResult>;
  /** 同一张表单里跟在这个字段后面、但自己不保存的只读字段(Profile 的 Email)。
   *  夹具的 Profile 是「Display name → Email → Save changes」一张表,不是两块。 */
  children?: React.ReactNode;
}) {
  const [saved, setSaved] = useState(initialValue);
  const [draft, setDraft] = useState(initialValue);
  const [status, setStatus] = useState<"saving" | "saved" | "error" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const trimmed = draft.trim();
  const dirty = trimmed !== saved.trim();
  const valid = trimmed.length > 0;
  const inputId = `profile-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty || !valid || status === "saving") return;
    setStatus("saving");
    setErrorMsg(null);
    try {
      const result = await onSave(draft);
      if ("error" in result) {
        setStatus("error");
        setErrorMsg(result.error);
        return;
      }
      // Echo back exactly what was stored — the action trims and caps the value, so the
      // field must never keep showing something the database does not have.
      setSaved(result.name);
      setDraft(result.name);
      setStatus("saved");
    } catch {
      setStatus("error");
      setErrorMsg("Could not save. Try again.");
    }
  }

  return (
    <form onSubmit={submit} className="w-full">
      <Field data-invalid={status === "error"}>
        <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
        <Input
          id={inputId}
          value={draft}
          maxLength={MAX_NAME_LENGTH}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={status === "error" ? true : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setStatus(null);
            setErrorMsg(null);
          }}
        />
        {status === "error" ? (
          <FieldError errors={[{ message: errorMsg ?? "Could not save. Try again." }]} />
        ) : (
          <FieldDescription>{hint}</FieldDescription>
        )}
      </Field>
      {children}
      {/* 已冻结的 Settings pattern §3.4:多字段 form 只有一个明确的 `Save changes`,
          结果就在原位置说,不靠 toast 冒充完成(§3.5)。夹具的动作行长这样:
          一条上边框、`pt-5`、按钮与保存回执同排。 */}
      <div className="mt-7 flex items-center gap-4 border-t border-border pt-5">
        <Button type="submit" size="sm" disabled={!dirty || !valid || status === "saving"}>
          {status === "saving" && <Spinner data-icon="inline-start" />}
          {status === "saving" ? "Saving…" : "Save changes"}
        </Button>
        {/* 判官 [P2-1]:live region 必须**常驻**。挂载它的同时才把字放进去,读屏往往
            什么都不报 —— 区域是在这一帧才出现的,变化发生在它存在之前。主干原本就是
            常驻的(`<FieldDescription role="status" aria-live="polite">` 一直在,只有
            children 在 hint 与 "Saved" 之间换),换皮不该把这条性质弄丢。所以这里只换
            children:容器一直在,保存成功那一刻变的是它装的东西。 */}
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-success"
        >
          {status === "saved" ? (
            <>
              <Check className="size-4" aria-hidden />
              Saved
            </>
          ) : null}
        </span>
      </div>
    </form>
  );
}

export function ProfileNames({ displayName, workspaceName }: { displayName: string; workspaceName: string }) {
  return (
    <FieldGroup>
      <NameField
        label="Display name"
        hint="This is how your name appears across Fikirtive."
        initialValue={displayName}
        placeholder="Your name"
        autoComplete="name"
        onSave={updateDisplayName}
      />
      {/* #680 — when the merchant has never been asked for a shop name (sign-in code and invite
          sign-ins never ask), this field is EMPTY and the placeholder asks for it. It used to
          arrive pre-filled with their email address, which read as an answer they had given. */}
      <NameField
        label={`${PRODUCT_VOCABULARY.workspace} name`}
        hint={`This name identifies the ${PRODUCT_VOCABULARY.workspace.toLowerCase()} inside Fikirtive. It does not replace your Brand context.`}
        initialValue={workspaceName}
        placeholder="Set your shop name"
        autoComplete="organization"
        onSave={updateWorkspaceName}
      />
    </FieldGroup>
  );
}

export function DisplayNameField({
  displayName,
  children,
}: {
  displayName: string;
  children?: React.ReactNode;
}) {
  return (
    <FieldGroup>
      <NameField
        label="Display name"
        hint="This is how your name appears across Fikirtive."
        initialValue={displayName}
        placeholder="Your name"
        autoComplete="name"
        onSave={updateDisplayName}
      >
        {children}
      </NameField>
    </FieldGroup>
  );
}

export function WorkspaceNameField({ workspaceName }: { workspaceName: string }) {
  return (
    <FieldGroup>
      <NameField
        label={`${PRODUCT_VOCABULARY.workspace} name`}
        hint={`This name identifies the ${PRODUCT_VOCABULARY.workspace.toLowerCase()} inside Fikirtive. It does not replace your Brand context.`}
        initialValue={workspaceName}
        placeholder="Set your shop name"
        autoComplete="organization"
        onSave={updateWorkspaceName}
      />
    </FieldGroup>
  );
}
