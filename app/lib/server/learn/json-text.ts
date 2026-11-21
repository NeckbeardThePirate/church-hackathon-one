/** Pull the first JSON object out of a model response. No Worker imports, so tests can load it. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const pieces: string[] = [];
  for (const match of trimmed.matchAll(/```(?:json)?[^\n]*\n?([\s\S]*?)```/gi)) {
    const body = match[1]?.trim();
    if (body) pieces.push(body);
  }
  const unfenced = trimmed.replace(/```(?:json)?[^\n]*\n?/gi, "").replace(/```/g, "").trim();
  if (unfenced) pieces.push(unfenced);

  let lastSyntax = "";
  let sawObject = false;
  for (const piece of pieces) {
    const parsed = parseFirstObject(piece);
    if (parsed.status === "none") continue;
    if (parsed.status === "ok") return parsed.value;
    sawObject = true;
    lastSyntax = parsed.error;
  }
  if (sawObject && lastSyntax) throw new Error(lastSyntax);
  throw new Error("No JSON object in model output.");
}

function parseFirstObject(
  text: string,
): { status: "ok"; value: unknown } | { status: "bad"; error: string } | { status: "none" } {
  let from = 0;
  let lastError = "";
  let saw = false;
  while (from < text.length) {
    const start = text.indexOf("{", from);
    if (start === -1) break;
    const end = balancedEnd(text, start);
    if (end === -1) break;
    saw = true;
    try {
      return { status: "ok", value: JSON.parse(text.slice(start, end + 1)) };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      from = start + 1;
    }
  }
  if (!saw) return { status: "none" };
  return { status: "bad", error: lastError };
}

function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
