import {
  createHash,
  createHmac,
  pbkdf2 as pbkdf2Callback,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import * as argon2 from "argon2";

import { getRequiredAuthSecret } from "./auth-config";

const pbkdf2 = promisify(pbkdf2Callback);

const LEGACY_PASSWORD_ALGORITHM = "pbkdf2-sha256";
const LEGACY_PASSWORD_ITERATIONS = 600_000;
const LEGACY_PASSWORD_KEY_LENGTH = 32;
const LEGACY_PASSWORD_DIGEST = "sha256";
const ARGON2ID_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
} satisfies argon2.Options;

function toBase64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function safeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function createAuthId(prefix: string): string {
  return `${prefix}_${toBase64Url(randomBytes(18))}`;
}

export function createRandomToken(): string {
  return toBase64Url(randomBytes(32));
}

export function createOtpCode(): string {
  const value = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return value.toString().padStart(6, "0");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256Hex(value: string): string {
  return createHmac("sha256", getRequiredAuthSecret())
    .update(value)
    .digest("hex");
}

export function hashSessionToken(token: string): string {
  return `sha256:${sha256Hex(token)}`;
}

export function hashOneTimeToken(token: string): string {
  return `hmac-sha256:${hmacSha256Hex(token)}`;
}

export function hashRequestFingerprint(value: string | null): string | null {
  const cleanValue = value?.trim();

  if (!cleanValue) {
    return null;
  }

  return `sha256:${hmacSha256Hex(cleanValue)}`;
}

export function hashOtpCode(code: string): string {
  return `hmac-sha256:${hmacSha256Hex(code)}`;
}

export function verifyOtpHash(code: string, hash: string): boolean {
  const [algorithm, expected] = hash.split(":");

  if (algorithm !== "hmac-sha256" || !expected) {
    return false;
  }

  return safeEqualHex(hmacSha256Hex(code), expected);
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2ID_OPTIONS);
}

async function verifyLegacyPbkdf2Password(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [algorithm, iterationsValue, saltValue, keyValue] =
    storedHash.split("$");
  const iterations = Number(iterationsValue);

  if (
    algorithm !== LEGACY_PASSWORD_ALGORITHM ||
    !Number.isInteger(iterations) ||
    iterations <= 0 ||
    !saltValue ||
    !keyValue
  ) {
    return false;
  }

  const salt = fromBase64Url(saltValue);
  const expectedKey = fromBase64Url(keyValue);
  const actualKey = await pbkdf2(
    password,
    salt,
    iterations,
    expectedKey.length,
    LEGACY_PASSWORD_DIGEST,
  );

  return (
    actualKey.length === expectedKey.length &&
    timingSafeEqual(actualKey, expectedKey)
  );
}

export async function createLegacyPbkdf2PasswordHashForTest(
  password: string,
): Promise<string> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Legacy password hash helper is for tests only.");
  }

  const salt = randomBytes(16);
  const derivedKey = await pbkdf2(
    password,
    salt,
    LEGACY_PASSWORD_ITERATIONS,
    LEGACY_PASSWORD_KEY_LENGTH,
    LEGACY_PASSWORD_DIGEST,
  );

  return [
    LEGACY_PASSWORD_ALGORITHM,
    String(LEGACY_PASSWORD_ITERATIONS),
    toBase64Url(salt),
    toBase64Url(derivedKey),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (storedHash.startsWith("$argon2")) {
    try {
      return await argon2.verify(storedHash, password);
    } catch {
      return false;
    }
  }

  return verifyLegacyPbkdf2Password(password, storedHash);
}

export function passwordNeedsRehash(storedHash: string): boolean {
  if (!storedHash.startsWith("$argon2id$")) {
    return true;
  }

  try {
    return argon2.needsRehash(storedHash, ARGON2ID_OPTIONS);
  } catch {
    return true;
  }
}
