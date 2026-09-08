from pathlib import Path

ui = Path("src/ui/solandra-conversation-page.ts")
text = ui.read_text()

replacements = [
    (
        '''      const persistDraft = (value) => {\n        if (value.length > 0) storageSet(STORAGE.draft, value);\n        else storageRemove(STORAGE.draft);\n      };\n      const restoreDraft = () => {\n        const draft = storageGet(STORAGE.draft);\n        if (draft !== null && !input.value) input.value = draft;\n      };\n      const clearDraftIfSame = (value) => {\n        if (input.value === value) input.value = \"\";\n        if (storageGet(STORAGE.draft) === value) storageRemove(STORAGE.draft);\n      };\n''',
        '''      const readDraft = () => {\n        const record = readRecord(STORAGE.draft);\n        return record\n          && typeof record.conversationId === \"string\"\n          && typeof record.value === \"string\"\n          ? record\n          : null;\n      };\n      const persistDraft = (value) => {\n        const id = conversationId || storageGet(STORAGE.conversation);\n        if (value.length > 0 && id) writeRecord(STORAGE.draft, { conversationId: id, value });\n        else if (value.length === 0) storageRemove(STORAGE.draft);\n      };\n      const restoreDraftForConversation = (id) => {\n        const draft = readDraft();\n        if (draft?.conversationId === id && !input.value) input.value = draft.value;\n      };\n      const clearDraftIfSame = (value) => {\n        if (input.value === value) input.value = \"\";\n        const draft = readDraft();\n        if (draft?.conversationId === conversationId && draft.value === value) storageRemove(STORAGE.draft);\n      };\n''',
        "draft helper",
    ),
    (
        '''        clearPendingTurn(record.turnId);\n        clearDraftIfSame(record.message);\n        await handleTurnResponse(body, record);\n''',
        '''        clearDraftIfSame(record.message);\n        await handleTurnResponse(body, record);\n        clearPendingTurn(record.turnId);\n''',
        "accepted-turn handoff",
    ),
    (
        '''        const clarification = readClarification();\n        if (clarification?.conversationId === id) storageRemove(STORAGE.clarification);\n        if (conversationId === id) conversationId = null;\n''',
        '''        const clarification = readClarification();\n        if (clarification?.conversationId === id) storageRemove(STORAGE.clarification);\n        const draft = readDraft();\n        if (draft?.conversationId === id) storageRemove(STORAGE.draft);\n        if (conversationId === id) conversationId = null;\n''',
        "ownership purge",
    ),
    (
        '''        recovering = true;\n        restoreDraft();\n        try {\n''',
        '''        recovering = true;\n        try {\n''',
        "early draft restore",
    ),
    (
        '''          } catch {\n            appendSolandraTurn(\"I couldn't reconnect to your saved conversation yet. Your draft is still here, and I won't start duplicate work.\");\n            return;\n          }\n          if (continuityResponse.status === 404) {\n            clearStoredConversationState(storedId);\n            appendSolandraTurn(\"I couldn't recover that saved conversation for this signed-in user. Your draft is still here.\");\n            return;\n          }\n          if (!continuityResponse.ok) {\n            appendSolandraTurn(\"I couldn't reconnect to your saved conversation yet. Your draft is still here, and I won't start duplicate work.\");\n            return;\n          }\n          const continuity = await continuityResponse.json();\n          setConversation(storedId);\n          rebuildConversation(continuity);\n''',
        '''          } catch {\n            appendSolandraTurn(\"I couldn't reconnect to your saved conversation yet. I won't start duplicate work while recovery is uncertain.\");\n            return;\n          }\n          if (continuityResponse.status === 404) {\n            clearStoredConversationState(storedId);\n            appendSolandraTurn(\"I couldn't recover that saved conversation for this signed-in user.\");\n            return;\n          }\n          if (!continuityResponse.ok) {\n            appendSolandraTurn(\"I couldn't reconnect to your saved conversation yet. I won't start duplicate work while recovery is uncertain.\");\n            return;\n          }\n          const continuity = await continuityResponse.json();\n          setConversation(storedId);\n          rebuildConversation(continuity);\n          restoreDraftForConversation(storedId);\n''',
        "subject revalidation",
    ),
    (
        '''      void recoverSession()\n        .catch(() => appendSolandraTurn(\"I couldn't reconnect yet. Your draft is still here, and I won't start duplicate work.\"))\n''',
        '''      void recoverSession()\n        .catch(() => appendSolandraTurn(\"I couldn't reconnect yet. I won't start duplicate work while recovery is uncertain.\"))\n''',
        "startup recovery language",
    ),
]

for old, new, label in replacements:
    if text.count(old) != 1:
        raise SystemExit(f"{label} anchor mismatch")
    text = text.replace(old, new)

ui.write_text(text)

test = Path("test/a5-solandra-recovery-continuity.test.ts")
text = test.read_text()

old = '''  assert.match(html, /body: JSON\\.stringify\\(\\{ turnId: record\\.turnId, message: record\\.message \\}\\)/u);\n  assert.match(html, /\\/continuity/u);\n'''
new = '''  assert.match(html, /body: JSON\\.stringify\\(\\{ turnId: record\\.turnId, message: record\\.message \\}\\)/u);\n  assert.match(html, /clearDraftIfSame\\(record\\.message\\);[\\s\\S]*await handleTurnResponse\\(body, record\\);[\\s\\S]*clearPendingTurn\\(record\\.turnId\\);/u);\n  assert.doesNotMatch(html, /clearPendingTurn\\(record\\.turnId\\);[\\s\\S]*await handleTurnResponse\\(body, record\\);/u);\n  assert.match(html, /\\/continuity/u);\n'''
if text.count(old) != 1:
    raise SystemExit("focused handoff assertion anchor mismatch")
text = text.replace(old, new)

old = '''  assert.doesNotMatch(html, /worker status|queue status|provider status|retry epoch/iu);\n});\n\ntest(\"one logical USER turn identity replays to one durable USER message and one Run\", async () => {\n'''
new = '''  assert.doesNotMatch(html, /worker status|queue status|provider status|retry epoch/iu);\n});\n\ntest(\"browser keeps accepted logical-turn recovery identity until active-work handoff is established\", async () => {\n  const html = renderSolandraConversationPage();\n  assert.match(html, /clearDraftIfSame\\(record\\.message\\);[\\s\\S]*await handleTurnResponse\\(body, record\\);[\\s\\S]*clearPendingTurn\\(record\\.turnId\\);/u);\n\n  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 250 });\n  try {\n    const conversationId = await createConversation(app);\n    const turnId = \"a5-accepted-handoff-turn\";\n    const message = \"Investigate this accepted handoff without duplicating it.\";\n\n    const accepted = await submitTurn(app, conversationId, turnId, message);\n    assert.equal(accepted.statusCode, 202, accepted.body);\n    const first = accepted.json<{ runId: string; intentVersionId: string; provenance: { messageId: string } }>();\n\n    // Simulate reload at the exact client-side handoff boundary after durable\n    // acceptance but before active-work storage has been established.\n    const recovered = await submitTurn(app, conversationId, turnId, message);\n    assert.equal(recovered.statusCode, 202, recovered.body);\n    const replay = recovered.json<{ runId: string; intentVersionId: string; provenance: { messageId: string } }>();\n    assert.deepEqual(replay, first);\n\n    const continuity = await app.inject({\n      method: \"GET\",\n      url: `/api/v1/conversations/${encodeURIComponent(conversationId)}/continuity`,\n    });\n    assert.equal(continuity.statusCode, 200, continuity.body);\n    const state = continuity.json<{ messages: Array<{ id: string }>; runs: Array<{ runId: string }> }>();\n    assert.equal(state.messages.length, 1);\n    assert.equal(state.messages[0]?.id, first.provenance.messageId);\n    assert.equal(state.runs.length, 1);\n    assert.equal(state.runs[0]?.runId, first.runId);\n  } finally {\n    await app.close();\n  }\n});\n\ntest(\"draft recovery is conversation-bound and waits for subject-owned continuity before showing USER text\", () => {\n  const html = renderSolandraConversationPage();\n  assert.match(html, /writeRecord\\(STORAGE\\.draft, \\{ conversationId: id, value \\}\\)/u);\n  assert.match(html, /const draft = readDraft\\(\\);[\\s\\S]*if \\(draft\\?\\.conversationId === id\\) storageRemove\\(STORAGE\\.draft\\);/u);\n  assert.match(html, /const continuity = await continuityResponse\\.json\\(\\);[\\s\\S]*setConversation\\(storedId\\);[\\s\\S]*rebuildConversation\\(continuity\\);[\\s\\S]*restoreDraftForConversation\\(storedId\\);/u);\n  assert.doesNotMatch(html, /recovering = true;\\s*restoreDraft/u);\n  assert.doesNotMatch(html, /couldn't recover that saved conversation[^\\n]*draft is still here/iu);\n});\n\ntest(\"one logical USER turn identity replays to one durable USER message and one Run\", async () => {\n'''
if text.count(old) != 1:
    raise SystemExit("focused regression insertion anchor mismatch")
text = text.replace(old, new)

old = '''    assert.equal(cancel.statusCode, 404);\n  } finally {\n'''
new = '''    assert.equal(cancel.statusCode, 404);\n\n    const html = renderSolandraConversationPage();\n    assert.match(html, /if \\(continuityResponse\\.status === 404\\) \\{[\\s\\S]*clearStoredConversationState\\(storedId\\);[\\s\\S]*return;/u);\n    assert.match(html, /const draft = readDraft\\(\\);[\\s\\S]*if \\(draft\\?\\.conversationId === id\\) storageRemove\\(STORAGE\\.draft\\);/u);\n  } finally {\n'''
if text.count(old) != 1:
    raise SystemExit("subject isolation assertion anchor mismatch")
text = text.replace(old, new)

test.write_text(text)
