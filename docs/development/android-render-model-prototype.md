# Android + Render local-model prototype

Status: development-only Product prototype reference.

Authority: Owner-approved prototype direction recorded in the Project conversation on 2026-08-26. This document does not alter V36 Truth Core, Lattice Decision Engine, Solandra Experience, production, security, cost, or Team authority.

## Objective

Exercise a real local LLM on Android while keeping the public prototype surface on Render's free development service.

The model remains local to Android. Render hosts only the transient Lattice control/UI process and an in-memory relay. Android initiates every network connection to Render, so the phone does not need an inbound public port or a third-party tunnel.

```text
Browser
  -> Render development-only Lattice service
  -> in-memory Android model relay job
  <- authenticated Android worker polls outbound over HTTPS
  -> Android worker
  -> http://127.0.0.1:8080/v1/chat/completions
  -> local OpenAI-compatible inference (for example llama.cpp)
  <- raw OpenAI-compatible response
  -> Render relay completion
  -> canonical Lattice Model Gateway / ModelRuntime validation
  -> transient Solandra Experience conversation-test response
```

## Nonclaims and boundaries

- This is not the durable `lattice-v36` deployment path.
- `LATTICE_DEPLOYMENT_MODE=durable` rejects Android relay configuration.
- The existing loopback simulator adapter remains loopback-only and is not widened to remote URLs.
- Relay jobs are in memory. A Render restart, cold start, deploy, timeout, or process loss can discard an active job.
- Android model output remains non-authoritative prototype material. It does not become V36 Truth Core evidence and cannot create or alter Lattice Decision Engine eligibility, ranking, or winner state.
- The prototype does not establish model quality, production readiness, privacy suitability for production data, or end-to-end acceptance.
- No paid model API, GPU service, persistent model store, or production resource is required by this slice.

## Render development service

Use a separate Render Free web service pointed at the prototype branch rather than changing the canonical durable `lattice-v36` Blueprint.

Required runtime configuration:

```text
HOST=0.0.0.0
LATTICE_DEPLOYMENT_MODE=development
LATTICE_TRUTH_MODE=v36-offline
LATTICE_AUTO_MIGRATE=false
LATTICE_ANDROID_MODEL_RELAY_TOKEN=<shared secret, 32-512 characters>
LATTICE_ANDROID_MODEL_RELAY_MODEL=android-local-prototype
LATTICE_ANDROID_MODEL_RELAY_TIMEOUT_MS=45000
```

Build command:

```bash
npm ci --no-audit --no-fund && npm run build
```

Start command:

```bash
npm start
```

Do not place the relay token in the repository, command history intended for sharing, screenshots, issues, PR comments, or chat. Set it directly in Render's environment and in the Android shell.

## Android inference process

Run an OpenAI-compatible local inference server bound only to loopback. Keep the llama.cpp REST alias equal to `LATTICE_ANDROID_MODEL_RELAY_MODEL` so the OpenAI-compatible `model` field is explicit and reproducible. Example:

```bash
llama-server \
  -m /path/to/model.gguf \
  --alias android-local-prototype \
  --host 127.0.0.1 \
  --port 8080
```

Choose the model and quantization only after measuring the actual Android device's available RAM, throughput, thermal behavior, and Lattice evaluation quality. Parameter count alone is not acceptance evidence.

## Android relay worker

In a second Termux/Ubuntu shell in the Lattice repository:

```bash
export LATTICE_ANDROID_RELAY_BASE_URL="https://<prototype-service>.onrender.com"
export LATTICE_ANDROID_RELAY_TOKEN="<same secret configured directly in Render>"
export LATTICE_ANDROID_LOCAL_MODEL_BASE_URL="http://127.0.0.1:8080/v1"
export LATTICE_ANDROID_LOCAL_MODEL_TIMEOUT_MS="40000"
npm run android:model-worker
```

The worker:

1. polls the authenticated Render relay for one queued model request;
2. forwards the provided OpenAI-compatible request only to a loopback Android endpoint;
3. bounds the local response to 512 KiB;
4. returns the raw HTTP status/body to Render;
5. lets the Product-owned `ModelRuntime` validate the canonical response;
6. reports local transport failure without sending raw prompts or credentials to logs.

Run the worker only during active prototype testing. It is not a durable Android background-service design, and continuous polling is not a production lifecycle strategy.

## First Product-observable probe

With the Render prototype service and Android worker both running:

1. open `https://<prototype-service>.onrender.com/android-llm`;
2. confirm the composer identifies replies as Android local-model prototype output, not verified evidence or an authoritative decision;
3. submit a unique message;
4. observe an Android worker job completion;
5. observe the exact local-model reply return in the browser;
6. stop the Android worker and submit another message;
7. verify the Product fails visibly and offers retry rather than fabricating a response or falling back to a remote provider.

Record the exact repository revision, Android hardware/runtime, inference engine revision, GGUF model identity/hash, model configuration, and observed result. A successful round trip validates only that exact prototype configuration and probe.
