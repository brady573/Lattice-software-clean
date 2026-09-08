from pathlib import Path

path = Path("src/consultation-intake.ts")
text = path.read_text(encoding="utf-8")
old = '''        const governed = await recentGovernedKnowledge(\n          options.knowledgeStore,\n          options.runStore,\n          run.conversationId,\n          4,\n        );\n        let generated;'''
new = '''        const recent = await recentGovernedKnowledge(\n          options.knowledgeStore,\n          options.runStore,\n          run.conversationId,\n          4,\n        );\n        const priorGoverned = recent.filter((item) => item.record.runId !== run.id);\n        const currentGoverned = priorGoverned.length === 0\n          ? await loadKnowledge(options.knowledgeStore, options.runStore, established.record.knowledgeId)\n          : undefined;\n        const governed = priorGoverned.length > 0\n          ? priorGoverned\n          : currentGoverned\n            ? [currentGoverned]\n            : [];\n        if (governed.length === 0) {\n          return reply.status(409).send({ error: "ACTION_PREPARATION_KNOWLEDGE_UNAVAILABLE" });\n        }\n        let generated;'''
if text.count(old) != 1:
    raise SystemExit(f"expected one M3 governed basis block, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("M3 historical Knowledge continuity repair applied")
