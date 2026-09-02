import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractJsonFromText } from "./extract-json-from-text.js";

describe("extractJsonFromText", () => {
  it("parses json code fence", () => {
    const doc = extractJsonFromText(`
Here is the result:

\`\`\`json
{"version":"1.0","features":[]}
\`\`\`
`);
    assert.deepEqual(doc, { version: "1.0", features: [] });
  });

  it("parses bare object", () => {
    const doc = extractJsonFromText('prefix {"a":1} suffix');
    assert.deepEqual(doc, { a: 1 });
  });

  it("uses last code fence when multiple", () => {
    const doc = extractJsonFromText(`
\`\`\`json
{"x":1}
\`\`\`
\`\`\`json
{"y":2}
\`\`\`
`);
    assert.deepEqual(doc, { y: 2 });
  });
});
