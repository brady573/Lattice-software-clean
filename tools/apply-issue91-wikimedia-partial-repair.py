from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one replacement target, found {count}")
    file.write_text(text.replace(old, new, 1))


# 1. Acquisition contract: typed completion state, optional for compatibility.
replace_once(
    "src/knowledge/acquisition.ts",
    '''export interface KnowledgeAcquisitionResult {
  readonly sources: readonly RetrievedKnowledgeSource[];
  readonly claims: readonly RetrievedKnowledgeClaim[];
}
''',
    '''export type KnowledgeAcquisitionPartialReason =
  | "RATE_LIMITED"
  | "TIMED_OUT"
  | "PROVIDER_FAILURE";

export type KnowledgeAcquisitionCompletion =
  | { readonly status: "COMPLETE" }
  | {
      readonly status: "PARTIAL";
      readonly reason: KnowledgeAcquisitionPartialReason;
    };

export interface KnowledgeAcquisitionResult {
  readonly sources: readonly RetrievedKnowledgeSource[];
  readonly claims: readonly RetrievedKnowledgeClaim[];
  /**
   * Operational completeness only. Omission preserves compatibility with
   * existing injected providers and is interpreted as COMPLETE downstream.
   * It never admits evidence or establishes truth.
   */
  readonly completion?: KnowledgeAcquisitionCompletion;
}
''',
)

# 2. Preserve acquisition completeness through Solandra responsiveness selection.
replace_once(
    "src/knowledge/investigation.ts",
    '''    return {
      sources: acquired.sources.filter((source) => selectedSourceIds.has(source.sourceId)),
      claims,
    };
''',
    '''    return {
      sources: acquired.sources.filter((source) => selectedSourceIds.has(source.sourceId)),
      claims,
      ...(acquired.completion === undefined ? {} : { completion: acquired.completion }),
    };
''',
)

# 3. Wikimedia provider: typed interruptions, partial survival, batched enrichment.
replace_once(
    "src/knowledge/wikimedia-acquisition.ts",
    '''  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
  RetrievedKnowledgeClaim,
  RetrievedKnowledgeSource,
''',
    '''  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
  type KnowledgeAcquisitionPartialReason,
  RetrievedKnowledgeClaim,
  RetrievedKnowledgeSource,
''',
)
replace_once(
    "src/knowledge/wikimedia-acquisition.ts",
    '''const MAX_TOTAL_RESULTS = 12;
const MAX_INVESTIGATION_QUERIES = 8;
''',
    '''const MAX_TOTAL_RESULTS = 12;
const MAX_INVESTIGATION_QUERIES = 8;
const DETAIL_BATCH_SIZE = 4;
''',
)
replace_once(
    "src/knowledge/wikimedia-acquisition.ts",
    '''type WikimediaPage = {
  pageid?: unknown;
  index?: unknown;
  title?: unknown;
  extract?: unknown;
  fullurl?: unknown;
};
''',
    '''type WikimediaPage = {
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
''',
)
replace_once(
    "src/knowledge/wikimedia-acquisition.ts",
    '''async function readBoundedJson(response: Response): Promise<unknown> {
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
''',
    '''async function readBoundedJson(response: Response): Promise<unknown> {
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
''',
)
replace_once(
    "src/knowledge/wikimedia-acquisition.ts",
    '''    } catch (error) {
      if (signal.aborted) {
        throw new Error(`Knowledge source request exceeded ${this.timeoutMs} ms`, { cause: error });
      }
      throw error;
    }
  }

  private async fullPageExtract(pageId: string, fallback: string, signal: AbortSignal): Promise<string> {
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
      const root = record(await this.requestJson(url, signal));
      const query = record(root?.query);
      const rawPage = Array.isArray(query?.pages) ? query.pages[0] : undefined;
      const page = record(rawPage) as WikimediaPage | null;
      const extract = typeof page?.extract === "string" ? page.extract.trim() : "";
      return (extract || fallback).slice(0, MAX_SOURCE_CONTENT_CHARS);
    } catch (error) {
      if (signal.aborted) throw error;
      return fallback.slice(0, MAX_SOURCE_CONTENT_CHARS);
    }
  }
''',
    '''    } catch (error) {
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
''',
)

wikimedia = Path("src/knowledge/wikimedia-acquisition.ts")
text = wikimedia.read_text()
start = text.index("  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {")
class_close = text.rfind("\n}\n")
if class_close <= start:
    raise RuntimeError("Unable to locate Wikimedia acquire method boundary")
new_acquire = '''  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
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
        : { status: "PARTIAL", reason: interruption },
    };
  }
'''
wikimedia.write_text(text[:start] + new_acquire + text[class_close:])

# 4. Truth pipeline: sanitize and persist operational partial state without truth promotion.
replace_once(
    "src/truth/knowledge-acquisition-pipeline.ts",
    '''  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionResult,
  RetrievedKnowledgeClaim,
''',
    '''  KnowledgeAcquisitionProvider,
  type KnowledgeAcquisitionCompletion,
  type KnowledgeAcquisitionPartialReason,
  KnowledgeAcquisitionResult,
  RetrievedKnowledgeClaim,
''',
)
replace_once(
    "src/truth/knowledge-acquisition-pipeline.ts",
    '''type SanitizedAcquisition = {
  sources: RetrievedKnowledgeSource[];
  claims: RetrievedKnowledgeClaim[];
};
''',
    '''type SanitizedAcquisition = {
  sources: RetrievedKnowledgeSource[];
  claims: RetrievedKnowledgeClaim[];
  completion: KnowledgeAcquisitionCompletion;
};
''',
)
replace_once(
    "src/truth/knowledge-acquisition-pipeline.ts",
    '''function sanitizeAcquisition(value: KnowledgeAcquisitionResult): SanitizedAcquisition {
''',
    '''function sanitizeCompletion(
  value: KnowledgeAcquisitionResult["completion"],
): KnowledgeAcquisitionCompletion {
  if (value === undefined || value.status === "COMPLETE") return { status: "COMPLETE" };
  if (
    value.status === "PARTIAL"
    && (value.reason === "RATE_LIMITED" || value.reason === "TIMED_OUT" || value.reason === "PROVIDER_FAILURE")
  ) {
    return { status: "PARTIAL", reason: value.reason };
  }
  throw new Error("Knowledge acquisition completion state is invalid.");
}

function sanitizeAcquisition(value: KnowledgeAcquisitionResult): SanitizedAcquisition {
''',
)
replace_once(
    "src/truth/knowledge-acquisition-pipeline.ts",
    '''  return { sources, claims };
}

function researchQuery''',
    '''  return { sources, claims, completion: sanitizeCompletion(value.completion) };
}

function researchQuery''',
)

pipeline = Path("src/truth/knowledge-acquisition-pipeline.ts")
text = pipeline.read_text()
old_start = text.index("function unavailableBundle(runId: string, query: string): TruthBundle {")
old_end = text.index("\nfunction investigatedBundle(", old_start)
new_unavailable = '''function unavailableBundle(
  runId: string,
  query: string,
  partialReason?: KnowledgeAcquisitionPartialReason,
): TruthBundle {
  const partial = partialReason !== undefined;
  const sourceClaimId = partial ? "acquisition-partial" : "acquisition-unavailable";
  const compilation = compileClaim({
    runId,
    sourceClaimId,
    text: partial
      ? "External information retrieval was incomplete for this consultation."
      : "External information could not be established for this consultation.",
    claimType: "INTERPRETIVE",
    qualifiers: [
      { key: "acquisition-state", value: partial ? "PARTIAL" : "UNAVAILABLE_OR_INSUFFICIENT" },
      ...(partialReason === undefined ? [] : [{ key: "acquisition-reason", value: partialReason }]),
    ],
  });
  const obligations = compilation.requiredProofKinds.map<ProofObligation>((kind) => ({
    id: stableTruthUuid(`${runId}:obligation:${sourceClaimId}:${kind}`),
    runId,
    claimId: compilation.claim.id,
    kind,
    required: true,
  }));
  const checks = obligations.map<ProofCheck>((obligation) => ({
    id: stableTruthUuid(`${runId}:check:${sourceClaimId}:${obligation.kind}`),
    runId,
    obligationId: obligation.id,
    kind: obligation.kind,
    status: "UNRESOLVED",
    evidenceIds: [],
    explanation: partial
      ? "Acquisition was incomplete before this proof obligation could be fully investigated."
      : "No source-bound evidence was available for this proof obligation.",
  }));
  return {
    runId,
    provenanceComponents: [],
    researchQuestions: [{
      id: stableTruthUuid(`${runId}:research:${sourceClaimId}`),
      runId,
      claimId: compilation.claim.id,
      parentQuestionId: null,
      purpose: "SUPPORT",
      query,
      serialRound: 1,
    }],
    sources: [],
    sourceEdges: [],
    claims: [compilation.claim],
    claimEvidence: [],
    obligations,
    checks,
    assessments: [emptyAssessment(compilation.claim, obligations, checks, [])],
  };
}

function appendPartialAcquisitionLimitation(
  bundle: TruthBundle,
  runId: string,
  query: string,
  reason: KnowledgeAcquisitionPartialReason,
): TruthBundle {
  const limitation = unavailableBundle(runId, query, reason);
  return {
    ...bundle,
    researchQuestions: [...bundle.researchQuestions, ...limitation.researchQuestions],
    claims: [...bundle.claims, ...limitation.claims],
    obligations: [...bundle.obligations, ...limitation.obligations],
    checks: [...bundle.checks, ...limitation.checks],
    assessments: [...bundle.assessments, ...limitation.assessments],
  };
}
'''
pipeline.write_text(text[:old_start] + new_unavailable + text[old_end:])

replace_once(
    "src/truth/knowledge-acquisition-pipeline.ts",
    '''  if (acquired.sources.length === 0 || acquired.claims.length === 0) {
    return unavailableBundle(runId, researchQuery(request));
  }
''',
    '''  if (acquired.sources.length === 0 || acquired.claims.length === 0) {
    return unavailableBundle(
      runId,
      researchQuery(request),
      acquired.completion.status === "PARTIAL" ? acquired.completion.reason : undefined,
    );
  }
''',
)
replace_once(
    "src/truth/knowledge-acquisition-pipeline.ts",
    '''  return {
    runId,
    provenanceComponents: [],
    researchQuestions,
    sources: [...sourceByExternalId.values()],
    sourceEdges: [],
    claims,
    claimEvidence: evidence,
    obligations,
    checks,
    assessments,
  };
}

function sourceContent''',
    '''  const bundle: TruthBundle = {
    runId,
    provenanceComponents: [],
    researchQuestions,
    sources: [...sourceByExternalId.values()],
    sourceEdges: [],
    claims,
    claimEvidence: evidence,
    obligations,
    checks,
    assessments,
  };
  return acquired.completion.status === "PARTIAL"
    ? appendPartialAcquisitionLimitation(
        bundle,
        runId,
        researchQuery(request),
        acquired.completion.reason,
      )
    : bundle;
}

function sourceContent''',
)

# 5. Product uncertainty: distinguish partial external acquisition from complete/no-relevant-evidence state.
replace_once(
    "src/outcome.ts",
    '''function isAcquisitionLimitationClaim(claim: TruthBundle["claims"][number]): boolean {
  return claim.qualifiers.some((item) => item.key === "acquisition-state");
}

function unresolvedSummary''',
    '''function isAcquisitionLimitationClaim(claim: TruthBundle["claims"][number]): boolean {
  return claim.qualifiers.some((item) => item.key === "acquisition-state");
}

function claimQualifier(claim: TruthBundle["claims"][number], key: string): string | undefined {
  return claim.qualifiers.find((item) => item.key === key)?.value;
}

function acquisitionUncertainties(truth: TruthBundle): string[] {
  const partial = truth.claims.find((claim) => claimQualifier(claim, "acquisition-state") === "PARTIAL");
  if (!partial) return [];
  switch (claimQualifier(partial, "acquisition-reason")) {
    case "RATE_LIMITED":
      return [
        "External source retrieval was incomplete because the source provider limited further requests. The result reflects only material retrieved before that interruption.",
      ];
    case "TIMED_OUT":
      return [
        "External source retrieval was incomplete because the source request timed out. The result reflects only material retrieved before that interruption.",
      ];
    default:
      return [
        "External source retrieval was incomplete because the source provider became unavailable. The result reflects only material retrieved before that interruption.",
      ];
  }
}

function unresolvedSummary''',
)
replace_once(
    "src/outcome.ts",
    '''  const uncertainties = findings
    .filter((finding) => finding.status === "UNRESOLVED" || finding.status === "CONFLICTED")
    .map(unresolvedSummary);
  if (findings.length === 0) {
    uncertainties.push("No validated external findings are sufficiently relevant to this objective.");
  }
''',
    '''  const acquisitionLimitations = acquisitionUncertainties(truth);
  const uncertainties = [
    ...acquisitionLimitations,
    ...findings
      .filter((finding) => finding.status === "UNRESOLVED" || finding.status === "CONFLICTED")
      .map(unresolvedSummary),
  ];
  if (findings.length === 0 && acquisitionLimitations.length === 0) {
    uncertainties.push("No validated external findings are sufficiently relevant to this objective.");
  }
''',
)

# 6. Existing presentation structurally exposes non-default empty-Knowledge uncertainty.
replace_once(
    "src/presentation/solandra/knowledge-response.ts",
    '''function renderGovernedAnswer(knowledge: KnowledgeOutcome): string {
  if (knowledge.findings.length === 0) return GENERIC_INSUFFICIENT_KNOWLEDGE_MESSAGE;
''',
    '''function renderGovernedAnswer(knowledge: KnowledgeOutcome): string {
  if (knowledge.findings.length === 0) {
    const limitation = knowledge.uncertainties[0]?.trim();
    return limitation && limitation !== EMPTY_KNOWLEDGE_MESSAGE
      ? limitation
      : GENERIC_INSUFFICIENT_KNOWLEDGE_MESSAGE;
  }
''',
)
replace_once(
    "src/presentation/solandra/knowledge-response.ts",
    '''export function renderKnowledgeResponse(knowledge: KnowledgeOutcome): string {
  if (knowledge.findings.length === 0) {
    return knowledge.uncertainties.find((item) => item.includes("No validated external findings"))
      ?? EMPTY_KNOWLEDGE_MESSAGE;
  }
''',
    '''export function renderKnowledgeResponse(knowledge: KnowledgeOutcome): string {
  if (knowledge.findings.length === 0) {
    return knowledge.uncertainties[0] ?? EMPTY_KNOWLEDGE_MESSAGE;
  }
''',
)

# 7. Update existing Issue #57 expectations to the now-general partial-acquisition contract.
replace_once(
    "test/issues-56-57-wikimedia-provider.test.ts",
    '''  await assert.rejects(
    provider.acquire(request("issue-57-timeout")),
    /Knowledge source was unavailable: Knowledge source request exceeded 20 ms\\./u,
  );
  assert.equal(calls, 1, "Wikimedia acquisition must not invent a retry after timeout");

  const recovered = await provider.acquire(request("issue-57-recovery"));
''',
    '''  const timedOut = await provider.acquire(request("issue-57-timeout"));
  assert.deepEqual(timedOut.completion, { status: "PARTIAL", reason: "TIMED_OUT" });
  assert.deepEqual(timedOut.sources, []);
  assert.deepEqual(timedOut.claims, []);
  assert.equal(calls, 1, "Wikimedia acquisition must not invent a retry after timeout");

  const recovered = await provider.acquire(request("issue-57-recovery"));
  assert.deepEqual(recovered.completion, { status: "COMPLETE" });
''',
)
replace_once(
    "test/issues-56-57-wikimedia-provider.test.ts",
    '''  await assert.rejects(
    provider.acquire(request("issue-57-detail-timeout")),
    /Knowledge source request exceeded 20 ms/u,
  );
  assert.equal(calls, 2);
''',
    '''  const result = await provider.acquire(request("issue-57-detail-timeout"));
  assert.equal(result.sources[0]?.content, "Introductory source report.");
  assert.deepEqual(result.completion, { status: "PARTIAL", reason: "TIMED_OUT" });
  assert.equal(calls, 2);
''',
)
replace_once(
    "test/issues-56-57-wikimedia-provider.test.ts",
    '''  const result = await provider.acquire(request("issue-57-detail-fallback"));
  assert.equal(result.sources[0]?.content, "Introductory source report.");
  assert.equal(result.sources[0]?.publishedAt, null);
});
''',
    '''  const result = await provider.acquire(request("issue-57-detail-fallback"));
  assert.equal(result.sources[0]?.content, "Introductory source report.");
  assert.equal(result.sources[0]?.publishedAt, null);
  assert.deepEqual(result.completion, { status: "PARTIAL", reason: "PROVIDER_FAILURE" });
});
''',
)

# 8. Add focused general-capability tests: later rate limit, first-request rate limit, and request amplification.
provider_test = Path("test/issues-56-57-wikimedia-provider.test.ts")
provider_test.write_text(provider_test.read_text() + r'''

test("Issue #91: later Wikimedia rate limit preserves already retrieved source material as partial acquisition", async () => {
  let searches = 0;
  let calls = 0;
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 2_000,
    fetchImpl: async (input) => {
      calls += 1;
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("generator"), "search");
      searches += 1;
      if (searches === 2) return new Response("rate limited", { status: 429 });
      return new Response(JSON.stringify({
        query: {
          pages: [{
            pageid: 91,
            index: 1,
            title: "Retrieved before interruption",
            fullurl: "https://en.wikipedia.org/wiki/Retrieved_before_interruption",
            extract: "Materially useful introductory source report.",
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await provider.acquire({
    runId: "issue-91-later-rate-limit",
    objective: "Understand an encyclopedic topic.",
    context: [],
    investigationQueries: ["first useful query", "later interrupted query"],
  });

  assert.deepEqual(result.completion, { status: "PARTIAL", reason: "RATE_LIMITED" });
  assert.equal(result.sources[0]?.sourceId, "page:91");
  assert.equal(result.sources[0]?.content, "Materially useful introductory source report.");
  assert.equal(result.claims.length, 1);
  assert.equal(calls, 2, "rate limit must not trigger detail enrichment, retry, or further provider calls");
});

test("Issue #91: first Wikimedia rate limit remains explicit even when no material was retrieved", async () => {
  let calls = 0;
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 2_000,
    fetchImpl: async () => {
      calls += 1;
      return new Response("rate limited", { status: 429 });
    },
  });

  const result = await provider.acquire(request("issue-91-first-rate-limit"));
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.claims, []);
  assert.deepEqual(result.completion, { status: "PARTIAL", reason: "RATE_LIMITED" });
  assert.equal(calls, 1);
});

test("Issue #91: full-page enrichment is batched instead of multiplying one request per page", async () => {
  let searchNumber = 0;
  let calls = 0;
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 2_000,
    resultLimit: 4,
    fetchImpl: async (input) => {
      calls += 1;
      const url = new URL(String(input));
      const pageIds = url.searchParams.get("pageids");
      if (pageIds) {
        return new Response(JSON.stringify({
          query: {
            pages: pageIds.split("|").map((raw) => ({
              pageid: Number(raw),
              title: `Topic ${raw}`,
              extract: `Full source report ${raw}.`,
            })),
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      searchNumber += 1;
      const base = searchNumber * 100;
      return new Response(JSON.stringify({
        query: {
          pages: [1, 2, 3, 4].map((offset) => ({
            pageid: base + offset,
            index: offset,
            title: `Topic ${base + offset}`,
            fullurl: `https://en.wikipedia.org/wiki/Topic_${base + offset}`,
            extract: `Intro source report ${base + offset}.`,
          })),
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await provider.acquire({
    runId: "issue-91-batched-enrichment",
    objective: "Investigate several source candidates.",
    context: [],
    investigationQueries: ["query one", "query two", "query three", "query four"],
  });

  assert.equal(result.sources.length, 12);
  assert.deepEqual(result.completion, { status: "COMPLETE" });
  assert.equal(searchNumber, 3, "source cap should stop further search work once twelve candidates exist");
  assert.equal(calls, 6, "twelve candidates should require three searches plus three batched detail requests");
});
''')

# 9. Add focused propagation tests across responsiveness -> V36 -> outcome -> Product response.
Path("test/issue-91-partial-acquisition-boundary.test.ts").write_text(r'''import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun, LatticeRunRequest } from "../src/domain.js";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import {
  RelevantKnowledgeAcquisitionProvider,
  type KnowledgeInvestigator,
} from "../src/knowledge/investigation.js";
import { buildKnowledgeOutcome } from "../src/outcome.js";
import { renderKnowledgeResponseForRun } from "../src/presentation/solandra/knowledge-response.js";
import { KnowledgeAcquisitionTruthPipeline } from "../src/truth/knowledge-acquisition-pipeline.js";

const request: LatticeRunRequest = {
  kind: "consultation",
  objective: "Explain an unfamiliar physical process.",
  context: [],
  investigationQueries: ["external information needed"],
  advisoryRequested: false,
  decisionNeed: "NONE",
  resourceNeed: "NONE",
  sourceMessageId: "issue-91-partial-message",
  sourceMessageDigest: "9".repeat(64),
  intentVersion: 1,
  intentScopeId: "issue-91-partial-scope",
  intentVersionId: "issue-91-partial-intent",
};

function run(id: string): LatticeRun {
  return {
    id,
    conversationId: "issue-91-partial-conversation",
    status: "COMPLETED",
    version: 1,
    request,
    decision: null,
    explanation: null,
    truthAssessmentIds: [],
    events: [],
  };
}

function partialSourceResult(): KnowledgeAcquisitionResult {
  const text = "A retrieved source reports a material explanation of the process.";
  return {
    sources: [{
      sourceId: "partial-source",
      canonicalUri: "https://example.test/partial-source",
      title: "Partial source",
      publisher: "Example",
      retrievedAt: "2026-09-13T12:00:00.000Z",
      publishedAt: null,
      contentType: "text/plain",
      content: text,
      metadata: { evidentiarySuitability: "GENERAL_REFERENCE" },
    }],
    claims: [{
      claimId: "partial-claim",
      text,
      claimType: "INTERPRETIVE",
      evidence: [{ sourceId: "partial-source", relation: "SUPPORTS", excerpt: text }],
    }],
    completion: { status: "PARTIAL", reason: "RATE_LIMITED" },
  };
}

class FixedProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "issue-91-fixed-provider";
  constructor(private readonly result: KnowledgeAcquisitionResult) {}
  async acquire(_request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    return structuredClone(this.result);
  }
}

const investigator: KnowledgeInvestigator = {
  kind: "issue-91-fixed-investigator",
  async plan() {
    return { retrievalQueries: ["provider-ready query"] };
  },
  async selectResponsive(input) {
    return {
      selections: input.claims.map((claim) => ({
        claimId: claim.claimId,
        sourceIds: claim.evidence.map((item) => item.sourceId),
      })),
    };
  },
};

test("Issue #91: semantic responsiveness preserves typed partial acquisition state", async () => {
  const acquisition = new RelevantKnowledgeAcquisitionProvider(
    new FixedProvider(partialSourceResult()),
    investigator,
  );
  const result = await acquisition.acquire({
    runId: "issue-91-responsive-partial",
    objective: request.objective,
    context: [],
    investigationQueries: request.investigationQueries,
  });

  assert.deepEqual(result.completion, { status: "PARTIAL", reason: "RATE_LIMITED" });
  assert.equal(result.sources.length, 1);
  assert.equal(result.claims.length, 1);
});

test("Issue #91: partial source material still reaches V36 while incompleteness remains explicit", async () => {
  const pipeline = new KnowledgeAcquisitionTruthPipeline(new FixedProvider(partialSourceResult()));
  const execution = await pipeline.execute("issue-91-partial-v36", request);
  const acquisitionState = execution.bundle.claims.find((claim) =>
    claim.qualifiers.some((item) => item.key === "acquisition-state" && item.value === "PARTIAL"));
  assert.ok(acquisitionState);
  assert.equal(
    acquisitionState.qualifiers.find((item) => item.key === "acquisition-reason")?.value,
    "RATE_LIMITED",
  );
  assert.equal(execution.bundle.sources.length, 1);
  assert.equal(execution.bundle.claimEvidence[0]?.admitted, true);

  const knowledge = buildKnowledgeOutcome(run("issue-91-partial-v36"), execution.bundle);
  assert.equal(knowledge.findings.length, 1);
  assert.equal(knowledge.provenance.length, 1);
  assert.ok(knowledge.uncertainties.some((item) => item.includes("source provider limited further requests")));
  const message = await renderKnowledgeResponseForRun(knowledge, run("issue-91-partial-v36"));
  assert.match(message, /retrieved source material reports/iu);
  assert.match(message, /source provider limited further requests/iu);
});

test("Issue #91: zero-source partial acquisition is distinct from complete no-relevant-evidence state", async () => {
  const partialPipeline = new KnowledgeAcquisitionTruthPipeline(new FixedProvider({
    sources: [],
    claims: [],
    completion: { status: "PARTIAL", reason: "TIMED_OUT" },
  }));
  const partialExecution = await partialPipeline.execute("issue-91-empty-partial", request);
  const partialKnowledge = buildKnowledgeOutcome(run("issue-91-empty-partial"), partialExecution.bundle);
  assert.deepEqual(partialKnowledge.findings, []);
  assert.equal(partialKnowledge.uncertainties.length, 1);
  assert.match(partialKnowledge.uncertainties[0] ?? "", /source request timed out/iu);
  const partialMessage = await renderKnowledgeResponseForRun(
    partialKnowledge,
    run("issue-91-empty-partial"),
  );
  assert.match(partialMessage, /source request timed out/iu);
  assert.doesNotMatch(partialMessage, /couldn't establish enough relevant evidence/iu);

  const completePipeline = new KnowledgeAcquisitionTruthPipeline(new FixedProvider({
    sources: [],
    claims: [],
    completion: { status: "COMPLETE" },
  }));
  const completeExecution = await completePipeline.execute("issue-91-empty-complete", request);
  const completeKnowledge = buildKnowledgeOutcome(run("issue-91-empty-complete"), completeExecution.bundle);
  assert.deepEqual(completeKnowledge.findings, []);
  assert.deepEqual(completeKnowledge.uncertainties, [
    "No validated external findings are sufficiently relevant to this objective.",
  ]);
  const completeMessage = await renderKnowledgeResponseForRun(
    completeKnowledge,
    run("issue-91-empty-complete"),
  );
  assert.equal(completeMessage, "I couldn't establish enough relevant evidence to answer that reliably.");
});
''')

print("ISSUE91_PATCH_APPLIED")
