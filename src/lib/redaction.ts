const REDACTED_VALUE = "[redacted]";
const MAX_STRING_LENGTH = 2_000;
const MAX_ARRAY_LENGTH = 50;
const MAX_DEPTH = 6;

const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|api[-_]?key|device[-_]?key|authorization|cookie|credential|session|otp|hash|salt|private[-_]?key)/i;

const SENSITIVE_VALUE_PATTERN =
  /^(?:bearer\s|basic\s|mysql:\/\/|stk_[A-Za-z0-9_-]{8,})/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value)
  );
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_STRING_LENGTH)}…[truncated ${value.length - MAX_STRING_LENGTH} chars]`;
}

function serializeError(error: Error): Record<string, unknown> {
  const record: Record<string, unknown> = {
    name: error.name,
    message: truncateString(error.message),
  };

  const code = (error as Error & { code?: unknown }).code;

  if (typeof code === "string" || typeof code === "number") {
    record.code = code;
  }

  if (error.stack) {
    record.stack = truncateString(error.stack);
  }

  return record;
}

/**
 * Converts arbitrary log context into a JSON-safe, redacted structure.
 *
 * The goal is that a log line can never leak a credential, a session token,
 * a device key, or a connection string, even when the caller passes a raw
 * request object or a whole configuration record.
 */
export function redactForLogging(
  value: unknown,
  depth = 0,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth > MAX_DEPTH) {
    return "[depth-limit]";
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (typeof value === "string") {
    if (SENSITIVE_VALUE_PATTERN.test(value.trim())) {
      return REDACTED_VALUE;
    }

    return truncateString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return `[${typeof value}]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[buffer ${value.byteLength} bytes]`;
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => redactForLogging(item, depth + 1));

    if (value.length > MAX_ARRAY_LENGTH) {
      items.push(`[+${value.length - MAX_ARRAY_LENGTH} more items]`);
    }

    return items;
  }

  if (isPlainObject(value)) {
    const output: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      if (nestedValue === undefined) {
        continue;
      }

      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = REDACTED_VALUE;
        continue;
      }

      output[key] = redactForLogging(nestedValue, depth + 1);
    }

    return output;
  }

  return String(value);
}

export const REDACTION_PLACEHOLDER = REDACTED_VALUE;
