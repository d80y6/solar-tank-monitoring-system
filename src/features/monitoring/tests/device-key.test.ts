import { describe, expect, it } from "vitest";
import {
  createDeviceKey,
  hashDeviceKey,
  isGlobalDeviceKeyFallbackAllowed,
  isPreviousDeviceKeyWithinGrace,
  verifyDeviceKey,
  verifyDeviceKeyHash,
} from "../lib/device-key";

describe("device key security", () => {
  it("creates strong random device keys for firmware packages", () => {
    const firstKey = createDeviceKey();
    const secondKey = createDeviceKey();

    expect(firstKey).toMatch(/^stk_[A-Za-z0-9_-]{40,}$/);
    expect(secondKey).toMatch(/^stk_[A-Za-z0-9_-]{40,}$/);
    expect(firstKey).not.toBe(secondKey);
  });

  it("hashes device keys with a sha256 prefix", () => {
    const hash = hashDeviceKey("demo-tph-key");

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("verifies a supplied key against a stored hash", () => {
    const hash = hashDeviceKey("demo-tph-key");

    expect(verifyDeviceKeyHash("demo-tph-key", hash)).toBe(true);
    expect(verifyDeviceKeyHash("wrong-key", hash)).toBe(false);
  });

  it("allows a device-specific key before trying the global fallback", () => {
    const apiKeyHash = hashDeviceKey("demo-tph-key");

    expect(
      verifyDeviceKey({
        device: { apiKeyHash },
        suppliedDeviceKey: "demo-tph-key",
        fallbackDeviceKey: "local-development-key",
        allowGlobalFallback: false,
      }),
    ).toBe(true);
  });

  it("can disable the global fallback key", () => {
    expect(
      verifyDeviceKey({
        device: { apiKeyHash: hashDeviceKey("demo-tph-key") },
        suppliedDeviceKey: "local-development-key",
        fallbackDeviceKey: "local-development-key",
        allowGlobalFallback: false,
      }),
    ).toBe(false);
  });

  it("keeps the global fallback enabled by default for local development", () => {
    expect(isGlobalDeviceKeyFallbackAllowed(undefined)).toBe(true);
    expect(isGlobalDeviceKeyFallbackAllowed("true")).toBe(true);
    expect(isGlobalDeviceKeyFallbackAllowed("false")).toBe(false);
    expect(isGlobalDeviceKeyFallbackAllowed("0")).toBe(false);
  });
});

describe("device key rotation grace window", () => {
  const now = new Date("2026-10-16T12:00:00.000Z");
  const currentKey = createDeviceKey();
  const previousKey = createDeviceKey();

  const device = {
    apiKeyHash: hashDeviceKey(currentKey),
    previousApiKeyHash: hashDeviceKey(previousKey),
    previousKeyValidUntil: "2026-10-16T18:00:00.000Z",
  };

  it("accepts the current key at any time", () => {
    expect(
      verifyDeviceKey({
        device,
        now,
        suppliedDeviceKey: currentKey,
      }),
    ).toBe(true);
  });

  it("accepts the previous key while the grace window is open", () => {
    expect(
      verifyDeviceKey({
        device,
        now,
        suppliedDeviceKey: previousKey,
      }),
    ).toBe(true);
  });

  it("rejects the previous key once the grace window closes", () => {
    expect(
      verifyDeviceKey({
        device,
        now: new Date("2026-10-16T18:00:01.000Z"),
        suppliedDeviceKey: previousKey,
      }),
    ).toBe(false);
  });

  it("treats a previous hash without an expiry as expired", () => {
    expect(
      verifyDeviceKey({
        device: {
          apiKeyHash: hashDeviceKey(currentKey),
          previousApiKeyHash: hashDeviceKey(previousKey),
        },
        now,
        suppliedDeviceKey: previousKey,
      }),
    ).toBe(false);
  });

  it("exposes the grace-window decision helper", () => {
    expect(
      isPreviousDeviceKeyWithinGrace({ device, now }),
    ).toBe(true);
    expect(
      isPreviousDeviceKeyWithinGrace({
        device,
        now: new Date("2026-10-17T00:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("never accepts an unrelated key", () => {
    expect(
      verifyDeviceKey({
        device,
        now,
        suppliedDeviceKey: createDeviceKey(),
      }),
    ).toBe(false);
  });
});
