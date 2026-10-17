import type { NextRequest } from "next/server";

export type OriginCheckOutcome =
  | {
      checked: boolean;
      ok: true;
      reason: "no-origin-header" | "same-origin" | "allowlisted";
    }
  | { checked: true; ok: false; reason: "cross-origin" | "unparsable-origin" };

export const ORIGIN_ALLOWLIST_ENV = "AUTH_ALLOWED_ORIGINS";

export function parseOriginAllowlist(value: string | undefined | null): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return `${url.protocol}//${url.host.toLowerCase()}`;
  } catch {
    return null;
  }
}

function readCandidateOrigin(originHeader: string | null, refererHeader: string | null): string | null {
  const candidate = originHeader?.trim() || refererHeader?.trim();

  if (!candidate) {
    return null;
  }

  // `Origin: null` appears for sandboxed frames and some redirects; it can
  // never be trusted for a state-changing request.
  if (candidate === "null") {
    return null;
  }

  return normalizeOrigin(candidate);
}

/**
 * Decides whether a state-changing request comes from the application's own
 * origin.
 *
 * Cookies are `SameSite=Lax`, which already blocks classic cross-site POSTs,
 * but Lax does not protect against a sibling subdomain or a mis-configured
 * proxy that strips the attribute. This check adds the second line of defence
 * the security review asked for (finding S3).
 *
 * Behaviour:
 * - no `Origin` and no `Referer` ⇒ accepted and reported as unchecked, so
 *   non-browser clients (curl, health checks, the pilot scripts) keep working;
 * - `Origin`/`Referer` host equal to the request host (or `x-forwarded-host`)
 *   ⇒ accepted;
 * - an allowlisted origin (`AUTH_ALLOWED_ORIGINS`) ⇒ accepted;
 * - anything else, including `Origin: null` ⇒ rejected.
 */
export function evaluateRequestOrigin({
  allowedOrigins,
  forwardedHost,
  host,
  originHeader,
  refererHeader,
}: {
  allowedOrigins: string[];
  forwardedHost: string | null;
  host: string | null;
  originHeader: string | null;
  refererHeader: string | null;
}): OriginCheckOutcome {
  const candidate = readCandidateOrigin(originHeader, refererHeader);

  if (!candidate) {
    if (originHeader?.trim() === "null") {
      return { checked: true, ok: false, reason: "unparsable-origin" };
    }

    return { checked: false, ok: true, reason: "no-origin-header" };
  }

  if (allowedOrigins.includes(candidate)) {
    return { checked: true, ok: true, reason: "allowlisted" };
  }

  const effectiveHost = (forwardedHost ?? host ?? "").split(",")[0]?.trim().toLowerCase();

  if (effectiveHost && candidate.endsWith(`//${effectiveHost}`)) {
    return { checked: true, ok: true, reason: "same-origin" };
  }

  return { checked: true, ok: false, reason: "cross-origin" };
}

export function verifyRequestOrigin(
  request: NextRequest,
  { allowedOrigins = parseOriginAllowlist(process.env[ORIGIN_ALLOWLIST_ENV]) } = {},
): OriginCheckOutcome {
  return evaluateRequestOrigin({
    allowedOrigins,
    forwardedHost: request.headers.get("x-forwarded-host"),
    host: request.headers.get("host"),
    originHeader: request.headers.get("origin"),
    refererHeader: request.headers.get("referer"),
  });
}

/**
 * Returns a 403 response when the request did not come from this application,
 * or `null` when the caller may continue.
 */
export function requireSameOrigin(request: NextRequest): Response | null {
  const outcome = verifyRequestOrigin(request);

  if (outcome.ok) {
    return null;
  }

  return Response.json(
    {
      error:
        "This request was blocked because it did not come from the application origin.",
      ok: false,
      reason: outcome.reason,
    },
    { status: 403 },
  );
}
