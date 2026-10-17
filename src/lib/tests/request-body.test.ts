import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";

import {
  DEFAULT_JSON_BODY_LIMIT_BYTES,
  parseBodyLimit,
  readLimitedJsonBody,
} from "../request-body";

function makeRequest(
  body: string,
  { contentLength }: { contentLength?: string } = {},
): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });

  if (contentLength !== undefined) {
    headers.set("content-length", contentLength);
  }

  return {
    headers,
    text: async () => body,
  } as unknown as NextRequest;
}

describe("parseBodyLimit", () => {
  it("accepts values inside the allowed range", () => {
    expect(parseBodyLimit("4096")).toBe(4096);
  });

  it("falls back for missing, tiny, or oversized values", () => {
    expect(parseBodyLimit(undefined)).toBe(DEFAULT_JSON_BODY_LIMIT_BYTES);
    expect(parseBodyLimit("10")).toBe(DEFAULT_JSON_BODY_LIMIT_BYTES);
    expect(parseBodyLimit("99999999")).toBe(DEFAULT_JSON_BODY_LIMIT_BYTES);
    expect(parseBodyLimit("not-a-number")).toBe(DEFAULT_JSON_BODY_LIMIT_BYTES);
  });
});

describe("readLimitedJsonBody", () => {
  it("parses a normal JSON body", async () => {
    const result = await readLimitedJsonBody(makeRequest('{"email":"a@b.c"}'));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.body).toEqual({ email: "a@b.c" });
    }
  });

  it("treats an empty body as an empty object", async () => {
    const result = await readLimitedJsonBody(makeRequest("   "));

    expect(result).toEqual({ body: {}, bytes: 3, ok: true });
  });

  it("rejects invalid JSON without throwing", async () => {
    const result = await readLimitedJsonBody(makeRequest("{not json"));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.reason).toBe("invalid-json");
    }
  });

  it("rejects an oversized declared body before reading it", async () => {
    const result = await readLimitedJsonBody(
      makeRequest('{"a":1}', { contentLength: "2048" }),
      { maxBytes: 1024 },
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.reason).toBe("too-large");
      expect(result.bytes).toBe(2048);
    }
  });

  it("rejects an oversized body even without a Content-Length header", async () => {
    const body = JSON.stringify({ padding: "x".repeat(2_000) });
    const result = await readLimitedJsonBody(makeRequest(body), {
      maxBytes: 1024,
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.reason).toBe("too-large");
      expect(result.bytes).toBeGreaterThan(1024);
    }
  });

  it("accepts a body exactly at the limit", async () => {
    const body = '{"a":1}';
    const result = await readLimitedJsonBody(makeRequest(body), {
      maxBytes: body.length,
    });

    expect(result.ok).toBe(true);
  });
});
