import type { LearnAttempt } from "./attempts.ts";
import type { LearnPlanProgress } from "./plan-progress.ts";

/** One automatic retry. Local progress is saved before this runs and is not written again on failure. */
export async function postLearnAttempt(
  planId: string,
  attempt: LearnAttempt & { timeZone?: string },
): Promise<{ conceptMastery?: LearnPlanProgress["conceptMastery"] } | null> {
  for (let attemptIndex = 0; attemptIndex < 2; attemptIndex++) {
    try {
      const response = await fetch(`/api/learn/plans/${planId}/attempts`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(attempt),
      });
      if (response.ok) {
        return (await response.json()) as { conceptMastery?: LearnPlanProgress["conceptMastery"] };
      }
      if (response.status < 500) return null;
    } catch {
      /* Network or a body that is not JSON. Retry once, then keep the local quiz. */
    }
  }
  return null;
}
