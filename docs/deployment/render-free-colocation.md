# Render free API + Run-worker co-location

This deployment composition is a delivery constraint, not a Product architecture change.

The canonical API process remains `dist/src/index.js`. The canonical Run-worker process remains `dist/src/run-worker-main.js`. `tools/render-colocated-runtime.mjs` supervises those two existing process roles inside one Render Web Service so the zero-cost deployment can retain both roles without combining their semantic responsibilities.

The supervisor:

- starts both canonical processes with the same runtime environment;
- forwards `SIGTERM` and `SIGINT` to both roles;
- waits for both roles to stop on an intentional platform shutdown;
- treats an unexpected exit or spawn failure from either role as a service failure;
- terminates the surviving sibling on such a failure rather than leaving a partially functioning service reporting success;
- escalates a child that does not stop within the bounded shutdown interval to `SIGKILL`.

Render free Web Services spin down after inactivity and cold-start on the next request. Because the worker is co-located with the Web Service, it sleeps whenever the Web Service sleeps. Durable PostgreSQL state remains in Supabase, but background Run progress is not continuous while the free service is asleep. A new inbound request that wakes the Web Service also restarts the Run worker, which can resume durable queued work according to the existing lease/retry semantics.

This free-tier composition therefore does **not** provide always-on background processing. If Product acceptance later requires Runs to progress without any inbound traffic during free-tier sleep periods, this composition is insufficient and a paid always-on compute resource or a separately authorized architecture decision would be required.
