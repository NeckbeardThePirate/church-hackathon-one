"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parsePassageList, MAX_PASSAGES, type PassageRef } from "../lib/bible/parse-reference";
import { MAX_IMPORT_IMAGES, runOcrForKey, uploadSourceImage } from "../lib/import-queue";
import { MAX_NOTES, MAX_TOPIC, deriveTopic, hasIntake } from "../lib/learn/intake";
import { TRADITIONS, isPerspective, type Perspective } from "../lib/learn/types";
import { fetchLearnPerspective } from "../lib/workspace-sync";

export type StartPayload = {
  topic: string;
  notes: string;
  /** Passage labels, e.g. "Romans 8:1–17". The server parses them again. */
  passages: string[];
  photos: { name: string; text: string }[];
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

type Photo = {
  id: string;
  name: string;
  previewUrl: string;
  status: "reading" | "done" | "error";
  text: string;
  message?: string;
};

const FIELD =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 py-3 text-base text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_srgb,var(--accent)_45%,var(--line))]";

const LABEL = "text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]";

export function LearnStartForm({ projectId, starting, error, onStart }: Props) {
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [passageInput, setPassageInput] = useState("");
  const [passages, setPassages] = useState<PassageRef[]>([]);
  const [passageError, setPassageError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [perspective, setPerspective] = useState<Perspective>("neutral");
  const [makeDefault, setMakeDefault] = useState(false);
  const [includeScripture, setIncludeScripture] = useState<"auto" | "yes" | "no">("auto");
  const fileRef = useRef<HTMLInputElement>(null);
  const photoCount = useRef(0);
  const previews = useRef(new Set<string>());

  useEffect(() => {
    let live = true;
    void fetchLearnPerspective().then((saved) => {
      if (live && isPerspective(saved)) setPerspective(saved);
    });
    const urls = previews.current;
    return () => {
      live = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  const addPhotos = useCallback(
    async (incoming: File[]) => {
      const files = incoming.filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return;
      setPhotoError(null);
      const room = Math.max(0, MAX_IMPORT_IMAGES - photoCount.current);
      if (room === 0) {
        setPhotoError(`Up to ${MAX_IMPORT_IMAGES} photos.`);
        return;
      }
      if (files.length > room) setPhotoError(`Only ${room} more fit (max ${MAX_IMPORT_IMAGES}).`);
      const batch = files.slice(0, room).map((file) => {
        const previewUrl = URL.createObjectURL(file);
        previews.current.add(previewUrl);
        return { file, previewUrl, id: crypto.randomUUID() };
      });
      photoCount.current += batch.length;
      setPhotos((prev) => [
        ...prev,
        ...batch.map(({ file, id, previewUrl }) => ({
          id,
          previewUrl,
          name: file.name && file.name !== "image.png" ? file.name : "Pasted photo",
          status: "reading" as const,
          text: "",
        })),
      ]);

      for (const { file, id } of batch) {
        try {
          const uploaded = await uploadSourceImage(projectId, file);
          const ocr = await runOcrForKey(projectId, uploaded.key);
          const text = ocr.extractedText?.trim() ?? "";
          if (!text) throw new Error(ocr.ocrError ?? "No text found in this photo.");
          setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, status: "done", text } : p)));
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : "Could not read this photo.";
          setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, status: "error", message } : p)));
        }
      }
    },
    [projectId],
  );

  // Clipboard paste: only intercepted when the clipboard carries an image, so text paste is untouched.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return;
      e.preventDefault();
      void addPhotos(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addPhotos]);

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) {
        URL.revokeObjectURL(gone.previewUrl);
        previews.current.delete(gone.previewUrl);
      }
      return prev.filter((p) => p.id !== id);
    });
    photoCount.current = Math.max(0, photoCount.current - 1);
    setPhotoError(null);
  };

  const addPassages = () => {
    const text = passageInput.trim();
    if (!text) return;
    const { passages: parsed, invalid } = parsePassageList(text);
    if (invalid.length) {
      setPassageError(`Not a Bible passage: ${invalid[0]}`);
      return;
    }
    const merged = [...passages];
    for (const ref of parsed) if (!merged.some((p) => p.label === ref.label)) merged.push(ref);
    if (merged.length > MAX_PASSAGES) {
      setPassageError(`Up to ${MAX_PASSAGES} passages.`);
      return;
    }
    setPassages(merged);
    setPassageInput("");
    setPassageError(null);
  };

  const reading = photos.some((p) => p.status === "reading");
  const photoTexts = useMemo(
    () => photos.filter((p) => p.status === "done").map((p) => ({ name: p.name, text: p.text })),
    [photos],
  );
  const intake = useMemo(() => ({ topic, notes, passages, photos: photoTexts }), [topic, notes, passages, photoTexts]);
  const canStart = !starting && !reading && hasIntake(intake) && notes.length <= MAX_NOTES;

  const submit = () => {
    if (!canStart) return;
    onStart({
      topic: deriveTopic(intake),
      notes: notes.trim(),
      passages: passages.map((p) => p.label),
      photos: photoTexts,
      perspective,
      includeScripture,
      makeDefault,
    });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void addPhotos([...e.dataTransfer.files]);
  };

  return (
    <section
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      className={`mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] pt-8 sm:px-10 sm:pt-20 ${
        dragging ? "rounded-2xl outline-dashed outline-2 outline-offset-[-8px] outline-[var(--accent)]" : ""
      }`}
    >
      <header className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">New learn path</p>
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-[var(--ink)] sm:text-4xl">What do you want to learn?</h1>
      </header>

      <div className="flex flex-col gap-5">
        <input
          aria-label="Topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          maxLength={MAX_TOPIC}
          placeholder="Topic (optional)"
          className={FIELD}
          autoFocus
        />

        <textarea
          aria-label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={9}
          maxLength={MAX_NOTES}
          placeholder="Notes, goals, or what you already know"
          className={`${FIELD} min-h-48 resize-y [scrollbar-gutter:stable]`}
        />

        <div className="flex flex-col gap-2">
          <p className={LABEL}>Passages</p>
          <div className="flex gap-2">
            <input
              aria-label="Add a Bible passage"
              value={passageInput}
              onChange={(e) => {
                setPassageInput(e.target.value);
                setPassageError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addPassages();
                }
              }}
              maxLength={200}
              enterKeyHint="done"
              placeholder="Romans 8:1-17"
              aria-invalid={passageError ? true : undefined}
              className={FIELD}
            />
            <button
              type="button"
              onClick={addPassages}
              disabled={!passageInput.trim()}
              className="min-h-12 shrink-0 rounded-lg border border-[var(--line)] px-4 text-sm font-medium text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {passageError ? (
            <p role="alert" className="text-sm text-[#c0533f]">
              {passageError}
            </p>
          ) : null}
          {passages.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Added passages">
              {passages.map((p) => (
                <li
                  key={p.label}
                  className="flex min-h-10 items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[var(--sidebar-active)] pl-3.5 pr-1 text-sm text-[var(--ink)]"
                >
                  <span>{p.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${p.label}`}
                    onClick={() => setPassages((prev) => prev.filter((x) => x.label !== p.label))}
                    className="grid size-8 place-items-center rounded-full text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  >
                    <span aria-hidden>×</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <p className={LABEL}>Photos</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="sr-only"
            aria-label="Choose photos"
            tabIndex={-1}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              void addPhotos(files);
            }}
          />
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Added photos">
            {photos.map((p) => (
              <li
                key={p.id}
                className={`relative aspect-square overflow-hidden rounded-lg border bg-[var(--sidebar)] ${
                  p.status === "error" ? "border-[#c0533f]" : "border-[var(--line)]"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.previewUrl}
                  alt={p.name}
                  className={`size-full object-cover ${p.status === "done" ? "" : "opacity-50"}`}
                />
                {p.status !== "done" ? (
                  <span
                    title={p.message}
                    className={`absolute inset-x-0 bottom-0 truncate bg-[color-mix(in_srgb,var(--canvas)_85%,transparent)] px-1.5 py-1 text-xs ${
                      p.status === "error" ? "text-[#c0533f]" : "animate-pulse text-[var(--ink)]"
                    }`}
                  >
                    {p.status === "reading" ? "Reading…" : (p.message ?? "Failed")}
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => removePhoto(p.id)}
                  className="absolute right-1 top-1 grid size-9 place-items-center rounded-full bg-[color-mix(in_srgb,var(--canvas)_85%,transparent)] text-[var(--ink)] shadow-sm"
                >
                  <span aria-hidden>×</span>
                </button>
              </li>
            ))}
            {photos.length < MAX_IMPORT_IMAGES ? (
              <li>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--line)] bg-[var(--sidebar)] text-sm text-[var(--ink-muted)] hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--line))] hover:text-[var(--ink)]"
                >
                  <span aria-hidden className="text-2xl leading-none">+</span>
                  <span>Add photos</span>
                </button>
              </li>
            ) : null}
          </ul>
          {photoError ? <p className="text-sm text-[#c0533f]">{photoError}</p> : null}
        </div>
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
