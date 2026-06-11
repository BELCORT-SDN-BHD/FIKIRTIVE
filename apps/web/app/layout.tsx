import type { Metadata } from "next";
import { Hanken_Grotesk, Geist_Mono } from "next/font/google";
import "./globals.css";

// Vapor type system: Hanken Grotesk for everything, Geist Mono for metadata
const body = Hanken_Grotesk({ variable: "--font-body", subsets: ["latin"] });
const meta = Geist_Mono({ variable: "--font-meta", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Artlio",
  description: "Model-neutral entity asset layer for AI video creators",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${body.variable} ${meta.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <div className="ambient-layer" aria-hidden />
        <div className="relative z-10 flex flex-col min-h-dvh">{children}</div>
      </body>
    </html>
  );
}
