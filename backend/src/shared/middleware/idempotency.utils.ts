/**
 * Idempotency utilities
 */

/**
 * Creates a hash of the request for idempotency checking
 * Uses a simple but deterministic hashing approach
 */
export function hashRequest(request: {
  method: string;
  path: string;
  body: any;
  query: any;
}): string {
  // Normalize the request for consistent hashing
  const normalized = {
    method: request.method.toUpperCase(),
    path: request.path,
    body: request.body ? JSON.stringify(request.body) : null,
    query: request.query ? JSON.stringify(request.query) : null,
  };

  const str = JSON.stringify(normalized);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Generates a client-friendly idempotency key
 * Clients can use this format or provide their own
 */
export function generateIdempotencyKey(prefix: string = 'idem'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Validates idempotency key format
 */
export function isValidIdempotencyKey(key: string): boolean {
  return typeof key === 'string' && key.length > 0 && key.length <= 255;
}