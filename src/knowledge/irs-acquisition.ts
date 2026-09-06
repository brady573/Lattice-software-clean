import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
  RetrievedKnowledgeClaim,
  RetrievedKnowledgeSource,
} from "./acquisition.js";

export const IRS_HOME_SALE_TOPIC_URL = "https://www.irs.gov/taxtopics/tc701";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_CONTENT_CHARS = 60_000;
const MAX_CLAIMS = 12;
const MAX_CLAIM_CHARS = 1_200;
const DEFAULT_TIMEOUT_MS = 15_000;
const TOPIC_SENTENCE_PATTERN = /\b(?:home|sale|gain|income|tax|exclude|exclusion|report|ownership|use)\b/iu;

export interface IrsHomeSaleKnowledgeAcquisitionOptions {
  readonly fetchImpl?: typeof fetch;
  readonly clock?: () => Date;
  readonly timeoutMs?: number;
}

function timeoutMs(value: number | undefined): number {
  const resolved = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 60_000) {
    throw new Error("IRS acquisition timeout must be an integer between 1 and 60000 milliseconds.");
  }
  return resolved;
}

async function readBoundedText(response: Response): Promise<string> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`IRS source returned HTTP ${response.status}.`);
  }
  const contentType = response.headers.get("content-type")?.toLocaleLowerCase("en-US") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("IRS source returned an unsupported content type.");
  }
  if (!response.body) throw new Error("IRS source returned an empty response.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("IRS source response exceeded its byte limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function decodeHtmlEntities(value: string): string {
  const named = value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, "\"")
    .replace(/&apos;|&#39;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");
  return named.replace(/&#(x?[0-9a-f]+);/giu, (_whole: string, encoded: string) => {
    const radix = encoded.toLocaleLowerCase("en-US").startsWith("x") ? 16 : 10;
    const digits = radix === 16 ? encoded.slice(1) : encoded;
    const codePoint = Number.parseInt(digits, radix);
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : " ";
  });
}

function officialPageText(html: string): string {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/iu.exec(html)?.[1] ?? html;
  const withoutNonContent = main.replace(
    /<(?:script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg)>/giu,
    " ",
  );
  const separated = withoutNonContent
    .replace(/<(?:br|hr)\b[^>]*\/?>/giu, "\n")
    .replace(/<\/(?:p|li|h1|h2|h3|h4|h5|h6|section|article|div)>/giu, "\n")
    .replace(/<[^>]+>/gu, " ");
  return decodeHtmlEntities(separated)
    .split(/\r?\n/gu)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_SOURCE_CONTENT_CHARS);
}

function sourceReportSentences(content: string): string[] {
  const sentences = content.match(/[^.!?\n]+(?:[.!?]+|$)/gu) ?? [];
  return sentences
    .map((sentence) => sentence.replace(/\s+/gu, " ").trim())
    .filter((sentence) => sentence.length >= 40 && sentence.length <= MAX_CLAIM_CHARS)
    .filter((sentence) => TOPIC_SENTENCE_PATTERN.test(sentence))
    .filter((sentence, index, values) => values.indexOf(sentence) === index)
    .slice(0, MAX_CLAIMS);
}

/**
 * Narrow zero-credential authoritative-source acquisition for the IRS home-sale
 * tax topic. It retrieves exact IRS text and proposes source-report sentences;
 * it does not confer source suitability, V36 admission, or truth authority.
 */
export class IrsHomeSaleKnowledgeAcquisitionProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "irs-home-sale-topic-701";
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => Date;
  private readonly requestTimeoutMs: number;

  constructor(options: IrsHomeSaleKnowledgeAcquisitionOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date());
    this.requestTimeoutMs = timeoutMs(options.timeoutMs);
  }

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    if (!request.runId.trim() || !request.objective.trim()) {
      throw new Error("IRS Knowledge acquisition requires an exact Run and objective.");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(IRS_HOME_SALE_TOPIC_URL, {
        method: "GET",
        redirect: "error",
        headers: {
          accept: "text/html, text/plain;q=0.9",
          "user-agent": "Mozilla/5.0 (compatible; Lattice-Knowledge-Consultation/0.1; authoritative source retrieval)",
        },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new Error(`IRS source was unavailable: ${error instanceof Error ? error.message : "request failed"}.`);
    }

    const content = officialPageText(await readBoundedText(response));
    if (!content) throw new Error("IRS source contained no usable topic text.");
    const claimTexts = sourceReportSentences(content);
    if (claimTexts.length === 0) throw new Error("IRS source contained no bounded source-report sentences.");

    const sourceId = "irs:topic-701";
    const source: RetrievedKnowledgeSource = {
      sourceId,
      canonicalUri: IRS_HOME_SALE_TOPIC_URL,
      title: "Topic no. 701, Sale of your home",
      publisher: "Internal Revenue Service",
      retrievedAt: this.clock().toISOString(),
      publishedAt: null,
      contentType: "text/plain; charset=utf-8",
      content,
      metadata: {
        sourceAdapter: this.kind,
        sourceTopic: "701",
      },
    };
    const claims: RetrievedKnowledgeClaim[] = claimTexts.map((text, index) => ({
      claimId: `irs-topic-701-report:${index + 1}`,
      text,
      claimType: "INTERPRETIVE",
      evidence: [{ sourceId, relation: "SUPPORTS", excerpt: text }],
    }));

    return { sources: [source], claims };
  }
}
