import { retrievalFocus, selectRelevant } from "../server/learn/library-rank.ts";
import type { LearnLesson, LibraryCitation } from "./types.ts";

const PER_KIND = 2;
const REFORMED_DOC = /westminster|heidelberg|belgic|dort|canons/i;
const KINDS = ["confession", "commentary", "father"] as const;

/**
 * The same query shape citeLibrary uses at build time: title, objectives, and the lesson passage.
 * A short slice of the teaching is included so a lesson titled only by its theme still matches.
 */
export function libraryFocusText(
  lesson: Pick<LearnLesson, "title" | "objectives" | "scripture" | "searchHints" | "teaching">,
): string {
  const teaching = lesson.teaching
    .map((block) => block.text)
    .join(" ")
    .slice(0, 500);
  return [lesson.title, ...lesson.objectives, ...lesson.scripture.map((row) => row.reference), ...(lesson.searchHints ?? []), teaching]
    .filter(Boolean)
    .join(". ");
}

function cardText(card: LibraryCitation): string {
  return `${card.label} ${card.detail ?? ""} ${card.note} ${card.text}`;
}

function passageKey(reference: string): string | null {
  const match = reference.trim().toLowerCase().match(/^((?:[1-3]\s*)?[a-z][a-z .]*?)\s+(\d+)/);
  if (!match?.[1] || !match[2]) return null;
  return `${match[1].replace(/\s+/g, " ").trim()} ${match[2]}`;
}

/** A commentary or father stored against the lesson passage can stay. Confessions cannot. */
function onLessonPassage(card: LibraryCitation, references: readonly string[]): boolean {
  if (card.source === "confession") return false;
  const hay = cardText(card);
  return references.some((reference) => {
    const key = passageKey(reference);
    if (!key) return false;
    const pattern = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}\\b`, "i");
    return pattern.test(hay);
  });
}

/**
 * Re-rank cards already stored on a lesson.
 * Plans built before the relevance filter still hold off-topic confessions.
 * Reading them through this drops those cards, and keeps at most two of each kind.
 */
export function visibleLibraryCards(
  lesson: Pick<LearnLesson, "title" | "objectives" | "scripture" | "searchHints" | "teaching" | "library">,
  perspective = "neutral",
): LibraryCitation[] {
  const cards = lesson.library ?? [];
  if (!cards.length) return [];
  const focus = retrievalFocus(libraryFocusText(lesson));
  const references = lesson.scripture.map((row) => row.reference);
  const visible: LibraryCitation[] = [];
  for (const kind of KINDS) {
    const group = cards.filter((card) => card.source === kind && card.text.trim());
    visible.push(
      ...selectRelevant(group, cardText, focus, {
        limit: PER_KIND,
        perspective,
        reformed: (card) => REFORMED_DOC.test(`${card.label} ${card.detail ?? ""}`),
        keepAnyway: (card) => onLessonPassage(card, references),
      }),
    );
  }
  return visible;
}
