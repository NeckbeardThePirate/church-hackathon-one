/** Keep a real connection note. Drop stock retrieval captions that only say where the quote was copied from. */
export function visibleCitationNote(note: string): string {
  const trimmed = note.replace(/\s+/g, " ").trim();
  if (!trimmed || isStockCaption(trimmed)) return "";
  return trimmed;
}

function isStockCaption(note: string): boolean {
  if (/^quoted from\b/i.test(note)) return true;
  if (/^from the retrieved commentary text\.?$/i.test(note)) return true;
  if (/^a passage you chose\.?$/i.test(note)) return true;
  if (/^comment on (?=.*\d)[^.]+\.$/i.test(note)) return true;
  return false;
}
