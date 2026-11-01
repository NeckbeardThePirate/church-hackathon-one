import { createBlock, type BlockContent, type DeeperState } from "./projects";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Inline markdown (**bold**, *italic*) → editor HTML. Citations like [Romans 3:28] stay as text. */
function inlineHtml(text: string): string {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\s][^*]*)\*/g, "<em>$1</em>");
}

/** Simple markdown → editor blocks (headings, bullets, numbered, paragraphs). */
export function markdownToBlocks(markdown: string): BlockContent[] {
  const out: BlockContent[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(createBlock("paragraph", inlineHtml(para.join(" "))));
    para = [];
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (heading) {
      flush();
      out.push(createBlock("heading2", inlineHtml(heading[1]!)));
    } else if (bullet) {
      flush();
      out.push(createBlock("bullet", inlineHtml(bullet[1]!)));
    } else if (numbered) {
      flush();
      out.push(createBlock("numbered", inlineHtml(numbered[1]!)));
    } else {
      para.push(line);
    }
  }
  flush();
  return out;
}

/**
 * Turns a Go Deeper thread into the blocks of a study sub-page.
 * The thread itself is kept (minimized) at the end so the conversation can continue there.
 */
export function deeperToPageBlocks(state: DeeperState): BlockContent[] {
  const blocks: BlockContent[] = [];
  const source = createBlock("quote", esc(state.text));
  blocks.push(source);

  const [explanation, ...rest] = state.messages ?? [];
  if (explanation?.content.trim()) {
    blocks.push(createBlock("heading2", "Explanation"), ...markdownToBlocks(explanation.content));
  }

  if (rest.some((m) => m.content.trim())) {
    blocks.push(createBlock("heading2", "Discussion"));
    for (const m of rest) {
      if (!m.content.trim()) continue;
      if (m.role === "user") blocks.push(createBlock("paragraph", `<strong>Q:</strong> ${inlineHtml(m.content)}`));
      else blocks.push(...markdownToBlocks(m.content));
    }
  }

  const data = state.data;
  if (data?.crossReferences.length) {
    blocks.push(createBlock("heading2", "Scripture"));
    // A bare reference per paragraph: scripture enrichment links it and inserts the BSB text.
    for (const ref of data.crossReferences) {
      blocks.push(createBlock("paragraph", `${esc(ref.reference)}${ref.note ? ` — ${esc(ref.note)}` : ""}`));
    }
  }

  if (data?.fathers.length) {
    blocks.push(createBlock("heading2", "Church Fathers"));
    for (const f of data.fathers) {
      const who = [f.author, f.work, f.year ? `c. ${f.year}` : null, `on ${f.passage}`].filter(Boolean).join(", ");
      blocks.push(createBlock("quote", `${esc(f.text)}<br>— ${esc(who)}`));
      if (f.note) blocks.push(createBlock("paragraph", `<em>${esc(f.note)}</em>`));
    }
  }

  if (data?.confessions.length) {
    blocks.push(createBlock("heading2", "Confessions"));
    for (const c of data.confessions) {
      blocks.push(createBlock("quote", `${esc(c.text)}<br>— ${esc([c.document, c.label].filter(Boolean).join(" "))}`));
      if (c.note) blocks.push(createBlock("paragraph", `<em>${esc(c.note)}</em>`));
    }
  }

  if (data?.furtherReading?.length) {
    blocks.push(createBlock("heading2", "Further reading"));
    for (const r of data.furtherReading) {
      const label = r.kind === "search" ? `${r.source}: ${r.description ?? "Search"} for “${r.title}”` : `${r.title} (${r.source})`;
      blocks.push(
        createBlock("bullet", `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`),
      );
    }
  }

  blocks.push({
    ...createBlock("paragraph", ""),
    kind: "deeper",
    deeper: { ...state, sourceBlockId: source.id, collapsed: true },
  });
  blocks.push(createBlock("paragraph", ""));
  return blocks;
}
