/**
 * 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
 * 
 * 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
 * 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
 * 
 * 授权商业应用请联系微信：huice666
 */

"use client";

import {
  ReactNode,
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { type Message, type Checkpoint } from "@langchain/langgraph-sdk";
import { v4 as uuidv4 } from "uuid";
import { ContentBlock } from "@langchain/core/messages";
import { useStreamContext, type StateType } from "@/providers/Stream";
import { useArtifactContext } from "@/components/thread/artifact";
import { useThreads } from "@/providers/Thread";
import {
  DO_NOT_RENDER_ID_PREFIX,
  ensureToolCallsHaveResponses,
} from "@/lib/ensure-tool-responses";
import type {
  TodoItem,
} from "@/types/chat";

export interface ContextType extends Record<string, unknown> {
  enable_rag?: boolean;
}

export interface ChatContextType {
  stream: ReturnType<typeof useStreamContext>;
  messages: Message[];
  todos: TodoItem[];
  files: Record<string, string>;
  email?: {
    id?: string;
    subject?: string;
    page_content?: string;
  };
  ui: any[];
  setFiles: (files: Record<string, string>) => Promise<void>;
  isLoading: boolean;
  isThreadLoading: boolean;
  interrupt: unknown;
  getMessagesMetadata: ReturnType<typeof useStreamContext>["getMessagesMetadata"];
  sendMessage: (
    content: string,
    contentBlocks?: ContentBlock.Multimodal.Data[],
    context?: ContextType,
  ) => void;
  runSingleStep: (
    messages: Message[],
    checkpoint?: Checkpoint,
    isRerunningSubagent?: boolean,
    optimisticMessages?: Message[],
  ) => void;
  continueStream: (hasTaskToolCall?: boolean) => void;
  stopStream: () => void;
  markCurrentThreadAsResolved: () => void;
  resumeInterrupt: (value: unknown) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const stream = useStreamContext();
  const [artifactContext] = useArtifactContext();
  const { getThreads, setThreads } = useThreads();

  const revalidateThreadsRef = useRef(() => {
    getThreads().then(setThreads).catch(console.error);
  });

  useEffect(() => {
    revalidateThreadsRef.current = () => {
      getThreads().then(setThreads).catch(console.error);
    };
  }, [getThreads, setThreads]);

  const scheduleRevalidate = useCallback(() => {
    if (typeof window === "undefined") {
      revalidateThreadsRef.current();
      return;
    }
    window.setTimeout(() => revalidateThreadsRef.current(), 0);
  }, []);

  const sendMessage = useCallback(
    (
      content: string,
      contentBlocks?: ContentBlock.Multimodal.Data[],
      context?: ContextType,
    ) => {
      const imageBlocks =
        contentBlocks?.filter((b) => b.type === "image") ?? [];
      const pdfBlocks =
        contentBlocks?.filter((b) => b.type !== "image") ?? [];

      const imageUrlBlocks = imageBlocks.map((b) => ({
        type: "image_url" as const,
        image_url: {
          url: `data:${b.mimeType};base64,${b.data}`,
        },
      }));

      const messageContent: Message["content"] =
        imageUrlBlocks.length > 0
          ? ([
              ...(content.trim().length > 0
                ? [{ type: "text" as const, text: content }]
                : []),
              ...imageUrlBlocks,
            ] as Message["content"])
          : content;

      const newHumanMessage: Message = {
        id: uuidv4(),
        type: "human",
        content: messageContent,
        ...(pdfBlocks.length > 0
          ? { additional_kwargs: { attachments: pdfBlocks } }
          : {}),
      };

      const toolMessages = ensureToolCallsHaveResponses(stream.messages);

      const mergedContext =
        Object.keys(artifactContext).length > 0 || context
          ? { ...context, ...artifactContext }
          : undefined;

      stream.submit(
        { messages: [...toolMessages, newHumanMessage] },
        {
          streamMode: ["values"],
          streamSubgraphs: true,
          streamResumable: true,
          optimisticValues: (prev) => ({
            ...prev,
            context: mergedContext,
            messages: [
              ...(prev.messages ?? []),
              ...toolMessages,
              newHumanMessage,
            ],
          }),
          ...(mergedContext ? { context: mergedContext } : {}),
        },
      );

      scheduleRevalidate();
    },
    [stream, artifactContext, scheduleRevalidate],
  );

  const runSingleStep = useCallback(
    (
      messages: Message[],
      checkpoint?: Checkpoint,
      isRerunningSubagent?: boolean,
      optimisticMessages?: Message[],
    ) => {
      if (checkpoint) {
        stream.submit(undefined, {
          ...(optimisticMessages
            ? { optimisticValues: { messages: optimisticMessages } }
            : {}),
          checkpoint,
          ...(isRerunningSubagent
            ? { interruptAfter: ["tools"] }
            : { interruptBefore: ["tools"] }),
        });
      } else {
        stream.submit(
          { messages },
          { interruptBefore: ["tools"] },
        );
      }
    },
    [stream],
  );

  const setFiles = useCallback(
    async (_files: Record<string, string>) => {
      // The current platform does not expose chat-state file editing.
      // Keep the API shape for compatibility with the reference UI.
      return Promise.resolve();
    },
    [],
  );

  const continueStream = useCallback(
    (hasTaskToolCall?: boolean) => {
      stream.submit(undefined, {
        ...(hasTaskToolCall
          ? { interruptAfter: ["tools"] }
          : { interruptBefore: ["tools"] }),
      });
      scheduleRevalidate();
    },
    [stream, scheduleRevalidate],
  );

  const markCurrentThreadAsResolved = useCallback(() => {
    stream.submit(null, { command: { goto: "__end__", update: null } });
    scheduleRevalidate();
  }, [stream, scheduleRevalidate]);

  const resumeInterrupt = useCallback(
    (value: unknown) => {
      stream.submit(null, { command: { resume: value } });
      scheduleRevalidate();
    },
    [stream, scheduleRevalidate],
  );

  const stopStream = useCallback(() => {
    stream.stop();
  }, [stream]);

  const value: ChatContextType = {
    stream,
    messages: stream.messages,
    todos: (stream.values as StateType).todos ?? [],
    files: (stream.values as StateType).files ?? {},
    email: (stream.values as StateType).email,
    ui: (stream.values as StateType).ui ?? [],
    setFiles,
    isLoading: stream.isLoading,
    isThreadLoading: stream.isThreadLoading,
    interrupt: stream.interrupt,
    getMessagesMetadata: stream.getMessagesMetadata,
    sendMessage,
    runSingleStep,
    continueStream,
    stopStream,
    markCurrentThreadAsResolved,
    resumeInterrupt,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextType {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
}

export { DO_NOT_RENDER_ID_PREFIX };
