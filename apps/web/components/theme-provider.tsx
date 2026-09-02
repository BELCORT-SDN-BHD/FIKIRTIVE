"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Wire ① of the §K3 activation contract (#804) — the thing that makes the `.gb.dark`
 * token block, which has existed and been contrast-audited for months, stop being dead
 * code. Nothing set `class="dark"` before this; next-themes was already a dependency,
 * mounted nowhere, and the previous Sonner wrapper was the only code reading `useTheme()` (getting the
 * hard-coded "system" fallback every time).
 *
 * Settings, and why each one:
 *  - `attribute="class"`   the class the §K3 selectors key on. next-themes writes it on
 *                          <html>; globals.css matches it with `.dark .gb`.
 *  - `defaultTheme="system"` a merchant who never opens the menu keeps the appearance
 *                          their phone or laptop already chose. No new decision is forced
 *                          on anyone by this ticket shipping.
 *  - `enableSystem`        keeps "System" as a real, live third choice — it follows the
 *                          OS as it changes (sunset), it is not a one-time snapshot.
 *  - `disableTransitionOnChange` suppresses the ~200ms colour transitions our recipes
 *                          declare, for the one frame the theme flips. Without it, every
 *                          surface on screen cross-fades independently and the switch
 *                          reads as a smear rather than a change.
 *
 * Persistence is next-themes' own localStorage key ("theme"), read by the blocking script
 * it injects into <head>, so the class is on the element before first paint — no flash of
 * the wrong theme. It is a device preference, deliberately not a server-side one: it needs
 * to be correct on the very first paint of a cold load, before any session is resolved,
 * and a merchant on a bright shop floor and a dark office should not have to fight over
 * one row in the database.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
