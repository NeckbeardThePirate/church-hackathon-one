import type { GradeInput, GradeResult } from "../../learn/grade-answer.ts";
import { GRADE_SYSTEM, gradeShortAnswerLocal, gradeUserPrompt, parseGradeModel } from "../../learn/grade-answer.ts";
import { LEARN_MAX_TOKENS, llmJson, type LlmEnv } from "./llm.ts";

/**
 * Grade on the Learn worker model (Claude Haiku 5.5 when LEARN_MODEL_WORKER is empty).
 * A model failure falls back to the semantic key-concept grader so a paraphrase is not marked wrong.
 */
export async function gradeWithLearnModel(
  env: LlmEnv,
  userId: string,
  planId: string,
  input: GradeInput,
): Promise<GradeResult> {
  if (env.MOCK_AI === "1") return gradeShortAnswerLocal(input.given, input.expected);
  try {
    return await llmJson(env, {
      role: "worker",
      system: GRADE_SYSTEM,
      user: gradeUserPrompt(input),
      meta: { planId, stage: "grade" },
      maxTokens: LEARN_MAX_TOKENS,
      temperature: 0,
      userId,
      validate: parseGradeModel,
    });
  } catch {
    return gradeShortAnswerLocal(input.given, input.expected);
  }
}
