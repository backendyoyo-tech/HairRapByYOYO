import { randomUUID } from "node:crypto";

export interface RequestContext {
  requestId: string;
}

export function createRequestContext(
  incomingRequestId?: string,
): RequestContext {
  return {
    requestId: incomingRequestId?.trim() || randomUUID(),
  };
}