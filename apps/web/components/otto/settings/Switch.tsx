"use client";
import { useState, useEffect } from "react";
export function Switch({ checked, onChange, "aria-label": label }: {
  checked: boolean;
  onChange: (v: boolean) => void | Promise<unknown>;
  "aria-label": string;
}) {
  const [on, setOn] = useState(checked);
  useEffect(() => { setOn(checked); }, [checked]); // server truth wins after revalidation
  const toggle = async () => {
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
      className={on ? "cv-switch on" : "cv-switch"} onClick={toggle} />
  );
}
