import playdl from "play-dl";
import { logger } from "../lib/logger.js";

export interface TrackInfo {
  title: string;
  url: string;
  duration: string;
  thumbnail: string;
  source: "youtube" | "soundcloud";
}

function formatDuration(secs: number): string {
  if (!secs) return "Live";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export async function resolveTrack(query: string): Promise<TrackInfo | null> {
  const isUrl = query.startsWith("http://") || query.startsWith("https://");

  if (isUrl) {
    const ytType = playdl.yt_validate(query);
    if (ytType === "video") {
      try {
        const info = await playdl.video_info(query);
        const v = info.video_details;
        return {
          title: v.title ?? "Unknown",
          url: query,
          duration: formatDuration(v.durationInSec ?? 0),
          thumbnail: v.thumbnails?.at(-1)?.url ?? "",
          source: "youtube",
        };
      } catch (err) {
        logger.warn({ err, query }, "play-dl video_info failed, trying stream directly");
        return { title: "YouTube Video", url: query, duration: "?", thumbnail: "", source: "youtube" };
      }
    }

    const scType = await playdl.so_validate(query);
    if (scType === "track") {
      try {
        const info = await playdl.soundcloud(query);
        if (info.type !== "track") return null;
        const thumb = (info as { thumbnail?: string }).thumbnail ?? "";
        return {
          title: info.name,
          url: info.url,
          duration: formatDuration(Math.floor(info.durationInMs / 1000)),
          thumbnail: thumb,
          source: "soundcloud",
        };
      } catch (err) {
        logger.error({ err, query }, "SoundCloud info failed");
        return null;
      }
    }
  }

  try {
    const results = await playdl.search(query, { source: { youtube: "video" }, limit: 1 });
    if (results.length) {
      const v = results[0]!;
      return {
        title: v.title ?? "Unknown",
        url: v.url,
        duration: formatDuration(v.durationInSec ?? 0),
        thumbnail: v.thumbnails?.at(-1)?.url ?? "",
        source: "youtube",
      };
    }
  } catch (ytErr) {
    logger.warn({ err: ytErr, query }, "YouTube search failed, trying SoundCloud");
  }

  try {
    const scResults = await playdl.search(query, { source: { soundcloud: "tracks" }, limit: 1 });
    if (scResults.length) {
      const t = scResults[0]!;
      return {
        title: t.name,
        url: t.url,
        duration: formatDuration(Math.floor(t.durationInMs / 1000)),
        thumbnail: t.thumbnail,
        source: "soundcloud",
      };
    }
  } catch (scErr) {
    logger.error({ err: scErr, query }, "SoundCloud search also failed");
  }

  return null;
}

export async function createStream(url: string, source: "youtube" | "soundcloud") {
  if (source === "soundcloud") {
    const stream = await playdl.stream(url);
    return stream.stream;
  }
  const stream = await playdl.stream(url, { quality: 2 });
  return stream.stream;
}
