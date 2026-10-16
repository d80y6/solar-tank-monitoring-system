import { NextResponse, type NextRequest } from "next/server";
import {
  buildDashboardNextPath,
  buildLoginRedirectPath,
} from "@/features/auth/lib/auth-redirect";

const AUTH_COOKIE_NAME =
  process.env.AUTH_SESSION_COOKIE_NAME?.trim() || "solar_tank_session";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

function resolveRequestId(request: NextRequest): string {
  const headerValue = request.headers.get("x-request-id")?.trim();

  if (headerValue && REQUEST_ID_PATTERN.test(headerValue)) {
    return headerValue;
  }

  return globalThis.crypto.randomUUID();
}

function isProductionLike(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase() === "production"
  );
}

/**
 * Content Security Policy for the application.
 *
 * `unsafe-inline` is required because the Next.js App Router inlines its
 * bootstrap scripts and the runtime injects critical styles. Every other
 * directive is locked to the application origin, with the Turnstile origin
 * allowed only when the CAPTCHA provider needs it.
 */
export function buildContentSecurityPolicy({
  production,
  captchaEnabled,
}: {
  production: boolean;
  captchaEnabled: boolean;
}): string {
  const scriptSources = ["'self'", "'unsafe-inline'"];
  const frameSources = ["'none'"];
  const connectSources = ["'self'"];

  if (captchaEnabled) {
    scriptSources.push(TURNSTILE_ORIGIN);
    frameSources.length = 0;
    frameSources.push(TURNSTILE_ORIGIN);
    connectSources.push(TURNSTILE_ORIGIN);
  }

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    `frame-src ${frameSources.join(" ")}`,
    "worker-src 'self' blob:",
    "media-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${production ? "'none'" : "'self'"}`,
  ];

  if (production) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

function isCaptchaEnabled(): boolean {
  return process.env.AUTH_CAPTCHA_PROVIDER?.trim().toLowerCase() === "turnstile";
}

function applySecurityHeaders({
  requestId,
  response,
}: {
  requestId: string;
  response: NextResponse;
}): NextResponse {
  const production = isProductionLike();

  response.headers.set("x-request-id", requestId);
  response.headers.set(
    "content-security-policy",
    buildContentSecurityPolicy({
      captchaEnabled: isCaptchaEnabled(),
      production,
    }),
  );
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set(
    "referrer-policy",
    "strict-origin-when-cross-origin",
  );
  response.headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  );
  response.headers.set("cross-origin-opener-policy", "same-origin");
  response.headers.set("x-permitted-cross-domain-policies", "none");
  response.headers.set(
    "x-frame-options",
    production ? "DENY" : "SAMEORIGIN",
  );

  if (production) {
    response.headers.set(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains",
    );
  }

  return response;
}

export function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request);
  const sessionCookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const dashboardNextPath = buildDashboardNextPath(
    request.nextUrl.pathname,
    request.nextUrl.search,
  );

  if (!sessionCookie && request.nextUrl.pathname.startsWith("/dashboard")) {
    const loginUrl = new URL(
      buildLoginRedirectPath(dashboardNextPath),
      request.nextUrl,
    );

    return applySecurityHeaders({
      requestId,
      response: NextResponse.redirect(loginUrl),
    });
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-solar-tank-pathname", request.nextUrl.pathname);
  requestHeaders.set("x-solar-tank-search", request.nextUrl.search);

  return applySecurityHeaders({
    requestId,
    response: NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    }),
  });
}

export const config = {
  matcher: [
    // Run on every route except Next.js internal asset pipelines so that
    // request correlation and security headers apply to pages, APIs, and
    // public assets alike.
    "/((?!_next/static|_next/image).*)",
  ],
};
