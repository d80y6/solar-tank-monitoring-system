import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Device } from "../types/monitoring";

const DEVICE_KEY_HASH_PREFIX = "sha256:";
const DEVICE_KEY_PREFIX = "stk";
const DEVICE_KEY_RANDOM_BYTES = 32;
const SHA256_HEX_LENGTH = 64;
const DISABLED_ENV_VALUES = new Set(["0", "false", "no", "off"]);

type VerifyDeviceKeyInput = {
  device: Pick<Device, "apiKeyHash"> &
    Partial<
      Pick<Device, "previousApiKeyHash" | "previousKeyValidUntil">
    >;
  suppliedDeviceKey: string;
  fallbackDeviceKey?: string;
  allowGlobalFallback?: boolean;
  now?: Date;
};

function cleanDeviceKey(value: string): string {
  return value.trim();
}

function parseSha256Hash(value?: string | null): Buffer | null {
  const cleanValue = value?.trim().toLowerCase();

  if (!cleanValue) {
    return null;
  }

  const hexValue = cleanValue.startsWith(DEVICE_KEY_HASH_PREFIX)
    ? cleanValue.slice(DEVICE_KEY_HASH_PREFIX.length)
    : cleanValue;

  if (
    hexValue.length !== SHA256_HEX_LENGTH ||
    !/^[a-f0-9]+$/.test(hexValue)
  ) {
    return null;
  }

  return Buffer.from(hexValue, "hex");
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashDeviceKey(deviceKey: string): string {
  return `${DEVICE_KEY_HASH_PREFIX}${createHash("sha256")
    .update(deviceKey, "utf8")
    .digest("hex")}`;
}

export function createDeviceKey(): string {
  return `${DEVICE_KEY_PREFIX}_${randomBytes(DEVICE_KEY_RANDOM_BYTES).toString("base64url")}`;
}

export function verifyDeviceKeyHash(
  suppliedDeviceKey: string,
  storedHash?: string | null,
): boolean {
  const expectedHash = parseSha256Hash(storedHash);

  if (!expectedHash) {
    return false;
  }

  const actualHash = parseSha256Hash(hashDeviceKey(cleanDeviceKey(suppliedDeviceKey)));

  if (!actualHash || actualHash.length !== expectedHash.length) {
    return false;
  }

  return timingSafeEqual(actualHash, expectedHash);
}

export function isGlobalDeviceKeyFallbackAllowed(
  envValue = process.env.SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK,
): boolean {
  const cleanValue = envValue?.trim().toLowerCase();

  if (!cleanValue) {
    return true;
  }

  return !DISABLED_ENV_VALUES.has(cleanValue);
}

/**
 * Returns true while a previous key is still accepted after a rotation.
 *
 * The grace window is what makes rotation operationally possible: the device
 * in the field keeps working until it is re-flashed with the new package,
 * and the old key stops being accepted the moment the window closes.
 */
export function isPreviousDeviceKeyWithinGrace({
  device,
  now = new Date(),
}: {
  device: Pick<Device, "previousApiKeyHash"> &
    Partial<Pick<Device, "previousKeyValidUntil">>;
  now?: Date;
}): boolean {
  if (!device.previousApiKeyHash) {
    return false;
  }

  const validUntil = device.previousKeyValidUntil
    ? Date.parse(device.previousKeyValidUntil)
    : Number.NaN;

  if (!Number.isFinite(validUntil)) {
    // No grace window recorded: a stored previous hash without an expiry is
    // treated as expired rather than as a permanent second key.
    return false;
  }

  return now.getTime() < validUntil;
}

export function verifyDeviceKey({
  device,
  suppliedDeviceKey,
  fallbackDeviceKey,
  allowGlobalFallback = true,
  now = new Date(),
}: VerifyDeviceKeyInput): boolean {
  const cleanSuppliedKey = cleanDeviceKey(suppliedDeviceKey);

  if (!cleanSuppliedKey) {
    return false;
  }

  if (verifyDeviceKeyHash(cleanSuppliedKey, device.apiKeyHash)) {
    return true;
  }

  if (
    isPreviousDeviceKeyWithinGrace({ device, now }) &&
    verifyDeviceKeyHash(cleanSuppliedKey, device.previousApiKeyHash)
  ) {
    return true;
  }

  const cleanFallbackKey = fallbackDeviceKey?.trim();

  return Boolean(
    allowGlobalFallback &&
      cleanFallbackKey &&
      timingSafeStringEqual(cleanSuppliedKey, cleanFallbackKey),
  );
}
