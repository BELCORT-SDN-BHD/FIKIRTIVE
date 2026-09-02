"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Laptop, Moon, Sun } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Wire ④ of the ticket's own list (#804) — the control that gives the merchant the choice.
 *
 * Three named choices, not a two-state switch: "System" has to stay reachable, because it is
 * the default every merchant starts on and the only one that keeps following the device as it
 * changes (a phone that darkens at sunset). A two-state toggle can leave System but never
 * return to it, which quietly turns a live preference into a stale snapshot.
 *
 * A <Select> rather than a menu because that is what this is — one value out of three, with
 * the current one on the face of the control. Radix gives the listbox semantics, the arrow
 * keys, the type-ahead and Escape for free (#840: shadcn/ui is the base, never a hand-rolled
 * `role="menu"` div).
 */

/** `theme` is the merchant's choice, which is why "system" is a value here and not a state. */
const THEMES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Laptop },
] as const;

/** A store that never changes: false while rendering on the server, true once hydrated. */
const NEVER_CHANGES = () => () => {};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  /**
   * The server cannot know which theme this device has stored, and next-themes reads
   * localStorage during its very first client render — so server markup and first client
   * markup disagree by construction. `useSyncExternalStore` is React's own answer: it hands
   * back the server snapshot (false) for the render that has to match, then the client one
   * (true). The row keeps its size either way, so nothing shifts when the real value lands.
   */
  const mounted = useSyncExternalStore(NEVER_CHANGES, () => true, () => false);

  return (
    <>
      <div className="flex flex-1 flex-col gap-1">
        <span id="appearance-label" className="text-sm font-medium">Appearance</span>
        <span className="text-sm text-muted-foreground">Light, dark, or follow your device.</span>
      </div>
      <Select value={mounted ? (theme ?? "system") : undefined} onValueChange={setTheme}>
        <SelectTrigger aria-labelledby="appearance-label" className="w-[150px]">
          <SelectValue placeholder="System" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {THEMES.map(({ value, label, Icon }) => (
              <SelectItem key={value} value={value}>
                <Icon aria-hidden />
                {label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </>
  );
}
