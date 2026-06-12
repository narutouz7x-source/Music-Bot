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
}

// Search cache to avoid repeated API calls
const searchCache = new Map<string, TrackInfo>();
const CACHE_TTL = 3600000; // 1 hour

function formatDuration(secs: number): string {
  if (!secs) return "Live";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Validate FFmpeg
function validateFFmpeg(): boolean {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    logger.info("✅ FFmpeg is available");
    return true;
  } catch {
    logger.error("❌ FFmpeg not found — audio streaming will fail. Install ffmpeg-static.");
    return false;
  }
}

async function searchYouTube(query: string): Promise<TrackInfo | null> {
  try {
    logger.info({ query }, "🔍 Searching YouTube...");
    
    const results = await playdl.search(query, { 
      source: { youtube: "video" }, 
      limit: 5 
    });
    
    if (!results.length) {
      logger.warn({ query }, "YouTube: No results found");
      return null;
    }

    // Find first playable result
    for (const v of results) {
      try {
        const title = v.title ?? "Unknown";
        const url = v.url;
        const duration = formatDuration(v.durationInSec ?? 0);
        const thumbnail = v.thumbnails?.at(-1)?.url ?? "";

        logger.info({ title, url }, "✅ YouTube: Found track");
        return {
          title,
          url,
          duration,
          thumbnail,
          source: "youtube",
        };
      } catch (err) {
        logger.warn({ err }, "YouTube: Video processing failed, trying next");
        continue;
      }
    }

    logger.error({ query }, "YouTube: All results failed to process");
    return null;
  } catch (err) {
    logger.error({ err, query }, "❌ YouTube search error");
    return null;
  }
}

async function searchSoundCloud(query: string): Promise<TrackInfo | null> {
  try {
    logger.info({ query }, "🔍 Searching SoundCloud...");
    
    const results = await playdl.search(query, { 
      source: { soundcloud: "tracks" }, 
      limit: 5 
    });

    if (!results.length) {
      logger.warn({ query }, "SoundCloud: No results found");
      return null;
    }

    // Find first playable result
    for (const t of results) {
      try {
        const title = (t as any).name ?? "Unknown";
        const url = t.url;
        const duration = formatDuration(Math.floor((t as any).durationInMs / 1000) ?? 0);
        const thumbnail = (t as any).thumbnail ?? "";

        logger.info({ title, url }, "✅ SoundCloud: Found track");
        return {
          title,
          url,
          duration,
          thumbnail,
          source: "soundcloud",
        };
      } catch (err) {
        logger.warn({ err }, "SoundCloud: Track processing failed, trying next");
        continue;
      }
    }

    logger.error({ query }, "SoundCloud: All results failed to process");
    return null;
  } catch (err) {
    logger.error({ err, query }, "❌ SoundCloud search error");
    return null;
  }
}

export async function resolveTrack(query: string): Promise<TrackInfo | null> {
  // Check cache first
  const cacheKey = `search:${query}`;
  if (searchCache.has(cacheKey)) {
    logger.info({ query }, "📦 Found in search cache");
    return searchCache.get(cacheKey)!;
  }

  const isUrl = query.startsWith("http://") || query.startsWith("https://");

  // Handle direct URLs
  if (isUrl) {
    // YouTube URL
    if (query.includes("youtube.com") || query.includes("youtu.be")) {
      try {
        logger.info({ url: query }, "Resolving YouTube URL");
        const info = await playdl.video_info(query);
        const v = info.video_details;
        const track: TrackInfo = {
          title: v.title ?? "YouTube Video",
          url: query,
          duration: formatDuration(v.durationInSec ?? 0),
          thumbnail: v.thumbnails?.at(-1)?.url ?? "",
          source: "youtube",
        };
        searchCache.set(cacheKey, track);
        return track;
      } catch (err) {
        logger.error({ err, url: query }, "Failed to resolve YouTube URL");
        return null;
      }
    }

    // SoundCloud URL
    if (query.includes("soundcloud.com")) {
      try {
        logger.info({ url: query }, "Resolving SoundCloud URL");
        const info = await playdl.soundcloud(query);
        if (info.type !== "track") return null;

        const track: TrackInfo = {
          title: (info as any).name ?? "SoundCloud Track",
          url: info.url,
          duration: formatDuration(Math.floor((info as any).durationInMs / 1000)),
          thumbnail: (info as any).thumbnail ?? "",
          source: "soundcloud",
        };
        searchCache.set(cacheKey, track);
        return track;
      } catch (err) {
        logger.error({ err, url: query }, "Failed to resolve SoundCloud URL");
        return null;
      }
    }
  }

  // Text search: Try YouTube FIRST (most songs are there)
  logger.info({ query }, "🎵 Text search: YouTube → SoundCloud");
  
  const ytResult = await searchYouTube(query);
  if (ytResult) {
    searchCache.set(cacheKey, ytResult);
    return ytResult;
  }

  logger.info({ query }, "YouTube failed, trying SoundCloud...");
  const scResult = await searchSoundCloud(query);
  if (scResult) {
    searchCache.set(cacheKey, scResult);
    return scResult;
  }

  logger.error({ query }, "❌ No results found on YouTube or SoundCloud");
  return null;
}

export async function createStream(track: TrackInfo): Promise<Readable> {
  logger.info({ source: track.source, title: track.title }, "📥 Creating stream...");

  // Try streaming with retries
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      logger.info({ attempt, source: track.source }, `Streaming attempt ${attempt}/3`);

      const streamData = await playdl.stream(track.url);

      if (!streamData || !streamData.stream) {
        throw new Error("Stream returned empty");
      }

      logger.info({ source: track.source }, "✅ Stream created successfully");
      return streamData.stream as unknown as Readable;
    } catch (err) {
      logger.warn({ err, attempt, source: track.source }, `Attempt ${attempt} failed`);

      if (attempt < 3) {
        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      // All attempts failed
      logger.error({ err, source: track.source, url: track.url }, "All streaming attempts failed");
      throw new Error(`Cannot stream "${track.title}" — all attempts exhausted`);
    }
  }

  throw new Error("Streaming failed");
}

// Validate on startup
logger.info("Initializing music streamer...");
validateFFmpeg();
