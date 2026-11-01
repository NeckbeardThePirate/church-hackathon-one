"use client";

import { useState } from "react";
import { embeddableYoutubeId, youtubeEmbedSrc, youtubeThumbnail } from "../lib/learn/youtube";
import type { VideoResource } from "../lib/learn/types";

type Props = {
  video: VideoResource;
  meta?: string;
  reviewNote?: string;
  /** This lesson's currently playing video, so only one iframe stays mounted. */
  playing: boolean;
  onPlay: () => void;
};

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="ml-0.5 size-7 fill-current">
      <path d="M8 5.5v13l11-6.5-11-6.5z" />
    </svg>
  );
}

export function LessonVideoPlayer({ video, meta, reviewNote, playing, onPlay }: Props) {
  const id = embeddableYoutubeId(video);
  const [thumbFailed, setThumbFailed] = useState(false);

  return (
    <li className="overflow-hidden rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--sidebar)_90%,var(--canvas))]">
      <div className="relative aspect-video bg-black">
        {id && playing ? (
          <iframe
            src={youtubeEmbedSrc(id, true)}
            title={video.title}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : id ? (
          <button type="button" onClick={onPlay} aria-label={`Play ${video.title}`} className="group absolute inset-0">
            {thumbFailed ? null : (
              <img
                src={youtubeThumbnail(id)}
                alt=""
                className="h-full w-full object-cover"
                onError={() => setThumbFailed(true)}
              />
            )}
            <span className="absolute inset-0 bg-black/30 transition-colors group-hover:bg-black/40" />
            <span className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_88%,#1a1a1a)] text-[var(--canvas)] shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-transform group-hover:scale-105">
              <PlayIcon />
            </span>
          </button>
        ) : (
          <a
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute inset-0 grid place-items-center text-sm font-medium text-[var(--ink)]"
          >
            Open video
          </a>
        )}
      </div>
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium leading-snug text-[var(--ink)]">{video.title}</p>
          <a
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs font-medium text-[color-mix(in_srgb,var(--accent)_85%,var(--ink))] underline-offset-2 hover:underline"
          >
            YouTube
          </a>
        </div>
        {meta ? <p className="mt-1 text-xs text-[var(--ink-muted)]">{meta}</p> : null}
        {video.review ? (
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">
            {video.review}
            {reviewNote ? <span className="italic"> {reviewNote}</span> : null}
          </p>
        ) : null}
      </div>
    </li>
  );
}
