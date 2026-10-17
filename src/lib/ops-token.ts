import { timingSafeEqual } from "node:crypto";

const OPS_TOKEN_HEADERS = [
  "x-solar-tank-ops-token",
  "x-cron-secret",
  "authorization",
] as const;

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function readBearerToken(value: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(value?.trim() ?? "");

  return match?.[1]?.trim() || null;
}

export function getProvidedOpsToken(headers: Headers): string | null {
  for (const header of OPS_TOKEN_HEADERS) {
    const rawValue = headers.get(header)?.trim();

    if (!rawValue) {
      continue;
    }

    if (header === "authorization") {
      const bearer = readBearerToken(rawValue);

      if (bearer) {
        return bearer;
      }

      continue;
    }

    return rawValue;
  }

  return null;
}

/**
 * Verifies an operational token used by machine callers (schedulers,
 * monitoring systems). A fallback token is accepted so a single deployment
 * can reuse the readiness token when a dedicated ops token is not set.
 */
export function hasValidOpsToken({
  expectedToken,
  fallbackToken,
  headers,
}: {
  expectedToken?: string | null;
  fallbackToken?: string | null;
  headers: Headers;
}): boolean {
  const candidates = [expectedToken?.trim(), fallbackToken?.trim()].filter(
    (value): value is string => Boolean(value),
  );

  if (candidates.length === 0) {
    return false;
  }

  const providedToken = getProvidedOpsToken(headers);

  if (!providedToken) {
    return false;
  }

  return candidates.some((candidate) => safeEqual(providedToken, candidate));
}
