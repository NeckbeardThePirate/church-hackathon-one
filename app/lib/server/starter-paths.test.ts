import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { gradeShortAnswerLocal } from "../learn/grade-answer.ts";
import { shouldOfferStarterPath } from "../learn/starter-offer.ts";
import { isStarterPlanId } from "../learn/starters.ts";
import type { LearnLesson, QuizItem } from "../learn/types.ts";
import { WORKSPACE_SCHEMA_VERSION } from "./user-workspace-schema.ts";
import { materializeStarter, seedStarterIntoWorkspace, type WorkspaceSeed } from "./starter-paths.ts";
import { env as workersEnv } from "./learn/cloudflare-workers-stub.ts";
import { SESSION_COOKIE, signSession } from "./session.ts";

const SECRET = "starter-path-test-secret";
const HESED_PARAPHRASE = "covenant loyalty and steadfast kindness shown within a relationship";
const LORDS_PARAPHRASE =
  "both start by calling God Father and ask for daily food; Matthew's is longer, with extra lines Luke leaves out";

test("an empty workspace offers a starter, and any real path hides it", () => {
  assert.equal(shouldOfferStarterPath([]), true);
  assert.equal(
    shouldOfferStarterPath([{ kind: "learn", title: "", learnPlan: undefined, learnPlanId: undefined }]),
    true,
  );
  assert.equal(shouldOfferStarterPath([{ kind: "learn", title: "Romans", learnPlan: undefined, learnPlanId: undefined }]), false);
  assert.equal(shouldOfferStarterPath([{ kind: "lesson", title: "Archived", learnPlan: undefined, learnPlanId: undefined }]), false);
});

test("the honesty note is unchanged and the starter card does not use browser dialogs", () => {
  const note = readFileSync(new URL("../../components/SourceNote.tsx", import.meta.url), "utf8");
  const card = readFileSync(new URL("../../components/StarterPathCard.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../components/WorkspaceApp.tsx", import.meta.url), "utf8");
  const builder = readFileSync(new URL("./starter-paths.ts", import.meta.url), "utf8");
  assert.match(
    note,
    /home:\s*"Lessons and quizzes are AI-generated\. Scripture and historical sources are retrieved from the library, not written by the model\."/,
  );
  assert.match(card, /<SourceNote place="home" compact \/>/);
  assert.match(app, /shouldOfferStarterPath\(projects\)/);
  assert.doesNotMatch(card, /\b(alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(app, /\b(alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(builder, /enqueue\(|learn\/llm/);
  assert.equal(WORKSPACE_SCHEMA_VERSION, 3);
});

test("a starter with no Bible library uses bundled wording, a gap lesson, and gradeable quiz keys", async () => {
  const ruth = await materializeStarter("ruth", {}, 40);
  assert.equal(ruth.importComplete, true);
  assert.equal(ruth.learnPlanId, undefined);
  assert.equal(ruth.learnPlan?.status, "complete");
  assert.equal(isStarterPlanId(ruth.learnPlan?.id ?? ""), true);
  assert.equal(ruth.title, "The Book of Ruth");
  const lessons = ruth.learnPlan?.lessons ?? [];
  const gap = lessons.find((lesson) => lesson.kind === "gap");
  assert.ok(gap);
  assert.equal(gap.sourceLessonId, "l1");
  assert.ok(gap.teaching.length > 0);
  assert.ok(gap.quiz.length > 0);
  assert.equal(gap.scripture[0]?.textSource, "bundled");
  assert.match(gap.scripture[0]?.text ?? "", /Intreat me not to leave thee/);
  assert.ok(lessons.every((lesson) => lesson.quiz.length > 0 && lesson.scripture.length > 0 && (lesson.library?.length ?? 0) > 0));
  const hesed = shortItem(lessons, /hesed/i);
  assert.equal(gradeShortAnswerLocal(HESED_PARAPHRASE, hesed.answer).correct, true);

  const lords = await materializeStarter("lords-prayer", {}, 40);
  assert.equal(lords.title, "The Lord’s Prayer");
  const compare = shortItem(lords.learnPlan?.lessons ?? [], /shared and one varying/i);
  assert.equal(gradeShortAnswerLocal(LORDS_PARAPHRASE, compare.answer).correct, true);
  assert.ok((lords.learnPlan?.finalAssessment.length ?? 0) >= 3);
  assert.equal(lords.learnPlan?.lessons.some((lesson) => lesson.kind === "gap" && lesson.title.includes("Line-by-line")), true);
});

test("D1 rows replace bundled scripture and confessions, and a miss keeps the bundle", async () => {
  const ruth = await materializeStarter("ruth", { BIBLE: fakeBible() }, 40);
  const first = ruth.learnPlan?.lessons[0];
  assert.equal(first?.scripture[0]?.textSource, "d1");
  assert.match(first?.scripture[0]?.text ?? "", /D1-RUTH-16/);
  assert.doesNotMatch(first?.scripture[0]?.text ?? "", /Intreat/);
  assert.equal(first?.library?.[0]?.textSource, "d1");
  assert.match(first?.library?.[0]?.text ?? "", /D1-WCF-PROVIDENCE/);
  const wings = ruth.learnPlan?.lessons.find((lesson) => lesson.id === "l2");
  assert.equal(wings?.scripture[0]?.textSource, "bundled");
  assert.match(wings?.scripture[0]?.text ?? "", /under whose wings/);
  const chrysostom = wings?.library?.find((item) => item.source === "father");
  assert.equal(chrysostom?.textSource, "bundled");
  assert.match(chrysostom?.text ?? "", /gift from above/);
});

type SqlCursor = { one(): Record<string, unknown>; toArray(): Record<string, unknown>[] };

function sqliteSql(db: DatabaseSync) {
  return {
    exec(query: string, ...bindings: unknown[]): SqlCursor {
      const statement = db.prepare(query);
      const read = /^\s*(select|with)\b/i.test(query);
      const rows = (read ? statement.all(...(bindings as (string | number | null | bigint)[])) : []) as Record<string, unknown>[];
      if (!read) statement.run(...(bindings as (string | number | null | bigint)[]));
      return {
        one: () => {
          const row = rows[0];
          if (!row) throw new Error(`Expected a row for: ${query}`);
          return row;
        },
        toArray: () => rows,
      };
    },
  };
}

async function bootWorkspace() {
  const { UserWorkspaceDO } = await import("./user-workspace-do.ts");
  const db = new DatabaseSync(":memory:");
  let ready = Promise.resolve();
  const workspace = new UserWorkspaceDO(
    {
      storage: { sql: sqliteSql(db) },
      blockConcurrencyWhile(task: () => Promise<void>) {
        ready = task();
      },
    } as never,
    {} as never,
  );
  await ready;
  return workspace;
}

test("seeding writes one workspace project and does not touch a workspace that already has a path", async () => {
  const workspace = await bootWorkspace();
  let writes = 0;
  const seed: WorkspaceSeed = {
    listProjects: () => workspace.listProjects(),
    upsertProject: (input) => {
      writes += 1;
      return workspace.upsertProject(input);
    },
  };
  const first = await seedStarterIntoWorkspace(seed, {}, "ruth", 10);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.created, true);
  assert.equal(writes, 1);
  const stored = workspace.getProject("starter-ruth");
  assert.equal(stored?.learnPlan?.lessons.some((lesson) => lesson.kind === "gap"), true);
  assert.equal(stored?.importComplete, true);

  const again = await seedStarterIntoWorkspace(seed, {}, "ruth", 99);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.created, false);
  assert.equal(again.project.updatedAt, 10);
  assert.equal(writes, 1);
  assert.equal(workspace.listProjects().length, 1);

  workspace.upsertProject({
    id: "owned",
    kind: "learn",
    title: "Already mine",
    blocks: [],
    updatedAt: 5,
    importComplete: true,
  });
  const blocked = await seedStarterIntoWorkspace(
    {
      listProjects: () => workspace.listProjects().filter((project) => project.id !== "starter-ruth"),
      upsertProject: () => {
        throw new Error("should not write");
      },
    },
    {},
    "lords-prayer",
    20,
  );
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.status, 409);
  assert.equal(workspace.getProject("starter-lords-prayer"), null);
});

function installEnv(workspace: WorkspaceSeed, bible?: unknown): { opens: () => number } {
  for (const key of Object.keys(workersEnv)) delete workersEnv[key];
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_PUBLISHABLE_KEY;
  workersEnv.SESSION_SECRET = SECRET;
  let opened = 0;
  workersEnv.USER_WORKSPACE = {
    getByName() {
      opened += 1;
      return workspace;
    },
  };
  if (bible) workersEnv.BIBLE = bible;
  return { opens: () => opened };
}

async function signedRequest(path: string, userId: string, body: unknown): Promise<Request> {
  const token = await signSession(
    { userId, provider: "dev", compute: false, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
  return new Request(`https://study.example${path}`, {
    method: "POST",
    headers: {
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("the starter route rejects signed-out callers, seeds an empty workspace, and refuses a second path", async () => {
  const workspace = await bootWorkspace();
  const tracker = installEnv(workspace);
  const { POST } = await import("../../api/workspace/starter/route.ts");
  const signedOut = await POST(new Request("https://study.example/api/workspace/starter", { method: "POST" }));
  assert.equal(signedOut.status, 401);
  assert.equal(tracker.opens(), 0);

  const created = await POST(await signedRequest("/api/workspace/starter", "user_a", { id: "lords-prayer" }));
  assert.equal(created.status, 201);
  const createdBody = (await created.json()) as { created?: boolean; project?: { id?: string; title?: string; learnPlan?: { lessons?: { kind?: string }[] } } };
  assert.equal(createdBody.created, true);
  assert.equal(createdBody.project?.id, "starter-lords-prayer");
  assert.equal(createdBody.project?.title, "The Lord’s Prayer");
  assert.equal(createdBody.project?.learnPlan?.lessons?.some((lesson) => lesson.kind === "gap"), true);
  assert.equal(workspace.getProject("starter-lords-prayer")?.learnPlan?.status, "complete");

  const repeat = await POST(await signedRequest("/api/workspace/starter", "user_a", { id: "lords-prayer" }));
  assert.equal(repeat.status, 200);
  const repeatBody = (await repeat.json()) as { created?: boolean };
  assert.equal(repeatBody.created, false);
  assert.equal(workspace.listProjects().length, 1);

  const unknown = await POST(await signedRequest("/api/workspace/starter", "user_a", { id: "jonah" }));
  assert.equal(unknown.status, 400);

  workspace.deleteProject("starter-lords-prayer");
  workspace.upsertProject({
    id: "owned",
    kind: "learn",
    title: "Already mine",
    blocks: [],
    updatedAt: 5,
    importComplete: true,
  });
  const refused = await POST(await signedRequest("/api/workspace/starter", "user_a", { id: "ruth" }));
  assert.equal(refused.status, 409);
  assert.equal(workspace.getProject("starter-ruth"), null);
  assert.equal(workspace.getProject("owned")?.title, "Already mine");
});

function shortItem(lessons: LearnLesson[], question: RegExp): QuizItem {
  const item = lessons.flatMap((lesson) => lesson.quiz).find((quiz) => quiz.kind === "short" && question.test(quiz.question));
  assert.ok(item, `missing short item ${question}`);
  return item;
}

function fakeBible(): D1Database {
  const verses = [
    { book_id: 8, chapter: 1, verse: 16, text: "D1-RUTH-16" },
    { book_id: 8, chapter: 1, verse: 17, text: "D1-RUTH-17" },
  ];
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async all() {
              if (sql.includes("bible_verses")) {
                const [bookId, chapter, start, end] = args as number[];
                return {
                  results: verses
                    .filter((row) => row.book_id === bookId && row.chapter === chapter && row.verse >= start && row.verse <= end)
                    .map((row) => ({ verse: row.verse, text: row.text })),
                };
              }
              if (sql.includes("confession_sections") && String(args[2] ?? "") === "5.1") {
                return {
                  results: [
                    {
                      id: "d1-wcf-5-1",
                      doc_title: "Westminster Confession of Faith",
                      label: "5.1",
                      title: "Of Providence",
                      text: "D1-WCF-PROVIDENCE",
                    },
                  ],
                };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}
