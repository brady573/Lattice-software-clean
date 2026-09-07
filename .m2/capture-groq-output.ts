const originalFetch = globalThis.fetch;

function headerValue(headers: HeadersInit | undefined, name: string): string {
  if (headers === undefined) return "unknown";
  const normalized = new Headers(headers);
  return normalized.get(name) ?? "unknown";
}

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const response = await originalFetch(input, init);
  try {
    const correlationId = headerValue(init?.headers, "x-lattice-correlation-id");
    const body = await response.clone().json() as {
      model?: unknown;
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const model = typeof body.model === "string" ? body.model : "unknown";
    const content = body.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      console.log(`DIAGNOSTIC_GROQ_OUTPUT correlation=${correlationId} model=${model} content=${JSON.stringify(content)}`);
    } else {
      console.log(`DIAGNOSTIC_GROQ_OUTPUT correlation=${correlationId} model=${model} content=<non-text>`);
    }
  } catch (error) {
    console.log(`DIAGNOSTIC_GROQ_OUTPUT_CAPTURE_FAILED ${error instanceof Error ? error.message : String(error)}`);
  }
  return response;
};
