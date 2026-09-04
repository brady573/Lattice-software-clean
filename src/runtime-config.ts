export type DeploymentMode = "development" | "durable";
/** Runtime truth capability only; Product decision criteria are supplied by qualified adapters. */
export type TruthMode = "v36-offline" | "v36-live";
export type AuthenticationMode = "development-fixture" | "required";

export interface RuntimeConfig {
  port: number;
  host: string;
  databaseUrl: string | undefined;
  deploymentMode: DeploymentMode;
  truthMode: TruthMode;
  /** Omitted only by older programmatic development fixtures; resolved config always sets it. */
  authenticationMode?: AuthenticationMode;
  /** Development-only fixture identity; resolved config sets it only in development-fixture mode. */
  developmentFixtureSubjectId?: string;
  autoMigrate: boolean;
  /** First-class zero-cost development provider. Omitted only by older programmatic fixtures. */
  localModelProviderBaseUrl?: string | undefined;
  /** First-class local model identifier. Omitted only by older programmatic fixtures. */
  localModelProviderModel?: string;
  /** @deprecated Compatibility alias for older development configuration. */
  modelSimulatorBaseUrl: string | undefined;
  /** @deprecated Compatibility alias for older development configuration. */
  modelSimulatorModel: string;
  androidModelRelayToken: string | undefined;
  androidModelRelayModel: string;
  androidModelRelayTimeoutMs: number;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected boolean environment value, received: ${value}`);
}

function parseLocalModelProviderBaseUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const normalized = value.trim();
  const url = new URL(normalized);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL must use HTTP or HTTPS.");
  }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!loopbackHosts.has(url.hostname)) {
    throw new Error("LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL must resolve to a loopback host.");
  }
  return normalized.replace(/\/+$/, "");
}

function parseModelName(
  value: string | undefined,
  fallback: string,
  variableName: string,
): string {
  const model = value?.trim() || fallback;
  if (model.length > 128) {
    throw new Error(`${variableName} exceeds 128 characters.`);
  }
  return model;
}

function resolveLocalModelProvider(
  env: NodeJS.ProcessEnv,
): { baseUrl: string | undefined; model: string } {
  const modernConfigured = env.LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL !== undefined
    || env.LATTICE_LOCAL_MODEL_PROVIDER_MODEL !== undefined;
  const legacyConfigured = env.LATTICE_MODEL_SIMULATOR_BASE_URL !== undefined
    || env.LATTICE_MODEL_SIMULATOR_MODEL !== undefined;

  if (modernConfigured && legacyConfigured) {
    throw new Error(
      "Configure LATTICE_LOCAL_MODEL_PROVIDER_* or legacy LATTICE_MODEL_SIMULATOR_*, not both.",
    );
  }

  const baseUrlValue = modernConfigured
    ? env.LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL
    : env.LATTICE_MODEL_SIMULATOR_BASE_URL;
  const modelValue = modernConfigured
    ? env.LATTICE_LOCAL_MODEL_PROVIDER_MODEL
    : env.LATTICE_MODEL_SIMULATOR_MODEL;

  return {
    baseUrl: parseLocalModelProviderBaseUrl(baseUrlValue),
    model: parseModelName(
      modelValue,
      "offline-prototype",
      modernConfigured ? "LATTICE_LOCAL_MODEL_PROVIDER_MODEL" : "LATTICE_MODEL_SIMULATOR_MODEL",
    ),
  };
}

function parseAndroidRelayToken(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  if (value.trim().length === 0) {
    throw new Error("LATTICE_ANDROID_MODEL_RELAY_TOKEN must not be blank.");
  }
  if (value.length < 32 || value.length > 512) {
    throw new Error("LATTICE_ANDROID_MODEL_RELAY_TOKEN must contain between 32 and 512 characters.");
  }
  return value;
}

function parseAndroidRelayTimeout(value: string | undefined): number {
  const timeoutMs = Number.parseInt(value ?? "45000", 10);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 115_000) {
    throw new Error("LATTICE_ANDROID_MODEL_RELAY_TIMEOUT_MS must be an integer between 1000 and 115000.");
  }
  return timeoutMs;
}

function parseAuthenticationMode(
  value: string | undefined,
  deploymentMode: DeploymentMode,
): AuthenticationMode {
  const mode = value ?? (deploymentMode === "development" ? "development-fixture" : "required");
  if (mode !== "development-fixture" && mode !== "required") {
    throw new Error(`Unsupported LATTICE_AUTHENTICATION_MODE: ${mode}`);
  }
  if (deploymentMode !== "development" && mode === "development-fixture") {
    throw new Error("Development fixture authentication cannot be enabled in durable deployment mode.");
  }
  return mode;
}

function parseDevelopmentFixtureSubjectId(
  value: string | undefined,
  authenticationMode: AuthenticationMode,
): string | undefined {
  if (authenticationMode !== "development-fixture") {
    if (value !== undefined) {
      throw new Error("LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID requires development-fixture authentication mode.");
    }
    return undefined;
  }

  const subjectId = (value ?? "fixture-user").trim();
  if (!subjectId || subjectId.length > 200) {
    throw new Error("LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID must contain between 1 and 200 non-whitespace characters.");
  }
  return subjectId;
}

export function resolveRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const port = Number.parseInt(env.PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT ?? "3000"}`);
  }

  const deploymentMode = (env.LATTICE_DEPLOYMENT_MODE ?? "development") as DeploymentMode;
  if (deploymentMode !== "development" && deploymentMode !== "durable") {
    throw new Error(`Unsupported LATTICE_DEPLOYMENT_MODE: ${deploymentMode}`);
  }

  const truthMode = env.LATTICE_TRUTH_MODE ?? "v36-offline";
  if (truthMode !== "v36-offline" && truthMode !== "v36-live") {
    throw new Error(`Unsupported LATTICE_TRUTH_MODE: ${truthMode}`);
  }

  const databaseUrl = env.DATABASE_URL;
  if (deploymentMode === "durable" && !databaseUrl) {
    throw new Error("Durable deployment requires DATABASE_URL; refusing to fall back to in-memory state.");
  }

  const authenticationMode = parseAuthenticationMode(
    env.LATTICE_AUTHENTICATION_MODE,
    deploymentMode,
  );
  const developmentFixtureSubjectId = parseDevelopmentFixtureSubjectId(
    env.LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID,
    authenticationMode,
  );

  const autoMigrate = parseBoolean(
    env.LATTICE_AUTO_MIGRATE,
    deploymentMode === "development",
  );
  const localModelProvider = resolveLocalModelProvider(env);
  const androidModelRelayToken = parseAndroidRelayToken(env.LATTICE_ANDROID_MODEL_RELAY_TOKEN);
  if (localModelProvider.baseUrl !== undefined && androidModelRelayToken !== undefined) {
    throw new Error("Configure either the local model provider or the Android model relay, not both.");
  }
  if (deploymentMode !== "development" && localModelProvider.baseUrl !== undefined) {
    throw new Error("The local model provider is development-only and cannot be enabled in durable deployment mode.");
  }
  if (deploymentMode !== "development" && androidModelRelayToken !== undefined) {
    throw new Error("Android model relay is development-only and cannot be enabled in durable deployment mode.");
  }

  return {
    port,
    host: env.HOST ?? "127.0.0.1",
    databaseUrl,
    deploymentMode,
    truthMode,
    authenticationMode,
    ...(developmentFixtureSubjectId === undefined ? {} : { developmentFixtureSubjectId }),
    autoMigrate,
    localModelProviderBaseUrl: localModelProvider.baseUrl,
    localModelProviderModel: localModelProvider.model,
    modelSimulatorBaseUrl: localModelProvider.baseUrl,
    modelSimulatorModel: localModelProvider.model,
    androidModelRelayToken,
    androidModelRelayModel: parseModelName(
      env.LATTICE_ANDROID_MODEL_RELAY_MODEL,
      "android-local-prototype",
      "LATTICE_ANDROID_MODEL_RELAY_MODEL",
    ),
    androidModelRelayTimeoutMs: parseAndroidRelayTimeout(env.LATTICE_ANDROID_MODEL_RELAY_TIMEOUT_MS),
  };
}
