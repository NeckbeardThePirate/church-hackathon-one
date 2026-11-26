import { attemptLessonError } from "../../../../../lib/learn/attempts.ts";
import { handleLearnAttempt } from "../../../../../lib/server/learn/attempt-response.ts";
import { ownedPlan } from "../../../../../lib/server/learn/api.ts";
import { userWorkspaceStub } from "../../../../../lib/server/user-workspace.ts";

export const dynamic = "force-dynamic";

/** Record a lesson, final, or review attempt and return the plan DO's concept mastery. */
export async function POST(request: Request, context: { params: Promise<{ planId: string }> }): Promise<Response> {
  const { planId } = await context.params;
  const owned = await ownedPlan(request, planId);
  return handleLearnAttempt({
    owned,
    readBody: () => request.json(),
    previewAttempt: async (attempt) => {
      if (owned instanceof Response) return { ok: false, error: "Sign in required." };
      const context = await userWorkspaceStub(owned.userId).readAttemptContext(planId);
      const error = attemptLessonError(
        context.lessonIds ? { learnPlan: { lessons: context.lessonIds.map((id) => ({ id })) } } : null,
        attempt,
      );
      return error ? { ok: false, error } : { ok: true };
    },
    recordPlanAttempt: async (record) => {
      if (owned instanceof Response) throw new Error("Sign in required.");
      const context = await userWorkspaceStub(owned.userId).readAttemptContext(planId);
      const timeZone = context.timeZone || record.timeZone || "UTC";
      return owned.stub.recordLearnAttempt({
        ...record,
        planId,
        timeZone,
        ...(context.workspaceMastery ? { workspaceMastery: context.workspaceMastery } : {}),
        ...(context.projectId ? { projectId: context.projectId } : {}),
      });
    },
    mirrorAttempt: async (input) => {
      if (owned instanceof Response) throw new Error("Sign in required.");
      return userWorkspaceStub(owned.userId).mirrorLearnAttempt(planId, input);
    },
  });
}
