import type { Metadata, Viewport } from "next";
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
  title: "StudyBuddy",
  description: "Discipleship study plans cited to Scripture, the confessions, and the church fathers.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#191919",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${serif.variable}`}>
      <body className="min-h-dvh bg-[var(--canvas)] font-sans text-[var(--ink)] antialiased">
        <ClerkAppProvider>{children}</ClerkAppProvider>
      </body>
    </html>
  );
}
