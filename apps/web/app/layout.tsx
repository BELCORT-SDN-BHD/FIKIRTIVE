import type { Metadata } from "next";
import { Space_Grotesk, Schibsted_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const heading = Space_Grotesk({ variable: "--font-heading", subsets: ["latin"] });
const body = Schibsted_Grotesk({ variable: "--font-body", subsets: ["latin"] });
const meta = JetBrains_Mono({ variable: "--font-meta", subsets: ["latin"] });

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
    <html
      lang="en"
      className={`${heading.variable} ${body.variable} ${meta.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
