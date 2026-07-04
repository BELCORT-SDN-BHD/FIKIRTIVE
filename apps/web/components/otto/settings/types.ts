import type { ReactNode } from "react";

export type SettingsField =
  | { kind: "text"; id: string; label: string; hint?: string; value: string; readOnly?: boolean }
  | { kind: "toggle"; id: string; label: string; hint?: string; value: boolean; disabled?: boolean; onToggle: (v: boolean) => void | Promise<unknown> }
  | { kind: "number"; id: string; label: string; hint?: string; value: number; unit?: string; onSave: (v: number) => void | Promise<unknown> }
  | { kind: "action"; id: string; label: string; hint?: string; button: string; onClick: () => void; tone?: "default" | "danger" }
  | { kind: "custom"; id: string; render: () => ReactNode };

export type SettingsSection = {
  id: string;
  title: string;
  subtitle?: string;
  danger?: boolean;
  fields: SettingsField[];
};
