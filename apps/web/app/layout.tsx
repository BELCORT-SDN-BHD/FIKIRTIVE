import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Geist } from "next/font/google";
import "./globals.css";
import { isImpersonating } from "@/lib/better-auth/compat";
import { signOutAction } from "@/lib/account-actions";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import { MerchantAppShell } from "@/components/global-navigation";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mono for data/IDs — JetBrains Mono, matching design system 0abf8563
const meta = JetBrains_Mono({ variable: "--font-meta", subsets: ["latin"] });
// Fikirtive v4 uses Geist for every interface surface.
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Fikirtive",
  description: "Fikirtive is the marketing OS for small businesses.",
};

/** V1 is light-only by the approved v4 palette, including browser and native-control chrome. */
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#FAFAFC",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const impersonating = await isImpersonating();
  return (
    <html lang="en" className={`${meta.variable} ${geist.variable} h-full antialiased`}>
      <body className="gb min-h-full flex flex-col">
        <TooltipProvider>
          {impersonating && <ImpersonationBanner />}
          <div className="relative z-10 flex min-h-dvh flex-col">
            <MerchantAppShell signOutAction={signOutAction}>{children}</MerchantAppShell>
          </div>
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
