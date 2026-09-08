from pathlib import Path

path = Path("src/solandra/action-preparer.ts")
text = path.read_text(encoding="utf-8")
for status in ("PREPARED", "INSUFFICIENT_BASIS", "FIDELITY_REJECTED"):
    text = text.replace(f'status: "{status}",', f'status: "{status}" as const,')
path.write_text(text, encoding="utf-8")
print("M3 compile-literal repair applied")
