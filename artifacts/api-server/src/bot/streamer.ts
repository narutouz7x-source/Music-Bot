import { Readable } from "node:stream";
import { execSync } from "node:child_process";
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

// Validate FFmpeg is available
function validateFFmpeg(): boolean {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch {
    logger.warn("FFmpeg not found in PATH — audio streaming may fail");
    return false;
  }
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
    try {
      const s = await playdl.stream(track.url);
      if (!s || !s.stream) {
        throw new Error("SoundCloud stream returned empty");
      }
      logger.info({ url: track.url }, "SoundCloud stream created successfully");
      return s.stream as unknown as Readable;
    } catch (err) {
      logger.error({ err, url: track.url }, "Failed to create SoundCloud stream");
      throw err;
    }
  }

  // YouTube — attempt stream with fallback
  try {
    logger.info({ url: track.url }, "Attempting YouTube stream (quality: 2)");
    const s = await playdl.stream(track.url, { quality: 2 });
    if (!s || !s.stream) {
      throw new Error("YouTube stream returned empty");
    }
    logger.info({ url: track.url }, "YouTube stream created successfully");
    return s.stream as unknown as Readable;
  } catch (ytErr) {
    logger.warn({ err: ytErr, url: track.url }, "YouTube stream failed, attempting quality 1");

    // Retry with lower quality
    try {
      const s = await playdl.stream(track.url, { quality: 1 });
      if (!s || !s.stream) {
        throw new Error("YouTube stream (quality 1) returned empty");
      }
      logger.info({ url: track.url }, "YouTube stream created successfully with quality 1");
      return s.stream as unknown as Readable;
    } catch (qualityErr) {
      logger.warn({ err: qualityErr, url: track.url }, "YouTube quality 1 also failed, trying SoundCloud fallback");

      if (track.scFallbackQuery) {
        const scTrack = await searchSoundCloud(track.scFallbackQuery);
        if (scTrack) {
          try {
            const s = await playdl.stream(scTrack.url);
            if (!s || !s.stream) {
              throw new Error("SoundCloud fallback stream returned empty");
            }
            logger.info({ url: scTrack.url }, "SoundCloud fallback stream created successfully");
            track.source = "soundcloud";
            track.url = scTrack.url;
            return s.stream as unknown as Readable;
          } catch (scErr) {
            logger.error({ err: scErr, url: scTrack.url }, "SoundCloud fallback stream failed");
          }
        }
      }

      throw new Error(`Cannot stream "${track.title}" — all sources failed (YouTube and SoundCloud fallback).`);
    }
  }
}

// Validate FFmpeg on startup
validateFFmpeg();
