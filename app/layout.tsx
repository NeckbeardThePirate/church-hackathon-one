import type { Metadata } from "next";
import { DM_Sans, Newsreader } from "next/font/google";
import { ClerkAppProvider } from "./components/ClerkAppProvider";
import "./globals.css";

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const serif = Newsreader({
  subsets: ["latin"],
  variable: "--font-serif",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Notes — Church Hackathon",
  description: "A Notion-like writing space on Cloudflare Workers",
  themeColor: "#191919",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${serif.variable}`}>
      <body className="bg-[var(--canvas)] font-sans text-[var(--ink)] antialiased">
        <ClerkAppProvider>{children}</ClerkAppProvider>
      </body>
    </html>
  );
}
