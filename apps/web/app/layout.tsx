import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, JetBrains_Mono, Geist } from "next/font/google";
import "./globals.css";
import { isImpersonating } from "@/lib/better-auth/compat";
import { signOutAction } from "@/lib/account-actions";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import { MerchantAppShell } from "@/components/global-navigation";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

// Vapor type system (legacy): Hanken Grotesk for everything
const body = Hanken_Grotesk({ variable: "--font-body", subsets: ["latin"] });
// Mono for data/IDs — JetBrains Mono, matching design system 0abf8563
const meta = JetBrains_Mono({ variable: "--font-meta", subsets: ["latin"] });
// Grok-bright type system: Geist (sans) for the new `.gb` screens
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Fikirtive",
  description: "Model-neutral entity asset layer for AI video creators",
};

/**
 * Wire ④ of the §K3 activation contract (#804) — the two ground colours, handed to the
 * browser chrome itself. `themeColor` is what tints the address bar on Android and the
 * status bar of an installed PWA; one fixed value would leave a white bar capping a dark
 * page (or the reverse). The media queries read the OS rather than our class because the
 * browser resolves this before any of our CSS or JS runs — a merchant who picks the theme
 * by hand gets the OS-matching bar, which is the closest thing available at that moment.
 * The literals are §K3's, and they are exactly `--background` in each token block.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FCFCFC" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0B0C" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const impersonating = await isImpersonating();
  return (
    // suppressHydrationWarning is required by next-themes and scoped to this one element:
    // its blocking <head> script writes `class="dark"` and `style="color-scheme:…"` onto
    // <html> BEFORE React hydrates (that is what stops the flash of the wrong theme), so
    // the server's markup for this element can never match. React only forgives one level,
    // so nothing below <html> is silenced by it.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${body.variable} ${meta.variable} ${geist.variable} h-full antialiased`}
    >
      <body className="gb min-h-full flex flex-col">
        <ThemeProvider>
          {impersonating && <ImpersonationBanner />}
          <div className="relative z-10 flex min-h-dvh flex-col">
            <MerchantAppShell signOutAction={signOutAction}>{children}</MerchantAppShell>
          </div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
