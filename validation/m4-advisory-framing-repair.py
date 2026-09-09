from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match in {path}, found {count}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "src/solandra/advisory.ts",
    '''function parseJsonObject(text: string, label = "Solandra advisory reasoning"): unknown {\n  const trimmed = text.trim();\n  const unfenced = /^```(?:json)?\\s*([\\s\\S]*?)\\s*```$/iu.exec(trimmed)?.[1] ?? trimmed;\n  try {\n    return JSON.parse(unfenced);\n  } catch (error) {\n    throw new ModelProviderError("invalid_output", `${label} returned malformed JSON.`, { cause: error });\n  }\n}\n''',
    '''function parseJsonObject(text: string, label = "Solandra advisory reasoning"): unknown {\n  const trimmed = text.trim();\n  const unfenced = /^```(?:json)?\\s*([\\s\\S]*?)\\s*```$/iu.exec(trimmed)?.[1] ?? trimmed;\n  let parsed: unknown;\n  try {\n    parsed = JSON.parse(unfenced);\n  } catch (error) {\n    throw new ModelProviderError("invalid_output", `${label} returned malformed JSON.`, { cause: error });\n  }\n  if (!Array.isArray(parsed)) return parsed;\n  if (\n    parsed.length === 1\n    && parsed[0] !== null\n    && typeof parsed[0] === "object"\n    && !Array.isArray(parsed[0])\n  ) {\n    return parsed[0];\n  }\n  throw new ModelProviderError(\n    "invalid_output",\n    `${label} must return exactly one JSON object.`,\n  );\n}\n''',
)

p = Path("test/m2-solandra-advisory-spine.test.ts")
text = p.read_text()
append = r'''

class SingleObjectArrayGroundingProvider implements ModelProvider {
  readonly kind = "m4-single-object-array-grounding-provider";
  calls = 0;

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls += 1;
    const system = request.messages[0]?.content ?? "";
    const text = system.includes("bounded grounding verifier")
      ? JSON.stringify([{ status: "GROUNDED", unsupportedExternalPremises: [], knowledgeNeeds: [] }])
      : JSON.stringify({
        status: "RECOMMENDATION",
        recommendation: "Prefer the approach that best fits the USER's stated maintenance preference.",
        basis: [{ knowledgeId: "knowledge-supplied", claimIds: ["claim-supplied"] }],
        rationale: [FINDING],
        tradeoffs: [],
        assumptions: ["The USER's stated preference remains controlling."],
        uncertainties: ["Material uncertainty remains."],
        preservedUncertainties: ["Material uncertainty remains."],
        alternatives: [],
      });
    return {
      response: { id: `m4-array-${this.calls}`, model: request.model, output: [{ type: "text", text }] },
      route: { actualProvider: this.kind, actualModel: request.model, upstreamRequestId: `m4-array-${this.calls}` },
    };
  }
}

class MultipleObjectArrayGroundingProvider implements ModelProvider {
  readonly kind = "m4-multiple-object-array-grounding-provider";
  calls = 0;

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls += 1;
    const system = request.messages[0]?.content ?? "";
    const text = system.includes("bounded grounding verifier")
      ? JSON.stringify([
        { status: "GROUNDED", unsupportedExternalPremises: [], knowledgeNeeds: [] },
        { status: "GROUNDED", unsupportedExternalPremises: [], knowledgeNeeds: [] },
      ])
      : JSON.stringify({
        status: "RECOMMENDATION",
        recommendation: "Prefer the approach that best fits the USER's stated maintenance preference.",
        basis: [{ knowledgeId: "knowledge-supplied", claimIds: ["claim-supplied"] }],
        rationale: [FINDING],
        tradeoffs: [],
        assumptions: ["The USER's stated preference remains controlling."],
        uncertainties: ["Material uncertainty remains."],
        preservedUncertainties: ["Material uncertainty remains."],
        alternatives: [],
      });
    return {
      response: { id: `m4-array-multi-${this.calls}`, model: request.model, output: [{ type: "text", text }] },
      route: { actualProvider: this.kind, actualModel: request.model, upstreamRequestId: `m4-array-multi-${this.calls}` },
    };
  }
}

test("ModelSolandraAdvisoryRuntime tolerates one-object JSON array framing while preserving strict grounding schema", async () => {
  const provider = new SingleObjectArrayGroundingProvider();
  const runtime = new ModelSolandraAdvisoryRuntime(new ModelRuntime(provider), "m4-grounding-framing-model");
  const result = await runtime.advise(contractAdvisoryInput());
  assert.equal(provider.calls, 2);
  assert.equal(result.result.status, "RECOMMENDATION");
});

test("ModelSolandraAdvisoryRuntime rejects multi-object JSON array framing", async () => {
  const provider = new MultipleObjectArrayGroundingProvider();
  const runtime = new ModelSolandraAdvisoryRuntime(new ModelRuntime(provider), "m4-grounding-framing-model");
  await assert.rejects(
    runtime.advise(contractAdvisoryInput()),
    /must return exactly one JSON object/iu,
  );
});
'''
if "SingleObjectArrayGroundingProvider" in text:
    raise SystemExit("framing regression already present")
p.write_text(text + append)
print("M4 advisory framing repair applied")
