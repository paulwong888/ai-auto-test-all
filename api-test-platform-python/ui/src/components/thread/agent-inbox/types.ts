/**
 * 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
 * 
 * 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
 * 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
 * 
 * 授权商业应用请联系微信：huice666
 */

import { BaseMessage } from "@langchain/core/messages";
import { Interrupt, Thread, ThreadStatus } from "@langchain/langgraph-sdk";

export type DecisionType = "approve" | "edit" | "reject";

export interface Action {
  name: string;
  args: Record<string, unknown>;
}

export interface ActionRequest {
  name: string;
  args: Record<string, unknown>;
  description?: string;
}

export interface ReviewConfig {
  action_name: string;
  allowed_decisions: DecisionType[];
  args_schema?: Record<string, unknown>;
}

export interface HITLRequest {
  action_requests: ActionRequest[];
  review_configs: ReviewConfig[];
}

export type Decision =
  | { type: "approve" }
  | { type: "reject"; message?: string }
  | { type: "edit"; edited_action: Action };

export type DecisionWithEdits =
  | { type: "approve" }
  | { type: "reject"; message?: string }
  | {
      type: "edit";
      edited_action: Action;
      acceptAllowed?: boolean;
      editsMade?: boolean;
    };

export type Email = {
  id: string;
  thread_id: string;
  from_email: string;
  to_email: string;
  subject: string;
  page_content: string;
  send_time: string | undefined;
  read?: boolean;
  status?: "in-queue" | "processing" | "hitl" | "done";
};

export interface ThreadValues {
  email: Email;
  messages: BaseMessage[];
  triage: {
    logic: string;
    response: string;
  };
}

export type ThreadData<
  ThreadValues extends Record<string, any> = Record<string, any>,
> = {
  thread: Thread<ThreadValues>;
} & (
  | {
      status: "interrupted";
      interrupts: Interrupt<HITLRequest>[] | undefined;
    }
  | {
      status: "idle" | "busy" | "error";
      interrupts?: never;
    }
);

export type ThreadStatusWithAll = ThreadStatus | "all";

export type SubmitType = DecisionType;

export interface AgentInbox {
  /**
   * A unique identifier for the inbox.
   */
  id: string;
  /**
   * The ID of the graph.
   */
  graphId: string;
  /**
   * The URL of the deployment. Either a localhost URL, or a deployment URL.
   */
  deploymentUrl: string;
  /**
   * Optional name for the inbox, used in the UI to label the inbox.
   */
  name?: string;
  /**
   * Whether or not the inbox is selected.
   */
  selected: boolean;
}
