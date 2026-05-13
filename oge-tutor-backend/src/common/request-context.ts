/*
 * OGE Tutor Backend — per-request context.
 * Keeps the frontend-generated requestId available inside controllers, services and log helpers.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestLogContext = {
  requestId: string;
};

const storage = new AsyncLocalStorage<RequestLogContext>();

export function runWithRequestContext<T>(context: RequestLogContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function getRequestContext(): RequestLogContext | undefined {
  return storage.getStore();
}

export function getRequestId(fallback = 'req_unknown'): string {
  return storage.getStore()?.requestId || fallback;
}
