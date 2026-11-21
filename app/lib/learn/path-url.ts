import type { LearnLocation } from "./plan-progress.ts";

const PATH_ID = /^[A-Za-z0-9_-]{1,80}$/;

export type PathUrl = {
  pathId: string | null;
  /** Null when the URL does not name a screen, so saved progress can stand. */
  location: LearnLocation | null;
};

export function parsePathUrl(search: string): PathUrl {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawPath = params.get("path");
  const pathId = rawPath && PATH_ID.test(rawPath) ? rawPath : null;
  const lesson = params.get("lesson");
  if (!lesson) return { pathId, location: null };
  if (lesson === "home") return { pathId, location: { screen: "overview" } };
  if (lesson === "final") return { pathId, location: { screen: "final" } };
  if (PATH_ID.test(lesson)) return { pathId, location: { screen: "lesson", lessonId: lesson } };
  return { pathId, location: null };
}

export function pathSearch(pathId: string | null, location: LearnLocation | null, currentSearch = ""): string {
  const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
  if (pathId && PATH_ID.test(pathId)) params.set("path", pathId);
  else params.delete("path");
  if (!pathId) params.delete("lesson");
  else if (location?.screen === "overview") params.set("lesson", "home");
  else if (location?.screen === "final") params.set("lesson", "final");
  else if (location?.screen === "lesson" && location.lessonId && PATH_ID.test(location.lessonId)) params.set("lesson", location.lessonId);
  else if (location) params.delete("lesson");
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Keep a lesson id only when this plan actually has it. An unknown id falls back to the course home. */
export function locationForPlan(location: LearnLocation | null, lessonIds: readonly string[]): LearnLocation | null {
  if (!location) return null;
  if (location.screen === "overview") return location;
  if (location.screen === "final") return location;
  if (location.screen === "lesson" && location.lessonId && lessonIds.includes(location.lessonId)) return location;
  return { screen: "overview" };
}
