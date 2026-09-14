from pathlib import Path

ROOT = Path.cwd()


def replace_exact(path: str, old: str, new: str, count: int = 1) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f"{path}: expected {count} occurrences, found {actual}: {old[:100]!r}")
    target.write_text(text.replace(old, new, count), encoding="utf-8")


# runtime-app.ts: compose the bounded store without changing cognition or domain authority.
replace_exact(
    "src/runtime-app.ts",
    'import {\n  MemoryConversationResponseStore,\n  PostgresConversationResponseStore,\n  type ConversationResponseStore,\n} from "./conversation/conversation-response-store.js";\n',
    'import {\n  MemoryConversationReferenceStore,\n  PostgresConversationReferenceStore,\n  type ConversationReferenceStore,\n} from "./conversation/conversation-reference-store.js";\nimport {\n  MemoryConversationResponseStore,\n  PostgresConversationResponseStore,\n  type ConversationResponseStore,\n} from "./conversation/conversation-response-store.js";\n',
)
replace_exact(
    "src/runtime-app.ts",
    '  conversationResponseStore?: ConversationResponseStore;\n  solandraCognition?: SolandraCognitiveRuntime;\n',
    '  conversationResponseStore?: ConversationResponseStore;\n  conversationReferenceStore?: ConversationReferenceStore;\n  solandraCognition?: SolandraCognitiveRuntime;\n',
)
replace_exact(
    "src/runtime-app.ts",
    '  await PostgresConversationStore.migrate(databaseUrl);\n  await PostgresConversationResponseStore.migrate(databaseUrl);\n',
    '  await PostgresConversationStore.migrate(databaseUrl);\n  await PostgresConversationResponseStore.migrate(databaseUrl);\n  await PostgresConversationReferenceStore.migrate(databaseUrl);\n',
)
replace_exact(
    "src/runtime-app.ts",
    '  let conversationStore: ConversationStore;\n  let conversationResponseStore: ConversationResponseStore;\n  let decisionPlanStore: DecisionPlanStore;\n',
    '  let conversationStore: ConversationStore;\n  let conversationResponseStore: ConversationResponseStore;\n  let conversationReferenceStore: ConversationReferenceStore;\n  let decisionPlanStore: DecisionPlanStore;\n',
)
replace_exact(
    "src/runtime-app.ts",
    '    } = await connectPostgresRuntimeStores(config.databaseUrl, config.autoMigrate));\n  } else {\n',
    '    } = await connectPostgresRuntimeStores(config.databaseUrl, config.autoMigrate));\n    conversationReferenceStore = options.conversationReferenceStore\n      ?? await PostgresConversationReferenceStore.connect(config.databaseUrl);\n  } else {\n',
)
replace_exact(
    "src/runtime-app.ts",
    '    const memoryConversationResponseStore = options.conversationResponseStore ?? new MemoryConversationResponseStore();\n    const memoryDecisionPlanStore = new MemoryDecisionPlanStore(memoryIntentStore);\n',
    '    const memoryConversationResponseStore = options.conversationResponseStore ?? new MemoryConversationResponseStore();\n    const memoryConversationReferenceStore = options.conversationReferenceStore ?? new MemoryConversationReferenceStore();\n    const memoryDecisionPlanStore = new MemoryDecisionPlanStore(memoryIntentStore);\n',
)
replace_exact(
    "src/runtime-app.ts",
    '    conversationStore = memoryConversationStore;\n    conversationResponseStore = memoryConversationResponseStore;\n    decisionPlanStore = memoryDecisionPlanStore;\n',
    '    conversationStore = memoryConversationStore;\n    conversationResponseStore = memoryConversationResponseStore;\n    conversationReferenceStore = memoryConversationReferenceStore;\n    decisionPlanStore = memoryDecisionPlanStore;\n',
)
replace_exact(
    "src/runtime-app.ts",
    '    conversationStore,\n    conversationResponseStore,\n    userMessageStore,\n',
    '    conversationStore,\n    conversationResponseStore,\n    conversationReferenceStore,\n    userMessageStore,\n',
    count=2,
)
replace_exact(
    "src/runtime-app.ts",
    '    await knowledgeStore.close();\n    await conversationResponseStore.close();\n',
    '    await knowledgeStore.close();\n    await conversationReferenceStore.close();\n    await conversationResponseStore.close();\n',
)

# continuity-api.ts: expose the general linkage while retaining legacy Knowledge references.
replace_exact(
    "src/conversation/continuity-api.ts",
    'import type { ConversationResponseStore } from "./conversation-response-store.js";\n',
    'import type { ConversationReferenceStore } from "./conversation-reference-store.js";\nimport type { ConversationResponseStore } from "./conversation-response-store.js";\n',
)
replace_exact(
    "src/conversation/continuity-api.ts",
    '  conversationResponseStore: ConversationResponseStore;\n  userMessageStore: IntentUserMessageStore;\n',
    '  conversationResponseStore: ConversationResponseStore;\n  conversationReferenceStore?: ConversationReferenceStore;\n  userMessageStore: IntentUserMessageStore;\n',
)
replace_exact(
    "src/conversation/continuity-api.ts",
    '      const [messages, conversationResponses, runIds, knowledge, references, recommendations, acceptedChoices] = await Promise.all([\n',
    '      const [messages, conversationResponses, conversationReferences, runIds, knowledge, references, recommendations, acceptedChoices] = await Promise.all([\n',
)
replace_exact(
    "src/conversation/continuity-api.ts",
    '        options.conversationResponseStore.listByConversation(conversationId),\n        options.runIndexStore.listRunIds(conversationId),\n',
    '        options.conversationResponseStore.listByConversation(conversationId),\n        options.conversationReferenceStore?.listByConversation(conversationId) ?? Promise.resolve([]),\n        options.runIndexStore.listRunIds(conversationId),\n',
)
replace_exact(
    "src/conversation/continuity-api.ts",
    '        references: references.map((reference) => ({\n          referenceId: reference.referenceId,\n          userMessageId: reference.userMessageId,\n          responseId: reference.responseId,\n          intentVersionId: reference.intentVersionId,\n          knowledgeId: reference.knowledgeId,\n          referenceKind: reference.referenceKind,\n          parentReferenceId: reference.parentReferenceId,\n          createdAt: reference.createdAt,\n        })),\n',
    '        references: references.map((reference) => ({\n          referenceId: reference.referenceId,\n          userMessageId: reference.userMessageId,\n          responseId: reference.responseId,\n          intentVersionId: reference.intentVersionId,\n          knowledgeId: reference.knowledgeId,\n          referenceKind: reference.referenceKind,\n          parentReferenceId: reference.parentReferenceId,\n          createdAt: reference.createdAt,\n        })),\n        conversationReferences: conversationReferences.map((reference) => ({\n          referenceId: reference.referenceId,\n          userMessageId: reference.userMessageId,\n          responseId: reference.responseId,\n          intentVersionId: reference.intentVersionId,\n          targets: reference.targets,\n          parentReferenceId: reference.parentReferenceId,\n          createdAt: reference.createdAt,\n        })),\n',
)

# consultation-intake.ts: record exact existing object identities; no new semantic interpretation.
replace_exact(
    "src/consultation-intake.ts",
    'import type { ConversationResponse, ConversationResponseStore } from "./conversation/conversation-response-store.js";\n',
    'import {\n  appendConversationReference,\n  type ConversationReferenceStore,\n  type ConversationReferenceTarget,\n} from "./conversation/conversation-reference-store.js";\nimport type { ConversationResponse, ConversationResponseStore } from "./conversation/conversation-response-store.js";\n',
)
replace_exact(
    "src/consultation-intake.ts",
    '  conversationResponseStore: ConversationResponseStore;\n  userMessageStore: IntentUserMessageStore;\n',
    '  conversationResponseStore: ConversationResponseStore;\n  conversationReferenceStore?: ConversationReferenceStore;\n  userMessageStore: IntentUserMessageStore;\n',
)
replace_exact(
    "src/consultation-intake.ts",
    'function stableUuid(...parts: string[]): `${string}-${string}-${string}-${string}-${string}` {\n  const digest = digestHex(...parts).slice(0, 32);\n  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;\n}\n\n',
    'function stableUuid(...parts: string[]): `${string}-${string}-${string}-${string}-${string}` {\n  const digest = digestHex(...parts).slice(0, 32);\n  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;\n}\n\nasync function recordConversationReference(\n  options: ConsultationIntakeOptions,\n  input: Parameters<typeof appendConversationReference>[1],\n): Promise<void> {\n  if (!options.conversationReferenceStore) return;\n  await appendConversationReference(options.conversationReferenceStore, input);\n}\n\nfunction governedResponseId(kind: string, ...parts: string[]): string {\n  return `governed_response_${digestHex(kind, ...parts).slice(0, 40)}`;\n}\n\nfunction producedRecommendationTargets(\n  recommendation: Parameters<typeof recommendationOptions>[0],\n): ConversationReferenceTarget[] {\n  return [\n    { kind: "RECOMMENDATION", targetId: recommendation.recommendationId, relation: "PRODUCED" },\n    ...recommendationOptions(recommendation).map((option) => ({\n      kind: "OPTION" as const,\n      targetId: option.optionId,\n      relation: "PRODUCED" as const,\n    })),\n  ];\n}\n\nasync function recordEstablishedKnowledgeReference(\n  options: ConsultationIntakeOptions,\n  established: Awaited<ReturnType<typeof establishKnowledge>>,\n): Promise<void> {\n  await recordConversationReference(options, {\n    conversationId: established.record.conversationId,\n    userMessageId: established.record.sourceMessageId,\n    responseId: established.reference.responseId,\n    intentVersionId: established.record.intentVersionId,\n    targets: [{ kind: "KNOWLEDGE", targetId: established.record.knowledgeId, relation: "PRODUCED" }],\n    createdAt: established.reference.createdAt,\n  });\n}\n\n',
)

# Option explanation: exact Recommendation + Option consumption.
replace_exact(
    "src/consultation-intake.ts",
    '        if (cognition.proposal.requestedHelp === "EXPLAIN_OPTION") {\n          return reply.status(200).send({\n',
    '        if (cognition.proposal.requestedHelp === "EXPLAIN_OPTION") {\n          await recordConversationReference(options, {\n            conversationId,\n            userMessageId: sourceMessage.messageId,\n            responseId: governedResponseId("option-reference", sourceMessage.messageId, loaded.record.recommendationId, option.optionId),\n            intentVersionId: currentVersion.intentVersionId,\n            targets: [\n              { kind: "RECOMMENDATION", targetId: loaded.record.recommendationId, relation: "CONSUMED" },\n              { kind: "OPTION", targetId: option.optionId, relation: "CONSUMED" },\n            ],\n            createdAt: sourceMessage.createdAt,\n          });\n          return reply.status(200).send({\n',
)

# AcceptedChoice: consuming the exact prior Recommendation/Option is separate from producing USER choice.
replace_exact(
    "src/consultation-intake.ts",
    '        } catch (error) {\n          const message = error instanceof Error ? error.message : "Accepted USER choice could not be preserved.";\n          return reply.status(409).send({ error: "ACCEPTED_CHOICE_CONFLICT", message });\n        }\n        return reply.status(200).send({\n          status: "ACCEPTED_CHOICE_ESTABLISHED",\n',
    '        } catch (error) {\n          const message = error instanceof Error ? error.message : "Accepted USER choice could not be preserved.";\n          return reply.status(409).send({ error: "ACCEPTED_CHOICE_CONFLICT", message });\n        }\n        await recordConversationReference(options, {\n          conversationId,\n          userMessageId: sourceMessage.messageId,\n          responseId: governedResponseId("accepted-choice", sourceMessage.messageId, acceptedChoice.acceptedChoiceId),\n          intentVersionId: currentVersion.intentVersionId,\n          targets: [\n            { kind: "RECOMMENDATION", targetId: loaded.record.recommendationId, relation: "CONSUMED" },\n            { kind: "OPTION", targetId: option.optionId, relation: "CONSUMED" },\n            { kind: "ACCEPTED_CHOICE", targetId: acceptedChoice.acceptedChoiceId, relation: "PRODUCED" },\n          ],\n          createdAt: sourceMessage.createdAt,\n        });\n        return reply.status(200).send({\n          status: "ACCEPTED_CHOICE_ESTABLISHED",\n',
)

# Historical Recommendation: exact prior object consumption only.
replace_exact(
    "src/consultation-intake.ts",
    '        const assistantMessage = cognition.proposal.requestedHelp === "SOURCES_RECOMMENDATION"\n          ? renderHistoricalRecommendationSources(loaded)\n          : renderHistoricalRecommendationExplanation(loaded);\n        return reply.status(200).send({\n',
    '        const assistantMessage = cognition.proposal.requestedHelp === "SOURCES_RECOMMENDATION"\n          ? renderHistoricalRecommendationSources(loaded)\n          : renderHistoricalRecommendationExplanation(loaded);\n        await recordConversationReference(options, {\n          conversationId,\n          userMessageId: sourceMessage.messageId,\n          responseId: governedResponseId("recommendation-reference", sourceMessage.messageId, loaded.record.recommendationId),\n          intentVersionId: currentVersion.intentVersionId,\n          targets: [{ kind: "RECOMMENDATION", targetId: loaded.record.recommendationId, relation: "CONSUMED" }],\n          createdAt: sourceMessage.createdAt,\n        });\n        return reply.status(200).send({\n',
)

# Historical Knowledge: retain the accepted Knowledge-specific reference and add the general linkage.
replace_exact(
    "src/consultation-intake.ts",
    '        const reference = await referenceKnowledge(options.knowledgeStore, {\n          knowledge: loaded.record,\n          userMessageId: sourceMessage.messageId,\n          intentVersionId: currentVersion.intentVersionId,\n          createdAt: sourceMessage.createdAt,\n        });\n        return reply.status(200).send({\n',
    '        const reference = await referenceKnowledge(options.knowledgeStore, {\n          knowledge: loaded.record,\n          userMessageId: sourceMessage.messageId,\n          intentVersionId: currentVersion.intentVersionId,\n          createdAt: sourceMessage.createdAt,\n        });\n        await recordConversationReference(options, {\n          conversationId,\n          userMessageId: sourceMessage.messageId,\n          responseId: reference.responseId,\n          intentVersionId: currentVersion.intentVersionId,\n          targets: [{ kind: "KNOWLEDGE", targetId: loaded.record.knowledgeId, relation: "CONSUMED" }],\n          createdAt: sourceMessage.createdAt,\n        });\n        return reply.status(200).send({\n',
)

# Run-free Recommendation establishment: durable production of Recommendation and its exact options.
replace_exact(
    "src/consultation-intake.ts",
    '          const recommendation = await establishConversationalRecommendation({\n            store: options.recommendationStore,\n            conversationId,\n            intentVersion: version,\n            sourceMessage,\n            knowledge: governed,\n            advisory: advisory.result,\n          });\n          return reply.status(200).send({\n',
    '          const recommendation = await establishConversationalRecommendation({\n            store: options.recommendationStore,\n            conversationId,\n            intentVersion: version,\n            sourceMessage,\n            knowledge: governed,\n            advisory: advisory.result,\n          });\n          await recordConversationReference(options, {\n            conversationId,\n            userMessageId: sourceMessage.messageId,\n            responseId: governedResponseId("recommendation-established", sourceMessage.messageId, recommendation.recommendationId),\n            intentVersionId: version.intentVersionId,\n            targets: producedRecommendationTargets(recommendation),\n            createdAt: recommendation.createdAt,\n          });\n          return reply.status(200).send({\n',
)

# Every established governed Knowledge object gets a general produced link in addition to legacy continuity.
replace_exact(
    "src/consultation-intake.ts",
    '      const established = await establishKnowledge(options.knowledgeStore, run, truth, outcome.knowledge);\n      const knowledgeReference = {\n',
    '      const established = await establishKnowledge(options.knowledgeStore, run, truth, outcome.knowledge);\n      await recordEstablishedKnowledgeReference(options, established);\n      const knowledgeReference = {\n',
)
replace_exact(
    "src/consultation-intake.ts",
    '    const established = await establishKnowledge(options.knowledgeStore, run, truth, outcome);\n    const knowledgeReference = {\n',
    '    const established = await establishKnowledge(options.knowledgeStore, run, truth, outcome);\n    await recordEstablishedKnowledgeReference(options, established);\n    const knowledgeReference = {\n',
)
replace_exact(
    "src/consultation-intake.ts",
    '        const continuationEstablished = await establishKnowledge(\n          options.knowledgeStore,\n          continuationRun,\n          continuationTruth,\n          continuationOutcome,\n        );\n        const continuationKnowledge = await loadKnowledge(\n',
    '        const continuationEstablished = await establishKnowledge(\n          options.knowledgeStore,\n          continuationRun,\n          continuationTruth,\n          continuationOutcome,\n        );\n        await recordEstablishedKnowledgeReference(options, continuationEstablished);\n        const continuationKnowledge = await loadKnowledge(\n',
)

# PreparedResource: exact Knowledge use and resource production, still never authorization.
replace_exact(
    "src/consultation-intake.ts",
    '      const preparedOutcome = {\n        ...outcome,\n        resource: preparedResourceFromRecord(prepared),\n      };\n      return reply.send({\n',
    '      const preparedOutcome = {\n        ...outcome,\n        resource: preparedResourceFromRecord(prepared),\n      };\n      await recordConversationReference(options, {\n        conversationId: run.conversationId,\n        userMessageId: run.request.sourceMessageId,\n        responseId: governedResponseId("prepared-resource", run.id, prepared.resourceId),\n        intentVersionId: prepared.intentVersionId,\n        targets: [\n          ...prepared.knowledgeIds.map((knowledgeId) => ({\n            kind: "KNOWLEDGE" as const,\n            targetId: knowledgeId,\n            relation: "CONSUMED" as const,\n          })),\n          { kind: "PREPARED_RESOURCE", targetId: prepared.resourceId, relation: "PRODUCED" },\n        ],\n        createdAt: prepared.createdAt,\n      });\n      return reply.send({\n',
)

# Run-backed Recommendation production.
replace_exact(
    "src/consultation-intake.ts",
    '      const recommendation = await establishRecommendation({\n        store: options.recommendationStore,\n        run,\n        intentVersion,\n        knowledge: governedKnowledge,\n        advisory: advisory.result,\n      });\n      return reply.send({\n',
    '      const recommendation = await establishRecommendation({\n        store: options.recommendationStore,\n        run,\n        intentVersion,\n        knowledge: governedKnowledge,\n        advisory: advisory.result,\n      });\n      await recordConversationReference(options, {\n        conversationId: run.conversationId,\n        userMessageId: run.request.sourceMessageId,\n        responseId: governedResponseId("recommendation-established", run.id, recommendation.recommendationId),\n        intentVersionId: recommendation.intentVersionId,\n        targets: producedRecommendationTargets(recommendation),\n        createdAt: recommendation.createdAt,\n      });\n      return reply.send({\n',
)

print("ISSUE91_CONVERSATION_REFERENCE_PATCH=APPLIED")
