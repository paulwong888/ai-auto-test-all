import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";

export class JsonlReader {
  private buffer = "";
  private readonly decoder = new StringDecoder("utf8");
  private readonly listeners = new Set<(line: string) => void>();
  private ended = false;

  constructor(stream: Readable) {
    stream.on("data", (chunk: Buffer | string) => this.onData(chunk));
    stream.on("end", () => this.onEnd());
    stream.on("error", (err) => this.onError(err));
  }

  onLine(listener: (line: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitLine(rawLine: string): void {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) return;
    for (const listener of this.listeners) {
      listener(line);
    }
  }

  private drainBuffer(final = false): void {
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) break;
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.emitLine(line);
    }

    if (final && this.buffer.length > 0) {
      this.emitLine(this.buffer);
      this.buffer = "";
    }
  }

  private onData(chunk: Buffer | string): void {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    this.drainBuffer();
  }

  private onEnd(): void {
    if (this.ended) return;
    this.ended = true;
    this.buffer += this.decoder.end();
    this.drainBuffer(true);
  }

  private onError(err: Error): void {
    for (const listener of this.listeners) {
      try {
        listener(JSON.stringify({ type: "__stream_error__", error: err.message }));
      } catch {
        // ignore
      }
    }
  }
}
