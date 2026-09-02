import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  createCommand,
  createStreamState,
  parseJsonlLine,
  waitForResponse,
} from "./event-parser.js";
import { JsonlReader } from "./jsonl-reader.js";
import { JsonlWriter } from "./jsonl-writer.js";
import type {
  AuditProgressEvent,
  PiAgentEvent,
  PiJsonlRecord,
  PiRpcCommand,
  PiRpcResponse,
} from "./types.js";
import { isRpcResponse } from "./types.js";

export interface PiRpcClientOptions {
  cwd: string;
  piCliPath?: string;
  rpcArgs?: string[];
  commandTimeoutMs?: number;
  onProgress?: (event: AuditProgressEvent) => void;
}

/**
 * Pi Agent RPC 子进程客户端：管理 stdin 命令写入与 stdout JSONL 事件解析。
 */
export class PiRpcClient extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private writer: JsonlWriter | null = null;
  private readonly responseQueue: PiRpcResponse[] = [];
  private responseWaiters: Array<(response: PiRpcResponse) => void> = [];
  private readonly streamState = createStreamState();

  constructor(private readonly options: PiRpcClientOptions) {
    super();
  }

  get settled(): boolean {
    return this.streamState.settled;
  }

  /** 启动 pi --mode rpc 子进程 */
  async start(): Promise<number> {
    if (this.process) {
      throw new Error("Pi RPC client already started");
    }

    const args = ["--mode", "rpc", ...(this.options.rpcArgs ?? ["--no-session"])];
    const child = spawn(this.options.piCliPath ?? "pi", args, {
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    this.process = child;
    this.writer = new JsonlWriter(child.stdin);

    const reader = new JsonlReader(child.stdout);
    reader.onLine((line) => this.handleLine(line));

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) {
        this.emitProgress({ kind: "error", message: `[pi stderr] ${text}` });
      }
    });

    child.on("exit", (code, signal) => {
      this.emit("exit", { code, signal });
    });

    return child.pid ?? 0;
  }

  /** 发送 RPC 命令并等待对应 response */
  async sendCommand<TData = unknown>(
    command: PiRpcCommand,
    timeoutMs = this.options.commandTimeoutMs ?? 30_000,
  ): Promise<PiRpcResponse & { data?: TData }> {
    if (!this.writer) {
      throw new Error("Pi RPC client not started");
    }

    const commandId = command.id ?? createCommand(command.type).id!;
    command.id = commandId;

    const responsePromise = waitForResponse(
      this.responsesAsync(),
      commandId,
      command.type,
      timeoutMs,
    );

    this.writer.write(command);
    return responsePromise as Promise<PiRpcResponse & { data?: TData }>;
  }

  /** 发送 prompt 并等待 agent_settled */
  async promptAndWait(
    message: string,
    timeoutMs = 600_000,
  ): Promise<void> {
    this.resetSettled();
    const cmd = createCommand("prompt", { message });
    const acceptResponse = await this.sendCommand(cmd, 30_000);
    if (!acceptResponse.success) {
      throw new Error(acceptResponse.error ?? "Prompt rejected by Pi Agent");
    }

    this.emitProgress({ kind: "prompt_sent" });

    await this.waitUntilSettled(timeoutMs);
  }

  async waitUntilSettled(timeoutMs: number): Promise<void> {
    if (this.streamState.settled) return;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for agent_settled"));
      }, timeoutMs);

      const onProgress = (event: AuditProgressEvent) => {
        if (event.kind === "agent_settled") {
          cleanup();
          resolve();
        }
      };

      const onExit = () => {
        if (this.streamState.settled) {
          cleanup();
          resolve();
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off("progress", onProgress);
        this.off("exit", onExit);
      };

      this.on("progress", onProgress);
      this.on("exit", onExit);
    });
  }

  stop(): void {
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");
    }
    this.process = null;
    this.writer = null;
  }

  /** 新一轮 prompt 前重置 settled 状态 */
  resetSettled(): void {
    this.streamState.settled = false;
    this.streamState.lastAssistantText = "";
    this.streamState.textBlocks.clear();
  }

  /** 最近一次助手完整回复文本（审计 JSON 解析用） */
  getLastAssistantText(): string {
    return this.streamState.lastAssistantText;
  }

  private handleLine(line: string): void {
    const { record, progress } = parseJsonlLine(line, this.streamState);

    for (const event of progress) {
      this.emitProgress(event);
    }

    if (isRpcResponse(record)) {
      this.enqueueResponse(record);
    } else {
      this.emit("event", record as PiAgentEvent);
    }

    this.emit("record", record as PiJsonlRecord);
  }

  private enqueueResponse(response: PiRpcResponse): void {
    const waiter = this.responseWaiters.shift();
    if (waiter) {
      waiter(response);
      return;
    }
    this.responseQueue.push(response);
  }

  private async *responsesAsync(): AsyncGenerator<PiRpcResponse> {
    while (true) {
      if (this.responseQueue.length > 0) {
        yield this.responseQueue.shift()!;
        continue;
      }

      const next = await new Promise<PiRpcResponse | null>((resolve) => {
        if (this.responseQueue.length > 0) {
          resolve(this.responseQueue.shift()!);
          return;
        }
        this.responseWaiters.push((r) => resolve(r));
      });

      if (next) yield next;
    }
  }

  private emitProgress(event: AuditProgressEvent): void {
    this.options.onProgress?.(event);
    this.emit("progress", event);
  }
}
