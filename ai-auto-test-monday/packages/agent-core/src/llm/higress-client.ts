import type { ZodType } from "zod";
import type { LlmConfig } from "../config.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const PROGRESS_LOG_INTERVAL_MS = 30_000;
const PROGRESS_LOG_CHAR_STEP = 64 * 1024;

export class HigressClient {
  constructor(private readonly config: LlmConfig) {}

  async chatJson<T>(
    system: string,
    user: string,
    schema: ZodType<T>,
  ): Promise<T | null> {
    try {
      return await this.chatJsonOrThrow(system, user, schema);
    } catch (err) {
      console.warn("[llm] chatJson failed, using fallback:", err);
      return null;
    }
  }

  async chatJsonOrThrow<T>(
    system: string,
    user: string,
    schema: ZodType<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const raw = await this.chatCompletion([
          { role: "system", content: system },
          { role: "user", content: user },
        ]);
        const json = extractJson(raw);
        return schema.parse(json);
      } catch (err) {
        lastError = err;
      }
    }
    const reason =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`LLM request failed after retries: ${reason}`);
  }

  private async chatCompletion(messages: ChatMessage[]): Promise<string> {
    if (this.config.streamEnabled) {
      return this.chatCompletionStreaming(messages);
    }
    return this.chatCompletionNonStreaming(messages);
  }

  private buildRequestBody(messages: ChatMessage[], stream: boolean): string {
    return JSON.stringify({
      model: this.config.model,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
      stream,
      ...(this.config.reasoningEffort
        ? { reasoning_effort: this.config.reasoningEffort }
        : {}),
    });
  }

  private async chatCompletionNonStreaming(
    messages: ChatMessage[],
  ): Promise<string> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: this.buildRequestBody(messages, false),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("LLM empty response");
      return content;
    } catch (err) {
      throw wrapFetchError(err, this.config.timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }

  private async chatCompletionStreaming(
    messages: ChatMessage[],
  ): Promise<string> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const controller = new AbortController();
    const startedAt = Date.now();
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

    console.info(`[llm] stream started model=${this.config.model}`);
    resetChunkIdleTimer();

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: this.buildRequestBody(messages, true),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      if (!res.body) {
        throw new Error("LLM stream empty body");
      }

      const content = await this.readSseStream(res.body, {
        startedAt,
        onBytes: () => resetChunkIdleTimer(),
        onContentDelta: () => resetChunkIdleTimer(),
      });

      if (!content) throw new Error("LLM empty response");

      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.info(
        `[llm] stream done chars=${content.length} elapsed=${elapsedSec}s`,
      );
      return content;
    } catch (err) {
      if (abortedBy) {
        throw new Error(abortedBy);
      }
      throw wrapFetchError(err, this.config.timeoutMs);
    } finally {
      if (chunkIdleTimer) clearTimeout(chunkIdleTimer);
      if (totalTimer) clearTimeout(totalTimer);
    }
  }

  private async readSseStream(
    body: ReadableStream<Uint8Array>,
    hooks: {
      startedAt: number;
      onBytes: () => void;
      onContentDelta: () => void;
    },
  ): Promise<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";
    let contentBuffer = "";
    let firstChunkLogged = false;
    let lastProgressLogAt = hooks.startedAt;
    let lastProgressLogChars = 0;

    const maybeLogProgress = (): void => {
      const now = Date.now();
      const elapsedSec = ((now - hooks.startedAt) / 1000).toFixed(1);
      const charGrowth = contentBuffer.length - lastProgressLogChars;
      if (
        now - lastProgressLogAt >= PROGRESS_LOG_INTERVAL_MS ||
        charGrowth >= PROGRESS_LOG_CHAR_STEP
      ) {
        console.info(
          `[llm] stream progress chars=${contentBuffer.length} elapsed=${elapsedSec}s`,
        );
        lastProgressLogAt = now;
        lastProgressLogChars = contentBuffer.length;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        hooks.onBytes();
        lineBuffer += decoder.decode(value, { stream: true });

        let newlineIdx = lineBuffer.indexOf("\n");
        while (newlineIdx >= 0) {
          const line = lineBuffer.slice(0, newlineIdx).trim();
          lineBuffer = lineBuffer.slice(newlineIdx + 1);

          const delta = parseSseContentDelta(line);
          if (delta) {
            if (!firstChunkLogged) {
              firstChunkLogged = true;
              const elapsedSec = (
                (Date.now() - hooks.startedAt) /
                1000
              ).toFixed(1);
              console.info(`[llm] stream first chunk (+${elapsedSec}s)`);
            }
            contentBuffer += delta;
            hooks.onContentDelta();
            maybeLogProgress();
          }

          newlineIdx = lineBuffer.indexOf("\n");
        }
      }

      const trailing = lineBuffer.trim();
      if (trailing) {
        const delta = parseSseContentDelta(trailing);
        if (delta) contentBuffer += delta;
      }
    } finally {
      reader.releaseLock();
    }

    return contentBuffer;
  }
}

function parseSseContentDelta(line: string): string {
  if (!line.startsWith("data:")) return "";
  const payload = line.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") return "";

  try {
    const data = JSON.parse(payload) as {
      choices?: Array<{
        delta?: { content?: string };
        message?: { content?: string };
      }>;
    };
    const choice = data.choices?.[0];
    return choice?.delta?.content ?? choice?.message?.content ?? "";
  } catch {
    console.warn("[llm] stream skipped unparseable SSE line:", payload.slice(0, 80));
    return "";
  }
}

function wrapFetchError(err: unknown, timeoutMs: number): Error {
  if (err instanceof Error) {
    if (err.name === "AbortError") {
      return new Error(
        `LLM stream aborted: total timeout (${Math.round(timeoutMs / 1000)}s)`,
      );
    }
    return err;
  }
  return new Error(String(err));
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in LLM response");
    return JSON.parse(match[0]);
  }
}
