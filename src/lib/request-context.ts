import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  requestId: string;
  method?: string;
  route?: string;
  userAgent?: string;
  ipHash?: string;
  userId?: string;
  role?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function createRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export function isRequestId(value: string | null | undefined): boolean {
  const cleanValue = value?.trim();

  if (!cleanValue) {
    return false;
  }

  return /^[A-Za-z0-9._:-]{8,128}$/.test(cleanValue);
}

export function getRequestIdFromHeaders(headers: Headers): string {
  const headerValue = headers.get("x-request-id");

  return isRequestId(headerValue) ? headerValue!.trim() : createRequestId();
}

export function runWithRequestContext<T>(
  context: RequestContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function patchRequestContext(patch: Partial<RequestContext>): void {
  const current = storage.getStore();

  if (!current) {
    return;
  }

  Object.assign(current, patch);
}

export function getActiveRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
