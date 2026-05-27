import type { Metadata } from "next";
import { Bricolage_Grotesque, Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "BizAssist AI — Busy Business? Let BizAssist Handle It.",
  description:
    "BizAssist AI helps small and medium-sized businesses generate professional quotations in seconds. AI-powered drafting, PDF export, and human review built in.",
  keywords: [
    "AI assistant",
    "SME",
    "quotation generator",
    "business automation",
    "BizAssist",
  ],
  authors: [{ name: "BizAssist AI Solutions" }],
  openGraph: {
    title: "BizAssist AI",
    description: "Busy Business? Let BizAssist Handle It.",
    type: "website",
  },
  icons: {
    icon: "/bizassist-logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${manrope.variable} ${jetbrains.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
