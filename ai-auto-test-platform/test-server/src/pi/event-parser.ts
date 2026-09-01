import { randomUUID } from "node:crypto";
import type {
  AssistantMessageEvent,
  AuditProgressEvent,
  PiAgentEvent,
  PiJsonlRecord,
  PiRpcCommand,
  PiRpcResponse,
} from "./types.js";
import { isAgentEvent, isRpcResponse } from "./types.js";

export interface ParsedAgentStreamState {
  /** 按 contentIndex 累积的助手文本 */
  textBlocks: Map<number, string>;
  /** 按 toolCallId 累积的工具参数 JSON 片段 */
  toolCallArgs: Map<string, string>;
  /** 最近一次完整助手文本 */
  lastAssistantText: string;
  /** 是否已收到 agent_settled */
  settled: boolean;
  /** 最近一次 bash 工具参数 */
  lastBashArgs: Record<string, unknown>;
}

export function createStreamState(): ParsedAgentStreamState {
  return {
    textBlocks: new Map(),
    toolCallArgs: new Map(),
    lastAssistantText: "",
    settled: false,
    lastBashArgs: {},
  };
}

/**
 * 解析 Pi stdout 单行 JSONL，更新累积状态并产出标准化进度事件。
 */
export function parseJsonlLine(
  line: string,
  state: ParsedAgentStreamState,
): { record: PiJsonlRecord; progress: AuditProgressEvent[] } {
  const progress: AuditProgressEvent[] = [];

  let record: PiJsonlRecord;
  try {
    record = JSON.parse(line) as PiJsonlRecord;
  } catch {
    progress.push({ kind: "error", message: `Invalid JSONL: ${line.slice(0, 200)}` });
    return { record: { type: "extension_error", message: "parse_error" }, progress };
  }

  if (isRpcResponse(record)) {
    if (!record.success) {
      progress.push({
        kind: "error",
        message: record.error ?? `RPC command ${record.command} failed`,
      });
    }
    return { record, progress };
  }

  if (!isAgentEvent(record)) {
    return { record, progress };
  }

  progress.push({ kind: "agent_event", event: record });
  progress.push(...deriveProgressFromAgentEvent(record, state));

  return { record, progress };
}

function deriveProgressFromAgentEvent(
  event: PiAgentEvent,
  state: ParsedAgentStreamState,
): AuditProgressEvent[] {
  const events: AuditProgressEvent[] = [];

  switch (event.type) {
    case "message_update": {
      const update = event as Extract<PiAgentEvent, { type: "message_update" }>;
      const deltaEvents = handleAssistantMessageEvent(
        update.assistantMessageEvent,
        state,
      );
      events.push(...deltaEvents);
      break;
    }
    case "message_end": {
      const end = event as Extract<PiAgentEvent, { type: "message_end" }>;
      const msg = end.message as { role?: string; content?: unknown };
      if (msg?.role === "assistant" && typeof msg.content === "string") {
        state.lastAssistantText = msg.content;
      }
      break;
    }
    case "tool_execution_start": {
      const start = event as Extract<PiAgentEvent, { type: "tool_execution_start" }>;
      if (start.toolName === "bash") {
        state.lastBashArgs = start.args;
      }
      events.push({
        kind: "tool_start",
        toolName: start.toolName,
        args: start.args,
      });
      break;
    }
    case "tool_execution_end": {
      const end = event as Extract<PiAgentEvent, { type: "tool_execution_end" }>;
      events.push({
        kind: "tool_end",
        toolName: end.toolName,
        args: end.toolName === "bash" ? state.lastBashArgs : {},
        isError: end.isError,
      });
      break;
    }
    case "agent_settled":
      state.settled = true;
      events.push({ kind: "agent_settled" });
      break;
    default:
      break;
  }

  return events;
}

function handleAssistantMessageEvent(
  ame: AssistantMessageEvent,
  state: ParsedAgentStreamState,
): AuditProgressEvent[] {
  const events: AuditProgressEvent[] = [];

  switch (ame.type) {
    case "text_delta": {
      const idx = ame.contentIndex ?? 0;
      const prev = state.textBlocks.get(idx) ?? "";
      const next = prev + (ame.delta ?? "");
      state.textBlocks.set(idx, next);
      state.lastAssistantText = [...state.textBlocks.values()].join("");
      if (ame.delta) {
        events.push({ kind: "text_delta", delta: ame.delta });
      }
      break;
    }
    case "text_end": {
      const idx = ame.contentIndex ?? 0;
      if (ame.content !== undefined) {
        state.textBlocks.set(idx, ame.content);
        state.lastAssistantText = [...state.textBlocks.values()].join("");
      }
      break;
    }
    case "toolcall_start":
      if (ame.id) {
        state.toolCallArgs.set(ame.id, "");
      }
      break;
    case "toolcall_delta":
      if (ame.id) {
        const prev = state.toolCallArgs.get(ame.id) ?? "";
        state.toolCallArgs.set(ame.id, prev + (ame.delta ?? ""));
      }
      break;
    default:
      break;
  }

  return events;
}

/** 等待指定 RPC 命令的 response（按 id 关联） */
export function waitForResponse(
  responses: AsyncIterable<PiRpcResponse>,
  commandId: string,
  commandType: string,
  timeoutMs: number,
): Promise<PiRpcResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`RPC response timeout for ${commandType} (${commandId})`));
    }, timeoutMs);

    void (async () => {
      try {
        for await (const response of responses) {
          if (response.id === commandId && response.command === commandType) {
            clearTimeout(timer);
            resolve(response);
            return;
          }
        }
        clearTimeout(timer);
        reject(new Error(`Stream ended before response for ${commandType}`));
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    })();
  });
}

export function createCommand(type: string, payload: Record<string, unknown> = {}): PiRpcCommand {
  return { id: randomUUID(), type, ...payload };
}
