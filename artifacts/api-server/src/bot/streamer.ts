import ytdl from "@distube/ytdl-core";
import playdl from "play-dl";
import { logger } from "../lib/logger.js";

export interface TrackInfo {
  title: string;
  url: string;
  duration: string;
  thumbnail: string;
}

function formatDuration(secs: number): string {
  if (!secs) return "Live";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const YTDL_AGENT = ytdl.createAgent();

export async function resolveTrack(query: string): Promise<TrackInfo | null> {
  try {
    const isUrl = query.startsWith("http://") || query.startsWith("https://");

    if (isUrl && ytdl.validateURL(query)) {
      const info = await ytdl.getInfo(query, { agent: YTDL_AGENT });
      const d = info.videoDetails;
      return {
        title: d.title,
        url: d.video_url,
        duration: formatDuration(Number(d.lengthSeconds)),
        thumbnail: d.thumbnails.at(-1)?.url ?? "",
      };
    }

    const results = await playdl.search(query, { source: { youtube: "video" }, limit: 1 });
    if (!results.length) return null;
    const v = results[0]!;
    const info = await ytdl.getInfo(v.url, { agent: YTDL_AGENT });
    const d = info.videoDetails;
    return {
      title: d.title,
      url: d.video_url,
      duration: formatDuration(Number(d.lengthSeconds)),
      thumbnail: d.thumbnails.at(-1)?.url ?? "",
    };
  } catch (err) {
    logger.error({ err, query }, "resolveTrack failed");
    return null;
  }
}

export function createYtdlpStream(url: string) {
  return ytdl(url, {
    agent: YTDL_AGENT,
    filter: "audioonly",
    quality: "highestaudio",
    highWaterMark: 1 << 25,
  });
}
