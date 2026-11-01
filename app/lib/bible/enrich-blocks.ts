import type { BlockContent } from "../projects";
import { bibleGatewayEsvUrl } from "./bible-gateway";
import { findBibleReferences, type ParsedBibleReference } from "./parse-reference";
import { passageContentAlreadyPresent } from "./scripture-text";

export type PassageVerse = {
  verse: number;
  text: string;
};

export type PassageApiResponse = {
  reference: string;
  calloutHtml: string;
  gatewayUrl: string;
  verses?: PassageVerse[];
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function passageToQuoteHtml(passage: PassageApiResponse): string {
  if (passage.verses?.length) {
    return passage.verses
      .map((row) => `<strong>${row.verse}</strong> ${escapeHtml(row.text)}`)
      .join("<br>");
  }
  return escapeHtml(stripHtmlToPlain(passage.calloutHtml));
}

function linkifyReferences(plainText: string, refs: ParsedBibleReference[]): string {
  if (refs.length === 0) return escapeHtml(plainText);

  let html = "";
  let cursor = 0;

  for (const ref of refs) {
    html += escapeHtml(plainText.slice(cursor, ref.start));
    const href = bibleGatewayEsvUrl(ref.label);
    html += `<a href="${href}" target="_blank" rel="noopener noreferrer" class="scripture-ref">${escapeHtml(plainText.slice(ref.start, ref.end))}</a>`;
    cursor = ref.end;
  }

  html += escapeHtml(plainText.slice(cursor));
  return html.replace(/\n/g, "<br>");
}

function stripHtmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function plainToBlockHtml(plain: string): string {
  return escapeHtml(plain).replace(/\n/g, "<br>");
}

function refsInSlice(refs: ParsedBibleReference[], start: number, end: number): ParsedBibleReference[] {
  return refs
    .filter((ref) => ref.start >= start && ref.end <= end)
    .map((ref) => ({
      ...ref,
      start: ref.start - start,
      end: ref.end - start,
    }));
}

function passagePlainText(passage: PassageApiResponse): string {
  if (passage.verses?.length) {
    return passage.verses.map((row) => row.text).join(" ");
  }
  return stripHtmlToPlain(passage.calloutHtml);
}

function blockContainsPassageText(block: BlockContent, passage: PassageApiResponse): boolean {
  const plain = stripHtmlToPlain(block.html);
  if (!plain.trim()) return false;
  if (block.bibleReference === passage.reference) return true;
  return passageContentAlreadyPresent(plain, passagePlainText(passage), passage.verses);
}

function markPassageQuoted(
  quotesSatisfied: Set<string>,
  ref: ParsedBibleReference,
  passage: PassageApiResponse,
): void {
  quotesSatisfied.add(ref.label);
  quotesSatisfied.add(passage.reference);
}

function markPassageReferenceQuoted(quotesSatisfied: Set<string>, passage: PassageApiResponse): void {
  quotesSatisfied.add(passage.reference);
}

function findBlockAlreadyShowingPassage(
  passage: PassageApiResponse,
  candidates: (BlockContent | undefined)[],
): BlockContent | null {
  for (const block of candidates) {
    if (!block) continue;
    if (blockContainsPassageText(block, passage)) return block;
  }
  return null;
}

function isScriptureFollowBlock(block: BlockContent, reference: string): boolean {
  if (block.bibleReference !== reference) return false;
  return block.kind === "bible-callout" || block.type === "quote";
}

const VERSE_TEXT_BLOCK_TYPES = new Set<BlockContent["type"]>(["paragraph", "bullet", "numbered", "quote"]);

function shouldTryVerseTextMatch(block: BlockContent): boolean {
  if (block.kind === "bible-callout") return false;
  if (block.bibleReference) return false;
  if (!VERSE_TEXT_BLOCK_TYPES.has(block.type)) return false;
  return true;
}

function adoptQuoteBlock(block: BlockContent, passage: PassageApiResponse): BlockContent {
  const keepHtml =
    blockContainsPassageText(block, passage) && stripHtmlToPlain(block.html).trim().length >= 24;
  return {
    ...block,
    type: "quote",
    kind: undefined,
    html: keepHtml ? block.html : passageToQuoteHtml(passage),
    bibleReference: passage.reference,
    bibleGatewayUrl: passage.gatewayUrl,
  };
}

function quoteBlockFromPassage(block: BlockContent, passage: PassageApiResponse): BlockContent {
  return adoptQuoteBlock(block, passage);
}

function migrateLegacyCallout(block: BlockContent): BlockContent | null {
  if (block.kind !== "bible-callout" || !block.bibleReference) return null;
  return {
    ...block,
    kind: undefined,
    type: "quote",
    html: block.html.includes("<") ? stripHtmlToPlain(block.html) : block.html,
  };
}

function newScriptureQuoteBlock(reference: string, passage: PassageApiResponse): BlockContent {
  return {
    id: crypto.randomUUID(),
    type: "quote",
    html: passageToQuoteHtml(passage),
    bibleReference: reference,
    bibleGatewayUrl: passage.gatewayUrl,
  };
}

function textBlockFromTemplate(template: BlockContent, id: string, html: string): BlockContent {
  return { ...template, id, html, kind: template.kind === "bible-callout" ? undefined : template.kind };
}

async function appendQuoteForRef(
  ref: ParsedBibleReference,
  blocks: BlockContent[],
  followIndex: number,
  output: BlockContent[],
  quotesSatisfied: Set<string>,
  consumed: Set<number>,
  loadPassage: (ref: ParsedBibleReference) => Promise<PassageApiResponse | null>,
): Promise<number> {
  if (quotesSatisfied.has(ref.label)) return followIndex;

  const passage = await loadPassage(ref);
  if (!passage) return followIndex;
  if (quotesSatisfied.has(passage.reference)) return followIndex;

  const parent = output[output.length - 1];
  if (findBlockAlreadyShowingPassage(passage, [parent])) {
    markPassageQuoted(quotesSatisfied, ref, passage);
    return followIndex;
  }

  const existingInOutput = output.find((block) => blockContainsPassageText(block, passage));
  if (existingInOutput) {
    markPassageQuoted(quotesSatisfied, ref, passage);
    return followIndex;
  }

  const existing = blocks[followIndex];
  if (existing && isScriptureFollowBlock(existing, ref.label)) {
    markPassageQuoted(quotesSatisfied, ref, passage);
    output.push(existing);
    consumed.add(followIndex);
    return followIndex + 1;
  }

  if (existing && blockContainsPassageText(existing, passage)) {
    markPassageQuoted(quotesSatisfied, ref, passage);
    output.push(adoptQuoteBlock(existing, passage));
    consumed.add(followIndex);
    return followIndex + 1;
  }

  markPassageQuoted(quotesSatisfied, ref, passage);
  output.push(newScriptureQuoteBlock(passage.reference, passage));
  return followIndex;
}

export async function enrichBlocksWithScripture(
  blocks: BlockContent[],
  loadPassage: (ref: ParsedBibleReference) => Promise<PassageApiResponse | null>,
  loadVerseTextMatch: (plainText: string) => Promise<PassageApiResponse | null> = async () => null,
): Promise<BlockContent[]> {
  const output: BlockContent[] = [];
  const quotesSatisfied = new Set<string>();
  const consumed = new Set<number>();
  let changed = false;

  for (const block of blocks) {
    if (block.bibleReference) quotesSatisfied.add(block.bibleReference);
  }

  for (let index = 0; index < blocks.length; index++) {
    if (consumed.has(index)) continue;

    const block = blocks[index]!;
    const migrated = migrateLegacyCallout(block);
    if (migrated) {
      changed = true;
      if (migrated.bibleReference) quotesSatisfied.add(migrated.bibleReference);
      output.push(migrated);
      continue;
    }

    if (isScriptureFollowBlock(block, block.bibleReference ?? "")) {
      if (block.bibleReference) quotesSatisfied.add(block.bibleReference);
      output.push(block);
      continue;
    }

    const plain = stripHtmlToPlain(block.html);
    const refs = findBibleReferences(plain);

    if (refs.length === 0) {
      if (shouldTryVerseTextMatch(block) && plain.trim().length >= 24) {
        if (block.bibleReference && quotesSatisfied.has(block.bibleReference)) {
          output.push(block);
          continue;
        }
        const passage = await loadVerseTextMatch(plain);
        if (passage) {
          if (quotesSatisfied.has(passage.reference) && blockContainsPassageText(block, passage)) {
            output.push(block);
            continue;
          }
          if (blockContainsPassageText(block, passage) && block.type === "quote" && block.bibleReference) {
            output.push(block);
            markPassageReferenceQuoted(quotesSatisfied, passage);
            continue;
          }
          changed = true;
          markPassageReferenceQuoted(quotesSatisfied, passage);
          output.push(quoteBlockFromPassage(block, passage));
          continue;
        }
      }
      output.push(block);
      continue;
    }

    if (refs.length === 1) {
      const linkedHtml = linkifyReferences(plain, refs);
      const updatedBlock = linkedHtml !== block.html ? { ...block, html: linkedHtml } : block;
      if (updatedBlock !== block) changed = true;
      output.push(updatedBlock);

      const ref = refs[0]!;
      const beforeFollow = output.length;
      await appendQuoteForRef(ref, blocks, index + 1, output, quotesSatisfied, consumed, loadPassage);
      if (output.length > beforeFollow) changed = true;
      continue;
    }

    // Multiple references: split into one text block per reference, quote under each.
    changed = true;
    let followIndex = index + 1;

    for (let refIndex = 0; refIndex < refs.length; refIndex++) {
      const ref = refs[refIndex]!;
      const segStart = refIndex === 0 ? 0 : refs[refIndex - 1]!.end;
      const segEnd = ref.end;
      const segmentPlain = plain.slice(segStart, segEnd);
      if (!segmentPlain.trim()) continue;

      const segmentRefs = refsInSlice(refs, segStart, segEnd);
      const html = linkifyReferences(segmentPlain, segmentRefs);
      const id = refIndex === 0 ? block.id : crypto.randomUUID();
      output.push(textBlockFromTemplate(block, id, html));

      const beforeFollow = output.length;
      followIndex = await appendQuoteForRef(
        ref,
        blocks,
        followIndex,
        output,
        quotesSatisfied,
        consumed,
        loadPassage,
      );
      if (output.length > beforeFollow) changed = true;
    }

    const trailingPlain = plain.slice(refs[refs.length - 1]!.end);
    if (trailingPlain.trim()) {
      const trailingRefs = findBibleReferences(trailingPlain);
      const trailingHtml = trailingRefs.length
        ? linkifyReferences(trailingPlain, trailingRefs)
        : plainToBlockHtml(trailingPlain);
      output.push(textBlockFromTemplate(block, crypto.randomUUID(), trailingHtml));
    }
  }

  return changed ? output : blocks;
}

export async function fetchPassageForReference(ref: ParsedBibleReference): Promise<PassageApiResponse | null> {
  const params = new URLSearchParams({
    slug: ref.book.slug,
    chapter: String(ref.chapter),
    start: String(ref.verseStart),
    end: String(ref.verseEnd),
  });
  const response = await fetch(`/api/bible/passage?${params.toString()}`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as PassageApiResponse;
}

export async function fetchVerseTextMatch(plainText: string): Promise<PassageApiResponse | null> {
  const response = await fetch("/api/bible/match", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: plainText }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { match: PassageApiResponse | null };
  return body.match ?? null;
}
