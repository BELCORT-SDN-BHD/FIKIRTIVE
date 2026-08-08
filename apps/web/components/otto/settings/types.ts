import type { ReactNode } from "react";

// `hint` is a ReactNode, not a string (#686): a hint that tells the merchant to go
// somewhere has to be able to CARRY the link, not describe it. Plain strings still work
// everywhere they already did.
export type SettingsField =
  | { kind: "text"; id: string; label: string; hint?: ReactNode; value: string; readOnly?: boolean }
  | { kind: "toggle"; id: string; label: string; hint?: ReactNode; value: boolean; disabled?: boolean; onToggle: (v: boolean) => void | Promise<unknown> }
  | { kind: "number"; id: string; label: string; hint?: ReactNode; value: number; unit?: string; onSave: (v: number) => void | Promise<unknown> }
  | { kind: "action"; id: string; label: string; hint?: ReactNode; button: string; onClick: () => void; tone?: "default" | "danger" }
  | { kind: "custom"; id: string; render: () => ReactNode };

export type SettingsSection = {
  id: string;
  title: string;
  subtitle?: string;
  danger?: boolean;
  fields: SettingsField[];
};
