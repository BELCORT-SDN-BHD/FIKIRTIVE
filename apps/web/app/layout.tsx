import type { Metadata } from "next";
import { Hanken_Grotesk, Geist_Mono } from "next/font/google";
import "./globals.css";
import { isImpersonating } from "@/lib/better-auth/compat";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";

// Vapor type system: Hanken Grotesk for everything, Geist Mono for metadata
const body = Hanken_Grotesk({ variable: "--font-body", subsets: ["latin"] });
const meta = Geist_Mono({ variable: "--font-meta", subsets: ["latin"] });

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
    <html lang="en" className={`${body.variable} ${meta.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {impersonating && <ImpersonationBanner />}
        <div className="ambient-layer" aria-hidden />
        <div className="relative z-10 flex flex-col min-h-dvh">{children}</div>
      </body>
    </html>
  );
}
