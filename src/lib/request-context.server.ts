// Request-scoped attribution for the error trail.
//
// Server functions run per request, so the tenant behind a failure is known exactly
// once — in the auth middleware (userId) and in requireBusinessId() (businessId).
// Stamping it here means captureError() can attribute a «Nimadir xato ketdi» to the
// business that hit it without every call site threading the ids through.

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  businessId?: string | null;
  userId?: string | null;
}

const store = new AsyncLocalStorage<RequestContext>();

/** Wraps nothing: called inside a request, it fills the request's context in place. */
export function stampRequestContext(patch: RequestContext): void {
  const current = store.getStore();
  if (current) Object.assign(current, patch);
}

export function getRequestContext(): RequestContext {
  return store.getStore() ?? {};
}

/** Runs `fn` with a fresh context — the entry point for one request. */
export function runInRequestContext<T>(fn: () => T): T {
  return store.run({ businessId: null, userId: null }, fn);
}
