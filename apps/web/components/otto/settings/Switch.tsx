"use client";
export function Switch({ checked, onChange, "aria-label": label }: { checked: boolean; onChange: (v: boolean) => void; "aria-label": string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      className={checked ? "cv-switch on" : "cv-switch"} onClick={() => onChange(!checked)} />
  );
}
