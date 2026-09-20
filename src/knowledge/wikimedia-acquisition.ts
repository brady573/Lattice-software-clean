import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
  KnowledgeAcquisitionPartialReason,
  RetrievedKnowledgeClaim,
  RetrievedKnowledgeSource,
} from "./acquisition.js";

const DEFAULT_ENDPOINT = "https://en.wikipedia.org/w/api.php";
const DEFAULT_RESULT_LIMIT = 4;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_CONTENT_CHARS = 24_000;
const MAX_CLAIM_CHARS = 1_200;
const MAX_CLAIMS_PER_SOURCE = 8;
const MAX_TOTAL_RESULTS = 12;
const MAX_INVESTIGATION_QUERIES = 8;
const DETAIL_BATCH_SIZE = 4;

export interface WikimediaKnowledgeAcquisitionOptions {
  readonly endpoint?: string;
  readonly resultLimit?: number;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly clock?: () => Date;
}

type WikimediaPage = {
  pageid?: unknown;
  index?: unknown;
  title?: unknown;
  extract?: unknown;
  fullurl?: unknown;
};

type WikimediaCandidatePage = {
  pageId: string;
  title: string;
  canonicalUri: string;
  introExtract: string;
  investigationQuery: string;
  investigationQueryIndex: number;
};

class WikimediaRequestError extends Error {
  constructor(
    readonly reason: KnowledgeAcquisitionPartialReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WikimediaRequestError";
  }
}

function interruptionReason(error: unknown): KnowledgeAcquisitionPartialReason {
  return error instanceof WikimediaRequestError ? error.reason : "PROVIDER_FAILURE";
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeEndpoint(raw: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.hash
    || url.pathname === "/"
  ) {
    throw new Error("Wikimedia acquisition endpoint must be a credential-free HTTPS API path.");
  }
  return url;
}

function boundedResultLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 8) {
    throw new Error("Wikimedia acquisition resultLimit must be an integer between 1 and 8.");
  }
  return value;
}

function boundedTimeoutMs(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new Error(`Wikimedia acquisition timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}.`);
  }
  return value;
}

function retrievalQueries(request: KnowledgeAcquisitionRequest): string[] {
  const queries = [...new Set(
    (request.investigationQueries ?? [])
      .map((item) => item.trim())
      .filter(Boolean),
  )];
  if (queries.length === 0) {
    throw new Error("Wikimedia acquisition requires provider-ready retrieval queries from Solandra investigation.");
  }
  if (queries.length > MAX_INVESTIGATION_QUERIES) {
    throw new Error(`Wikimedia acquisition accepts at most ${MAX_INVESTIGATION_QUERIES} retrieval queries per operational call.`);
  }
  return queries;
}

function boundedClaimText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_CLAIM_CHARS) return trimmed;
  const bounded = trimmed.slice(0, MAX_CLAIM_CHARS);
  const sentenceEnd = Math.max(bounded.lastIndexOf(". "), bounded.lastIndexOf(".\n"));
  return (sentenceEnd >= 160 ? bounded.slice(0, sentenceEnd + 1) : bounded).trim();
}

function sourceClaimTexts(content: string): string[] {
  return content
    .split(/\n\s*\n/u)
    .map((part) => boundedClaimText(part))
    .filter(Boolean)
    .slice(0, MAX_CLAIMS_PER_SOURCE);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new WikimediaRequestError(
      response.status === 429 ? "RATE_LIMITED" : "PROVIDER_FAILURE",
      `Knowledge source returned HTTP ${response.status}.`,
    );
  }
  if (!response.body) {
    throw new WikimediaRequestError("PROVIDER_FAILURE", "Knowledge source returned an empty response.");
  }
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
        throw new WikimediaRequestError(
          "PROVIDER_FAILURE",
          "Knowledge source response exceeded its byte limit.",
        );
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
  try {
    return JSON.parse(new TextDecoder().decode(combined));
  } catch (error) {
    throw new WikimediaRequestError(
      "PROVIDER_FAILURE",
      "Knowledge source returned malformed JSON.",
      { cause: error },
    );
  }
}

/**
 * Zero-cost development adapter for Wikimedia's public search API. Solandra
 * supplies provider-ready retrieval queries. This adapter performs no semantic
 * interpretation or relevance ranking: it returns bounded source text and
 * source-bound paragraph claim proposals as candidate information only.
 *
 * Wikimedia remains GENERAL_REFERENCE metadata. V36 independently decides what
 * evidence may be admitted as governed Knowledge.
 */
export class WikimediaKnowledgeAcquisitionProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "wikimedia-search";
  private readonly endpoint: URL;
  private readonly resultLimit: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => Date;

  constructor(options: WikimediaKnowledgeAcquisitionOptions = {}) {
    this.endpoint = normalizeEndpoint(options.endpoint ?? DEFAULT_ENDPOINT);
    this.resultLimit = boundedResultLimit(options.resultLimit ?? DEFAULT_RESULT_LIMIT);
    this.timeoutMs = boundedTimeoutMs(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date());
  }

  private async requestJson(url: URL, signal: AbortSignal): Promise<unknown> {
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        redirect: "error",
        headers: {
          accept: "application/json",
          "user-agent": "Lattice-Knowledge-Consultation/0.1 (source retrieval; no truth authority)",
        },
        signal,
      });
      return await readBoundedJson(response);
    } catch (error) {
      if (signal.aborted) {
        throw new WikimediaRequestError(
          "TIMED_OUT",
          `Knowledge source request exceeded ${this.timeoutMs} ms`,
          { cause: error },
        );
      }
      if (error instanceof WikimediaRequestError) throw error;
      throw new WikimediaRequestError(
        "PROVIDER_FAILURE",
        "Knowledge source request failed.",
        { cause: error },
      );
    }
  }

  private async fullPageExtracts(
    pages: readonly WikimediaCandidatePage[],
    signal: AbortSignal,
  ): Promise<{
    extracts: Map<string, string>;
    interruption: KnowledgeAcquisitionPartialReason | null;
  }> {
    const extracts = new Map(
      pages.map((page) => [page.pageId, page.introExtract.slice(0, MAX_SOURCE_CONTENT_CHARS)] as const),
    );

    for (let offset = 0; offset < pages.length; offset += DETAIL_BATCH_SIZE) {
      const batch = pages.slice(offset, offset + DETAIL_BATCH_SIZE);
      const url = new URL(this.endpoint.href);
      for (const [key, value] of Object.entries({
        action: "query",
        pageids: batch.map((page) => page.pageId).join("|"),
        prop: "extracts",
        explaintext: "1",
        format: "json",
        formatversion: "2",
        origin: "*",
      })) {
        url.searchParams.set(key, value);
      }

      try {
        const root = record(await this.requestJson(url, signal));
        const query = record(root?.query);
        const returnedPages = Array.isArray(query?.pages) ? query.pages : [];
        for (const rawPage of returnedPages) {
          const page = record(rawPage) as WikimediaPage | null;
          const pageId = typeof page?.pageid === "number" ? String(page.pageid) : null;
          const extract = typeof page?.extract === "string" ? page.extract.trim() : "";
          if (pageId && extract && extracts.has(pageId)) {
            extracts.set(pageId, extract.slice(0, MAX_SOURCE_CONTENT_CHARS));
          }
        }
      } catch (error) {
        return { extracts, interruption: interruptionReason(error) };
      }
    }

    return { extracts, interruption: null };
  }

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    if (!request.runId.trim() || !request.objective.trim()) {
      throw new Error("Knowledge acquisition requires an exact Run and objective.");
    }
    const queries = retrievalQueries(request);
    const retrievedAt = this.clock().toISOString();
    const signal = AbortSignal.timeout(this.timeoutMs);
    const candidatePages: WikimediaCandidatePage[] = [];
    const seenPageIds = new Set<string>();
    let interruption: KnowledgeAcquisitionPartialReason | null = null;

    for (const [queryIndex, searchQuery] of queries.entries()) {
      if (candidatePages.length >= MAX_TOTAL_RESULTS) break;
      const url = new URL(this.endpoint.href);
      for (const [key, value] of Object.entries({
        action: "query",
        generator: "search",
        gsrsearch: searchQuery,
        gsrlimit: String(this.resultLimit),
        gsrnamespace: "0",
        prop: "extracts|info",
        exintro: "1",
        explaintext: "1",
        inprop: "url",
        format: "json",
        formatversion: "2",
        origin: "*",
      })) {
        url.searchParams.set(key, value);
      }

      let root: Record<string, unknown> | null;
      try {
        root = record(await this.requestJson(url, signal));
      } catch (error) {
        interruption = interruptionReason(error);
        break;
      }

      const query = record(root?.query);
      const pages = Array.isArray(query?.pages) ? query.pages : [];
      for (const rawPage of [...pages].sort((left, right) => {
        const a = record(left)?.index;
        const b = record(right)?.index;
        return (typeof a === "number" ? a : Number.MAX_SAFE_INTEGER)
          - (typeof b === "number" ? b : Number.MAX_SAFE_INTEGER);
      })) {
        if (candidatePages.length >= MAX_TOTAL_RESULTS) break;
        const page = record(rawPage) as WikimediaPage | null;
        if (!page) continue;
        const pageId = typeof page.pageid === "number" ? String(page.pageid) : null;
        const title = typeof page.title === "string" ? page.title.trim() : "";
        const fullurl = typeof page.fullurl === "string" ? page.fullurl : "";
        const introExtract = typeof page.extract === "string" ? page.extract.trim() : "";
        if (!pageId || seenPageIds.has(pageId) || !title || !introExtract) continue;
        let canonicalUri: string;
        try {
          const canonical = new URL(fullurl);
          if (canonical.protocol !== "https:") continue;
          canonicalUri = canonical.href;
        } catch {
          continue;
        }
        seenPageIds.add(pageId);
        candidatePages.push({
          pageId,
          title,
          canonicalUri,
          introExtract,
          investigationQuery: searchQuery,
          investigationQueryIndex: queryIndex,
        });
      }
    }

    let extracts = new Map(
      candidatePages.map((page) => [page.pageId, page.introExtract.slice(0, MAX_SOURCE_CONTENT_CHARS)] as const),
    );
    if (interruption === null && candidatePages.length > 0) {
      const detail = await this.fullPageExtracts(candidatePages, signal);
      extracts = detail.extracts;
      interruption = detail.interruption;
    }

    const sources: RetrievedKnowledgeSource[] = [];
    const claims: RetrievedKnowledgeClaim[] = [];
    for (const page of candidatePages) {
      const content = extracts.get(page.pageId) ?? page.introExtract.slice(0, MAX_SOURCE_CONTENT_CHARS);
      if (!content) continue;
      const sourceId = `page:${page.pageId}`;
      const source: RetrievedKnowledgeSource = {
        sourceId,
        canonicalUri: page.canonicalUri,
        title: page.title,
        publisher: "Wikipedia contributors",
        retrievedAt,
        publishedAt: null,
        contentType: "text/plain; charset=utf-8",
        content,
        metadata: {
          pageId: Number(page.pageId),
          sourceAdapter: this.kind,
          investigationQuery: page.investigationQuery,
          investigationQueryIndex: page.investigationQueryIndex,
          evidentiarySuitability: "GENERAL_REFERENCE",
        },
      };
      const paragraphs = sourceClaimTexts(content);
      if (paragraphs.length === 0) continue;
      sources.push(source);
      for (const [paragraphIndex, claimText] of paragraphs.entries()) {
        claims.push({
          claimId: `source-report:${page.pageId}:${paragraphIndex + 1}`,
          text: claimText,
          claimType: "INTERPRETIVE",
          evidence: [{ sourceId, relation: "SUPPORTS", excerpt: claimText }],
        });
      }
    }

    return {
      sources,
      claims,
      completion: interruption === null
        ? { status: "COMPLETE" }
        : sources.length === 0 || claims.length === 0
          ? { status: "FAILED", reason: interruption }
          : { status: "PARTIAL", reason: interruption },
    };
  }

}
