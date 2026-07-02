import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono, Geist } from "next/font/google";
import "./globals.css";
import { isImpersonating } from "@/lib/better-auth/compat";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const impersonating = await isImpersonating();
  return (
    <html lang="en" className={`${body.variable} ${meta.variable} ${geist.variable} h-full antialiased`}>
      <body className="gb min-h-full flex flex-col">
        {impersonating && <ImpersonationBanner />}
        <div className="relative z-10 flex flex-col min-h-dvh">{children}</div>
        <Toaster />
      </body>
    </html>
  );
}
