# Local model A/B benchmark

Status: development/research tooling. This benchmark does not define Lattice Product acceptance and does not make model output authoritative.

## Purpose

Compare local models for the intended Lattice black-box/web-agent role using the same deterministic scenarios and the same Windows/llama.cpp execution conditions.

The first bounded comparison is:

- Qwen3.5-9B Q6_K
- Qwen3-14B Q5_K_M

Correctness is the primary discriminator. If deterministic pass rates tie, latency establishes a preference only when mean, p50, and p95 all favor the same model; otherwise the comparison remains a tie. A result is evidence only for the exact model artifact, quantization, llama.cpp runtime, context configuration, hardware, suite revision, and run conditions used.

## Benchmark suite

`benchmarks/local-model-agent-v1.json` covers:

- black-box evidence-boundary classification;
- cheapest discriminating black-box probe selection;
- structured action JSON;
- source provenance selection;
- untrusted-web prompt-injection handling;
- a real OpenAI-compatible `web_search` tool-call contract.

Exact-string checks in this suite are deliberate benchmark diagnostics. They do not promote exact-string behavior into Lattice Product requirements. Expected structured values must be stated by the scenario rather than hidden only in the scorer.

## Safety boundary

The runner accepts only an HTTP(S) loopback OpenAI-compatible base URL. It does not connect to Render, production, GitHub, a database, or arbitrary remote model endpoints.

The benchmark sends `temperature: 0` and `chat_template_kwargs.enable_thinking=false` to keep the first comparison controlled and consistent with the existing local-model prototype configuration.

## Reconcile and checkout

Run the benchmark from the exact benchmark branch/revision supplied by the development handoff. Before interpreting results, record:

```powershell
git rev-parse HEAD
node --version
npm --version
llama --version
nvidia-smi
```

Keep this output with both model reports. The benchmark JSON contains request/result metrics, while these commands establish the execution environment and GPU/runtime provenance.

## Install dependencies and validate the harness

```powershell
npm ci --no-audit --no-fund
npm run check
```

Do not run the model comparison if the exact checked-out harness revision fails its deterministic validation.

## Model A — Qwen3.5-9B Q6_K

Use a Q6_K GGUF derived from the official `Qwen/Qwen3.5-9B` weights. The selected Q6_K artifact should be recorded by exact Hugging Face repository/revision or local file SHA-256 before interpreting the comparison.

A current reproducible candidate is `Ciel0HF/Qwen3.5-9B-GGUF:Q6_K`, whose repository records the source revision and llama.cpp conversion provenance.

Start the server in a dedicated PowerShell window:

```powershell
llama serve `
  -hf Ciel0HF/Qwen3.5-9B-GGUF:Q6_K `
  --alias qwen35-9b-q6k `
  --host 127.0.0.1 `
  --port 8080 `
  --ctx-size 16384 `
  -ngl 99
```

Wait until:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/health
```

reports healthy.

Create the output directory and execute three repeats per scenario:

```powershell
New-Item -ItemType Directory -Force .local-bench | Out-Null

npm run benchmark:local-model -- run `
  --base-url http://127.0.0.1:8080/v1 `
  --model qwen35-9b-q6k `
  --label "Qwen3.5-9B Q6_K | ctx=16384" `
  --repeat 3 `
  --output .local-bench/qwen35-9b-q6k.json
```

Stop the llama.cpp server before loading Model B. Do not attempt to keep both models resident simultaneously on a 16 GB GPU for this comparison.

## Model B — Qwen3-14B Q5_K_M

The official `Qwen/Qwen3-14B-GGUF` repository provides `Qwen3-14B-Q5_K_M.gguf`.

Start the second model under the same conditions:

```powershell
llama serve `
  -hf Qwen/Qwen3-14B-GGUF:Q5_K_M `
  --alias qwen3-14b-q5km `
  --host 127.0.0.1 `
  --port 8080 `
  --ctx-size 16384 `
  -ngl 99
```

Verify health, then run:

```powershell
npm run benchmark:local-model -- run `
  --base-url http://127.0.0.1:8080/v1 `
  --model qwen3-14b-q5km `
  --label "Qwen3-14B Q5_K_M | ctx=16384" `
  --repeat 3 `
  --output .local-bench/qwen3-14b-q5km.json
```

If the 14B model cannot load fully on GPU at 16K context, record the failure before changing conditions. Do not silently offload or reduce context and compare the changed run as though the environments were equivalent. A follow-up matched-condition experiment can use a lower context size or controlled offload for both models.

## Compare

```powershell
npm run benchmark:local-model -- compare `
  --left .local-bench/qwen35-9b-q6k.json `
  --right .local-bench/qwen3-14b-q5km.json
```

The comparison rule is intentionally conservative:

1. higher deterministic pass rate wins;
2. if correctness ties, a latency winner requires lower mean, p50, and p95 latency;
3. if those latency metrics do not all favor the same model, the result remains `TIE`.

Do not force a model choice from a small or inconsistent latency difference. The output includes an explicit evidence boundary stating that the result does not establish Lattice Product acceptance or general model superiority.

## Preserve artifacts

Keep these together for a valid research comparison:

- exact Lattice benchmark revision (`git rev-parse HEAD`);
- suite file and suite ID;
- both JSON reports;
- `llama --version`;
- `nvidia-smi` output;
- exact GGUF repository/revision or local file SHA-256;
- context size and any GPU-offload/cache flags;
- any load failure, timeout, or OOM output.

## Troubleshooting

### `Benchmark base URL must be an HTTP(S) loopback URL`

Expected. The research runner is intentionally local-only. Use `127.0.0.1` or `localhost`.

### `/v1/models` does not show the requested alias

The alias in `--model` must match the server model identity. Restart llama.cpp with the documented `--alias` or pass the model name actually exposed by `/v1/models`.

### 14B fails to load or reports CUDA out of memory

Preserve the failure as evidence. First verify no other GPU-heavy application is consuming VRAM. If a second experiment is required, reduce `--ctx-size` equally for both candidates or use the same controlled KV/offload configuration for both. Do not compare mismatched runtime conditions without labeling the mismatch.

### Tool-call scenario returns text instead of `tool_calls`

That scenario should fail. The intended agent role needs an OpenAI-compatible structured tool-call path; a conversational claim that it would search the web is not equivalent.

### Structured JSON includes markdown fences

That scenario should fail because the future controller needs machine-consumable structured proposals.

### One model times out

The attempt is recorded as a failed benchmark result. Do not delete the timeout from the report. Increase the timeout only in a new, equivalently configured run for both models.

### Exact-content scenarios fail with extra prose

That is a benchmark diagnostic failure, not a Lattice Product acceptance failure. It measures control-following under this specific agent workload.

## Research interpretation

The benchmark is intentionally small and discriminating. It is not a general intelligence benchmark. A winning model becomes the preferred candidate for the next bounded Lattice local-agent experiment; a `TIE` means this workload does not justify selecting one model over the other. Broader adoption still requires exact Product-relevant validation under the applicable Work Item.
