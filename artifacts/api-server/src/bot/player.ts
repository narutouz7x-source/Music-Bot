import {
  AudioPlayer,
  AudioPlayerStatus,
  VoiceConnection,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioResource,
  StreamType,
} from "@discordjs/voice";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { createStream } from "./streamer.js";
import { MusicQueue, QueueEntry } from "./queue.js";
import { logger } from "../lib/logger.js";

if (ffmpegStatic) {
  process.env["FFMPEG_PATH"] = ffmpegStatic;
}

export type PlayerEvent = "trackStart" | "trackEnd" | "queueEmpty" | "stateChange";

export class GuildPlayer {
  readonly guildId: string;
  readonly queue: MusicQueue;
  private audioPlayer: AudioPlayer;
  private connection: VoiceConnection | null = null;
  private currentEntry: QueueEntry | null = null;
  private history: QueueEntry[] = [];
  private volume = 0.5;
  private eventListeners = new Map<PlayerEvent, Array<() => void>>();

  constructor(guildId: string) {
    this.guildId = guildId;
    this.queue = new MusicQueue();
    this.audioPlayer = createAudioPlayer();

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      if (this.currentEntry) {
        if (this.queue.repeatMode === "one") {
          const repeat = this.currentEntry;
          this.currentEntry = null;
          void this.play(repeat);
          return;
        }
        if (this.queue.repeatMode === "all") {
          this.queue.enqueue(this.currentEntry);
        }
        this.history.push(this.currentEntry);
        if (this.history.length > 20) this.history.shift();
      }
      this.currentEntry = null;
      this.emit("trackEnd");
      void this.processQueue();
    });

    this.audioPlayer.on("error", (err) => {
      logger.error({ err, guildId }, "AudioPlayer error");
      if (this.currentEntry) {
        this.history.push(this.currentEntry);
        if (this.history.length > 20) this.history.shift();
      }
      this.currentEntry = null;
      this.emit("stateChange");
      void this.processQueue();
    });

    this.audioPlayer.on(AudioPlayerStatus.Playing, () => this.emit("stateChange"));
    this.audioPlayer.on(AudioPlayerStatus.Paused, () => this.emit("stateChange"));
  }

  on(event: PlayerEvent, callback: () => void): void {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, []);
    this.eventListeners.get(event)!.push(callback);
  }

  private emit(event: PlayerEvent): void {
    this.eventListeners.get(event)?.forEach((cb) => cb());
  }

  setConnection(connection: VoiceConnection): void {
    this.connection = connection;
    connection.subscribe(this.audioPlayer);
  }

  getConnection(): VoiceConnection | null {
    return this.connection;
  }

  getCurrentEntry(): QueueEntry | null {
    return this.currentEntry;
  }

  getHistory(): QueueEntry[] {
    return [...this.history];
  }

  getStatus(): AudioPlayerStatus {
    return this.audioPlayer.state.status;
  }

  isPlaying(): boolean {
    return this.audioPlayer.state.status === AudioPlayerStatus.Playing;
  }

  isPaused(): boolean {
    return this.audioPlayer.state.status === AudioPlayerStatus.Paused;
  }

  isActive(): boolean {
    return this.isPlaying() || this.isPaused();
  }

  private createFFmpegTranscoder(inputStream: NodeJS.ReadableStream) {
    const ffmpeg = spawn(ffmpegStatic || "ffmpeg", [
      "-i",
      "pipe:0",
      "-acodec",
      "libopus",
      "-af",
      "aresample=48000",
      "-f",
      "ogg",
      "pipe:1",
    ]);

    // Handle FFmpeg errors
    ffmpeg.on("error", (err) => {
      logger.error({ err, guildId: this.guildId }, "FFmpeg process error");
    });

    ffmpeg.stderr.on("data", (data) => {
      const message = data.toString();
      if (message.includes("error") || message.includes("Error")) {
        logger.error({ guildId: this.guildId, ffmpegError: message }, "FFmpeg error message");
      }
    });

    // Pipe input stream to FFmpeg
    inputStream.pipe(ffmpeg.stdin);

    return ffmpeg.stdout;
  }

  async play(entry: QueueEntry): Promise<void> {
    this.currentEntry = entry;

    try {
      logger.info({ guildId: this.guildId, title: entry.title, source: entry.source }, "Fetching stream...");
      const stream = await createStream(entry);

      // Transcode through FFmpeg to OggOpus
      logger.info({ guildId: this.guildId }, "Transcoding to OggOpus...");
      const transcodedStream = this.createFFmpegTranscoder(stream);

      const resource: AudioResource = createAudioResource(transcodedStream, {
        inputType: StreamType.OggOpus,
        inlineVolume: true,
      });

      resource.volume?.setVolume(this.volume);
      this.audioPlayer.play(resource);

      // Wait for audio to start playing
      await entersState(this.audioPlayer, AudioPlayerStatus.Playing, 30_000);
      logger.info({ guildId: this.guildId, title: entry.title, source: entry.source }, "✅ Now playing");
      this.emit("trackStart");
    } catch (err) {
      logger.error({ err, guildId: this.guildId, title: entry.title }, "Failed to play track");
      throw err;
    }
  }

  async processQueue(): Promise<void> {
    if (this.isActive()) return;
    const next = this.queue.dequeue();
    if (!next) {
      logger.info({ guildId: this.guildId }, "Queue empty");
      this.emit("queueEmpty");
      return;
    }
    try {
      await this.play(next);
    } catch (err) {
      logger.error({ err, guildId: this.guildId }, "Failed to play track, skipping");
      void this.processQueue();
    }
  }

  async previous(): Promise<boolean> {
    const prev = this.history.pop();
    if (!prev) return false;
    if (this.currentEntry) {
      this.queue.prepend(this.currentEntry);
    }
    this.audioPlayer.stop(true);
    try {
      await this.play(prev);
      return true;
    } catch (err) {
      logger.error({ err, guildId: this.guildId }, "Failed to play previous track");
      return false;
    }
  }

  pause(): boolean {
    return this.audioPlayer.pause();
  }

  resume(): boolean {
    return this.audioPlayer.unpause();
  }

  skip(): void {
    this.audioPlayer.stop(true);
  }

  stop(): void {
    this.queue.clear();
    this.audioPlayer.stop(true);
    this.currentEntry = null;
    this.emit("stateChange");
  }

  cycleRepeat(): string {
    const modes = ["off", "one", "all"] as const;
    const next = modes[(modes.indexOf(this.queue.repeatMode) + 1) % modes.length];
    this.queue.repeatMode = next!;
    this.emit("stateChange");
    return next!;
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    const state = this.audioPlayer.state;
    if (state.status === AudioPlayerStatus.Playing || state.status === AudioPlayerStatus.Paused) {
      (state.resource as AudioResource).volume?.setVolume(this.volume);
    }
    this.emit("stateChange");
  }

  getVolume(): number {
    return Math.round(this.volume * 100);
  }

  disconnect(): void {
    this.stop();
    this.connection?.destroy();
    this.connection = null;
    this.eventListeners.clear();
  }
}
