import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ModelRuntime } from "../dist/src/model/runtime.js";
import { ModelProviderError } from "../dist/src/model/errors.js";
import { ModelSolandraCognitiveRuntime } from "../dist/src/solandra/cognition.js";
import { ModelSolandraAdvisoryRuntime } from "../dist/src/solandra/advisory.js";
import { ModelSolandraActionPreparer } from "../dist/src/solandra/action-preparer.js";
import { ModelSolandraKnowledgePresenter } from "../dist/src/solandra/knowledge-presenter.js";
import { ModelSolandraKnowledgeInvestigator } from "../dist/src/solandra/knowledge-investigator.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../dist/src/knowledge/wikimedia-acquisition.js";
import { RelevantKnowledgeAcquisitionProvider } from "../dist/src/knowledge/investigation.js";
import { AlphaDecisionKnowledgeAcquisitionProvider } from "../dist/src/knowledge/npm-decision-acquisition.js";
import { KnowledgeAcquisitionTruthPipeline } from "../dist/src/truth/knowledge-acquisition-pipeline.js";
import { AlphaDecisionKnowledgeEvidenceAdmissionPolicy } from "../dist/src/truth/npm-decision-admission.js";
import { createAlphaDecisionRuntimeComposition } from "../dist/src/decision/alpha-decision-composition.js";
import { createRuntimeApp } from "../dist/src/runtime-app.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";

const QUESTION = "What caused the Cretaceous–Paleogene extinction, and what evidence supports that explanation?";
const PRESENTATION_FOLLOW_UP = "Using only the Knowledge you just established, answer my original question in plain language and tell me what remains uncertain.";
const GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const expectedSha = process.env.EXPECTED_PRODUCT_SHA?.trim();
const expectedTree = process.env.EXPECTED_PRODUCT_TREE?.trim();
assert.ok(expectedSha && expectedTree, "Exact Product SHA/tree are required.");
assert.ok(process.env.GEMINI_API_KEY?.trim(), "GEMINI_API_KEY is unavailable.");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(git("rev-parse", "HEAD"), expectedSha);
assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);

const artifactDir = resolve(process.env.VALIDATION_ARTIFACT_DIR ?? "../artifacts/issue91-post96-e2e");
mkdirSync(artifactDir, { recursive: true });
const trace = {
  product: { sha: expectedSha, tree: expectedTree },
  question: QUESTION,
  validationComposition: {
    modelProvider: "gemini",
    model: GEMINI_MODEL,
    providerUse: "validation-only ModelRuntime seam; Product cognition/investigation/presentation classes unchanged",
    braveUsed: false,
    retriesAdded: false,
    fallbackAdded: false,
  },
  cognition: null,
  investigation: null,
  acquisition: null,
  semanticResponsiveness: { calls: [], input: null, output: null, error: null },
  truthHandoff: null,
  v36: null,
  knowledge: null,
  presentation: null,
  firstMaterialFailure: null,
  notes: [],
};
const writeTrace = () => writeFileSync(resolve(artifactDir, "trace.json"), JSON.stringify(trace, null, 2));
const safeError = (error) => ({
  name: error?.name ?? typeof error,
  message: error instanceof Error ? error.message : String(error),
  code: typeof error?.code === "string" ? error.code : null,
  statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
  retryable: typeof error?.retryable === "boolean" ? error.retryable : null,
});
const bounded = (value, max = 700) => typeof value === "string" ? value.slice(0, max) : value;
const uniqueMatches = (text, pattern) => [...new Set([...text.matchAll(pattern)].map((match) => match[1]).filter(Boolean))];

class ValidationGeminiProvider {
  kind = "validation-gemini-openai-compatible";
  constructor(apiKey) { this.apiKey = apiKey; }
  async generate(request, context) {
    let response;
    try {
      response = await fetch(GEMINI_ENDPOINT, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${this.apiKey}`,
          "x-lattice-correlation-id": context.correlationId,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
          ...(request.seed === undefined ? {} : { seed: request.seed }),
        }),
        signal: context.signal,
      });
    } catch (error) {
      throw new ModelProviderError(context.signal.aborted ? "cancelled" : "unavailable", "Validation Gemini request failed.", { cause: error });
    }
    const text = await response.text();
    if (!response.ok) {
      throw new ModelProviderError(response.status === 429 ? "rate_limit" : "unavailable", `Validation Gemini returned HTTP ${response.status}.`, { statusCode: response.status, retryable: response.status === 429 || response.status >= 500 });
    }
    let body;
    try { body = JSON.parse(text); } catch (error) {
      throw new ModelProviderError("malformed_response", "Validation Gemini returned malformed JSON.", { cause: error, statusCode: 502 });
    }
    const choice = Array.isArray(body?.choices) ? body.choices[0] : undefined;
    const content = typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";
    if (!content) throw new ModelProviderError("invalid_output", "Validation Gemini returned no text output.", { statusCode: 502 });
    const actualModel = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : request.model;
    const id = typeof body?.id === "string" && body.id.trim() ? body.id.trim() : `gemini-${context.requestIdentity.slice(0, 16)}-${context.attempt}`;
    const inputTokens = Number.isSafeInteger(body?.usage?.prompt_tokens) ? body.usage.prompt_tokens : null;
    const outputTokens = Number.isSafeInteger(body?.usage?.completion_tokens) ? body.usage.completion_tokens : null;
    return {
      response: {
        id,
        model: actualModel,
        output: [{ type: "text", text: content }],
        ...(inputTokens === null || outputTokens === null ? {} : { usage: { inputTokens, outputTokens } }),
      },
      metadata: { upstreamStatus: response.status, inputTokens, outputTokens },
      route: { actualProvider: "gemini", actualModel, upstreamRequestId: id },
    };
  }
}

class ValidationGeminiRuntime extends ModelRuntime {
  constructor(provider) { super(provider, { timeoutMs: 60_000, maxRequestBytes: 256 * 1024 }); }
  async call(rawRequest, options) {
    const requestText = JSON.stringify(rawRequest);
    const promptText = Array.isArray(rawRequest?.messages) ? rawRequest.messages.map((message) => message.content ?? "").join("\n") : "";
    const observation = {
      sequence: trace.semanticResponsiveness.calls.length + 1,
      correlationId: options.correlationId,
      serializedRequestBytes: Buffer.byteLength(requestText),
      claimIdsPresented: uniqueMatches(promptText, /^Claim ID: (.+)$/gmu),
      sourceIdsPresented: uniqueMatches(promptText, /^Source ID: (.+)$/gmu),
      provider: "gemini",
      requestedModel: rawRequest?.model ?? null,
      result: null,
      error: null,
    };
    const isResponsiveness = options.correlationId.startsWith("solandra-responsiveness:");
    if (isResponsiveness) trace.semanticResponsiveness.calls.push(observation);
    try {
      const result = await super.call(rawRequest, {
        ...options,
        invocation: { executionClass: "LIVE_DIRECT", routeMode: "PINNED", requestedProvider: "gemini" },
      });
      observation.result = {
        actualProvider: result.audit.invocationProvenance.actualProvider,
        actualModel: result.audit.invocationProvenance.actualModel,
        routeProvenance: result.audit.invocationProvenance.routeProvenance,
        inputTokens: result.response.usage?.inputTokens ?? result.audit.providerMetadata?.inputTokens ?? null,
        outputTokens: result.response.usage?.outputTokens ?? result.audit.providerMetadata?.outputTokens ?? null,
        outputExcerpt: bounded(result.response.output?.[0]?.text ?? "", 900),
      };
      return result;
    } catch (error) {
      observation.error = safeError(error);
      throw error;
    } finally {
      writeTrace();
    }
  }
}

const runtime = new ValidationGeminiRuntime(new ValidationGeminiProvider(process.env.GEMINI_API_KEY.trim()));
const cognitionInner = new ModelSolandraCognitiveRuntime(runtime, GEMINI_MODEL);
const advisory = new ModelSolandraAdvisoryRuntime(runtime, GEMINI_MODEL);
const actionPreparer = new ModelSolandraActionPreparer(runtime, GEMINI_MODEL);
const presenterInner = new ModelSolandraKnowledgePresenter(runtime, GEMINI_MODEL);
const investigatorInner = new ModelSolandraKnowledgeInvestigator(runtime, GEMINI_MODEL);

const cognition = {
  async interpret(input) {
    const result = await cognitionInner.interpret(input);
    trace.cognition = {
      exactUserInput: input.message,
      mode: result.mode,
      provider: result.invocationProvenance.actualProvider,
      model: result.invocationProvenance.actualModel,
      routeProvenance: result.invocationProvenance.routeProvenance,
      ...(result.mode === "GOVERNED" ? {
        requestedHelp: result.proposal.requestedHelp,
        objectiveRelation: result.proposal.objectiveRelation,
        proposedObjective: result.proposal.proposedObjective,
        knowledgeNeeds: result.proposal.knowledgeNeeds,
        materialAmbiguity: result.proposal.materialAmbiguity,
      } : { assistantResponse: result.response }),
    };
    writeTrace();
    return result;
  },
};

const investigator = {
  kind: investigatorInner.kind,
  async plan(input) {
    const result = await investigatorInner.plan(input);
    trace.investigation = { knowledgeNeeds: [...input.knowledgeNeeds], retrievalQueries: [...result.retrievalQueries], provider: "gemini", model: GEMINI_MODEL };
    writeTrace();
    return result;
  },
  async selectResponsive(input) {
    trace.semanticResponsiveness.input = {
      sourceCount: input.sources.length,
      claimCount: input.claims.length,
      sourceIds: input.sources.map((source) => source.sourceId),
      claimIds: input.claims.map((claim) => claim.claimId),
    };
    try {
      const result = await investigatorInner.selectResponsive(input);
      trace.semanticResponsiveness.output = {
        selectionCount: result.selections.length,
        selections: result.selections.map((selection) => ({ claimId: selection.claimId, sourceIds: [...selection.sourceIds] })),
      };
      return result;
    } catch (error) {
      trace.semanticResponsiveness.error = safeError(error);
      throw error;
    } finally { writeTrace(); }
  },
};

const rawInner = new WikimediaKnowledgeAcquisitionProvider();
const rawProvider = {
  kind: rawInner.kind,
  async acquire(input) {
    try {
      const result = await rawInner.acquire(input);
      trace.acquisition = {
        provider: rawInner.kind,
        completion: result.completion ?? { status: "COMPLETE" },
        sourceCount: result.sources.length,
        claimCount: result.claims.length,
        sources: result.sources.map((source) => ({ sourceId: source.sourceId, title: source.title, canonicalUri: source.canonicalUri, excerpt: bounded(source.content, 900) })),
        claimIds: result.claims.map((claim) => claim.claimId),
      };
      return result;
    } catch (error) {
      trace.acquisition = { provider: rawInner.kind, error: safeError(error), sourceCount: 0, claimCount: 0 };
      throw error;
    } finally { writeTrace(); }
  },
};

const responsive = new RelevantKnowledgeAcquisitionProvider(rawProvider, investigator);
const routed = new AlphaDecisionKnowledgeAcquisitionProvider(responsive);
const selectedProvider = {
  kind: routed.kind,
  async acquire(input) {
    try {
      const result = await routed.acquire(input);
      trace.truthHandoff = {
        sourceCountEnteringSanitation: result.sources.length,
        claimCountEnteringSanitation: result.claims.length,
        sourceIdsEnteringSanitation: result.sources.map((source) => source.sourceId),
        claimIdsEnteringSanitation: result.claims.map((claim) => claim.claimId),
        completion: result.completion ?? { status: "COMPLETE" },
        maxClaimsCap: 24,
        capWouldReject: result.claims.length > 24,
      };
      return result;
    } catch (error) {
      trace.truthHandoff = { error: safeError(error) };
      throw error;
    } finally { writeTrace(); }
  },
};
const truthPipeline = new KnowledgeAcquisitionTruthPipeline(selectedProvider, new AlphaDecisionKnowledgeEvidenceAdmissionPolicy());

const presenter = {
  async present(input) {
    try {
      const result = await presenterInner.present(input);
      trace.presentation = {
        requestedHelp: input.requestedHelp,
        knowledgeId: input.knowledge.knowledgeId,
        findingsSupplied: input.knowledge.findings,
        uncertaintiesSupplied: input.knowledge.uncertainties,
        provenanceSupplied: input.knowledge.provenance,
        status: result.status,
        assistantMessage: result.status === "PRESENTED" ? result.text : null,
        provider: result.invocationProvenance.actualProvider,
        model: result.invocationProvenance.actualModel,
        routeProvenance: result.invocationProvenance.routeProvenance,
      };
      return result;
    } catch (error) {
      trace.presentation = { error: safeError(error) };
      throw error;
    } finally { writeTrace(); }
  },
};

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue91-post96-validator",
});
const app = await createRuntimeApp(config, {
  ...createAlphaDecisionRuntimeComposition(),
  truthPipeline,
  memoryDispatchDelayMs: 1,
  solandraCognition: cognition,
  solandraAdvisory: advisory,
  solandraActionPreparer: actionPreparer,
  solandraKnowledgePresenter: presenter,
});

async function request(options, allowed = [200, 201, 202]) {
  const response = await app.inject(options);
  if (!allowed.includes(response.statusCode)) throw new Error(`HTTP ${response.statusCode}: ${response.body}`);
  return response.json();
}
async function waitForRun(runId) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const run = await request({ method: "GET", url: `/api/v1/runs/${runId}` }, [200]);
    if (run.status === "FAILED" || run.status === "CANCELLED") return { run, failed: true };
    if (run.status === "COMPLETED") {
      const body = await request({ method: "GET", url: `/api/v1/runs/${runId}/outcome` }, [200]);
      return { run, failed: false, body };
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Run ${runId} timed out.`);
}
function providerErrorObserved() {
  const errors = trace.semanticResponsiveness.calls.map((call) => call.error).filter(Boolean);
  return errors.some((error) => ["rate_limit", "timeout", "unavailable"].includes(error.code));
}

try {
  const conversation = await request({ method: "POST", url: "/api/v1/conversations" }, [201]);
  const conversationId = conversation.conversation.id;
  const submitted = await request({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message: QUESTION },
  });

  if (submitted.status !== "RUN_ACCEPTED" || !submitted.runId) {
    trace.firstMaterialFailure = "UNKNOWN";
    trace.notes.push(`Initial turn did not enter a Knowledge Run: ${submitted.status ?? "unknown status"}.`);
  } else {
    const completed = await waitForRun(submitted.runId);
    if (completed.failed) {
      trace.firstMaterialFailure = "UNKNOWN";
      trace.notes.push(`Run ended ${completed.run.status}.`);
    } else {
      const outcome = completed.body.outcome;
      const knowledgeId = completed.body.knowledgeReference?.knowledgeId ?? null;
      const evidence = Array.isArray(outcome?.evidence) ? outcome.evidence : [];
      const findings = Array.isArray(outcome?.findings) ? outcome.findings : [];
      const admitted = evidence.filter((item) => item.admitted === true);
      const rejected = evidence.filter((item) => item.admitted !== true);
      trace.v36 = {
        invoked: true,
        evidenceEvaluated: evidence.length,
        admittedCount: admitted.length,
        rejectedCount: rejected.length,
        rejected: rejected.map((item) => ({ evidenceId: item.evidenceId, claimId: item.claimId, rejectionReason: item.rejectionReason })),
        findingStates: findings.map((finding) => ({ claimId: finding.claimId, status: finding.status, basis: finding.basis ?? null })),
        provenanceRetained: outcome?.provenance ?? [],
      };
      trace.knowledge = {
        runId: submitted.runId,
        runStatus: completed.run.status,
        knowledgeId,
        findings,
        provenance: outcome?.provenance ?? [],
        uncertainty: outcome?.uncertainties ?? [],
      };

      if (trace.acquisition?.error || ((trace.acquisition?.sourceCount ?? 0) === 0 && trace.acquisition?.completion?.status === "PARTIAL")) {
        trace.firstMaterialFailure = "PROVIDER";
      } else if (trace.semanticResponsiveness.error) {
        trace.firstMaterialFailure = providerErrorObserved() ? "PROVIDER" : "RESPONSIVENESS";
      } else if (trace.truthHandoff?.capWouldReject === true) {
        trace.firstMaterialFailure = "SANITIZER";
      } else if ((trace.truthHandoff?.claimCountEnteringSanitation ?? 0) > 0 && evidence.length === 0) {
        trace.firstMaterialFailure = "SANITIZER";
      } else if (evidence.length > 0 && admitted.length === 0) {
        trace.firstMaterialFailure = "V36";
      } else if (admitted.length > 0 && findings.length === 0) {
        trace.firstMaterialFailure = "KNOWLEDGE";
      } else if (admitted.length > 0 && findings.length > 0 && knowledgeId) {
        const follow = await request({
          method: "POST",
          url: `/api/v1/conversations/${conversationId}/turns`,
          payload: { turnId: randomUUID(), message: PRESENTATION_FOLLOW_UP },
        });
        if (follow.status !== "REFERENCE_RESOLVED" || typeof follow.presentation?.assistantMessage !== "string" || !follow.presentation.assistantMessage.trim()) {
          trace.firstMaterialFailure = "PRESENTATION";
          trace.presentation = { ...(trace.presentation ?? {}), apiStatus: follow.status ?? null, apiAssistantMessage: follow.presentation?.assistantMessage ?? null };
        } else {
          trace.presentation = { ...(trace.presentation ?? {}), apiStatus: follow.status, apiAssistantMessage: follow.presentation.assistantMessage, referencedKnowledgeId: follow.knowledgeReference?.knowledgeId ?? null };
          trace.firstMaterialFailure = "NONE OBSERVED";
        }
      } else {
        trace.firstMaterialFailure = "UNKNOWN";
      }
    }
  }

  assert.equal(git("rev-parse", "HEAD"), expectedSha);
  assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
  writeTrace();
  console.log(`ISSUE91_POST96_E2E_SUMMARY=${JSON.stringify({ firstMaterialFailure: trace.firstMaterialFailure, cognition: trace.cognition, investigation: trace.investigation, acquisition: trace.acquisition && { completion: trace.acquisition.completion, sourceCount: trace.acquisition.sourceCount, claimCount: trace.acquisition.claimCount, titles: trace.acquisition.sources?.map((s) => s.title) }, semantic: { calls: trace.semanticResponsiveness.calls.map((c) => ({ correlationId: c.correlationId, serializedRequestBytes: c.serializedRequestBytes, claimCount: c.claimIdsPresented.length, sourceCount: c.sourceIdsPresented.length, error: c.error, result: c.result && { actualProvider: c.result.actualProvider, actualModel: c.result.actualModel, inputTokens: c.result.inputTokens } })), output: trace.semanticResponsiveness.output, error: trace.semanticResponsiveness.error }, truthHandoff: trace.truthHandoff, v36: trace.v36, knowledge: trace.knowledge, presentation: trace.presentation }, null, 2)}`);
} catch (error) {
  trace.firstMaterialFailure ??= providerErrorObserved() ? "PROVIDER" : "UNKNOWN";
  trace.notes.push(`Harness-level error: ${JSON.stringify(safeError(error))}`);
  writeTrace();
  console.error("ISSUE91_POST96_E2E_HARNESS_ERROR", safeError(error));
  process.exitCode = 1;
} finally {
  await app.close();
}
