import { Readable } from "node:stream";
import playdl from "play-dl";
import { logger } from "../lib/logger.js";

export interface TrackInfo {
  title: string;
  url: string;
  duration: string;
  thumbnail: string;
  source: "youtube" | "soundcloud";
  scFallbackQuery?: string;
}

function formatDuration(secs: number): string {
  if (!secs) return "Live";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function searchSoundCloud(query: string): Promise<TrackInfo | null> {
  try {
    const results = await playdl.search(query, { source: { soundcloud: "tracks" }, limit: 1 });
    if (!results.length) return null;
    const t = results[0]!;
    return {
      title: t.name,
      url: t.url,
      duration: formatDuration(Math.floor(t.durationInMs / 1000)),
      thumbnail: t.thumbnail,
      source: "soundcloud",
    };
  } catch (err) {
    logger.warn({ err, query }, "SoundCloud search failed");
    return null;
  }
}

async function searchYouTube(query: string): Promise<TrackInfo | null> {
  try {
    const results = await playdl.search(query, { source: { youtube: "video" }, limit: 1 });
    if (!results.length) return null;
    const v = results[0]!;
    return {
      title: v.title ?? "Unknown",
      url: v.url,
      duration: formatDuration(v.durationInSec ?? 0),
      thumbnail: v.thumbnails?.at(-1)?.url ?? "",
      source: "youtube",
      scFallbackQuery: v.title ?? query,
    };
  } catch (err) {
    logger.warn({ err, query }, "YouTube search failed");
    return null;
  }
}

export async function resolveTrack(query: string): Promise<TrackInfo | null> {
  const isUrl = query.startsWith("http://") || query.startsWith("https://");

  if (isUrl) {
    const ytType = playdl.yt_validate(query);
    if (ytType === "video") {
      try {
        const info = await playdl.video_info(query);
        const v = info.video_details;
        const title = v.title ?? "YouTube Video";
        return {
          title,
          url: query,
          duration: formatDuration(v.durationInSec ?? 0),
          thumbnail: v.thumbnails?.at(-1)?.url ?? "",
          source: "youtube",
          scFallbackQuery: title,
        };
      } catch {
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
        logger.error({ err, query }, "SoundCloud URL info failed");
        return null;
      }
    }
  }

  // For text searches: try SoundCloud FIRST (works on server IPs),
  // then fall back to YouTube if SoundCloud has no results.
  const sc = await searchSoundCloud(query);
  if (sc) return sc;

  logger.info({ query }, "SoundCloud had no results, trying YouTube");
  return searchYouTube(query);
}

export async function createStream(track: TrackInfo): Promise<Readable> {
  if (track.source === "soundcloud") {
    const s = await playdl.stream(track.url);
    return s.stream as unknown as Readable;
  }

  // YouTube — attempt stream, fall back to SoundCloud if blocked
  try {
    const s = await playdl.stream(track.url, { quality: 2 });
    return s.stream as unknown as Readable;
  } catch (ytErr) {
    logger.warn({ err: ytErr, url: track.url }, "YouTube stream blocked, falling back to SoundCloud");

    if (track.scFallbackQuery) {
      const scTrack = await searchSoundCloud(track.scFallbackQuery);
      if (scTrack) {
        track.source = "soundcloud";
        track.url = scTrack.url;
        const s = await playdl.stream(scTrack.url);
        return s.stream as unknown as Readable;
      }
    }

    throw new Error(`Cannot stream "${track.title}" — YouTube blocked and no SoundCloud match found.`);
  }
}
