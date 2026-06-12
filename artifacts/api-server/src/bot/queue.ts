export interface QueueEntry {
  title: string;
  url: string;
  duration: string;
  thumbnail: string;
  requestedBy: string;
  source: "youtube" | "soundcloud";
  scFallbackQuery?: string;
}

export type RepeatMode = "off" | "one" | "all";

export class MusicQueue {
  private items: QueueEntry[] = [];
  repeatMode: RepeatMode = "off";

  enqueue(entry: QueueEntry): void {
    this.items.push(entry);
  }

  prepend(entry: QueueEntry): void {
    this.items.unshift(entry);
  }

  dequeue(): QueueEntry | undefined {
    return this.items.shift();
  }

  peek(): QueueEntry | undefined {
    return this.items[0];
  }

  getAll(): QueueEntry[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }

  get length(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }
}
