"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_IMPORT_IMAGES, mergeStructuredText, runOcrForKey, uploadSourceImage } from "../lib/import-queue";
import { TRADITIONS, isPerspective, type Perspective } from "../lib/learn/types";
import { fetchLearnPerspective } from "../lib/workspace-sync";

export type StartPayload = {
  topic: string;
  notes: string;
  perspective: Perspective;
  includeScripture: "auto" | "yes" | "no";
  makeDefault: boolean;
};

type Props = {
  /** Draft project id; scopes image uploads. */
  projectId: string;
  starting: boolean;
  error: string | null;
  onStart: (payload: StartPayload) => void;
};

type Source = "topic" | "notes" | "passage" | "photo";

const SOURCES: { id: Source; label: string }[] = [
  { id: "topic", label: "Topic" },
  { id: "notes", label: "Notes" },
  { id: "passage", label: "Passage" },
  { id: "photo", label: "Photo" },
];

type Photo = { id: string; name: string; status: "reading" | "done" | "error"; message?: string };

const FIELD =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 py-3 text-base text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_srgb,var(--accent)_45%,var(--line))]";

/** Topic used when the learner starts from notes, a passage, or a photo alone. */
export function deriveTopic(topic: string, passage: string, notes: string): string {
  const t = topic.trim();
  if (t) return t;
  const p = passage.trim();
  if (p) return `Study of ${p}`.slice(0, 500);
  const firstLine = notes
    .split("\n")
    .map((line) => line.replace(/^\[.*\]$/, "").trim())
    .find((line) => line.length >= 3);
  return (firstLine ?? "").slice(0, 120);
}

export function LearnStartForm({ projectId, starting, error, onStart }: Props) {
  const [source, setSource] = useState<Source>("topic");
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [passage, setPassage] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [perspective, setPerspective] = useState<Perspective>("neutral");
  const [makeDefault, setMakeDefault] = useState(false);
  const [includeScripture, setIncludeScripture] = useState<"auto" | "yes" | "no">("auto");
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void fetchLearnPerspective().then((saved) => {
      if (live && isPerspective(saved)) setPerspective(saved);
    });
    return () => {
      live = false;
    };
  }, []);

  const readPhotos = useCallback(
    async (incoming: FileList | null) => {
      const files = [...(incoming ?? [])].filter((f) => f.type.startsWith("image/"));
      if (fileRef.current) fileRef.current.value = "";
      if (files.length === 0) return;
      setPhotoError(null);
      const room = Math.max(0, MAX_IMPORT_IMAGES - photos.length);
      if (room === 0) {
        setPhotoError(`Up to ${MAX_IMPORT_IMAGES} photos.`);
        return;
      }
      const batch = files.slice(0, room).map((file) => ({ file, id: crypto.randomUUID() }));
      if (files.length > room) setPhotoError(`Only ${room} more fit (max ${MAX_IMPORT_IMAGES}).`);
      setPhotos((prev) => [...prev, ...batch.map(({ file, id }) => ({ id, name: file.name, status: "reading" as const }))]);

      for (const { file, id } of batch) {
        try {
          const uploaded = await uploadSourceImage(projectId, file);
          const ocr = await runOcrForKey(projectId, uploaded.key);
          const text = ocr.extractedText?.trim() ?? "";
          if (!text) throw new Error(ocr.ocrError ?? "No text found in this photo.");
          setNotes((prev) => mergeStructuredText(prev, text, file.name));
          setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, status: "done" } : p)));
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : "Could not read this photo.";
          setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, status: "error", message } : p)));
        }
      }
    },
    [photos.length, projectId],
  );

  const reading = photos.some((p) => p.status === "reading");
  const derivedTopic = useMemo(() => deriveTopic(topic, passage, notes), [topic, passage, notes]);
  const canStart = !starting && !reading && derivedTopic.length >= 3;

  const filled: Record<Source, boolean> = {
    topic: topic.trim().length > 0,
    notes: notes.trim().length > 0,
    passage: passage.trim().length > 0,
    photo: photos.some((p) => p.status === "done"),
  };

  const submit = () => {
    if (!canStart) return;
    const passageLine = passage.trim() ? `Passage: ${passage.trim()}` : "";
    const combined = [passageLine, notes.trim()].filter(Boolean).join("\n\n");
    onStart({ topic: derivedTopic, notes: combined, perspective, includeScripture, makeDefault });
  };

  return (
    <section className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] pt-8 sm:px-10 sm:pt-20">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">New learn path</p>
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-[var(--ink)] sm:text-4xl">What do you want to learn?</h1>
      </header>

      <div role="tablist" aria-label="Start from" className="grid grid-cols-4 gap-1 rounded-xl border border-[var(--line)] bg-[var(--sidebar)] p-1">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`start-tab-${s.id}`}
            aria-selected={source === s.id}
            aria-controls="start-panel"
            onClick={() => setSource(s.id)}
            className={`relative min-h-11 rounded-lg px-1 text-sm font-medium transition-colors ${
              source === s.id ? "bg-[var(--canvas)] text-[var(--ink)] shadow-sm" : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            {s.label}
            {filled[s.id] && source !== s.id ? (
              <span aria-label="has content" className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[var(--accent)]" />
            ) : null}
          </button>
        ))}
      </div>

      <div id="start-panel" role="tabpanel" aria-labelledby={`start-tab-${source}`} className="flex flex-col gap-3">
        {source === "topic" ? (
          <input
            aria-label="Topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={500}
            placeholder="The book of Romans, compound interest, intro to Greek"
            className={FIELD}
            autoFocus
          />
        ) : null}
        {source === "notes" ? (
          <textarea
            aria-label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={8}
            maxLength={20000}
            placeholder="Paste notes, goals, or what you already know"
            className={`${FIELD} [scrollbar-gutter:stable]`}
          />
        ) : null}
        {source === "passage" ? (
          <input
            aria-label="Passage"
            value={passage}
            onChange={(e) => setPassage(e.target.value)}
            maxLength={200}
            placeholder="Romans 8:1-17"
            className={FIELD}
            autoFocus
          />
        ) : null}
        {source === "photo" ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="sr-only"
              aria-label="Choose photos"
              onChange={(e) => void readPhotos(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex min-h-28 w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--line)] bg-[var(--sidebar)] px-4 py-6 text-base text-[var(--ink)] hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--line))]"
            >
              <span className="font-medium">Choose photos</span>
              <span className="text-sm text-[var(--ink-muted)]">Pages, syllabi, whiteboards</span>
            </button>
            {photoError ? <p className="text-sm text-[#c0533f]">{photoError}</p> : null}
            {photos.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {photos.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-[var(--ink)]">{p.name}</span>
                    <span className={`shrink-0 text-xs ${p.status === "error" ? "text-[#c0533f]" : "text-[var(--ink-muted)]"}`}>
                      {p.status === "reading" ? "Reading…" : p.status === "done" ? "Added to notes" : (p.message ?? "Failed")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>

      <details className="group rounded-xl border border-[var(--line)]">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium text-[var(--ink)]">
          Options
          <span aria-hidden className="text-[var(--ink-muted)] transition-transform group-open:rotate-90">›</span>
        </summary>
        <div className="flex flex-col gap-5 border-t border-[var(--line)] px-4 py-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="start-perspective" className="text-sm font-medium text-[var(--ink)]">
              Perspective on faith topics
            </label>
            <select
              id="start-perspective"
              value={perspective}
              onChange={(e) => setPerspective(isPerspective(e.target.value) ? e.target.value : "neutral")}
              className="min-h-11 rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 text-base text-[var(--ink)]"
            >
              <option value="neutral">Neutral</option>
              {TRADITIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <label className="flex min-h-11 items-center gap-2 text-sm text-[var(--ink-muted)]">
              <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="size-4" />
              Make this my default
            </label>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-[var(--ink)]">Scripture readings</legend>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["auto", "When relevant"],
                  ["yes", "Always"],
                  ["no", "Never"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={includeScripture === value}
                  onClick={() => setIncludeScripture(value)}
                  className={`min-h-11 rounded-md border px-2 text-sm font-medium transition-colors ${
                    includeScripture === value
                      ? "border-[color-mix(in_srgb,var(--accent)_45%,var(--line))] bg-[var(--sidebar-active)] text-[var(--ink)]"
                      : "border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </details>

      {error ? (
        <p role="alert" className="text-sm text-[#c0533f]">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={!canStart}
        onClick={submit}
        className="min-h-12 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-base font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      >
        {starting ? "Starting…" : reading ? "Reading photos…" : "Build my path"}
      </button>
    </section>
  );
}
