import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const originalRmSync = fs.rmSync;
fs.rmSync = (path, options = {}) => {
  try {
    return originalRmSync(path, { ...options, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.error(`A5_BROWSER_CLEANUP_WARNING=${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
};
syncBuiltinESMExports();
await import("./a5-browser-proof.mjs");
