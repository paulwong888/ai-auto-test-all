/**
 * 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
 * 
 * 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
 * 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
 * 
 * 授权商业应用请联系微信：huice666
 */

import { v4 as uuidv4 } from "uuid";
import { Message, ToolMessage } from "@langchain/langgraph-sdk";

export const DO_NOT_RENDER_ID_PREFIX = "do-not-render-";

export function ensureToolCallsHaveResponses(messages: Message[]): Message[] {
  const newMessages: ToolMessage[] = [];

  messages.forEach((message, index) => {
    if (message.type !== "ai" || message.tool_calls?.length === 0) {
      // If it's not an AI message, or it doesn't have tool calls, we can ignore.
      return;
    }
    // If it has tool calls, ensure the message which follows this is a tool message
    const followingMessage = messages[index + 1];
    if (followingMessage && followingMessage.type === "tool") {
      // Following message is a tool message, so we can ignore.
      return;
    }

    // Since the following message is not a tool message, we must create a new tool message
    newMessages.push(
      ...(message.tool_calls?.map((tc) => ({
        type: "tool" as const,
        tool_call_id: tc.id ?? "",
        id: `${DO_NOT_RENDER_ID_PREFIX}${uuidv4()}`,
        name: tc.name,
        content: "Successfully handled tool call.",
      })) ?? []),
    );
  });

  return newMessages;
}
