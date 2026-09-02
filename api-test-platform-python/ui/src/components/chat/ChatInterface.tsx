/**
 * 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
 * 
 * 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
 * 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
 * 
 * 授权商业应用请联系微信：huice666
 */

"use client";

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  FormEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Square,
  ArrowUp,
  Plus,
} from "lucide-react";
import { ChatMessage } from "./ChatMessage";
import type { ToolCall, ActionRequest, ReviewConfig, Project } from "@/types/chat";
import { Message } from "@langchain/langgraph-sdk";
import { extractStringFromMessageContent } from "@/lib/chat-utils";
import { useChatContext } from "@/providers/ChatProvider";
import { cn } from "@/lib/utils";
import { useStickToBottom } from "use-stick-to-bottom";
import { useFileUpload } from "@/hooks/use-file-upload";
import { ContentBlocksPreview } from "@/components/thread/ContentBlocksPreview";
import { Label } from "@/components/ui/label";
import { useQueryState, parseAsBoolean } from "nuqs";
import { QuickActions } from "./QuickActions";

interface ChatInterfaceProps {
  graphId?: string;
}

export const ChatInterface = React.memo<ChatInterfaceProps>(({ graphId }) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [input, setInput] = useState("");
  const [selectedProject, setSelectedProject] = useState<Project | undefined>(
    undefined,
  );
  const { scrollRef, contentRef } = useStickToBottom();
  const [hideToolCalls, setHideToolCalls] = useQueryState(
    "hideToolCalls",
    parseAsBoolean.withDefault(false),
  );
  const {
    contentBlocks,
    handleFileUpload,
    dropRef,
    removeBlock,
    resetBlocks,
    dragOver,
    handlePaste,
  } = useFileUpload();

  const {
    stream,
    messages,
    ui,
    isLoading,
    isThreadLoading,
    interrupt,
    sendMessage,
    stopStream,
    resumeInterrupt,
  } = useChatContext();

  const submitDisabled = isLoading;

  const submitMessage = useCallback(
    (text: string) => {
      if (!text.trim() || isLoading) return;
      sendMessage(text, [], {
        project_id: selectedProject?.id,
      });
    },
    [isLoading, sendMessage, selectedProject],
  );

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      if (e) {
        e.preventDefault();
      }
      const messageText = input.trim();
      if (
        (!messageText && contentBlocks.length === 0) ||
        isLoading ||
        submitDisabled
      )
        return;
      submitMessage(messageText);
      setInput("");
      resetBlocks();
    },
    [input, contentBlocks, isLoading, submitDisabled, resetBlocks, submitMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (submitDisabled) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, submitDisabled],
  );

  const messageUiMap = useMemo(() => {
    const nextMap = new Map<string, any[]>();

    if (!ui) {
      return nextMap;
    }

    ui.forEach((item: any) => {
      const messageId = item.metadata?.message_id;
      if (!messageId) {
        return;
      }

      const existing = nextMap.get(messageId);
      if (existing) {
        existing.push(item);
      } else {
        nextMap.set(messageId, [item]);
      }
    });

    return nextMap;
  }, [ui]);

  const processedMessages = useMemo(() => {
    const messageMap = new Map<
      string,
      { message: Message; toolCalls: ToolCall[] }
    >();

    messages.forEach((message: Message) => {
      if (message.type === "ai") {
        const toolCallsInMessage: Array<{
          id?: string;
          function?: { name?: string; arguments?: unknown };
          name?: string;
          type?: string;
          args?: unknown;
          input?: unknown;
        }> = [];

        if (
          message.additional_kwargs?.tool_calls &&
          Array.isArray(message.additional_kwargs.tool_calls)
        ) {
          toolCallsInMessage.push(...message.additional_kwargs.tool_calls);
        } else if (message.tool_calls && Array.isArray(message.tool_calls)) {
          toolCallsInMessage.push(
            ...message.tool_calls.filter(
              (toolCall: { name?: string }) => toolCall.name !== "",
            ),
          );
        } else if (Array.isArray(message.content)) {
          const toolUseBlocks = message.content.filter(
            (block: { type?: string }) => block.type === "tool_use",
          );
          toolCallsInMessage.push(...toolUseBlocks);
        }

        const toolCallsWithStatus = toolCallsInMessage.map(
          (toolCall: {
            id?: string;
            function?: { name?: string; arguments?: unknown };
            name?: string;
            type?: string;
            args?: unknown;
            input?: unknown;
          }) => {
            const name =
              toolCall.function?.name ||
              toolCall.name ||
              toolCall.type ||
              "unknown";
            const args =
              toolCall.function?.arguments ||
              toolCall.args ||
              toolCall.input ||
              {};
            return {
              id: toolCall.id || `tool-${Math.random()}`,
              name,
              args,
              status: interrupt ? "interrupted" : ("pending" as const),
            } as ToolCall;
          },
        );

        messageMap.set(message.id!, {
          message,
          toolCalls: toolCallsWithStatus,
        });
      } else if (message.type === "tool") {
        const toolCallId = message.tool_call_id;
        if (!toolCallId) {
          return;
        }

        for (const [, data] of messageMap.entries()) {
          const toolCallIndex = data.toolCalls.findIndex(
            (tc: ToolCall) => tc.id === toolCallId,
          );
          if (toolCallIndex === -1) {
            continue;
          }

          data.toolCalls[toolCallIndex] = {
            ...data.toolCalls[toolCallIndex],
            status: "completed" as const,
            result: extractStringFromMessageContent(message),
          };
          break;
        }
      } else if (message.type === "human") {
        messageMap.set(message.id!, {
          message,
          toolCalls: [],
        });
      }
    });

    const processedArray = Array.from(messageMap.values());
    return processedArray.map((data, index) => {
      const prevMessage =
        index > 0 ? processedArray[index - 1].message : null;
      return {
        ...data,
        showAvatar: data.message.type !== prevMessage?.type,
      };
    });
  }, [messages, interrupt]);

  const actionRequestsMap: Map<string, ActionRequest> | null = useMemo(() => {
    const actionRequests =
      interrupt && (interrupt as any)?.value?.["action_requests"];
    if (!actionRequests) return new Map<string, ActionRequest>();
    return new Map(actionRequests.map((ar: ActionRequest) => [ar.name, ar]));
  }, [interrupt]);

  const reviewConfigsMap: Map<string, ReviewConfig> | null = useMemo(() => {
    const reviewConfigs =
      interrupt && (interrupt as any)?.value?.["review_configs"];
    if (!reviewConfigs) return new Map<string, ReviewConfig>();
    return new Map(
      reviewConfigs.map((rc: any) => {
        const normalized: ReviewConfig = {
          actionName: rc.actionName || rc.action_name || "",
          allowedDecisions:
            rc.allowedDecisions || rc.allowed_decisions || undefined,
        };
        return [normalized.actionName, normalized];
      }),
    );
  }, [interrupt]);

  const lastMessageId = processedMessages.at(-1)?.message.id;

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const frameId = window.requestAnimationFrame(() => {
      scrollElement.scrollTo({
        top: scrollElement.scrollHeight,
        behavior: isLoading ? "auto" : "smooth",
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [lastMessageId, processedMessages.length, isLoading, scrollRef]);

  const lastProcessedMessage = processedMessages.at(-1);
  const isAwaitingFirstToken =
    isLoading &&
    lastProcessedMessage?.message.type === "human";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        ref={scrollRef}
      >
        <div
          className="mx-auto w-full max-w-[1024px] px-6 pb-6 pt-4"
          ref={contentRef}
        >
          {isThreadLoading ? (
            <div className="flex items-center justify-center p-8">
              <p className="text-muted-foreground">加载中...</p>
            </div>
          ) : (
            <>
              {processedMessages.map((data, index) => {
                const messageUi = messageUiMap.get(data.message.id ?? "");
                const isLastMessage = index === processedMessages.length - 1;
                return (
                  <ChatMessage
                    key={data.message.id}
                    message={data.message}
                    toolCalls={data.toolCalls}
                    isLoading={isLoading}
                    isStreaming={isLastMessage && isLoading}
                    actionRequestsMap={
                      isLastMessage ? actionRequestsMap : undefined
                    }
                    reviewConfigsMap={
                      isLastMessage ? reviewConfigsMap : undefined
                    }
                    ui={messageUi}
                    stream={isLastMessage ? stream : undefined}
                    onResumeInterrupt={
                      isLastMessage ? resumeInterrupt : undefined
                    }
                    graphId={isLastMessage ? graphId : undefined}
                    hideToolCalls={hideToolCalls}
                  />
                );
              })}
              {isAwaitingFirstToken && (
                <div className="mr-auto flex items-start gap-2">
                  <div className="bg-muted flex h-8 items-center gap-1 rounded-2xl px-4 py-2">
                    <div className="bg-foreground/50 h-1.5 w-1.5 animate-[pulse_1.5s_ease-in-out_infinite] rounded-full"></div>
                    <div className="bg-foreground/50 h-1.5 w-1.5 animate-[pulse_1.5s_ease-in-out_0.5s_infinite] rounded-full"></div>
                    <div className="bg-foreground/50 h-1.5 w-1.5 animate-[pulse_1.5s_ease-in-out_1s_infinite] rounded-full"></div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 bg-background">
        <div
          ref={dropRef}
          className={cn(
            "mx-4 mb-6 flex flex-shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background",
            "mx-auto w-[calc(100%-32px)] max-w-[1024px] transition-colors duration-200 ease-in-out",
            dragOver && "border-primary border-2 border-dotted",
          )}
        >
          <form
            onSubmit={handleSubmit}
            className="flex flex-col"
          >
            <div className="px-[18px] pt-3">
              <QuickActions
                project={selectedProject}
                onProjectChange={setSelectedProject}
                onSendMessage={submitMessage}
                isLoading={isLoading}
              />
            </div>
            <ContentBlocksPreview
              blocks={contentBlocks}
              onRemove={removeBlock}
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={isLoading ? "运行中..." : "输入您的消息..."}
              className="font-inherit field-sizing-content flex-1 resize-none border-0 bg-transparent px-[18px] pb-[13px] pt-[14px] text-sm leading-7 text-primary outline-none placeholder:text-tertiary"
              rows={1}
            />
            <div className="flex justify-between gap-2 p-3">
              <div className="flex items-center gap-4">
                <Label
                  htmlFor="file-input"
                  className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-primary"
                >
                  <Plus className="size-5" />
                  <span className="text-sm">上传 PDF 或图片</span>
                </Label>
                <input
                  id="file-input"
                  type="file"
                  onChange={handleFileUpload}
                  multiple
                  accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                  className="hidden"
                />
                <div className="flex items-center gap-2">
                  <Switch
                    id="render-tool-calls"
                    checked={hideToolCalls}
                    onCheckedChange={setHideToolCalls}
                  />
                  <Label
                    htmlFor="render-tool-calls"
                    className="cursor-pointer text-sm text-muted-foreground hover:text-primary"
                  >
                    隐藏工具调用
                  </Label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type={isLoading ? "button" : "submit"}
                  variant={isLoading ? "destructive" : "default"}
                  onClick={isLoading ? stopStream : handleSubmit}
                  disabled={
                    !isLoading &&
                    (submitDisabled ||
                      (!input.trim() && contentBlocks.length === 0))
                  }
                >
                  {isLoading ? (
                    <>
                      <Square size={14} />
                      <span>停止</span>
                    </>
                  ) : (
                    <>
                      <ArrowUp size={18} />
                      <span>发送</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
});

ChatInterface.displayName = "ChatInterface";
