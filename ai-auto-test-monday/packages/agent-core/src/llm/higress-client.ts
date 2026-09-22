import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";
import type { LlmConfig } from "../config.js";

const PROGRESS_LOG_INTERVAL_MS = 30_000;
const PROGRESS_LOG_CHAR_STEP = 64 * 1024;

export interface LlmLogContext {
  batch?: { current: number; total: number };
}

export interface FewShotMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatJsonOptions {
  logContext?: LlmLogContext;
  fewShotMessages?: FewShotMessage[];
}

function isChatJsonOptions(
  options: LlmLogContext | ChatJsonOptions,
): options is ChatJsonOptions {
  return "logContext" in options || "fewShotMessages" in options;
}

function normalizeChatJsonOptions(
  options?: LlmLogContext | ChatJsonOptions,
): ChatJsonOptions {
  if (!options) return {};
  if (isChatJsonOptions(options)) return options;
  return { logContext: options };
}

export class HigressClient {
  private readonly logTag: string;
  private readonly openai: OpenAI;

  constructor(
    private readonly config: LlmConfig,
    nodeName?: string,
  ) {
    this.logTag = nodeName ? `[${nodeName}-llm]` : "[llm]";
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl.replace(/\/$/, ""),
      timeout: config.timeoutMs,
      maxRetries: 0,
    });
  }

  async chatJson<T>(
    system: string,
    user: string,
    schema: ZodType<T>,
    schemaName = "structured_response",
    options?: LlmLogContext | ChatJsonOptions,
  ): Promise<T | null> {
    try {
      return await this.chatJsonOrThrow(system, user, schema, schemaName, options);
    } catch (err) {
      console.warn(`${this.logTag} chatJson failed, using fallback:`, err);
      return null;
    }
  }

  async chatJsonOrThrow<T>(
    system: string,
    user: string,
    schema: ZodType<T>,
    schemaName = "structured_response",
    options?: LlmLogContext | ChatJsonOptions,
  ): Promise<T> {
    const chatOptions = normalizeChatJsonOptions(options);
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await this.parseStructured(
          system,
          user,
          schema,
          schemaName,
          chatOptions,
        );
      } catch (err) {
        lastError = err;
      }
    }
    const reason =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`LLM request failed after retries: ${reason}`);
  }

  private buildRequestBody(
    system: string,
    user: string,
    schema: ZodType<unknown>,
    schemaName: string,
    fewShotMessages: FewShotMessage[] = [],
  ) {
    return {
      model: this.config.model,
      messages: [
        { role: "system" as const, content: system },
        ...fewShotMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { role: "user" as const, content: user },
      ],
      response_format: zodResponseFormat(schema, schemaName),
      temperature: 0.2,
      ...(this.config.reasoningEffort
        ? {
            reasoning_effort: this.config.reasoningEffort as
              | "low"
              | "medium"
              | "high",
          }
        : {}),
    };
  }

  private extractParsed<T>(completion: {
    choices: Array<{ message?: { parsed?: unknown; refusal?: string | null } }>;
  }): T {
    const parsed = completion.choices[0]?.message?.parsed;
    if (parsed != null) return parsed as T;

    const refusal = completion.choices[0]?.message?.refusal;
    throw new Error(
      refusal
        ? `LLM refused structured response: ${refusal}`
        : "LLM empty parsed response",
    );
  }

  private batchLabel(logContext?: LlmLogContext): string {
    const batch = logContext?.batch;
    if (!batch) return "";
    return ` batch=${batch.current}/${batch.total}`;
  }

  private async parseStructured<T>(
    system: string,
    user: string,
    schema: ZodType<T>,
    schemaName: string,
    options: ChatJsonOptions = {},
  ): Promise<T> {
    if (this.config.streamEnabled) {
      return this.parseStructuredStreaming(system, user, schema, schemaName, options);
    }
    return this.parseStructuredBlocking(system, user, schema, schemaName, options);
  }

  private async parseStructuredBlocking<T>(
    system: string,
    user: string,
    schema: ZodType<T>,
    schemaName: string,
    options: ChatJsonOptions = {},
  ): Promise<T> {
    const batchLabel = this.batchLabel(options.logContext);
    const startedAt = Date.now();
    console.info(
      `${this.logTag} parse started${batchLabel} model=${this.config.model} schema=${schemaName}`,
    );

    const completion = await this.openai.beta.chat.completions.parse(
      this.buildRequestBody(
        system,
        user,
        schema,
        schemaName,
        options.fewShotMessages ?? [],
      ),
    );

    const parsed = this.extractParsed<T>(completion);
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.info(
      `${this.logTag} parse done${batchLabel} schema=${schemaName} elapsed=${elapsedSec}s`,
    );
    return parsed;
  }

  private async parseStructuredStreaming<T>(
    system: string,
    user: string,
    schema: ZodType<T>,
    schemaName: string,
    options: ChatJsonOptions = {},
  ): Promise<T> {
    const batchLabel = this.batchLabel(options.logContext);
    const startedAt = Date.now();
    let lastProgressLogAt = startedAt;
    let lastProgressLogChars = 0;
    let firstChunkLogged = false;
    let contentLength = 0;

    const controller = new AbortController();
    let chunkIdleTimer: ReturnType<typeof setTimeout> | undefined;
    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    let abortedBy = "";

    const abort = (reason: string): void => {
      if (abortedBy) return;
      abortedBy = reason;
      controller.abort();
    };

    const resetChunkIdleTimer = (): void => {
      if (chunkIdleTimer) clearTimeout(chunkIdleTimer);
      chunkIdleTimer = setTimeout(() => {
        abort(
          `LLM stream idle timeout (no chunk for ${Math.round(this.config.streamChunkTimeoutMs / 1000)}s)`,
        );
      }, this.config.streamChunkTimeoutMs);
    };

    totalTimer = setTimeout(() => {
      abort(
        `LLM stream aborted: total timeout (${Math.round(this.config.timeoutMs / 1000)}s)`,
      );
    }, this.config.timeoutMs);

    console.info(
      `${this.logTag} stream started${batchLabel} model=${this.config.model} schema=${schemaName}`,
    );
    resetChunkIdleTimer();

    try {
      const stream = this.openai.beta.chat.completions.stream(
        {
          ...this.buildRequestBody(
            system,
            user,
            schema,
            schemaName,
            options.fewShotMessages ?? [],
          ),
          stream: true,
        },
        { signal: controller.signal },
      );

      stream.on("content.delta", ({ snapshot }) => {
        resetChunkIdleTimer();
        contentLength = snapshot.length;
        if (!firstChunkLogged) {
          firstChunkLogged = true;
          const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
          console.info(`${this.logTag} stream first chunk${batchLabel} (+${elapsedSec}s)`);
        }

        const now = Date.now();
        const charGrowth = contentLength - lastProgressLogChars;
        if (
          now - lastProgressLogAt >= PROGRESS_LOG_INTERVAL_MS ||
          charGrowth >= PROGRESS_LOG_CHAR_STEP
        ) {
          const elapsedSec = ((now - startedAt) / 1000).toFixed(1);
          console.info(
            `${this.logTag} stream progress${batchLabel} chars=${contentLength} elapsed=${elapsedSec}s`,
          );
          lastProgressLogAt = now;
          lastProgressLogChars = contentLength;
        }
      });

      const completion = await stream.finalChatCompletion();
      const parsed = this.extractParsed<T>(completion);
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.info(
        `${this.logTag} stream done${batchLabel} schema=${schemaName} chars=${contentLength} elapsed=${elapsedSec}s`,
      );
      return parsed;
    } catch (err) {
      if (abortedBy) throw new Error(abortedBy);
      throw err;
    } finally {
      if (chunkIdleTimer) clearTimeout(chunkIdleTimer);
      if (totalTimer) clearTimeout(totalTimer);
    }
  }
}
