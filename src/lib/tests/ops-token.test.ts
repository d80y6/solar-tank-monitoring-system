import { describe, expect, it } from "vitest";

import { getProvidedOpsToken, hasValidOpsToken } from "../ops-token";

const TOKEN = "ops-token-value-with-enough-entropy";

describe("operational token verification", () => {
  it("accepts the dedicated header, the cron secret, and bearer auth", () => {
    expect(
      hasValidOpsToken({
        expectedToken: TOKEN,
        headers: new Headers({ "x-solar-tank-ops-token": TOKEN }),
      }),
    ).toBe(true);

    expect(
      hasValidOpsToken({
        expectedToken: TOKEN,
        headers: new Headers({ "x-cron-secret": TOKEN }),
      }),
    ).toBe(true);

    expect(
      hasValidOpsToken({
        expectedToken: TOKEN,
        headers: new Headers({ authorization: `Bearer ${TOKEN}` }),
      }),
    ).toBe(true);
  });

  it("accepts a fallback token when no dedicated token is configured", () => {
    expect(
      hasValidOpsToken({
        fallbackToken: TOKEN,
        headers: new Headers({ authorization: `Bearer ${TOKEN}` }),
        expectedToken: null,
      }),
    ).toBe(true);
  });

  it("rejects missing, empty, or mismatched tokens", () => {
    expect(
      hasValidOpsToken({
        expectedToken: TOKEN,
        headers: new Headers(),
      }),
    ).toBe(false);

    expect(
      hasValidOpsToken({
        expectedToken: TOKEN,
        headers: new Headers({ authorization: "Bearer wrong" }),
      }),
    ).toBe(false);

    expect(
      hasValidOpsToken({
        headers: new Headers({ "x-solar-tank-ops-token": TOKEN }),
        expectedToken: undefined,
      }),
    ).toBe(false);
  });

  it("rejects tokens of different length without throwing", () => {
    expect(
      getProvidedOpsToken(new Headers({ "x-solar-tank-ops-token": "short" })),
    ).toBe("short");

    expect(
      hasValidOpsToken({
        expectedToken: TOKEN,
        headers: new Headers({ "x-solar-tank-ops-token": "short" }),
      }),
    ).toBe(false);
  });
});
