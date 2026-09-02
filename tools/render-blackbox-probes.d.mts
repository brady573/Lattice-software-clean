export interface BlackboxResponse {
  status: number;
  data: unknown;
}

export interface WaitForTargetHealthOptions {
  call: (method: string, path: string) => Promise<BlackboxResponse>;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  log?: (line: string) => void;
}

export function waitForTargetHealth(options: WaitForTargetHealthOptions): Promise<BlackboxResponse>;
export function assertHealthContract(health: BlackboxResponse): void;
export function createConversation(
  call: (method: string, path: string) => Promise<BlackboxResponse>,
  label: string,
): Promise<string>;
