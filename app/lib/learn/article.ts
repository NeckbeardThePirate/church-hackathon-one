/** Plain-text article body, shared by the reader and the fetch route. */

export const ARTICLE_TEXT_MAX = 40_000;

export type FetchedArticle = {
  url: string;
  title: string;
  author?: string;
  siteName?: string;
  text: string;
  truncated: boolean;
};

export type ArticleBlock =
  | { type: "h2" | "h3" | "p" | "quote"; text: string }
  | { type: "li"; text: string };

const NEW_BLOCK = /^(#{1,6}\s+|[-*•]\s+|\d+[.)]\s+|>\s?)/;

function classify(text: string): ArticleBlock {
  if (/^#{1,2}\s+/.test(text)) return { type: "h2", text: text.replace(/^#{1,2}\s+/, "") };
  if (/^#{3,6}\s+/.test(text)) return { type: "h3", text: text.replace(/^#{3,6}\s+/, "") };
  if (/^>\s?/.test(text)) return { type: "quote", text: text.replace(/^>\s?/, "") };
  if (/^[-*•]\s+/.test(text)) return { type: "li", text: text.replace(/^[-*•]\s+/, "") };
  if (/^\d+[.)]\s+/.test(text)) return { type: "li", text: text.replace(/^\d+[.)]\s+/, "") };
  return { type: "p", text };
}

const NOISE = /^(share|menu|advertisement|sponsored|subscribe|sign in|log in|cookie|cookies|home|search|close)$/i;

/** Turn extracted article text into blocks. Joins hard-wrapped lines; keeps real paragraph breaks. */
export function articleBlocks(raw: string): ArticleBlock[] {
  const text = raw.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").replace(/\u0000/g, "").trim();
  if (!text) return [];

  const lines = text.split("\n").map((line) => line.trim());
  const nonempty = lines.filter(Boolean);
  const long = nonempty.filter((line) => line.length > 80).length;
  const hardWrapped = nonempty.length > 4 && long / nonempty.length < 0.35;

  const paragraphs: string[] = [];
  if (hardWrapped) {
    let buf: string[] = [];
    const flush = () => {
      if (buf.length) paragraphs.push(buf.join(" "));
      buf = [];
    };
    for (const line of lines) {
      if (!line) {
        flush();
        continue;
      }
      if (buf.length && NEW_BLOCK.test(line)) flush();
      buf.push(line);
    }
    flush();
  } else {
    for (const line of lines) if (line) paragraphs.push(line);
  }

  return paragraphs.map(classify).filter((block) => {
    if (block.type === "p" && block.text.length < 24 && NOISE.test(block.text)) return false;
    // Drop icon-only and empty list markers left behind by page chrome.
    return /[0-9A-Za-z]/.test(block.text) || /[^\u0000-\u007F]/.test(block.text);
  });
}
