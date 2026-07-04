"use client";
import { useState } from "react";
export function Switch({ checked, onChange, disabled, "aria-label": label }: {
  checked: boolean;
  onChange: (v: boolean) => void | Promise<unknown>;
  disabled?: boolean;
  "aria-label": string;
}) {
  const [on, setOn] = useState(checked);
  const toggle = async () => {
    if (disabled) return;
    const next = !on;
    setOn(next); // optimistic
    try {
      const res = await onChange(next);
      if (res && typeof res === "object" && "error" in res) setOn(!next); // revert on {error}
    } catch {
      setOn(!next); // revert on throw
    }
  };
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label}
      className={on ? "cv-switch on" : "cv-switch"} onClick={toggle} disabled={disabled} />
  );
}
