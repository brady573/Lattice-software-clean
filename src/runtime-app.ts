import type { FastifyInstance } from "fastify";
import {
  MemoryApiRunControlStore,
  type ApiRunControlStore,
  type ApiRunSubmissionInput,
  type ApiRunSubmissionResult,
  type ApiRunSupersessionInput,
  type ApiRunSupersessionResult,
} from "./api-control-store.js";
import {
  createDevelopmentFixtureSubjectResolver,
  getAuthenticatedSubject,
  registerAuthenticatedSubjectBoundary,
  type AuthenticatedSubjectResolver,
} from "./auth/authenticated-subject.js";
import { registerConsultationIntake } from "./consultation-intake.js";
import { buildApp } from "./http-app.js";
import { registerConversationApi } from "./conversation/conversation-api.js";
import { registerConversationContinuityApi } from "./conversation/continuity-api.js";
import {
  MemoryConversationStore,
  PostgresConversationStore,
  type ConversationStore,
} from "./conversation/conversation-store.js";
import { ConversationRunIndexRecordingApiRunControlStore } from "./conversation/run-index-control.js";
import {
  MemoryConversationRunIndexStore,
  PostgresConversationRunIndexStore,
  type ConversationRunIndexStore,
} from "./conversation/run-index-store.js";
import { registerDurableUserMessageHistory } from "./conversation/user-message-history.js";
import {
  MemoryIntentAuthorityStore,
  MemoryIntentBoundRunStore,
  MemoryIntentUserMessageStore,
  MemoryUserPreferenceStore,
  PostgresIntentAuthorityStore,
  PostgresIntentUserMessageStore,
  PostgresUserPreferenceStore,
  type IntentAuthorityStore,
  type IntentUserMessageStore,
  type UserPreferenceStore,
} from "./intent/index.js";
import { registerDecisionPlanApi } from "./intent/decision-plan-api.js";
import { DecisionPlanRecordingApiRunControlStore } from "./intent/decision-plan-run-control.js";
import { createIntentAuthorityGeneralizedDecisionAdapter } from "./intent/generalized-decision-adapter.js";
import { defaultCriterionCatalog } from "./decision/default-criterion-catalog.js";
import {
  MemoryDecisionPlanStore,
  PostgresDecisionPlanStore,
  type DecisionPlanStore,
} from "./intent/decision-plan-store.js";
import { migrateRunIntentBindings } from "./intent/postgres-run-binding-store.js";
import { registerUserPreferenceControlsApi } from "./intent/user-preference-controls-api.js";
import {
  AndroidRelayModelProvider,
  LocalOfflineModelRuntime,
  ModelRuntime,
  OpenAiCompatibleModelProvider,
} from "./model/index.js";
import { PostgresApiRunControlStore } from "./postgres-api-control-store.js";
import { PostgresOrchestrationStore } from "./postgres-orchestration-store.js";
import { PostgresRunStore } from "./postgres-run-store.js";
import { registerRunEventStream } from "./progress/run-event-stream.js";
import { registerAndroidModelPrototype } from "./prototype/android-model-prototype.js";
import { executePersistedRun, type GeneralizedDecisionAdapter } from "./run-execution.js";
import { MemoryRunStore, type RunStore } from "./run-store.js";
import type { RuntimeConfig } from "./runtime-config.js";
import {
  createDefaultOfflineTruthPipeline,
  type TruthExecutionPipeline,
} from "./truth/execution-pipeline.js";
import { PostgresV36ResearchBridge } from "./v36-research-bridge.js";
import { migrateV36ResearchContinuationRounds } from "./v36-research-round-schema.js";

const DEFAULT_MEMORY_DISPATCH_DELAY_MS = 50;

export interface RuntimeAppOptions {
  truthPipeline?: TruthExecutionPipeline;
  memoryDispatchDelayMs?: number;
  authenticatedSubjectResolver?: AuthenticatedSubjectResolver;
}

function nonNegativeDelay(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new Error(`${name} must be a finite non-negative number.`);
  }
  return resolved;
}

function resolveAuthenticatedSubjectResolver(
  config: RuntimeConfig,
  resolver: AuthenticatedSubjectResolver | undefined,
): AuthenticatedSubjectResolver {
  if (resolver !== undefined) return resolver;

  const authenticationMode = config.authenticationMode
    ?? (config.deploymentMode === "development" ? "development-fixture" : "required");
  if (authenticationMode === "development-fixture") {
    if (config.deploymentMode !== "development") {
      throw new Error("Development fixture authentication cannot be used outside development mode.");
    }
    return createDevelopmentFixtureSubjectResolver(
      config.developmentFixtureSubjectId ?? "fixture-user",
    );
  }
  return () => undefined;
}

class DeferredMemoryApiRunControlStore implements ApiRunControlStore {
  private readonly executions = new Set<Promise<void>>();
  private closed = false;

  constructor(
    private readonly base: MemoryApiRunControlStore,
    private readonly runStore: RunStore,
    private readonly truthPipeline: TruthExecutionPipeline,
    private readonly dispatchDelayMs: number,
    private readonly generalizedDecisionAdapter?: GeneralizedDecisionAdapter,
  ) {}

  async submitRun(input: ApiRunSubmissionInput): Promise<ApiRunSubmissionResult> {
    const submission = await this.base.submitRun(input);
    if (submission.outcome === "created") this.scheduleExecution(input.run.id);
    return submission;
  }

  async supersedeRun(input: ApiRunSupersessionInput): Promise<ApiRunSupersessionResult> {
    const supersession = await this.base.supersedeRun(input);
    if (supersession.outcome === "superseded") {
      this.scheduleExecution(input.supersession.successorRun.id);
    }
    return supersession;
  }

  private scheduleExecution(runId: string): void {
    let execution: Promise<void>;
    execution = new Promise<void>((resolve) => {
      setTimeout(() => {
        if (this.closed) {
          resolve();
          return;
        }
        void executePersistedRun(this.runStore, this.truthPipeline, runId, undefined, this.generalizedDecisionAdapter)
          .then(() => resolve(), () => resolve());
      }, this.dispatchDelayMs);
    });
    this.executions.add(execution);
    void execution.finally(() => this.executions.delete(execution));
  }

  async close(): Promise<void> {

    this.closed = true;
    await Promise.allSettled([...this.executions]);
    await this.base.close();
  }
}

/**
 * Apply every PostgreSQL schema required by the current runtime in dependency
 * order. Individual adapters keep their own migration ownership, while this
 * function is the single runtime/admin authority that composes them.
 */
export async function migrateRuntimeDatabase(databaseUrl: string): Promise<void> {
  await PostgresRunStore.migrate(databaseUrl);

  const orchestrationStore = await PostgresOrchestrationStore.connect(databaseUrl, { migrate: true });
  await orchestrationStore.close();

  await PostgresV36ResearchBridge.migrate(databaseUrl);
  await migrateV36ResearchContinuationRounds(databaseUrl);
  await PostgresConversationStore.migrate(databaseUrl);
  await PostgresIntentUserMessageStore.migrate(databaseUrl);
  await PostgresIntentAuthorityStore.migrate(databaseUrl);
  await migrateRunIntentBindings(databaseUrl);
  await PostgresDecisionPlanStore.migrate(databaseUrl);
  await PostgresUserPreferenceStore.migrate(databaseUrl);

  const apiControlStore = await PostgresApiRunControlStore.connect(databaseUrl, { migrate: true });
  await apiControlStore.close();
}

/**
 * Connect the canonical set of PostgreSQL-backed stores (with production
 * wrapping, e.g. DecisionPlan/ConversationRunIndex recording) used by
 * createRuntimeApp. Exported so tests can compose an explicitly legacy/
 * test-only bounded-decision route against store instances identical to
 * production, without canonical runtime registering that route itself.
 */
export async function connectPostgresRuntimeStores(
  databaseUrl: string,
  autoMigrate: boolean,
): Promise<{
  runStore: RunStore;
  apiControlStore: ApiRunControlStore;
  intentStore: IntentAuthorityStore;
  userMessageStore: IntentUserMessageStore;
  userPreferenceStore: UserPreferenceStore;
  conversationStore: ConversationStore;
  decisionPlanStore: DecisionPlanStore;
  runIndexStore: ConversationRunIndexStore;
}> {
  if (autoMigrate) await migrateRuntimeDatabase(databaseUrl);

  const conversationStore = await PostgresConversationStore.connect(databaseUrl, { migrate: false });
  try {
    const intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
    try {
      const userMessageStore = await PostgresIntentUserMessageStore.connect(databaseUrl, { migrate: false });
      try {
        const userPreferenceStore = await PostgresUserPreferenceStore.connect(databaseUrl);
        try {
          const runStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
          try {
            const baseApiControlStore = await PostgresApiRunControlStore.connect(databaseUrl, { migrate: false });
            try {
              const decisionPlanStore = await PostgresDecisionPlanStore.connect(databaseUrl, { migrate: false });
              try {
                const runIndexStore = await PostgresConversationRunIndexStore.connect(databaseUrl);
                const decisionPlanControl = new DecisionPlanRecordingApiRunControlStore(baseApiControlStore, decisionPlanStore);
                const apiControlStore = new ConversationRunIndexRecordingApiRunControlStore(decisionPlanControl, runIndexStore);
                return {
                  runStore,
                  apiControlStore,
                  intentStore,
                  userMessageStore,
                  userPreferenceStore,
                  conversationStore,
                  decisionPlanStore,
                  runIndexStore,
                };
              } catch (error) {
                await decisionPlanStore.close();
                throw error;
              }
            } catch (error) {
              await baseApiControlStore.close();
              throw error;
            }
          } catch (error) {
            await runStore.close();
            throw error;
          }
        } catch (error) {
          await userPreferenceStore.close();
          throw error;
        }
      } catch (error) {
        await userMessageStore.close();
        throw error;
      }
    } catch (error) {
      await intentStore.close();
      throw error;
    }
  } catch (error) {
    await conversationStore.close();
    throw error;
  }
}

export async function createRuntimeApp(
  config: RuntimeConfig,
  options: RuntimeAppOptions = {},
): Promise<FastifyInstance> {
  const truthPipeline = options.truthPipeline ?? createDefaultOfflineTruthPipeline();
  const memoryDispatchDelayMs = nonNegativeDelay(
    options.memoryDispatchDelayMs,
    DEFAULT_MEMORY_DISPATCH_DELAY_MS,
    "memoryDispatchDelayMs",
  );

  let runStore: RunStore;
  let apiControlStore: ApiRunControlStore;
  let intentStore: IntentAuthorityStore;
  let userMessageStore: IntentUserMessageStore;
  let userPreferenceStore: UserPreferenceStore;
  let conversationStore: ConversationStore;
  let decisionPlanStore: DecisionPlanStore;
  let runIndexStore: ConversationRunIndexStore;

  if (config.databaseUrl) {
    ({
      runStore,
      apiControlStore,
      intentStore,
      userMessageStore,
      userPreferenceStore,
      conversationStore,
      decisionPlanStore,
      runIndexStore,
    } = await connectPostgresRuntimeStores(config.databaseUrl, config.autoMigrate));
  } else {
    const memoryRunStore = new MemoryRunStore();
    const memoryIntentStore = new MemoryIntentAuthorityStore();
    const memoryUserMessageStore = new MemoryIntentUserMessageStore();
    const memoryUserPreferenceStore = new MemoryUserPreferenceStore();
    const memoryConversationStore = new MemoryConversationStore();
    const memoryDecisionPlanStore = new MemoryDecisionPlanStore(memoryIntentStore);
    const memoryRunIndexStore = new MemoryConversationRunIndexStore();
    const intentBoundRuns = new MemoryIntentBoundRunStore(memoryRunStore, memoryIntentStore);
    runStore = memoryRunStore;
    intentStore = memoryIntentStore;
    userMessageStore = memoryUserMessageStore;
    userPreferenceStore = memoryUserPreferenceStore;
    conversationStore = memoryConversationStore;
    decisionPlanStore = memoryDecisionPlanStore;
    runIndexStore = memoryRunIndexStore;
    const decisionPlanControl = new DecisionPlanRecordingApiRunControlStore(
      new DeferredMemoryApiRunControlStore(
        new MemoryApiRunControlStore(memoryRunStore, intentBoundRuns),
        memoryRunStore,
        truthPipeline,
        memoryDispatchDelayMs,
        createIntentAuthorityGeneralizedDecisionAdapter(memoryIntentStore, defaultCriterionCatalog),
      ),
      memoryDecisionPlanStore,
    );
    apiControlStore = new ConversationRunIndexRecordingApiRunControlStore(
      decisionPlanControl,
      memoryRunIndexStore,
    );
  }

  const localModelProviderBaseUrl = config.localModelProviderBaseUrl ?? config.modelSimulatorBaseUrl;
  const localModelProviderModel = config.localModelProviderModel ?? config.modelSimulatorModel;
  const modelRuntime = localModelProviderBaseUrl === undefined
    ? undefined
    : new LocalOfflineModelRuntime(new OpenAiCompatibleModelProvider({
        baseUrl: localModelProviderBaseUrl,
      }));
  const authenticatedApiSubject = (request: Parameters<typeof getAuthenticatedSubject>[0]): string =>
    getAuthenticatedSubject(request).subjectId;

  const app = buildApp({
    runStore,    truthPipeline,
    apiControlStore,
    apiSubject: authenticatedApiSubject,
    authoritativeConversationUi: true,
    ...(modelRuntime === undefined
      ? {}
      : { modelRuntime, modelName: localModelProviderModel }),
  });

  registerAuthenticatedSubjectBoundary(app, {
    resolveSubject: resolveAuthenticatedSubjectResolver(
      config,
      options.authenticatedSubjectResolver,
    ),
  });
  registerConversationApi(app, { conversationStore, runStore });
  registerDurableUserMessageHistory(app, { userMessageStore });
  registerConsultationIntake(app, {
    intentStore,
    userMessageStore,
    apiControlStore,
    runStore,
    apiSubject: authenticatedApiSubject,
  });
  registerRunEventStream(app, { runStore });
  registerDecisionPlanApi(app, { decisionPlanStore });
  registerConversationContinuityApi(app, {
    conversationStore,
    userMessageStore,
    runStore,
    runIndexStore,
    decisionPlanStore,
  });
  registerUserPreferenceControlsApi(app, {
    preferenceStore: userPreferenceStore,
    intentStore,
    userMessageStore,
  });
  app.addHook("onClose", async () => {
    await conversationStore.close();
    await userMessageStore.close();
    await userPreferenceStore.close();
    await intentStore.close();
  });

  if (config.androidModelRelayToken !== undefined) {
    const provider = new AndroidRelayModelProvider({
      timeoutMs: config.androidModelRelayTimeoutMs,
    });
    const androidRuntime = new ModelRuntime(provider, {
      timeoutMs: config.androidModelRelayTimeoutMs + 5_000,
    });
    registerAndroidModelPrototype(app, {
      provider,
      runtime: androidRuntime,
      modelName: config.androidModelRelayModel,
      relayToken: config.androidModelRelayToken,
    });
  }

  return app;
}
