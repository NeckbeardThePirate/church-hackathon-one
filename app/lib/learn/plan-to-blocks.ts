import { bibleGatewayEsvUrl } from "../bible/bible-gateway";
import { createBlock, type BlockContent } from "../projects";
import type { LearnLesson, LearnPlan, QuizItem } from "./types";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function quizBlocks(items: QuizItem[], heading: string): BlockContent[] {
  if (!items.length) return [];
  const out: BlockContent[] = [createBlock("heading2", esc(heading))];
  items.forEach((item) => {
    out.push(createBlock("numbered", esc(item.question)));
    for (const choice of item.choices ?? []) out.push(createBlock("bullet", esc(choice)));
  });
  // Answers grouped after the questions so they don't give themselves away.
  out.push(createBlock("heading2", "Answer key"));
  items.forEach((item, i) => {
    out.push(
      createBlock(
        "paragraph",
        `<strong>${i + 1}.</strong> ${esc(item.answer)}${item.rationale ? ` — ${esc(item.rationale)}` : ""}`,
      ),
    );
  });
  return out;
}

function lessonBlocks(lesson: LearnLesson, total: number): BlockContent[] {
  const out: BlockContent[] = [
    createBlock("heading1", esc(`Lesson ${lesson.order} of ${total}: ${lesson.title}`)),
    createBlock("paragraph", `<em>About ${lesson.estimatedMinutes} min${lesson.status === "degraded" ? " · incomplete" : ""}</em>`),
    createBlock("heading2", "You will be able to"),
    ...lesson.objectives.map((o) => createBlock("bullet", esc(o))),
  ];

  for (const block of lesson.teaching) {
    out.push(block.type === "divider" ? createBlock("divider") : createBlock(block.type, esc(block.text)));
  }

  const link = (url: string, title: string) =>
    `<a href="${esc(url).replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>`;
  const tag = (p?: string) => (p && p !== "Unclear" ? ` <em>[${esc(p)}]</em>` : "");

  if (lesson.videos.length) {
    out.push(createBlock("heading2", "Watch"));
    for (const v of lesson.videos) {
      out.push(
        createBlock(
          "bullet",
          `${link(v.url, v.title)}${v.channel ? ` · ${esc(v.channel)}` : ""}${tag(v.perspective)}${
            v.review ? ` — ${esc(v.review)} <em>(reviewed from description)</em>` : ""
          }`,
        ),
      );
    }
  }

  if (lesson.articles.length) {
    out.push(createBlock("heading2", "Read"));
    for (const a of lesson.articles) {
      out.push(
        createBlock(
          "bullet",
          `${link(a.url, a.title)}${a.siteName ? ` · ${esc(a.siteName)}` : ""}${tag(a.perspective)}${
            a.review ? ` — ${esc(a.review)}` : ""
          }`,
        ),
      );
    }
  }

  if (lesson.library?.length) {
    out.push(createBlock("heading2", "Confessions and church fathers"));
    for (const item of lesson.library) {
      const label = item.condemned ? `${item.label} (condemned)` : item.label;
      const title = item.url ? link(item.url, label) : esc(label);
      out.push(
        createBlock(
          "quote",
          `${title}${item.detail ? ` · ${esc(item.detail)}` : ""}<br>${esc(item.text)}${
            item.note ? `<br><em>${esc(item.note)}</em>` : ""
          }`,
        ),
      );
    }
  }

  if (lesson.scripture.length) {
    out.push(createBlock("heading2", "Scripture readings"));
    for (const reading of lesson.scripture) {
      out.push({
        ...createBlock("quote", esc(reading.text)),
        bibleReference: reading.reference,
        bibleGatewayUrl: bibleGatewayEsvUrl(reading.reference),
      });
      if (reading.note) out.push(createBlock("paragraph", `<em>${esc(reading.note)}</em>`));
    }
  }

  out.push(...quizBlocks(lesson.quiz, "Check your understanding"));

  if (lesson.warnings.length) {
    out.push(createBlock("heading2", "Notes from the plan builder"));
    for (const w of lesson.warnings) out.push(createBlock("bullet", esc(w)));
  }
  out.push(createBlock("divider"));
  return out;
}

export function planToBlocks(plan: LearnPlan): BlockContent[] {
  const totalMin = plan.lessons.reduce((n, l) => n + l.estimatedMinutes, 0);
  const out: BlockContent[] = [
    createBlock(
      "paragraph",
      `<em>${plan.lessons.length} lesson${plan.lessons.length === 1 ? "" : "s"} · about ${Math.round(totalMin / 5) * 5} min · ${
        plan.complexity
      } topic${plan.perspective !== "neutral" ? ` · ${esc(plan.perspective)} perspective` : ""}${
        plan.status === "partial" ? " · partial plan" : ""
      }</em>`,
    ),
    createBlock("heading2", "Course goals"),
    ...plan.objectives.map((o) => createBlock("bullet", esc(o))),
  ];
  if (plan.prerequisites.length) {
    out.push(createBlock("heading2", "Before you start"));
    out.push(...plan.prerequisites.map((p) => createBlock("bullet", esc(p))));
  }
  out.push(createBlock("divider"));
  for (const lesson of plan.lessons) out.push(...lessonBlocks(lesson, plan.lessons.length));
  if (plan.finalAssessment.length) {
    out.push(createBlock("heading1", "Final assessment"));
    out.push(...quizBlocks(plan.finalAssessment, "Questions"));
  }
  if (plan.warnings.length) {
    out.push(createBlock("heading2", "Plan notes"));
    out.push(...plan.warnings.map((w) => createBlock("bullet", esc(w))));
  }
  return out;
}
