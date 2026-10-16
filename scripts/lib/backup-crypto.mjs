import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

/**
 * Encrypted backup container format (STB1).
 *
 * ```
 * offset 0   magic  "STB1"         4 bytes
 * offset 4   flags  bit0 = gzip    1 byte
 * offset 5   iv                   12 bytes
 * offset 17  ciphertext           n bytes
 * end - 16   gcm authentication tag
 * ```
 *
 * AES-256-GCM gives confidentiality *and* tamper detection: a modified backup
 * fails to decrypt instead of silently restoring corrupted data.
 */
export const BACKUP_MAGIC = Buffer.from("STB1", "utf8");
export const BACKUP_HEADER_LENGTH = BACKUP_MAGIC.length + 1 + 12;
export const BACKUP_TAG_LENGTH = 16;

const AES_KEY_BYTES = 32;

export function getBackupEncryptionKey(
  envValue = process.env.MYSQL_BACKUP_ENCRYPTION_KEY,
) {
  const raw = envValue?.trim();

  if (!raw) {
    return null;
  }

  const candidates = [
    Buffer.from(raw, "base64url"),
    Buffer.from(raw, "base64"),
    Buffer.from(raw, "hex"),
  ];
  const key = candidates.find((candidate) => candidate.length === AES_KEY_BYTES);

  if (!key) {
    throw new Error(
      "MYSQL_BACKUP_ENCRYPTION_KEY must be a 32-byte key encoded as base64url, base64, or hex. Generate one with: node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64url'))\"",
    );
  }

  return key;
}

export function getEncryptionKeyFingerprint(key) {
  return `sha256:${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

export function buildBackupHeader({ compressed, iv }) {
  return Buffer.concat([
    BACKUP_MAGIC,
    Buffer.from([compressed ? 0x01 : 0x00]),
    iv,
  ]);
}

export function parseBackupHeader(header) {
  if (header.length < BACKUP_HEADER_LENGTH) {
    throw new Error("Backup file is too small to contain a valid header.");
  }

  if (!header.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new Error("Backup file is not an FTM encrypted backup (bad magic).");
  }

  const flags = header[BACKUP_MAGIC.length];

  return {
    compressed: (flags & 0x01) === 0x01,
    iv: header.subarray(BACKUP_MAGIC.length + 1, BACKUP_HEADER_LENGTH),
  };
}

/**
 * Encrypts a dump stream into `outputPath`: header, ciphertext, auth tag.
 */
export async function writeEncryptedBackup({
  compressionEnabled,
  inputStream,
  key,
  outputPath,
}) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const headerHandle = await open(outputPath, "wx");

  try {
    await headerHandle.write(buildBackupHeader({ compressed: compressionEnabled, iv }));
  } finally {
    await headerHandle.close();
  }

  await pipeline(
    inputStream,
    ...(compressionEnabled ? [createGzip()] : []),
    cipher,
    createWriteStream(outputPath, { flags: "a" }),
  );

  const authTag = cipher.getAuthTag();
  const tagHandle = await open(outputPath, "a");

  try {
    await tagHandle.write(authTag);
  } finally {
    await tagHandle.close();
  }

  return { authTagLength: authTag.length, ivLength: iv.length };
}

export async function isEncryptedBackup(filePath) {
  const handle = await open(filePath, "r");

  try {
    const buffer = Buffer.alloc(BACKUP_MAGIC.length);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);

    return bytesRead === buffer.length && buffer.equals(BACKUP_MAGIC);
  } finally {
    await handle.close();
  }
}

/**
 * Decrypts (and decompresses) an STB1 backup into `outputPath`.
 *
 * A wrong key or a modified file makes the GCM authentication check fail,
 * which throws instead of producing a corrupt restore.
 */
export async function decryptBackupToFile({ inputPath, outputPath, key }) {
  const fileStat = await stat(inputPath);

  if (fileStat.size <= BACKUP_HEADER_LENGTH + BACKUP_TAG_LENGTH) {
    throw new Error("Backup file is truncated.");
  }

  const handle = await open(inputPath, "r");
  let header;
  let authTag;

  try {
    const headerBuffer = Buffer.alloc(BACKUP_HEADER_LENGTH);
    const tagBuffer = Buffer.alloc(BACKUP_TAG_LENGTH);

    await handle.read(headerBuffer, 0, BACKUP_HEADER_LENGTH, 0);
    await handle.read(
      tagBuffer,
      0,
      BACKUP_TAG_LENGTH,
      fileStat.size - BACKUP_TAG_LENGTH,
    );

    header = parseBackupHeader(headerBuffer);
    authTag = tagBuffer;
  } finally {
    await handle.close();
  }

  const decipher = createDecipheriv("aes-256-gcm", key, header.iv);

  decipher.setAuthTag(authTag);

  await pipeline(
    createReadStream(inputPath, {
      end: fileStat.size - BACKUP_TAG_LENGTH - 1,
      start: BACKUP_HEADER_LENGTH,
    }),
    decipher,
    ...(header.compressed ? [createGunzip()] : []),
    createWriteStream(outputPath, { flags: "wx" }),
  );

  return { compressed: header.compressed };
}
