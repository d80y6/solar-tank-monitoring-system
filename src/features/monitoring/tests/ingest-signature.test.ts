import { describe, expect, it } from "vitest";

import {
  buildSignaturePayload,
  checkIngestSignature,
  computeIngestSignature,
  getIngestSignatureMode,
  getIngestSignatureToleranceSeconds,
  readIngestSignatureHeaders,
} from "../lib/ingest-signature";

const DEVICE_KEY = "stk_test-device-key-value-for-signing-0123456789";
const BODY = JSON.stringify({ distance: 42 });
const NOW = new Date("2026-10-16T12:00:00.000Z");

function buildHeaders({
  nonce = "nonce-1",
  timestampSeconds = Math.floor(NOW.getTime() / 1_000),
  signature,
}: {
  nonce?: string;
  timestampSeconds?: number;
  signature?: string;
} = {}) {
  const resolvedSignature =
    signature ??
    computeIngestSignature({
      body: BODY,
      deviceKey: DEVICE_KEY,
      nonce,
      timestampSeconds,
    });

  return new Headers({
    "x-request-nonce": nonce,
    "x-request-signature": resolvedSignature,
    "x-request-timestamp": String(timestampSeconds),
  });
}

describe("ingest request signing", () => {
  it("parses the signature mode with a safe default", () => {
    expect(getIngestSignatureMode("required")).toBe("required");
    expect(getIngestSignatureMode("OPTIONAL")).toBe("optional");
    expect(getIngestSignatureMode("off")).toBe("off");
    expect(getIngestSignatureMode("nonsense")).toBe("off");
    expect(getIngestSignatureMode(undefined)).toBe("off");
  });

  it("clamps the tolerance window", () => {
    expect(getIngestSignatureToleranceSeconds("120")).toBe(120);
    expect(getIngestSignatureToleranceSeconds("5")).toBe(300);
    expect(getIngestSignatureToleranceSeconds("999999")).toBe(300);
    expect(getIngestSignatureToleranceSeconds(undefined)).toBe(300);
  });

  it("reads headers from either naming convention", () => {
    const headers = new Headers({
      "x-solar-tank-nonce": "abc",
      "x-solar-tank-signature": "def",
      "x-solar-tank-timestamp": "1700000000",
    });

    expect(readIngestSignatureHeaders(headers)).toEqual({
      nonce: "abc",
      signature: "def",
      timestampRaw: "1700000000",
      timestampSeconds: 1_700_000_000,
    });
  });

  it("binds timestamp, nonce, and body into the signature", () => {
    expect(
      buildSignaturePayload({
        body: BODY,
        nonce: "n",
        timestampSeconds: 1,
      }),
    ).toBe(`1.n.${BODY}`);
  });

  it("accepts a correctly signed request", () => {
    const result = checkIngestSignature({
      body: BODY,
      deviceKey: DEVICE_KEY,
      headers: buildHeaders(),
      mode: "required",
      now: NOW,
      toleranceSeconds: 300,
    });

    expect(result).toEqual({
      nonce: "nonce-1",
      ok: true,
      signed: true,
      timestampSeconds: Math.floor(NOW.getTime() / 1_000),
    });
  });

  it("rejects a tampered body, a wrong key, and a replayed nonce signature", () => {
    const headers = buildHeaders();

    expect(
      checkIngestSignature({
        body: '{"distance":43}',
        deviceKey: DEVICE_KEY,
        headers,
        mode: "required",
        now: NOW,
        toleranceSeconds: 300,
      }),
    ).toEqual({ ok: false, reason: "bad-signature" });

    expect(
      checkIngestSignature({
        body: BODY,
        deviceKey: "stk_other-key",
        headers,
        mode: "required",
        now: NOW,
        toleranceSeconds: 300,
      }),
    ).toEqual({ ok: false, reason: "bad-signature" });

    expect(
      checkIngestSignature({
        body: BODY,
        deviceKey: DEVICE_KEY,
        headers: buildHeaders({ nonce: "nonce-2", signature: headers.get("x-request-signature")! }),
        mode: "required",
        now: NOW,
        toleranceSeconds: 300,
      }),
    ).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects requests outside the clock tolerance", () => {
    const staleTimestamp = Math.floor(NOW.getTime() / 1_000) - 3_600;

    expect(
      checkIngestSignature({
        body: BODY,
        deviceKey: DEVICE_KEY,
        headers: buildHeaders({ timestampSeconds: staleTimestamp }),
        mode: "required",
        now: NOW,
        toleranceSeconds: 300,
      }),
    ).toEqual({ ok: false, reason: "clock-skew" });
  });

  it("treats unsigned requests according to the configured mode", () => {
    expect(
      checkIngestSignature({
        body: BODY,
        deviceKey: DEVICE_KEY,
        headers: new Headers(),
        mode: "off",
        now: NOW,
        toleranceSeconds: 300,
      }),
    ).toEqual({ ok: true, signed: false });

    expect(
      checkIngestSignature({
        body: BODY,
        deviceKey: DEVICE_KEY,
        headers: new Headers(),
        mode: "optional",
        now: NOW,
        toleranceSeconds: 300,
      }),
    ).toEqual({ ok: true, signed: false });

    expect(
      checkIngestSignature({
        body: BODY,
        deviceKey: DEVICE_KEY,
        headers: new Headers(),
        mode: "required",
        now: NOW,
        toleranceSeconds: 300,
      }),
    ).toEqual({ ok: false, reason: "missing-signature" });
  });
});
