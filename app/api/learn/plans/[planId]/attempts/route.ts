import { handleLearnAttempt } from "@/app/lib/server/learn/attempt-response";
import { ownedPlan } from "@/app/lib/server/learn/api";
import { userWorkspaceStub } from "@/app/lib/server/user-workspace";

export const dynamic = "force-dynamic";

/** Record a lesson, final, or review attempt and return the plan's concept mastery. */
export async function POST(request: Request, context: { params: Promise<{ planId: string }> }): Promise<Response> {
  const { planId } = await context.params;
  const owned = await ownedPlan(request, planId);
  return handleLearnAttempt({
    owned,
    readBody: () => request.json(),
    loadProject: async () => {
      if (owned instanceof Response) return null;
      return userWorkspaceStub(owned.userId).findProjectByLearnPlan(planId);
    },
    loadPlanMastery: async () => {
      if (owned instanceof Response) return {};
      return owned.stub.getConceptMastery();
    },
    saveProject: async (project) => {
      if (owned instanceof Response) return;
      await userWorkspaceStub(owned.userId).upsertProject(project);
    },
    savePlanAttempt: async (record) => {
      if (owned instanceof Response) return;
      await owned.stub.recordLearnAttempt(record);
    },
  });
}
