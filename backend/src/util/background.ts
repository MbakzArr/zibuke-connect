import { waitUntil } from 'cloudflare:workers';

// CLOUDFLARE VERSION of this file (develop/main has its own plain
// passthrough version - see that branch's copy of this file for why a
// Node process doesn't need any of this).
//
// This file was WRONG until now: it was a bare .catch() with no
// waitUntil() at all - meaning on Workers, once a Response goes out,
// the runtime is free to terminate the isolate at any moment, and any
// "background" work still in flight (multi-step chains like "insert
// notification rows, hydrate each one, push each over the socket") can
// get silently cut off mid-way. This is exactly why announcement
// mentions were unreliable while message mentions mostly worked - not
// two different bugs, the same missing waitUntil with different odds of
// getting cut off depending on how much async work each caller does
// before finishing.
//
// waitUntil imported directly from 'cloudflare:workers' is Cloudflare's
// newer ergonomic API for this - it ties into the CURRENT request's
// execution context automatically, without needing ExecutionContext
// threaded through every function call down to wherever
// runInBackground() actually gets used (which, via Express running
// through cloudflare:node's httpServerHandler, has no natural place to
// carry that context through anyway).
export function runInBackground(promise: Promise<unknown>): void {
  waitUntil(promise.catch((err) => console.error('Background task failed:', err)));
}
