"use client";

import type { BlockContent } from "../lib/projects";

type BibleCalloutBlockProps = {
  block: BlockContent;
  onRemove: () => void;
};

export function BibleCalloutBlock({ block, onRemove }: BibleCalloutBlockProps) {
  const reference = block.bibleReference ?? "Scripture";
  const gatewayUrl = block.bibleGatewayUrl;

  return (
    <aside
      className="bible-callout my-2 rounded-xl border border-[color-mix(in_srgb,var(--accent)_28%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--sidebar))] px-4 py-3"
      aria-label={`Scripture callout: ${reference}`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">
          Berean Study Bible
        </p>
        <div className="flex items-center gap-2">
          {gatewayUrl ? (
            <a
              href={gatewayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-[color-mix(in_srgb,var(--accent)_85%,var(--ink))] underline-offset-2 hover:underline"
            >
              {reference} (ESV on Bible Gateway)
            </a>
          ) : (
            <span className="text-xs font-medium text-[var(--ink)]">{reference}</span>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-1.5 py-0.5 text-xs text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)]"
            aria-label={`Remove ${reference} callout`}
          >
            Remove
          </button>
        </div>
      </div>
      <div
        className="bible-callout-body text-sm leading-relaxed text-[var(--ink)] [scrollbar-gutter:stable]"
        dangerouslySetInnerHTML={{ __html: block.html }}
      />
    </aside>
  );
}
