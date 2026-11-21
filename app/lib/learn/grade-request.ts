import { parseGradeModel, type GradeInput, type GradeResult } from "./grade-answer.ts";

type Owned = { userId: string } | Response;

const MAX_QUESTION = 2000;
const MAX_ANSWER = 4000;

export type GradeDeps = {
  owned: Owned;
  readBody: () => Promise<unknown>;
  grade: (input: GradeInput) => Promise<GradeResult>;
};

function parseGradeBody(body: unknown): { ok: true; input: GradeInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Grade body must be an object." };
  const raw = body as Record<string, unknown>;
  if (typeof raw.question !== "string" || !raw.question.trim() || raw.question.length > MAX_QUESTION) {
    return { ok: false, error: "question is required." };
  }
  if (typeof raw.expected !== "string" || !raw.expected.trim() || raw.expected.length > MAX_ANSWER) {
    return { ok: false, error: "expected is required." };
  }
  if (typeof raw.given !== "string" || raw.given.length > MAX_ANSWER) {
    return { ok: false, error: "given must be a string." };
  }
  if (!raw.given.trim()) return { ok: false, error: "given is empty." };
  const rationale = typeof raw.rationale === "string" ? raw.rationale.slice(0, MAX_ANSWER) : undefined;
  return {
    ok: true,
    input: { question: raw.question.trim(), expected: raw.expected.trim(), given: raw.given.trim(), ...(rationale ? { rationale } : {}) },
  };
}

/** POST /api/learn/plans/[planId]/grade. Auth failures are returned before the model is called. */
export async function handleGrade(deps: GradeDeps): Promise<Response> {
  if (deps.owned instanceof Response) return deps.owned;
  let body: unknown;
  try {
    body = await deps.readBody();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = parseGradeBody(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    const grade = parseGradeModel(await deps.grade(parsed.input));
    return Response.json(grade);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not grade the answer.";
    return Response.json({ error: message }, { status: 500 });
  }
}
