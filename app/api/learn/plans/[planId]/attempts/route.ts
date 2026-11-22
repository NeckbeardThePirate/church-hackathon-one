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
      return userWorkspaceStub(owned.userId).previewLearnAttempt(planId, attempt);
    },
    recordPlanAttempt: async (record) => {
      if (owned instanceof Response) throw new Error("Sign in required.");
      const scope = await userWorkspaceStub(owned.userId).learnScopeForPlan(planId);
      return owned.stub.recordLearnAttempt({
        ...record,
        planId,
        ...(scope ? { projectId: scope.projectId } : {}),
      });
    },
    mirrorAttempt: async (input) => {
      if (owned instanceof Response) throw new Error("Sign in required.");
      return userWorkspaceStub(owned.userId).mirrorLearnAttempt(planId, input);
    },
  });
}
