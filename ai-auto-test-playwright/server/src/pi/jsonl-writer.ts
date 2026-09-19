import type { Writable } from "node:stream";
import type { PiRpcCommand } from "./types.js";

export class JsonlWriter {
  constructor(private readonly stream: Writable) {}

  write(command: PiRpcCommand): void {
    this.stream.write(JSON.stringify(command) + "\n");
  }
}
