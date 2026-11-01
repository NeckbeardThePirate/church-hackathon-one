export type BlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "bullet"
  | "numbered"
  | "quote"
  | "divider";

export const BLOCK_TYPES: BlockType[] = [
  "paragraph",
  "heading1",
  "heading2",
  "bullet",
  "numbered",
  "quote",
  "divider",
];

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && (BLOCK_TYPES as string[]).includes(value);
}

export function normalizeBlockType(value: unknown): BlockType {
  return isBlockType(value) ? value : "paragraph";
}

export type SlashCommand = {
  id: BlockType;
  label: string;
  description: string;
  keywords: string[];
  /** Shown in the slash menu row */
  glyph: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "paragraph",
    label: "Text",
    description: "Plain paragraph",
    keywords: ["text", "paragraph", "p"],
    glyph: "¶",
  },
  {
    id: "heading1",
    label: "Heading 1",
    description: "Large section title",
    keywords: ["h1", "heading", "title", "heading1"],
    glyph: "H1",
  },
  {
    id: "heading2",
    label: "Heading 2",
    description: "Medium subsection",
    keywords: ["h2", "heading", "subtitle", "heading2"],
    glyph: "H2",
  },
  {
    id: "bullet",
    label: "Bulleted list",
    description: "Simple bullet list",
    keywords: ["bullet", "list", "ul", "unordered"],
    glyph: "•",
  },
  {
    id: "numbered",
    label: "Numbered list",
    description: "Ordered list",
    keywords: ["numbered", "ordered", "ol", "list", "1."],
    glyph: "1.",
  },
  {
    id: "quote",
    label: "Quote",
    description: "Call out a verse or quote",
    keywords: ["quote", "blockquote", "verse", "callout"],
    glyph: "“",
  },
  {
    id: "divider",
    label: "Divider",
    description: "Horizontal rule",
    keywords: ["divider", "hr", "line", "separator"],
    glyph: "—",
  },
];

export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((command) => {
    if (command.label.toLowerCase().includes(q)) return true;
    if (command.description.toLowerCase().includes(q)) return true;
    return command.keywords.some((keyword) => keyword.includes(q) || q.includes(keyword));
  });
}

/** Markdown-ish prefixes converted when the user types Space after them. */
export function matchMarkdownShortcut(plainText: string): { type: BlockType; rest: string } | null {
  const text = plainText.replace(/\u200B/g, "");
  if (text === "#") return { type: "heading1", rest: "" };
  if (text === "##") return { type: "heading2", rest: "" };
  if (text === "-" || text === "*") return { type: "bullet", rest: "" };
  if (text === "1." || text === "1)") return { type: "numbered", rest: "" };
  if (text === ">") return { type: "quote", rest: "" };
  if (text === "---" || text === "***") return { type: "divider", rest: "" };
  return null;
}

export function placeholderForType(type: BlockType, isFirst: boolean): string {
  switch (type) {
    case "heading1":
      return "Heading 1";
    case "heading2":
      return "Heading 2";
    case "bullet":
      return "List item";
    case "numbered":
      return "List item";
    case "quote":
      return "Quote or verse…";
    case "divider":
      return "";
    default:
      return isFirst ? "Type / for commands, or start writing…" : "Type something, or / for commands…";
  }
}

export function nextBlockTypeAfterEnter(type: BlockType): BlockType {
  if (type === "bullet" || type === "numbered" || type === "quote") return type;
  return "paragraph";
}
