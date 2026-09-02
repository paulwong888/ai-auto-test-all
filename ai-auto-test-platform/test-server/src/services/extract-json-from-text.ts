/**
 * Extract JSON from Pi assistant reply (code fence or bare object).
 */
export function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Empty assistant text");
  }

  const fenceMatches = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let i = fenceMatches.length - 1; i >= 0; i--) {
    const block = fenceMatches[i]?.[1]?.trim();
    if (!block) continue;
    try {
      return JSON.parse(block);
    } catch {
      /* try next block */
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  throw new Error("No valid JSON found in assistant text");
}
