from pathlib import Path

for path in (
    Path("src/knowledge/wikimedia-acquisition.ts"),
    Path("src/truth/knowledge-acquisition-pipeline.ts"),
):
    text = path.read_text()
    updated = text.replace("  type KnowledgeAcquisitionPartialReason,\n", "  KnowledgeAcquisitionPartialReason,\n")
    updated = updated.replace("  type KnowledgeAcquisitionCompletion,\n", "  KnowledgeAcquisitionCompletion,\n")
    if updated == text:
        raise RuntimeError(f"{path}: expected redundant import type modifier")
    path.write_text(updated)

print("ISSUE91_IMPORT_FIX_APPLIED")
