interface NdjsonBodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
}

interface NdjsonBody {
  getReader(): NdjsonBodyReader;
}

export async function* readNdjsonStream(
  body: NdjsonBody | null | undefined,
): AsyncGenerator<Record<string, unknown>> {
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line) as Record<string, unknown>;
      } catch {
        // ignore malformed lines
      }
    }
  }

  const tail = buffer.trim();
  if (tail) {
    try {
      yield JSON.parse(tail) as Record<string, unknown>;
    } catch {
      // ignore
    }
  }
}
