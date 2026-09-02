export interface RenderQualificationArgsOptions {
  sourceRevision?: string;
  output?: string;
  diagnosticScenarioIds?: string;
}

export interface NvidiaSmokeRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  top_p: number;
  max_tokens: number;
  stream: boolean;
}

export interface SanitizedProviderError {
  type?: string | number;
  code?: string | number;
  message?: string | number;
}

export function buildQualificationArgs(options?: RenderQualificationArgsOptions): string[];
export function buildNvidiaQualificationArgs(options?: RenderQualificationArgsOptions): string[];
export function buildNvidiaSmokeRequest(): NvidiaSmokeRequest;
export function observedResponseModel(body: unknown): string | null;
export function sanitizeProviderError(body: unknown): SanitizedProviderError | null;
export function boundedDiagnosticObserved(observed: unknown): string | null;
export function summaryHttpStatus(summary: { status?: string } | null | undefined): number;
export function main(): Promise<void>;
