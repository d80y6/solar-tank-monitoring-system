import { describe, expect, it } from "vitest";

import {
  evaluateRequestOrigin,
  parseOriginAllowlist,
} from "../lib/request-origin";

const base = {
  allowedOrigins: [] as string[],
  forwardedHost: null as string | null,
  host: "ftm.example.com",
  originHeader: null as string | null,
  refererHeader: null as string | null,
};

describe("parseOriginAllowlist", () => {
  it("normalizes scheme and host and drops junk", () => {
    expect(
      parseOriginAllowlist(
        "https://ftm.example.com, http://localhost:3000/ , ftp://x, not-a-url, ",
      ),
    ).toEqual(["https://ftm.example.com", "http://localhost:3000"]);
  });

  it("returns an empty list for missing values", () => {
    expect(parseOriginAllowlist(undefined)).toEqual([]);
    expect(parseOriginAllowlist(null)).toEqual([]);
    expect(parseOriginAllowlist("   ")).toEqual([]);
  });
});

describe("evaluateRequestOrigin", () => {
  it("accepts a browser request from the same origin", () => {
    expect(
      evaluateRequestOrigin({ ...base, originHeader: "https://ftm.example.com" }),
    ).toEqual({ checked: true, ok: true, reason: "same-origin" });
  });

  it("accepts a same-origin request when the proxy reports the public host", () => {
    expect(
      evaluateRequestOrigin({
        ...base,
        forwardedHost: "ftm.example.com",
        host: "10.0.0.5:3000",
        originHeader: "https://ftm.example.com",
      }),
    ).toEqual({ checked: true, ok: true, reason: "same-origin" });
  });

  it("accepts an allowlisted origin", () => {
    expect(
      evaluateRequestOrigin({
        ...base,
        allowedOrigins: ["https://admin.example.com"],
        originHeader: "https://admin.example.com",
      }),
    ).toEqual({ checked: true, ok: true, reason: "allowlisted" });
  });

  it("rejects a cross-origin request", () => {
    expect(
      evaluateRequestOrigin({ ...base, originHeader: "https://evil.example.com" }),
    ).toEqual({ checked: true, ok: false, reason: "cross-origin" });
  });

  it("rejects a lookalike subdomain that only ends with the host name", () => {
    const outcome = evaluateRequestOrigin({
      ...base,
      originHeader: "https://notftm.example.com",
    });

    expect(outcome.ok).toBe(false);
  });

  it("rejects Origin: null because a sandboxed frame can lie about it", () => {
    expect(evaluateRequestOrigin({ ...base, originHeader: "null" })).toEqual({
      checked: true,
      ok: false,
      reason: "unparsable-origin",
    });
  });

  it("accepts and reports requests without Origin or Referer", () => {
    expect(evaluateRequestOrigin(base)).toEqual({
      checked: false,
      ok: true,
      reason: "no-origin-header",
    });
  });

  it("falls back to the Referer when Origin is absent", () => {
    expect(
      evaluateRequestOrigin({
        ...base,
        refererHeader: "https://ftm.example.com/dashboard/tanks/tank-1",
      }),
    ).toEqual({ checked: true, ok: true, reason: "same-origin" });
    expect(
      evaluateRequestOrigin({
        ...base,
        refererHeader: "https://evil.example.com/x",
      }).ok,
    ).toBe(false);
  });

  it("rejects when neither header nor host can establish an origin", () => {
    expect(
      evaluateRequestOrigin({
        ...base,
        host: null,
        originHeader: "https://ftm.example.com",
      }).ok,
    ).toBe(false);
  });
});
