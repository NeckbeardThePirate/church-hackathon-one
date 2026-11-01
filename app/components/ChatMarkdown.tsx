"use client";

import { Fragment, useMemo, type ReactNode } from "react";

type MdBlock = { type: "p" | "ul" | "ol" | "h" | "quote"; lines: string[]; level?: number };

function parseBlocks(text: string): MdBlock[] {
  const out: MdBlock[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      out.push({ type: "p", lines: [] });
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    const last = out.at(-1);
    if (heading) {
      out.push({ type: "h", level: heading[1]!.length, lines: [heading[2]!] });
    } else if (quote) {
      if (last?.type === "quote") last.lines.push(quote[1]!);
      else out.push({ type: "quote", lines: [quote[1]!] });
    } else if (bullet) {
      if (last?.type === "ul") last.lines.push(bullet[1]!);
      else out.push({ type: "ul", lines: [bullet[1]!] });
    } else if (numbered) {
      if (last?.type === "ol") last.lines.push(numbered[1]!);
      else out.push({ type: "ol", lines: [numbered[1]!] });
    } else if (last?.type === "p" && last.lines.length) {
      last.lines.push(line);
    } else {
      out.push({ type: "p", lines: [line] });
    }
  }
  return out.filter((b) => b.lines.length);
}

function ChatInline({
  text,
  onCitation,
}: {
  text: string;
  onCitation?: (label: string) => void;
}) {
  const parts: ReactNode[] = [];
  const re =
    /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]{2,80}\]|https?:\/\/[^\s<]+[^\s<.,;:!?)])/g;
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(re)) {
    const index = m.index ?? 0;
    if (index > last) parts.push(<Fragment key={key++}>{text.slice(last, index)}</Fragment>);
    const tok = m[0];
    const link = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = link[2]!.trim();
      const safe = href.startsWith("http://") || href.startsWith("https://");
      parts.push(
        safe ? (
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[color-mix(in_srgb,var(--accent)_85%,var(--ink))] underline-offset-2 hover:underline"
          >
            {link[1]}
          </a>
        ) : (
          <span key={key++}>{tok}</span>
        ),
      );
    } else if (tok.startsWith("`")) {
      parts.push(
        <code
          key={key++}
          className="rounded-md border border-[var(--line)] bg-[color-mix(in_srgb,var(--sidebar-active)_80%,var(--canvas))] px-1 py-px font-mono text-[0.85em] text-[var(--ink)]"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      parts.push(
        <strong key={key++} className="font-semibold text-[var(--ink)]">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("*")) {
      parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith("http://") || tok.startsWith("https://")) {
      parts.push(
        <a
          key={key++}
          href={tok}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all font-medium text-[color-mix(in_srgb,var(--accent)_85%,var(--ink))] underline-offset-2 hover:underline"
        >
          {tok}
        </a>,
      );
    } else if (tok.startsWith("[") && tok.endsWith("]")) {
      const label = tok.slice(1, -1);
      if (onCitation) {
        parts.push(
          <button
            key={key++}
            type="button"
            onClick={() => onCitation(label)}
            className="mx-0.5 inline rounded-md border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-1.5 py-[1px] align-baseline text-[0.78em] font-medium text-[color-mix(in_srgb,var(--accent)_90%,var(--ink))] hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]"
          >
            {label}
          </button>,
        );
      } else {
        parts.push(
          <span
            key={key++}
            className="rounded-md border border-[var(--line)] bg-[color-mix(in_srgb,var(--sidebar-active)_65%,transparent)] px-1 py-px text-[0.85em] font-medium text-[var(--ink)]"
          >
            {label}
          </span>,
        );
      }
    }
    last = index + tok.length;
  }
  if (last < text.length) parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return <>{parts}</>;
}

export function ChatMarkdown({
  text,
  onCitation,
  streaming,
  className = "",
}: {
  text: string;
  onCitation?: (label: string) => void;
  streaming?: boolean;
  className?: string;
}) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const inline = (s: string) => <ChatInline text={s} onCitation={onCitation} />;

  return (
    <div
      className={`space-y-2.5 text-[0.925rem] leading-relaxed text-[color-mix(in_srgb,var(--ink)_92%,transparent)] ${className}`.trim()}
    >
      {blocks.map((b, i) => {
        const caret =
          streaming && i === blocks.length - 1 ? (
            <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-[var(--accent)]" />
          ) : null;
        if (b.type === "h") {
          const level = b.level ?? 3;
          const size =
            level <= 2 ? "text-base font-semibold" : level === 3 ? "text-sm font-semibold" : "text-sm font-medium";
          return (
            <p key={i} className={`pt-0.5 ${size} text-[var(--ink)]`}>
              {inline(b.lines[0]!)}
              {caret}
            </p>
          );
        }
        if (b.type === "quote") {
          return (
            <blockquote
              key={i}
              className="border-l-2 border-[color-mix(in_srgb,var(--accent)_40%,var(--line))] pl-3 text-[var(--ink-muted)] italic"
            >
              {b.lines.map((l, j) => (
                <p key={j} className={j > 0 ? "mt-1.5" : ""}>
                  {inline(l)}
                  {j === b.lines.length - 1 ? caret : null}
                </p>
              ))}
            </blockquote>
          );
        }
        if (b.type === "ul" || b.type === "ol") {
          const List = b.type;
          return (
            <List
              key={i}
              className={`space-y-1 pl-5 ${b.type === "ul" ? "list-disc" : "list-decimal"} marker:text-[var(--ink-muted)]`}
            >
              {b.lines.map((l, j) => (
                <li key={j}>
                  {inline(l)}
                  {j === b.lines.length - 1 ? caret : null}
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            {inline(b.lines.join(" "))}
            {caret}
          </p>
        );
      })}
    </div>
  );
}
