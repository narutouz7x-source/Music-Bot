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
import playdl from "play-dl";
import { MusicQueue, QueueEntry } from "./queue.js";
import { logger } from "../lib/logger.js";

export class GuildPlayer {
  readonly guildId: string;
  readonly queue: MusicQueue;
  private audioPlayer: AudioPlayer;
  private connection: VoiceConnection | null = null;
  private currentEntry: QueueEntry | null = null;
  private volume = 0.5;

  constructor(guildId: string) {
    this.guildId = guildId;
    this.queue = new MusicQueue();
    this.audioPlayer = createAudioPlayer();

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      this.currentEntry = null;
      void this.processQueue();
    });

    this.audioPlayer.on("error", (err) => {
      logger.error({ err, guildId }, "AudioPlayer error");
      this.currentEntry = null;
      void this.processQueue();
    });
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

  getStatus(): AudioPlayerStatus {
    return this.audioPlayer.state.status;
  }

  isPlaying(): boolean {
    return this.audioPlayer.state.status === AudioPlayerStatus.Playing;
  }

  isPaused(): boolean {
    return this.audioPlayer.state.status === AudioPlayerStatus.Paused;
  }

  async play(entry: QueueEntry): Promise<void> {
    this.currentEntry = entry;

    const stream = await playdl.stream(entry.url, { quality: 2 });

    const resource: AudioResource = createAudioResource(stream.stream, {
      inputType: stream.type as StreamType,
      inlineVolume: true,
    });

    resource.volume?.setVolume(this.volume);
    this.audioPlayer.play(resource);

    await entersState(this.audioPlayer, AudioPlayerStatus.Playing, 15_000);
    logger.info({ guildId: this.guildId, title: entry.title }, "Now playing");
  }

  async processQueue(): Promise<void> {
    if (this.isPlaying() || this.isPaused()) return;
    const next = this.queue.dequeue();
    if (!next) {
      logger.info({ guildId: this.guildId }, "Queue empty");
      return;
    }
    try {
      await this.play(next);
    } catch (err) {
      logger.error({ err, guildId: this.guildId }, "Failed to play track, skipping");
      void this.processQueue();
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
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    const state = this.audioPlayer.state;
    if (state.status === AudioPlayerStatus.Playing) {
      (state.resource as AudioResource).volume?.setVolume(this.volume);
    }
  }

  getVolume(): number {
    return Math.round(this.volume * 100);
  }

  disconnect(): void {
    this.stop();
    this.connection?.destroy();
    this.connection = null;
  }
}
