/** Pi Agent RPC 协议类型 */

export interface PiRpcCommand {
  id?: string;
  type: string;
  [key: string]: unknown;
}

export interface PiRpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface AssistantMessageEvent {
  type:
    | "text_start"
    | "text_delta"
    | "text_end"
    | "thinking_start"
    | "thinking_delta"
    | "thinking_end"
    | "toolcall_start"
    | "toolcall_delta"
    | "toolcall_end";
  contentIndex?: number;
  delta?: string;
  content?: string;
  id?: string;
  toolName?: string;
}

export type PiAgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages?: unknown[]; willRetry?: boolean }
  | { type: "agent_settled" }
  | { type: "turn_start" }
  | { type: "turn_end"; message?: unknown; toolResults?: unknown[] }
  | { type: "message_start"; message: unknown }
  | { type: "message_end"; message: unknown }
  | {
      type: "message_update";
      usage?: Record<string, unknown>;
      assistantMessageEvent: AssistantMessageEvent;
    }
  | { type: "bash_execution_update"; id?: string; delta: string }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | { type: string; [key: string]: unknown };

export type PiJsonlRecord = PiRpcResponse | PiAgentEvent;

export function isRpcResponse(record: PiJsonlRecord): record is PiRpcResponse {
  return record.type === "response";
}

export function isAgentEvent(record: PiJsonlRecord): record is PiAgentEvent {
  return record.type !== "response";
}

export type PiProgressEvent =
  | { kind: "prompt_sent" }
  | { kind: "agent_event"; event: PiAgentEvent }
  | { kind: "text_delta"; delta: string }
  | { kind: "tool_start"; toolName: string; args: Record<string, unknown> }
  | { kind: "tool_end"; toolName: string; args: Record<string, unknown>; isError: boolean }
  | { kind: "agent_settled" }
  | { kind: "error"; message: string };

export type WsMessage =
  | { type: "connected"; message: string }
  | { type: "plan_generating"; projectId: string; jobId: string }
  | { type: "plan_ready"; projectId: string; planPath: string; jobId: string }
  | { type: "plan_failed"; projectId: string; jobId: string; error: string }
  | { type: "code_generating"; projectId: string; jobId: string }
  | { type: "code_ready"; projectId: string; jobId: string }
  | { type: "code_failed"; projectId: string; jobId: string; error: string }
  | { type: "fix_generating"; projectId: string; jobId: string; runId: string }
  | { type: "fix_ready"; projectId: string; jobId: string; runId: string }
  | { type: "fix_failed"; projectId: string; jobId: string; runId: string; error: string }
  | { type: "job_log"; projectId: string; jobId: string; stream: "ai" | "tool" | "stderr"; text: string }
  | { type: "run_started"; runId: string; projectId: string; jobId?: string }
  | { type: "run_log"; runId: string; line: string }
  | { type: "run_finished"; runId: string; passed: number; failed: number; skipped: number; durationMs: number }
  | { type: "job_queued"; projectId: string; jobId: string; jobType: string }
  | { type: "job_started"; projectId: string; jobId: string }
  | { type: "job_completed"; projectId: string; jobId: string }
  | { type: "job_failed"; projectId: string; jobId: string; error: string };
