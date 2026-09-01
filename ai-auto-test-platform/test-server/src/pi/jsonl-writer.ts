import type { Writable } from "node:stream";
import type { PiRpcCommand } from "./types.js";

/**
 * 向 Pi stdin 写入 JSONL 命令（每条记录以 LF 结尾）。
 */
export class JsonlWriter {
  constructor(private readonly stream: Writable) {}

  write(command: PiRpcCommand): void {
    const payload = JSON.stringify(command) + "\n";
    this.stream.write(payload);
  }

  end(): void {
    this.stream.end();
  }
}
