/**
 * Pi Agent RPC 协议类型定义
 * @see https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md
 */

/** 发往 Pi stdin 的 RPC 命令 */
export interface PiRpcCommand {
  id?: string;
  type: string;
  [key: string]: unknown;
}

/** Pi stdout 返回的标准响应 */
export interface PiRpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/** 助手消息流式增量事件 */
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
  toolCall?: ToolCallPayload;
}

export interface ToolCallPayload {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultContent {
  type: string;
  text?: string;
}

export interface ToolExecutionResult {
  content: ToolResultContent[];
  details?: Record<string, unknown>;
}

/** Pi stdout 流式事件（非 response 类型） */
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
      partialResult: ToolExecutionResult;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: ToolExecutionResult;
      isError: boolean;
    }
  | { type: "queue_update"; steering?: string[]; followUp?: string[] }
  | { type: "compaction_start"; reason?: string }
  | { type: "compaction_end"; [key: string]: unknown }
  | { type: "auto_retry_start" }
  | { type: "auto_retry_end" }
  | { type: "extension_error"; [key: string]: unknown }
  | { type: string; [key: string]: unknown };

/** stdout 上任意一行 JSONL 记录 */
export type PiJsonlRecord = PiRpcResponse | PiAgentEvent;

export function isRpcResponse(record: PiJsonlRecord): record is PiRpcResponse {
  return record.type === "response";
}

export function isAgentEvent(record: PiJsonlRecord): record is PiAgentEvent {
  return record.type !== "response";
}

/** Gherkin 步骤结构 */
export interface GherkinSteps {
  scenario: string;
  given: string[];
  when: string[];
  then: string[];
  and?: string[];
}

/** FEATURES.json 单条功能 */
export interface FeatureItem {
  id: string;
  title: string;
  description: string;
  sourceFile: string;
  route?: string;
  gherkin: GherkinSteps;
  /** 完整 Gherkin 文本，便于前端直接展示 */
  gherkinText: string;
}

/** FEATURES.json 根结构 */
export interface FeaturesDocument {
  version: "1.0";
  generatedAt: string;
  repoPath: string;
  features: FeatureItem[];
}

/** 审计任务进度事件（供 API / WebSocket 复用） */
export type AuditProgressEvent =
  | { kind: "started"; repoPath: string; mode?: "core" | "full" }
  | { kind: "pi_spawned"; pid: number }
  | { kind: "prompt_sent" }
  | { kind: "agent_event"; event: PiAgentEvent }
  | { kind: "text_delta"; delta: string }
  | { kind: "tool_start"; toolName: string; args: Record<string, unknown> }
  | { kind: "tool_end"; toolName: string; args: Record<string, unknown>; isError: boolean }
  | { kind: "agent_settled" }
  | { kind: "module_started"; moduleId: string; moduleTitle: string }
  | { kind: "module_completed"; moduleId: string; moduleTitle: string; featureCount: number }
  | { kind: "module_failed"; moduleId: string; moduleTitle: string; message: string }
  | { kind: "merge_completed"; featureCount: number }
  | { kind: "features_loaded"; features: FeaturesDocument }
  | { kind: "error"; message: string }
  | { kind: "completed"; featuresPath: string; featureCount: number; mode?: "core" | "full" };

/** Gherkin 步骤相位 */
export type GherkinPhase = "given" | "when" | "then" | "and";

export type StepStatus = "pending" | "running" | "pass" | "fail" | "healing";

export interface FlatGherkinStep {
  phase: GherkinPhase;
  index: number;
  text: string;
  status: StepStatus;
}

export type MilestoneKind =
  | "when_failed"
  | "healing_start"
  | "healing_edit"
  | "healing_retry"
  | "then_checking"
  | "then_pass"
  | "then_fail";

export type AuditJobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type AuditModuleJobStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface AuditModuleJobState {
  id: string;
  title: string;
  status: AuditModuleJobStatus;
  featureCount?: number;
  error?: string;
}

export interface AuditJobState {
  id: string;
  projectId: string;
  mode: "full";
  status: AuditJobStatus;
  createdAt: string;
  updatedAt: string;
  repoPath: string;
  currentModuleId?: string;
  modules: AuditModuleJobState[];
  featureCount: number;
  error?: string;
  featuresPath?: string;
}

/** WebSocket 广播消息 */
export type WsMessage =
  | { type: "run_started"; runId: string; featureId: string; title: string; steps: FlatGherkinStep[] }
  | { type: "step_update"; runId: string; phase: GherkinPhase; index: number; status: StepStatus }
  | {
      type: "milestone";
      runId: string;
      kind: MilestoneKind;
      message: string;
      phase?: GherkinPhase;
      index?: number;
    }
  | { type: "log"; runId: string; stream: "stdout" | "stderr" | "ai" | "tool"; text: string }
  | { type: "run_finished"; runId: string; success: boolean; message: string }
  | { type: "audit_job_started"; jobId: string; projectId: string; moduleCount: number }
  | { type: "audit_module_started"; jobId: string; moduleId: string; moduleTitle: string }
  | { type: "audit_module_completed"; jobId: string; moduleId: string; moduleTitle: string; featureCount: number }
  | { type: "audit_module_failed"; jobId: string; moduleId: string; moduleTitle: string; message: string }
  | { type: "audit_merge_completed"; jobId: string; featureCount: number }
  | { type: "audit_job_completed"; jobId: string; featureCount: number; success: boolean; message: string };

/** 剧本执行内部进度（复用 Pi 事件解析） */
export type RunProgressEvent =
  | AuditProgressEvent
  | { kind: "step_update"; phase: GherkinPhase; index: number; status: StepStatus }
  | { kind: "run_finished"; success: boolean; message: string };

export function flattenGherkinSteps(gherkin: GherkinSteps): FlatGherkinStep[] {
  const steps: FlatGherkinStep[] = [];
  const push = (phase: GherkinPhase, texts: string[]) => {
    texts.forEach((text, index) => {
      steps.push({ phase, index, text, status: "pending" });
    });
  };
  push("given", gherkin.given);
  push("when", gherkin.when);
  if (gherkin.and?.length) push("and", gherkin.and);
  push("then", gherkin.then);
  return steps;
}
