export interface EvidenceTask<T> {
  id: string;
  dependsOn: string[];
  maxAttempts?: number;
  execute(signal: AbortSignal): Promise<T>;
}

export interface EvidenceTaskResult<T> {
  id: string;
  value: T;
  attempts: number;
  completedRound: number;
}

export interface EvidencePlanResult<T> {
  results: Map<string, EvidenceTaskResult<T>>;
  serialRounds: number;
}

export async function executeEvidencePlan<T>(
  tasks: EvidenceTask<T>[],
  signal?: AbortSignal,
): Promise<EvidencePlanResult<T>> {
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) throw new Error("Evidence task IDs must be unique.");
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`Unknown evidence task dependency: ${dependency}`);
    }
  }

  const completed = new Map<string, EvidenceTaskResult<T>>();
  const attempts = new Map<string, number>();
  let serialRounds = 0;
  const controller = new AbortController();
  const abortFromCaller = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    while (completed.size < tasks.length) {
      if (controller.signal.aborted) throw new Error("Evidence plan cancelled.");
      const ready = tasks.filter(
        (task) =>
          !completed.has(task.id)
          && task.dependsOn.every((dependency) => completed.has(dependency)),
      );
      if (ready.length === 0) {
        throw new Error("Evidence plan cannot progress; dependency cycle or blocked node detected.");
      }

      serialRounds += 1;
      const settled = await Promise.all(
        ready.map(async (task) => {
          const attempt = (attempts.get(task.id) ?? 0) + 1;
          attempts.set(task.id, attempt);
          try {
            const value = await task.execute(controller.signal);
            return { task, attempt, ok: true as const, value };
          } catch (error) {
            return { task, attempt, ok: false as const, error };
          }
        }),
      );

      let madeProgress = false;
      for (const result of settled) {
        if (result.ok) {
          completed.set(result.task.id, {
            id: result.task.id,
            value: result.value,
            attempts: result.attempt,
            completedRound: serialRounds,
          });
          madeProgress = true;
          continue;
        }
        const maxAttempts = result.task.maxAttempts ?? 1;
        if (result.attempt >= maxAttempts) {
          controller.abort(result.error);
          const message = result.error instanceof Error ? result.error.message : String(result.error);
          throw new Error(`Evidence task ${result.task.id} failed after ${result.attempt} attempt(s): ${message}`);
        }
      }

      if (!madeProgress && ready.every((task) => (attempts.get(task.id) ?? 0) >= (task.maxAttempts ?? 1))) {
        throw new Error("Evidence plan exhausted retries without progress.");
      }
    }
    return { results: completed, serialRounds };
  } finally {
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
