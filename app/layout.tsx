import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
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

const title = "StudyBuddy";
const description =
  "Learn paths built from a topic, notes, a passage, or a photo, cited to Scripture, the confessions, and the church fathers.";

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: await requestMetadataBase(),
    title,
    description,
    applicationName: title,
    openGraph: {
      title,
      description,
      siteName: title,
      type: "website",
      locale: "en_US",
    },
    twitter: {
      title,
      description,
    },
  };
}

/** Absolute social URLs follow the host that actually served the page. */
async function requestMetadataBase(): Promise<URL | undefined> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const hostname = host?.split(",")[0]?.trim();
  if (!hostname) return undefined;
  const forwarded = headerList.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const local = hostname.startsWith("localhost") || hostname.startsWith("127.0.0.1");
  const proto = forwarded === "http" || forwarded === "https" ? forwarded : local ? "http" : "https";
  try {
    return new URL(`${proto}://${hostname}`);
  } catch {
    return undefined;
  }
}

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
