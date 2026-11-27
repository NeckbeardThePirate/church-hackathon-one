/** First-run welcome. Pure helpers so the empty desk can stay quiet without a server round trip. */

export const WELCOME_PREF_KEY = "welcome-walkthrough";
export const WELCOME_STORAGE_KEY = "studybuddy-welcome";

export type WelcomeStatus = "unseen" | "dismissed" | "completed";

export function parseWelcomeStatus(value: unknown): WelcomeStatus {
  return value === "dismissed" || value === "completed" ? value : "unseen";
}

/**
 * A stored decision on the server wins. A decision that only exists in this
 * browser is pushed up so the next device does not open the intro again.
 */
export function reconcileWelcomeStatus(
  local: WelcomeStatus,
  remote: WelcomeStatus,
): { status: WelcomeStatus; push: Exclude<WelcomeStatus, "unseen"> | null } {
  if (remote !== "unseen") return { status: remote, push: null };
  if (local !== "unseen") return { status: local, push: local };
  return { status: "unseen", push: null };
}

/** The intro opens by itself only on an empty desk that has not been skipped or finished. */
export function shouldShowWelcomeIntro(status: WelcomeStatus, hasPath: boolean, replay: boolean): boolean {
  if (replay && !hasPath) return true;
  return !hasPath && status === "unseen";
}

/** No path yet: the page has one job, so progress widgets stay out of the way. */
export function isQuietWorkspace(hasPath: boolean, onStartScreen: boolean): boolean {
  return !hasPath && onStartScreen;
}

export function readStoredWelcomeStatus(): WelcomeStatus {
  if (typeof window === "undefined") return "unseen";
  try {
    return parseWelcomeStatus(window.localStorage.getItem(WELCOME_STORAGE_KEY));
  } catch {
    return "unseen";
  }
}

export function writeStoredWelcomeStatus(status: WelcomeStatus): void {
  if (typeof window === "undefined") return;
  try {
    if (status === "unseen") window.localStorage.removeItem(WELCOME_STORAGE_KEY);
    else window.localStorage.setItem(WELCOME_STORAGE_KEY, status);
  } catch {
    /* Private mode can reject storage. The account pref still records the choice when it can. */
  }
}
