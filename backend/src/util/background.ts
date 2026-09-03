// RENDER/NODE VERSION of this file (develop/main only - the Cloudflare
// version, which wraps everything in Workers' waitUntil() so it survives
// past the response being sent, is a separate file living only on the
// cloudflare branch). A plain Node process has no equivalent problem: it
// keeps running normally in the background regardless of whether a
// specific HTTP response has already gone out, so this is just a thin,
// honest pass-through - errors are still caught and logged, nothing
// about the actual behavior changes here. This file exists purely so
// the SAME calling code (messaging.controller.ts, tasks.service.ts, etc.)
// works unmodified on both platforms.
export function runInBackground(promise: Promise<unknown>): void {
  promise.catch((err) => console.error('Background task failed:', err));
}
