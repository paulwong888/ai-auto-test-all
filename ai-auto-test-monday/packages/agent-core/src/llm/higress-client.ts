import type { ZodType } from "zod";
import type { LlmConfig } from "../config.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class HigressClient {
  constructor(private readonly config: LlmConfig) {}

  async chatJson<T>(
    system: string,
    user: string,
    schema: ZodType<T>,
  ): Promise<T | null> {
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
    console.warn("[llm] chatJson failed, using fallback:", lastError);
    return null;
  }

  private async chatCompletion(messages: ChatMessage[]): Promise<string> {
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
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
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
    } finally {
      clearTimeout(timer);
    }
  }
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
