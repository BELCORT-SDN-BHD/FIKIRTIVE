"use client";
import { useState } from "react";
import { Switch as UiSwitch } from "@/components/ui/switch";
export function Switch({ checked, onChange, disabled, "aria-label": label }: {
  checked: boolean;
  onChange: (v: boolean) => void | Promise<unknown>;
  disabled?: boolean;
  "aria-label": string;
}) {
  const [on, setOn] = useState(checked);
  // Radix hands back the value it is about to become (it already knows `disabled`
  // means no interaction, same guard the old `if (disabled) return;` gave manually).
  const toggle = async (next: boolean) => {
    setOn(next); // optimistic
    try {
      const res = await onChange(next);
      if (res && typeof res === "object" && "error" in res) setOn(!next); // revert on {error}
    } catch {
      setOn(!next); // revert on throw
    }
  };
  return (
    <UiSwitch checked={on} onCheckedChange={toggle} disabled={disabled} aria-label={label} />
  );
}
