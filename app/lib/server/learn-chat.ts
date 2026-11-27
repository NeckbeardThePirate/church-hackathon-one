import { callAnthropic, learnModelId, readAnthropicText, type LlmEnv } from "./learn/llm";
import { SOURCE_TEXT_RULE } from "./learn/source-policy";
import type { LearnChatContext, LearnChatInput, LearnChatMessage, SerializedLesson } from "../learn/agent-context";

const clip = (text: string | undefined, n: number) => {
  const t = (text ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

const SYSTEM = `You are a patient tutor inside a structured learning course. The learner sees one screen at a time; you receive the course metadata and the materials for their current focus (overview, one lesson, or final assessment).

Rules:
- Ground explanations in the TEACHING text and in scripture, confession, or church-father passages provided in the context.
- ${SOURCE_TEXT_RULE}
- When the focus is a practice (gap) lesson or a review item, use the same rule: quote only the retrieved wording in that focus, and do not write any other verse, confession, or church-father text.
- When mentioning a video, article, or book, name it and you may mention its URL from the context.
- Do not invent resources, URLs, or ratings that are not in the context.
- Quiz: help the learner think through questions without giving away answers unless they paste their attempt and ask you to check it, or they explicitly ask for the answer key.
- If the course perspective is not "neutral", teach primarily from that tradition while noting other views when relevant. If neutral, present major views fairly.
- Use plain Markdown: short paragraphs, **bold** for key terms, "- " bullets. No headings above ###.
- Be concise unless the learner asks for depth.`;

function formatLesson(ctx: LearnChatContext): string {
  const lesson = ctx.lesson;
  if (!lesson) return "";
  const parts = [
    `Lesson ${lesson.order}: ${lesson.title} (~${lesson.estimatedMinutes} min)`,
    lesson.kind === "gap"
      ? "This is a practice lesson for missed ideas. Scripture and historical sources below were retrieved from the library."
      : "",
    lesson.objectives.length ? `Objectives:\n${lesson.objectives.map((o) => `- ${o}`).join("\n")}` : "",
    lesson.teaching ? `Teaching:\n"""\n${lesson.teaching}\n"""` : "",
    lesson.videos.length
      ? `Videos:\n${lesson.videos
          .map(
            (v) =>
              `- ${v.title}${v.channel ? ` (${v.channel})` : ""} [${v.reviewBasis} review]: ${clip(v.review, 900)}\n  ${v.url}`,
          )
          .join("\n")}`
      : "",
    lesson.articles.length
      ? `Articles:\n${lesson.articles
          .map((a) => `- ${a.title}${a.siteName ? ` · ${a.siteName}` : ""}: ${clip(a.review, 900)}\n  ${a.url}`)
          .join("\n")}`
      : "",
    lesson.books.length
      ? `Books:\n${lesson.books
          .map((b) => `- ${b.title} (${b.authors.join(", ")}): ${clip(b.review, 900)}\n  ${b.url}`)
          .join("\n")}`
      : "",
    lesson.scripture.length
      ? `Scripture (retrieved from the library):\n${lesson.scripture
          .map((s) => `- ${s.reference}: ${clip(s.text, 2000)}${s.note ? `\n  Note: ${s.note}` : ""}`)
          .join("\n\n")}`
      : "",
    lesson.library?.length
      ? `Confessions and church fathers (retrieved from the library):\n${lesson.library
          .map(
            (item) =>
              `- ${item.label}${item.condemned ? " [condemned]" : ""}${item.detail ? ` (${item.detail})` : ""}: ${clip(item.text, 1500)}`,
          )
          .join("\n\n")}`
      : "",
    lesson.quiz.length
      ? `Quiz (questions only — do not reveal answers unprompted):\n${lesson.quiz
          .map((q, i) => {
            const choices = q.choices?.length ? `\n  Choices: ${q.choices.join(" | ")}` : "";
            return `${i + 1}. [${q.kind}] ${q.question}${choices}${q.sourceRef ? ` (ties to: ${q.sourceRef})` : ""}`;
          })
          .join("\n")}`
      : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

function formatRetrieved(lesson: SerializedLesson): string {
  const scripture = lesson.scripture.length
    ? `Scripture (retrieved from the library):\n${lesson.scripture
        .map((s) => `- ${s.reference}: ${clip(s.text, 2000)}`)
        .join("\n\n")}`
    : "";
  const library = lesson.library?.length
    ? `Confessions and church fathers (retrieved from the library):\n${lesson.library
        .map(
          (item) =>
            `- ${item.label}${item.condemned ? " [condemned]" : ""}${item.detail ? ` (${item.detail})` : ""}: ${clip(item.text, 1500)}`,
        )
        .join("\n\n")}`
    : "";
  return [scripture, library].filter(Boolean).join("\n\n");
}

function formatReview(ctx: LearnChatContext): string {
  const review = ctx.review;
  if (!review) return "";
  const retrieved = review.lesson ? formatRetrieved(review.lesson) : "";
  return [
    "Current review item. The question comes from the teach-time quiz bank. Do not reveal the answer unless the learner asks for it.",
    `Concept: ${review.conceptLabel}`,
    `Question: ${review.question}`,
    review.lesson?.kind === "gap" ? "The source is a practice lesson." : "",
    retrieved || "No retrieved scripture or historical source is in the context for this item. Do not supply that wording.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildContextBlock(ctx: LearnChatContext): string {
  const focusLine = ctx.review
    ? `Current focus: Review — ${ctx.review.conceptLabel}`
    : ctx.focus.screen === "lesson" && ctx.focus.lessonTitle
      ? `Current focus: Lesson ${ctx.focus.lessonOrder ?? "?"} — ${ctx.focus.lessonTitle}`
      : ctx.focus.screen === "final"
        ? "Current focus: Final assessment (whole course)"
        : "Current focus: Course overview";

  const parts = [
    `Course: ${ctx.title}`,
    `Topic: ${ctx.topic}`,
    `Complexity: ${ctx.complexity} · Perspective: ${ctx.perspective}`,
    focusLine,
    ctx.objectives.length ? `Course objectives:\n${ctx.objectives.map((o) => `- ${o}`).join("\n")}` : "",
    ctx.prerequisites.length ? `Prerequisites:\n${ctx.prerequisites.map((p) => `- ${p}`).join("\n")}` : "",
    ctx.courseBooks?.length
      ? `Course reading list:\n${ctx.courseBooks
          .map((b) => `- ${b.title} (${b.authors.join(", ")}): ${clip(b.review, 600)}`)
          .join("\n")}`
      : "",
    ctx.lessonOutline?.length
      ? `Lesson map:\n${ctx.lessonOutline.map((l) => `- L${l.order} ${l.title}`).join("\n")}`
      : "",
    ctx.finalQuestions?.length
      ? `Final assessment questions:\n${ctx.finalQuestions.map((q, i) => `${i + 1}. [${q.kind}] ${q.question}`).join("\n")}`
      : "",
    formatReview(ctx),
    formatLesson(ctx),
  ];
  return parts.filter(Boolean).join("\n\n");
}

function parseSseLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return "";
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return "";
  try {
    const json = JSON.parse(payload) as {
      type?: string;
      delta?: { type?: string; text?: string };
      response?: unknown;
      choices?: { delta?: { content?: unknown } }[];
    };
    if (json.type === "content_block_delta" && json.delta?.type === "text_delta" && typeof json.delta.text === "string") {
      return json.delta.text;
    }
    if (typeof json.response === "string") return json.response;
    const content = json.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
}

function textStreamFrom(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const delta = parseSseLine(line);
          if (delta) controller.enqueue(encoder.encode(delta));
        }
      },
      flush(controller) {
        const delta = parseSseLine(buffer);
        if (delta) controller.enqueue(encoder.encode(delta));
      },
    }),
  );
}

function onceText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      if (text) controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

type ChatEnv = Pick<LlmEnv, "AI" | "AI_GATEWAY_ID" | "AI_GATEWAY_TOKEN" | "ANTHROPIC_API_KEY" | "LEARN_MODEL_WORKER">;

export async function streamLearnChat(env: ChatEnv, input: LearnChatInput): Promise<ReadableStream<Uint8Array>> {
  const history = (input.messages ?? [])
    .filter((m): m is LearnChatMessage => (m.role === "user" || m.role === "assistant") && !!m.content?.trim())
    .slice(-16)
    .map((m) => ({ role: m.role, content: clip(m.content, 4000) }));

  if (!history.length || history.at(-1)?.role !== "user") {
    throw new Error("messages must end with a user turn");
  }

  const system = `${SYSTEM}\n\n${buildContextBlock(input.context)}`;
  const model = learnModelId(env, "worker");

  if (model.startsWith("anthropic/")) {
    const result = await callAnthropic(env, model, {
      max_tokens: 1800,
      stream: true,
      system,
      messages: history,
    });
    if (typeof Response !== "undefined" && result instanceof Response) {
      if (!result.ok || !result.body) {
        const detail = (await result.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 500);
        throw new Error(`Anthropic via gateway: ${result.status}${detail ? ` ${detail}` : ""}`);
      }
      return textStreamFrom(result.body);
    }
    return onceText(await readAnthropicText(result));
  }

  const upstream = (await env.AI.run(
    model as Parameters<Ai["run"]>[0],
    {
      messages: [{ role: "system", content: system }, ...history],
      stream: true,
      max_tokens: 1800,
      temperature: 0.45,
    } as never,
  )) as unknown as ReadableStream<Uint8Array>;

  return textStreamFrom(upstream);
}
