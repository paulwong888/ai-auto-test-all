import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createStreamState,
  parseJsonlLine,
} from "./event-parser.js";
import { JsonlReader } from "./jsonl-reader.js";
import { Readable } from "node:stream";

describe("JSONL protocol", () => {
  it("parses message_update text_delta and accumulates assistant text", () => {
    const state = createStreamState();
    const line = JSON.stringify({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "Hello",
      },
    });

    const { progress } = parseJsonlLine(line, state);
    assert.ok(progress.some((e) => e.kind === "text_delta"));
    assert.equal(state.lastAssistantText, "Hello");
  });

  it("detects agent_settled", () => {
    const state = createStreamState();
    const { progress } = parseJsonlLine(
      JSON.stringify({ type: "agent_settled" }),
      state,
    );
    assert.equal(state.settled, true);
    assert.ok(progress.some((e) => e.kind === "agent_settled"));
  });

  it("splits on LF only (not U+2028 inside JSON string)", async () => {
    const payload = '{"type":"test","msg":"line1\\u2028line2"}\n{"type":"done"}\n';
    const stream = Readable.from([payload]);
    const lines: string[] = [];

    const reader = new JsonlReader(stream);
    reader.onLine((line: string) => lines.push(line));

    await new Promise<void>((resolve) => stream.on("end", resolve));

    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]!).msg, "line1\u2028line2");
    assert.equal(JSON.parse(lines[1]!).type, "done");
  });
});
