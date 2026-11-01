import { REFINE_MODEL } from "./refine-ocr";

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** Compact source bundle the client already has from /api/study/deeper. */
export type DeeperChatSources = {
  theme?: string;
  crossReferences?: { reference: string; text?: string; note?: string }[];
  fathers?: { author: string; work?: string | null; year?: number | null; passage?: string; text: string; condemned?: boolean }[];
  confessions?: { document: string; label?: string | null; text: string }[];
};

export type DeeperChatInput = {
  blockText: string;
  before?: string;
  after?: string;
  noteKind?: string;
  sources?: DeeperChatSources;
  messages?: ChatMessage[];
};

const clip = (text: string | undefined, n: number) => {
  const t = (text ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

const SYSTEM = `You are a warm, theologically careful Bible study companion inside a note-taking app.
You help the user understand ONE focused block of their notes, in light of the surrounding notes and the retrieved sources provided (Bible verses in the BSB, church father comments, and historic confessions).
Rules:
- Ground claims in the provided sources. Cite them inline in brackets, e.g. [Romans 3:28], [Augustine, On the Spirit and the Letter], [Heidelberg Q60].
- Never invent quotations. If you paraphrase a source, say so. If the sources don't cover something, say what is your own synthesis.
- Note where traditions differ instead of flattening disagreements. Flag any author marked condemned as outside orthodox consensus.
- Write in plain Markdown: short paragraphs, **bold** for key terms, "- " bullets. No headings larger than ###. Be concise.`;

function buildContext(input: DeeperChatInput): string {
  const s = input.sources ?? {};
  const parts = [
    input.noteKind ? `Note type: ${input.noteKind}` : "",
    input.before ? `Notes BEFORE the focused block:\n"""\n${clip(input.before, 2500)}\n"""` : "",
    `FOCUSED BLOCK:\n"""\n${clip(input.blockText, 2500)}\n"""`,
    input.after ? `Notes AFTER the focused block:\n"""\n${clip(input.after, 1200)}\n"""` : "",
    s.theme ? `Detected theme: ${s.theme}` : "",
    s.crossReferences?.length
      ? `Cross-references (BSB):\n${s.crossReferences
          .slice(0, 10)
          .map((r) => `- ${r.reference}: ${clip(r.text, 400)}${r.note ? ` (why: ${clip(r.note, 200)})` : ""}`)
          .join("\n")}`
      : "",
    s.fathers?.length
      ? `Church fathers:\n${s.fathers
          .slice(0, 8)
          .map(
            (f) =>
              `- ${f.author}${f.condemned ? " [condemned by council]" : ""}${f.work ? `, ${f.work}` : ""}${f.year ? ` (c. ${f.year})` : ""}${f.passage ? ` on ${f.passage}` : ""}: ${clip(f.text, 700)}`,
          )
          .join("\n")}`
      : "",
    s.confessions?.length
      ? `Confessions & catechisms:\n${s.confessions
          .slice(0, 8)
          .map((c) => `- ${c.document}${c.label ? ` ${c.label}` : ""}: ${clip(c.text, 600)}`)
          .join("\n")}`
      : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

const EXPLAIN_PROMPT = `Explain the focused block for deeper study. In about 150-250 words:
1. What it is saying and how it fits the surrounding notes.
2. How the cross-references illuminate it.
3. What the church fathers and confessions add (note agreement or tension).
End with one probing question for reflection.`;

/** Returns a ReadableStream of plain UTF-8 text deltas. */
export async function streamDeeperChat(ai: Ai, input: DeeperChatInput): Promise<ReadableStream<Uint8Array>> {
  const history = (input.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: clip(m.content, 4000) }));

  const messages = [
    { role: "system", content: `${SYSTEM}\n\n${buildContext(input)}` },
    // The first assistant turn is always the explanation; replay its prompt so follow-ups stay coherent.
    { role: "user", content: EXPLAIN_PROMPT },
    ...history,
  ];

  const upstream = (await ai.run(REFINE_MODEL, {
    messages,
    stream: true,
    reasoning_effort: "low",
    max_tokens: 1500,
    temperature: 0.4,
  } as never)) as unknown as ReadableStream<Uint8Array>;

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

/** Workers AI streams SSE; content lives in `response` (legacy) or `choices[0].delta.content` (OpenAI-style). */
function parseSseLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return "";
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return "";
  try {
    const json = JSON.parse(payload) as {
      response?: unknown;
      choices?: { delta?: { content?: unknown } }[];
    };
    if (typeof json.response === "string") return json.response;
    const content = json.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
}
