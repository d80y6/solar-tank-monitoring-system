import { createHmac, timingSafeEqual } from "node:crypto";

export type IngestSignatureMode = "off" | "optional" | "required";

const DEFAULT_TOLERANCE_SECONDS = 300;

const SIGNATURE_HEADERS = {
  nonce: ["x-request-nonce", "x-solar-tank-nonce"],
  signature: ["x-request-signature", "x-solar-tank-signature"],
  timestamp: ["x-request-timestamp", "x-solar-tank-timestamp"],
} as const;

function readFirstHeader(
  headers: Headers,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const value = headers.get(name)?.trim();

    if (value) {
      return value;
    }
  }

  return null;
}

export function getIngestSignatureMode(
  envValue = process.env.INGEST_SIGNATURE_MODE,
): IngestSignatureMode {
  const cleanValue = envValue?.trim().toLowerCase();

  if (cleanValue === "required") {
    return "required";
  }

  if (cleanValue === "optional" || cleanValue === "on") {
    return "optional";
  }

  return "off";
}

export function getIngestSignatureToleranceSeconds(
  envValue = process.env.INGEST_SIGNATURE_TOLERANCE_SECONDS,
): number {
  const parsed = Number(envValue);

  if (Number.isInteger(parsed) && parsed >= 30 && parsed <= 3_600) {
    return parsed;
  }

  return DEFAULT_TOLERANCE_SECONDS;
}

export type IngestSignatureHeaders = {
  nonce: string | null;
  signature: string | null;
  timestampSeconds: number | null;
  timestampRaw: string | null;
};

export function readIngestSignatureHeaders(
  headers: Headers,
): IngestSignatureHeaders {
  const timestampRaw = readFirstHeader(headers, SIGNATURE_HEADERS.timestamp);
  const parsedTimestamp = Number(timestampRaw);

  return {
    nonce: readFirstHeader(headers, SIGNATURE_HEADERS.nonce),
    signature: readFirstHeader(headers, SIGNATURE_HEADERS.signature),
    timestampRaw,
    timestampSeconds:
      Number.isFinite(parsedTimestamp) && parsedTimestamp > 0
        ? Math.trunc(parsedTimestamp)
        : null,
  };
}

/**
 * Canonical string that a device signs.
 *
 * `timestamp.nonce.body` — binding the timestamp and nonce into the signature
 * is what makes replay protection meaningful: an attacker cannot reuse a
 * captured signature with a different timestamp or nonce.
 */
export function buildSignaturePayload({
  body,
  nonce,
  timestampSeconds,
}: {
  body: string;
  nonce: string;
  timestampSeconds: number;
}): string {
  return `${timestampSeconds}.${nonce}.${body}`;
}

export function computeIngestSignature({
  body,
  deviceKey,
  nonce,
  timestampSeconds,
}: {
  body: string;
  deviceKey: string;
  nonce: string;
  timestampSeconds: number;
}): string {
  return createHmac("sha256", deviceKey)
    .update(buildSignaturePayload({ body, nonce, timestampSeconds }), "utf8")
    .digest("hex");
}

export function verifyIngestSignature({
  body,
  deviceKey,
  nonce,
  signature,
  timestampSeconds,
}: {
  body: string;
  deviceKey: string;
  nonce: string;
  signature: string;
  timestampSeconds: number;
}): boolean {
  const expected = computeIngestSignature({
    body,
    deviceKey,
    nonce,
    timestampSeconds,
  });
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(signature.trim().toLowerCase(), "utf8");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export type SignatureCheckResult =
  | { ok: true; signed: false }
  | { ok: true; signed: true; nonce: string; timestampSeconds: number }
  | { ok: false; reason: "clock-skew" | "missing-signature" | "bad-signature" };

export function checkIngestSignature({
  body,
  deviceKey,
  headers,
  now = new Date(),
  mode,
  toleranceSeconds,
}: {
  body: string;
  deviceKey: string;
  headers: Headers;
  now?: Date;
  mode: IngestSignatureMode;
  toleranceSeconds: number;
}): SignatureCheckResult {
  if (mode === "off") {
    return { ok: true, signed: false };
  }

  const { nonce, signature, timestampSeconds } =
    readIngestSignatureHeaders(headers);

  if (!nonce || !signature || timestampSeconds === null) {
    if (mode === "required") {
      return { ok: false, reason: "missing-signature" };
    }

    return { ok: true, signed: false };
  }

  const skewSeconds = Math.abs(now.getTime() / 1_000 - timestampSeconds);

  if (skewSeconds > toleranceSeconds) {
    return { ok: false, reason: "clock-skew" };
  }

  if (
    !verifyIngestSignature({
      body,
      deviceKey,
      nonce,
      signature,
      timestampSeconds,
    })
  ) {
    return { ok: false, reason: "bad-signature" };
  }

  return { ok: true, nonce, signed: true, timestampSeconds };
}
