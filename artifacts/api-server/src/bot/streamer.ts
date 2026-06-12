import { Readable } from "node:stream";
import { execSync } from "node:child_process";
import playdl from "play-dl";
import { logger } from "../lib/logger.js";

export interface TrackInfo {
  title: string;
  url: string;
  duration: string;
  thumbnail: string;
  source: "youtube" | "soundcloud" | "spotify";
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

async function searchSpotify(query: string): Promise<TrackInfo | null> {
  try {
    const results = await playdl.search(query, { source: { spotify: "tracks" }, limit: 1 });
    if (!results.length) return null;
    const t = results[0]!;
    return {
      title: (t as any).name || t.title || "Unknown",
      url: t.url,
      duration: formatDuration(Math.floor((t as any).durationInMs / 1000) || 0),
      thumbnail: (t as any).thumbnail || "",
      source: "spotify",
    };
  } catch (err) {
    logger.warn({ err, query }, "Spotify search failed");
    return null;
  }
}

async function searchSoundCloud(query: string): Promise<TrackInfo | null> {
  try {
    const results = await playdl.search(query, { source: { soundcloud: "tracks" }, limit: 1 });
    if (!results.length) return null;
    const t = results[0]!;
    return {
      title: (t as any).name,
      url: t.url,
      duration: formatDuration(Math.floor((t as any).durationInMs / 1000)),
      thumbnail: (t as any).thumbnail,
      source: "soundcloud",
    };
  } catch (err) {
    logger.warn({ err, query }, "SoundCloud search failed");
    return null;
  }
}

async function searchYouTube(query: string): Promise<TrackInfo | null> {
  try {
    logger.info({ query }, "Searching YouTube...");
    const results = await playdl.search(query, { source: { youtube: "video" }, limit: 1 });
    if (!results.length) {
      logger.warn({ query }, "YouTube search returned no results");
      return null;
    }
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
        logger.info({ url: query }, "Resolving YouTube URL...");
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
      } catch (err) {
        logger.error({ err, url: query }, "Failed to resolve YouTube URL");
        return null;
      }
    }

    const scType = await playdl.so_validate(query);
    if (scType === "track") {
      try {
        logger.info({ url: query }, "Resolving SoundCloud URL...");
        const info = await playdl.soundcloud(query);
        if (info.type !== "track") return null;
        const thumb = (info as { thumbnail?: string }).thumbnail ?? "";
        return {
          title: (info as any).name,
          url: info.url,
          duration: formatDuration(Math.floor((info as any).durationInMs / 1000)),
          thumbnail: thumb,
          source: "soundcloud",
        };
      } catch (err) {
        logger.error({ err, query }, "SoundCloud URL info failed");
        return null;
      }
    }

    // Try Spotify URL
    try {
      const spotifyMatch = query.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
      if (spotifyMatch) {
        logger.info({ url: query }, "Resolving Spotify URL...");
        return await searchSpotify(query);
      }
    } catch (err) {
      logger.warn({ err, query }, "Spotify URL resolution failed");
    }
  }

  // For text searches: PRIMARY SEARCH ORDER (most reliable for Discord bots)
  // 1. YouTube (largest music library, but may be IP-blocked on servers)
  // 2. Spotify (reliable alternative, good metadata)
  // 3. SoundCloud (backup option)

  logger.info({ query }, "Starting search: YouTube → Spotify → SoundCloud");

  // Try YouTube first
  const yt = await searchYouTube(query);
  if (yt) {
    logger.info({ query, source: "youtube" }, "Found on YouTube");
    return yt;
  }

  logger.info({ query }, "YouTube had no results, trying Spotify");

  // Try Spotify second
  const spotify = await searchSpotify(query);
  if (spotify) {
    logger.info({ query, source: "spotify" }, "Found on Spotify");
    return spotify;
  }

  logger.info({ query }, "Spotify had no results, trying SoundCloud");

  // Try SoundCloud last
  const sc = await searchSoundCloud(query);
  if (sc) {
    logger.info({ query, source: "soundcloud" }, "Found on SoundCloud");
    return sc;
  }

  logger.error({ query }, "No results found on any source (YouTube, Spotify, SoundCloud)");
  return null;
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

  if (track.source === "spotify") {
    try {
      const s = await playdl.stream(track.url);
      if (!s || !s.stream) {
        throw new Error("Spotify stream returned empty");
      }
      logger.info({ url: track.url }, "Spotify stream created successfully");
      return s.stream as unknown as Readable;
    } catch (err) {
      logger.error({ err, url: track.url }, "Failed to create Spotify stream, trying YouTube fallback");
      if (track.scFallbackQuery) {
        try {
          const yt = await searchYouTube(track.scFallbackQuery);
          if (yt) {
            return await createStream(yt);
          }
        } catch {}
      }
      throw err;
    }
  }

  // YouTube — attempt stream with quality fallback
  try {
    logger.info({ url: track.url }, "Attempting YouTube stream (quality: 2)");
    const s = await playdl.stream(track.url, { quality: 2 });
    if (!s || !s.stream) {
      throw new Error("YouTube stream returned empty");
    }
    logger.info({ url: track.url }, "YouTube stream created successfully");
    return s.stream as unknown as Readable;
  } catch (ytErr) {
    logger.warn({ err: ytErr, url: track.url }, "YouTube quality 2 failed, trying quality 1");

    // Retry with lower quality
    try {
      const s = await playdl.stream(track.url, { quality: 1 });
      if (!s || !s.stream) {
        throw new Error("YouTube stream (quality 1) returned empty");
      }
      logger.info({ url: track.url }, "YouTube stream created successfully with quality 1");
      return s.stream as unknown as Readable;
    } catch (qualityErr) {
      logger.warn({ err: qualityErr, url: track.url }, "YouTube quality 1 failed, trying Spotify fallback");

      if (track.scFallbackQuery) {
        try {
          const spotifyTrack = await searchSpotify(track.scFallbackQuery);
          if (spotifyTrack) {
            logger.info({ query: track.scFallbackQuery }, "Found Spotify fallback");
            return await createStream(spotifyTrack);
          }
        } catch (spotifyErr) {
          logger.warn({ err: spotifyErr }, "Spotify fallback failed, trying SoundCloud");
        }

        try {
          const scTrack = await searchSoundCloud(track.scFallbackQuery);
          if (scTrack) {
            logger.info({ url: scTrack.url }, "Found SoundCloud fallback");
            return await createStream(scTrack);
          }
        } catch (scErr) {
          logger.error({ err: scErr }, "SoundCloud fallback failed");
        }
      }

      throw new Error(`Cannot stream "${track.title}" — all sources exhausted (YouTube → Spotify → SoundCloud).`);
    }
  }
}

// Validate FFmpeg on startup
validateFFmpeg();
