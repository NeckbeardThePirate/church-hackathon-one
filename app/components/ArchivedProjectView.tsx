"use client";

import { defaultTitle, PROJECT_KIND_LABEL, type BlockContent, type Project } from "../lib/projects";

type Props = {
  project: Project;
  /** Offered for learn paths that never produced a plan. */
  onBuildPath?: () => void;
};

function htmlToText(html: string): string {
  if (typeof DOMParser === "undefined") return html.replace(/<[^>]*>/g, "");
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}

function Block({ block }: { block: BlockContent }) {
  const text = htmlToText(typeof block.html === "string" ? block.html : "").trim();
  switch (block.type) {
    case "divider":
      return <hr className="my-3 border-[var(--line)]" />;
    case "heading1":
      return text ? <h2 className="mt-4 text-2xl font-semibold text-[var(--ink)]">{text}</h2> : null;
    case "heading2":
      return text ? <h3 className="mt-3 text-lg font-semibold text-[var(--ink)]">{text}</h3> : null;
    case "bullet":
      return text ? <p className="pl-5 -indent-3 text-base leading-relaxed text-[var(--ink)]">• {text}</p> : null;
    case "numbered":
      return text ? <p className="pl-5 text-base leading-relaxed text-[var(--ink)]">{text}</p> : null;
    case "quote":
      return text ? (
        <blockquote className="border-l-2 border-[var(--line)] pl-4 text-base italic leading-relaxed text-[var(--ink-muted)]">{text}</blockquote>
      ) : null;
    default:
      return text ? <p className="text-base leading-relaxed text-[var(--ink)]">{text}</p> : null;
  }
}

/** Read-only view for projects saved by earlier versions, and learn paths without a finished plan. */
export function ArchivedProjectView({ project, onBuildPath }: Props) {
  const blocks = Array.isArray(project.blocks) ? project.blocks : [];
  const images = project.sourceImages ?? (project.sourceImage ? [project.sourceImage] : []);
  const hasText = blocks.some((b) => htmlToText(typeof b.html === "string" ? b.html : "").trim());

  return (
    <article className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] pt-8 sm:px-10 sm:pt-16">
      <p className="inline-flex w-fit rounded-md border border-[var(--line)] px-2 py-0.5 text-xs font-medium text-[var(--ink-muted)]">
        {PROJECT_KIND_LABEL[project.kind] ?? "Archived"} · Read-only
      </p>
      <h1 className="text-3xl font-semibold tracking-[-0.02em] text-[var(--ink)]">{defaultTitle(project)}</h1>
      {onBuildPath ? (
        <button
          type="button"
          onClick={onBuildPath}
          className="min-h-12 w-full rounded-lg bg-[var(--accent)] px-4 text-base font-medium text-white sm:w-fit"
        >
          Build a path
        </button>
      ) : null}
      {images.length > 0 ? (
        <ul className="flex gap-2 overflow-x-auto">
          {images.map((image, i) => (
            <li key={image.key} className="shrink-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--sidebar)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/media/${image.key}`} alt={image.fileName ?? `Source ${i + 1}`} className="h-24 w-auto object-contain p-1" />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-col gap-2">
        {hasText ? blocks.map((block) => <Block key={block.id} block={block} />) : <p className="text-base text-[var(--ink-muted)]">Nothing saved here.</p>}
      </div>
    </article>
  );
}
