import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
  RetrievedKnowledgeClaim,
  RetrievedKnowledgeSource,
} from "./acquisition.js";

const DEFAULT_ENDPOINT = "https://en.wikipedia.org/w/api.php";
const DEFAULT_RESULT_LIMIT = 4;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_CONTENT_CHARS = 24_000;
const MAX_CLAIM_CHARS = 1_200;
const MAX_CLAIMS_PER_SOURCE = 8;
const MAX_TOTAL_RESULTS = 12;
const MAX_INVESTIGATION_QUERIES = 8;

export interface WikimediaKnowledgeAcquisitionOptions {
  readonly endpoint?: string;
  readonly resultLimit?: number;
  readonly fetchImpl?: typeof fetch;
  readonly clock?: () => Date;
}

type WikimediaPage = {
  pageid?: unknown;
  index?: unknown;
  title?: unknown;
  extract?: unknown;
  fullurl?: unknown;
  touched?: unknown;
};

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
    throw new Error(`Knowledge source returned HTTP ${response.status}.`);
  }
  if (!response.body) throw new Error("Knowledge source returned an empty response.");
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
        throw new Error("Knowledge source response exceeded its byte limit.");
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
  return JSON.parse(new TextDecoder().decode(combined));
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
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => Date;

  constructor(options: WikimediaKnowledgeAcquisitionOptions = {}) {
    this.endpoint = normalizeEndpoint(options.endpoint ?? DEFAULT_ENDPOINT);
    this.resultLimit = boundedResultLimit(options.resultLimit ?? DEFAULT_RESULT_LIMIT);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date());
  }

  private async fullPageExtract(pageId: string, fallback: string): Promise<string> {
    const url = new URL(this.endpoint.href);
    for (const [key, value] of Object.entries({
      action: "query",
      pageids: pageId,
      prop: "extracts",
      explaintext: "1",
      format: "json",
      formatversion: "2",
      origin: "*",
    })) {
      url.searchParams.set(key, value);
    }

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        redirect: "error",
        headers: {
          accept: "application/json",
          "user-agent": "Lattice-Knowledge-Consultation/0.1 (source retrieval; no truth authority)",
        },
      });
      const root = record(await readBoundedJson(response));
      const query = record(root?.query);
      const rawPage = Array.isArray(query?.pages) ? query.pages[0] : undefined;
      const page = record(rawPage) as WikimediaPage | null;
      const extract = typeof page?.extract === "string" ? page.extract.trim() : "";
      return (extract || fallback).slice(0, MAX_SOURCE_CONTENT_CHARS);
    } catch {
      return fallback.slice(0, MAX_SOURCE_CONTENT_CHARS);
    }
  }

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    if (!request.runId.trim() || !request.objective.trim()) {
      throw new Error("Knowledge acquisition requires an exact Run and objective.");
    }
    const queries = retrievalQueries(request);
    const retrievedAt = this.clock().toISOString();
    const sources: RetrievedKnowledgeSource[] = [];
    const claims: RetrievedKnowledgeClaim[] = [];
    const seenPageIds = new Set<string>();

    for (const [queryIndex, searchQuery] of queries.entries()) {
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

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          redirect: "error",
          headers: {
            accept: "application/json",
            "user-agent": "Lattice-Knowledge-Consultation/0.1 (source retrieval; no truth authority)",
          },
        });
      } catch (error) {
        throw new Error(`Knowledge source was unavailable: ${error instanceof Error ? error.message : "request failed"}.`);
      }

      const root = record(await readBoundedJson(response));
      const query = record(root?.query);
      const pages = Array.isArray(query?.pages) ? query.pages : [];

      for (const rawPage of [...pages].sort((left, right) => {
        const a = record(left)?.index;
        const b = record(right)?.index;
        return (typeof a === "number" ? a : Number.MAX_SAFE_INTEGER)
          - (typeof b === "number" ? b : Number.MAX_SAFE_INTEGER);
      })) {
        if (sources.length >= MAX_TOTAL_RESULTS) break;
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

        const extract = await this.fullPageExtract(pageId, introExtract);
        if (!extract) continue;
        const sourceId = `page:${pageId}`;
        const source: RetrievedKnowledgeSource = {
          sourceId,
          canonicalUri,
          title,
          publisher: "Wikipedia contributors",
          retrievedAt,
          publishedAt: typeof page.touched === "string" ? page.touched : null,
          contentType: "text/plain; charset=utf-8",
          content: extract,
          metadata: {
            pageId: Number(pageId),
            sourceAdapter: this.kind,
            investigationQuery: searchQuery,
            investigationQueryIndex: queryIndex,
            evidentiarySuitability: "GENERAL_REFERENCE",
          },
        };
        const paragraphs = sourceClaimTexts(extract);
        if (paragraphs.length === 0) continue;
        seenPageIds.add(pageId);
        sources.push(source);
        for (const [paragraphIndex, text] of paragraphs.entries()) {
          claims.push({
            claimId: `source-report:${pageId}:${paragraphIndex + 1}`,
            text,
            claimType: "INTERPRETIVE",
            evidence: [{ sourceId, relation: "SUPPORTS", excerpt: text }],
          });
        }
      }
      if (sources.length >= MAX_TOTAL_RESULTS) break;
    }

    return { sources, claims };
  }
}
