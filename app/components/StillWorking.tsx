"use client";

import { useEffect, useMemo, useState } from "react";
import type { Heartbeat, LearnStage } from "../lib/learn/types";

/**
 * "Still working" indicator for plan generation.
 * Whimsy (lamp + captions) is decoration; the facts under it come from server heartbeats:
 * what is running right now, model/search call counts, and time since the server last did work.
 * If heartbeats stop, the lamp dims and the copy says so plainly.
 */

const CAPTIONS: Partial<Record<LearnStage, string[]>> = {
  intake: ["Unrolling the scroll…", "Lighting the lamp…"],
  scope: ["Counting the cost before building the tower (Luke 14:28)…", "Surveying the land before the journey…"],
  plan: ["Laying stones, line upon line (Isaiah 28:10)…", "Marking out the path, step by step…"],
  research: [
    "Searching the scrolls daily, like the Bereans (Acts 17:11)…",
    "Seeking, and expecting to find (Matthew 7:7)…",
    "Going out to the highways and byways for good sources…",
  ],
  review: ["Testing everything, holding fast what is good (1 Thess. 5:21)…", "Sorting the wheat from the chaff…"],
  teach: [
    "Writing the vision plainly on tablets (Habakkuk 2:2)…",
    "Gathering two of every kind of example…",
    "Preparing milk first, then solid food (Hebrews 5:12)…",
  ],
  check: ["Weighing it in the balances (Daniel 5:27)…", "Counting the fish in the net…"],
  critic: ["Iron sharpening iron (Proverbs 27:17)…", "Measuring the walls once more…"],
  assemble: ["Gathering up the fragments so nothing is lost (John 6:12)…", "Binding the scroll…"],
};
const FALLBACK = ["Trimming the lamp; there is still oil (Matthew 25:4)…", "Building the ark, plank by plank…"];

const STAGE_VERB: Record<string, string> = {
  intake: "Reading your topic",
  scope: "Sizing up the topic",
  plan: "Outlining lessons",
  research: "Finding videos and articles for",
  review: "Reviewing sources for",
  teach: "Writing",
  check: "Quizzing itself on",
  critic: "Reviewing the whole course",
  assemble: "Assembling the plan",
};

function describe(key: string): string {
  const [stage = "", lesson = "-"] = key.split(":");
  const verb = STAGE_VERB[stage] ?? stage;
  if (lesson === "-") return verb;
  return `${verb} lesson ${lesson.replace(/^l/, "")}`;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

type Props = {
  stage: LearnStage | undefined;
  heartbeat: Heartbeat | null;
  /** Client receive time of the latest heartbeat (server clocks can drift). */
  heartbeatReceivedAt: number | null;
  startedAt: number;
};

export function StillWorking({ stage, heartbeat, heartbeatReceivedAt, startedAt }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [captionIndex, setCaptionIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const captions = useMemo(() => (stage && CAPTIONS[stage]) || FALLBACK, [stage]);
  useEffect(() => {
    setCaptionIndex(0);
    const t = setInterval(() => setCaptionIndex((i) => i + 1), 7000);
    return () => clearInterval(t);
  }, [captions]);
  const caption = captions[captionIndex % captions.length];

  const silence = heartbeatReceivedAt ? now - heartbeatReceivedAt : now - startedAt;
  // Server-side: time since a consumer last did anything for this plan.
  const idle = heartbeat ? Math.max(0, heartbeat.at - heartbeat.lastActivityAt) + (heartbeatReceivedAt ? now - heartbeatReceivedAt : 0) : null;
  const connection: "live" | "quiet" | "lost" = silence < 12_000 ? "live" : silence < 40_000 ? "quiet" : "lost";

  const active = heartbeat?.active ?? [];
  const working = active.length
    ? active
        .slice()
        .sort((a, b) => a.since - b.since)
        .map((a) => `${describe(a.key)} (${ago((heartbeat?.at ?? now) - a.since)})`)
    : [];

  let status: string;
  if (connection === "lost") status = `No word from the server for ${ago(silence)}. It may still be working; we'll keep listening.`;
  else if (connection === "quiet") status = `Waiting on the server… last heard ${ago(silence)} ago.`;
  else if (working.length) status = working.join(" · ");
  else if (idle !== null && idle > 20_000) status = `Between steps; next one is queued (${ago(idle)} since last activity).`;
  else status = "Handing off to the next step…";

  return (
    <div
      className="flex items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-4 py-3"
      role="status"
      aria-live="polite"
    >
      <style>{`
        @keyframes lamp-flicker { 0%,100% { transform: scale(1,1) rotate(-1deg); opacity:.95 } 25% { transform: scale(.94,1.06) rotate(1.5deg) } 50% { transform: scale(1.04,.95) rotate(-2deg); opacity:1 } 75% { transform: scale(.97,1.03) rotate(1deg) } }
        @keyframes lamp-flare { 0% { transform: scale(1.35); opacity:1 } 100% { transform: scale(1); opacity:.9 } }
        .lamp-flame { transform-origin: 50% 90%; animation: lamp-flicker 1.4s ease-in-out infinite; }
        .lamp-glow { transform-origin: 50% 60%; }
        .lamp-flare { animation: lamp-flare .9s ease-out; }
        @media (prefers-reduced-motion: reduce) { .lamp-flame, .lamp-flare { animation: none } }
      `}</style>
      <svg width="56" height="44" viewBox="0 0 56 44" aria-hidden className="shrink-0">
        {/* glow re-mounts on each heartbeat so it flares, then settles */}
        <g key={heartbeat?.at ?? 0} className={`lamp-glow ${connection === "live" ? "lamp-flare" : ""}`}>
          <circle
            cx="40"
            cy="14"
            r="12"
            fill="#f2b84b"
            opacity={connection === "live" ? 0.22 : connection === "quiet" ? 0.1 : 0.03}
          />
        </g>
        <g className="lamp-flame" style={{ opacity: connection === "lost" ? 0.25 : connection === "quiet" ? 0.6 : 1 }}>
          <path d="M40 4 C44 10 45 14 40 19 C35 14 36 10 40 4 Z" fill="#f2b84b" />
          <path d="M40 9 C42 12 42 15 40 17 C38 15 38 12 40 9 Z" fill="#fff1c9" />
        </g>
        {/* clay lamp: body, spout, handle */}
        <path d="M6 28 C6 22 16 19 28 19 C34 19 38 20 41 22 L44 20 C46 19 47 21 45 23 L40 28 C38 33 31 36 23 36 C13 36 6 33 6 28 Z" fill="#b8734a" />
        <path d="M9 28 C12 32 20 33 26 33 C32 33 36 31 38 28" stroke="#8f5536" strokeWidth="1.2" fill="none" />
        <ellipse cx="23" cy="24" rx="5" ry="1.8" fill="#6e3f27" />
        <path d="M6 27 C2 26 1 22 4 21" stroke="#b8734a" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      </svg>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm italic text-[var(--ink)]" key={caption}>
          {caption}
        </p>
        <p className={`mt-0.5 text-xs ${connection === "lost" ? "text-[#c0533f]" : "text-[var(--ink-muted)]"}`}>{status}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-[var(--ink-muted)]">
          <span className="flex items-center gap-1.5">
            <span
              className={`inline-block size-1.5 rounded-full ${
                connection === "live" ? "bg-[#6aa77d]" : connection === "quiet" ? "bg-[#d4a84a]" : "bg-[#c0533f]"
              }`}
            />
            {connection === "live" ? "Live" : connection === "quiet" ? "Quiet" : "No signal"}
          </span>
          {heartbeat ? (
            <span>
              {heartbeat.calls.llm} model calls{heartbeat.calls.exa ? ` · ${heartbeat.calls.exa} searches` : ""}
            </span>
          ) : null}
          {heartbeat?.lessonsTotal ? (
            <span>
              {heartbeat.lessonsDone}/{heartbeat.lessonsTotal} lessons
            </span>
          ) : null}
          <span>{ago(now - startedAt)} elapsed</span>
        </p>
      </div>
    </div>
  );
}
