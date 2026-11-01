import { ARTICLE_TEXT_MAX } from "@/app/lib/learn/article";

const BLOCKED_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

function ipv4Blocked(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if ([a, b, Number(match[3]), Number(match[4])].some((n) => n > 255)) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** Public http(s) only. Blocks loopback, link-local, and private ranges before we fetch. */
export function publicArticleUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || BLOCKED_HOST.test(host) || host === "0.0.0.0" || host === "169.254.169.254") return null;
  if (ipv4Blocked(host)) return null;
  if (/^\d+$/.test(host)) return null;
  if (host.includes(":")) {
    const v6 = host.toLowerCase();
    if (v6 === "::1" || v6 === "0:0:0:0:0:0:0:1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")) {
      return null;
    }
    const mapped = v6.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped && ipv4Blocked(mapped[1]!)) return null;
  }
  return url;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => {
      const code = Number.parseInt(n, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

/**
 * Pull the readable text out of an HTML page. Prefers `<article>`, then `<main>`.
 * Tags are stripped; the result is plain text for the reader, never rendered as HTML.
 */
export function htmlToArticleText(html: string, max = ARTICLE_TEXT_MAX): { title?: string; text: string; truncated: boolean } {
  const titleRaw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  let body =
    article ??
    main ??
    html.replace(/[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*/i, "");

  body = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|form|nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section|figure)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<h([1-6])[^>]*>/gi, (_, level: string) => `\n\n${"#".repeat(Math.min(Number(level) || 1, 3))} `)
    .replace(/<blockquote[^>]*>/gi, "\n\n> ")
    .replace(/<[^>]+>/g, "");

  const decoded = decodeEntities(body);
  const lines = decoded
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const truncated = lines.length > max;
  const text = truncated ? lines.slice(0, max).replace(/\s+\S*$/, "").trim() : lines;
  const title = titleRaw ? decodeEntities(titleRaw).replace(/\s+/g, " ").trim() : undefined;
  return { title: title || undefined, text, truncated };
}
