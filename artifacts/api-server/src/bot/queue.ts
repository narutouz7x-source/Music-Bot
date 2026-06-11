export interface QueueEntry {
  title: string;
  url: string;
  requestedBy: string;
}

export class MusicQueue {
  private items: QueueEntry[] = [];

  enqueue(entry: QueueEntry): void {
    this.items.push(entry);
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
