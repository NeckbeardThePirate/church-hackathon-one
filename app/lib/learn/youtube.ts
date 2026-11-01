/** YouTube ids are path-safe. Reject anything that could change the embed URL. */
const YOUTUBE_ID = /^[\w-]{6,}$/;

export function embeddableYoutubeId(video: { videoId?: string; url: string }): string | null {
  if (video.videoId && YOUTUBE_ID.test(video.videoId)) return video.videoId;
  try {
    const url = new URL(video.url);
    const host = url.hostname.replace(/^www\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] || null;
    else if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else id = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/)?.[1] ?? null;
    }
    return id && YOUTUBE_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function youtubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
}

/** Privacy-enhanced embed. `autoplay` is set only after the learner presses play. */
export function youtubeEmbedSrc(id: string, autoplay: boolean): string {
  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
  });
  if (autoplay) params.set("autoplay", "1");
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`;
}
