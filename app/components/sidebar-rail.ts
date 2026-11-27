/**
 * Desktop width for the learn-paths sidebar.
 * Tailwind keeps every utility it sees, and two `md:w-*` classes on one element
 * resolve to whichever rule was generated last — the wide width. Emit only one set.
 */
export function sidebarRailClass(collapsed: boolean): string {
  if (collapsed) return "md:w-16 md:min-w-16 md:max-w-16 md:px-0";
  return "md:w-60 md:min-w-60 md:max-w-60 md:px-3";
}
