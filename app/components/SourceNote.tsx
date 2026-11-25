const COPY = {
  home: "Lessons and quizzes are AI-generated. Scripture and historical sources are retrieved from the library, not written by the model.",
  lesson:
    "This lesson is AI-generated. Scripture and historical sources below are retrieved from the library, not written by the model.",
  quiz: "This quiz is AI-generated. Scripture and historical sources in the lesson are retrieved from the library, not written by the model.",
  review:
    "These questions come from the lesson quiz. They are AI-generated. Scripture and historical sources are retrieved from the library, not written by the model.",
  progress:
    "Lessons and quizzes are AI-generated. Scripture and historical sources are retrieved from the library, not written by the model.",
  intake:
    "The path is AI-generated. Scripture and historical sources are retrieved from the library, not written by the model.",
} as const;

export type SourceNotePlace = keyof typeof COPY;

/** Short honesty line on the screens a learner (or a judge) actually reads. */
export function SourceNote({ place }: { place: SourceNotePlace }) {
  return (
    <p className="mt-3 max-w-full text-sm leading-relaxed break-words text-[var(--ink-muted)]" data-source-note={place}>
      {COPY[place]}
    </p>
  );
}
