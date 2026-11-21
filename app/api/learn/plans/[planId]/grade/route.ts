import { handleGrade } from "../../../../../lib/learn/grade-request.ts";
import type { GradeInput } from "../../../../../lib/learn/grade-answer.ts";
import { gradeWithLearnModel } from "../../../../../lib/server/learn/grade-short.ts";
import { learnEnv, ownedPlan } from "../../../../../lib/server/learn/api.ts";

export const dynamic = "force-dynamic";

/** Grade one free-text answer on the Learn model (Haiku 5.5 by default). */
export async function POST(request: Request, context: { params: Promise<{ planId: string }> }): Promise<Response> {
  const { planId } = await context.params;
  const owned = await ownedPlan(request, planId);
  return handleGrade({
    owned,
    readBody: () => request.json(),
    grade: (input: GradeInput) => {
      if (owned instanceof Response) return Promise.reject(new Error("Sign in required."));
      return gradeWithLearnModel(learnEnv(), owned.userId, planId, input);
    },
  });
}
