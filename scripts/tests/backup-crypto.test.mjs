import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  BACKUP_HEADER_LENGTH,
  BACKUP_TAG_LENGTH,
  buildBackupHeader,
  decryptBackupToFile,
  getBackupEncryptionKey,
  getEncryptionKeyFingerprint,
  isEncryptedBackup,
  parseBackupHeader,
  writeEncryptedBackup,
} from "../lib/backup-crypto.mjs";

const tempDirs = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ftm-backup-test-"));

  tempDirs.push(dir);

  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop(), { force: true, recursive: true });
  }
});

describe("backup encryption key parsing", () => {
  it("accepts base64url, base64, and hex keys", () => {
    const key = randomBytes(32);

    expect(getBackupEncryptionKey(key.toString("base64url"))).toHaveLength(32);
    expect(getBackupEncryptionKey(key.toString("base64"))).toHaveLength(32);
    expect(getBackupEncryptionKey(key.toString("hex"))).toHaveLength(32);
  });

  it("returns null when no key is configured", () => {
    expect(getBackupEncryptionKey("")).toBeNull();
    expect(getBackupEncryptionKey(undefined)).toBeNull();
  });

  it("rejects keys with the wrong length", () => {
    expect(() => getBackupEncryptionKey("too-short")).toThrow(/32-byte key/);
  });

  it("produces a stable, non-reversible fingerprint", () => {
    const key = randomBytes(32);

    expect(getEncryptionKeyFingerprint(key)).toBe(
      getEncryptionKeyFingerprint(key),
    );
    expect(getEncryptionKeyFingerprint(key)).toMatch(/^sha256:[a-f0-9]{16}$/);
  });
});

describe("backup container header", () => {
  it("round-trips the compression flag and IV", () => {
    const iv = randomBytes(12);

    for (const compressed of [true, false]) {
      const parsed = parseBackupHeader(buildBackupHeader({ compressed, iv }));

      expect(parsed.compressed).toBe(compressed);
      expect(parsed.iv.equals(iv)).toBe(true);
    }
  });

  it("rejects a foreign or truncated header", () => {
    expect(() => parseBackupHeader(Buffer.from("not-a-backup"))).toThrow();
    expect(() =>
      parseBackupHeader(Buffer.concat([Buffer.from("XXXX"), randomBytes(20)])),
    ).toThrow(/not an FTM encrypted backup/i);
  });
});

describe("encrypted backup round trip", () => {
  it("encrypts, detects encryption, and decrypts with the same key", async () => {
    const dir = await makeTempDir();
    const payloadPath = path.join(dir, "dump.sql");
    const backupPath = path.join(dir, "backup.sql.gz.enc");
    const restoredPath = path.join(dir, "restored.sql");
    const key = randomBytes(32);
    const payload = "CREATE TABLE demo (id INT);\nINSERT INTO `demo` VALUES (1);\n";

    await writeFile(payloadPath, payload, "utf8");
    await writeEncryptedBackup({
      compressionEnabled: true,
      inputStream: createReadStream(payloadPath),
      key,
      outputPath: backupPath,
    });

    expect(await isEncryptedBackup(backupPath)).toBe(true);

    const backupStat = await stat(backupPath);
    const rawBackup = await readFile(backupPath);

    // The plaintext must not appear anywhere in the encrypted container.
    expect(rawBackup.includes(Buffer.from("CREATE TABLE"))).toBe(false);
    expect(backupStat.size).toBeGreaterThan(BACKUP_HEADER_LENGTH + BACKUP_TAG_LENGTH);

    await decryptBackupToFile({
      inputPath: backupPath,
      key,
      outputPath: restoredPath,
    });

    expect(await readFile(restoredPath, "utf8")).toBe(payload);
  });

  it("supports uncompressed encrypted backups", async () => {
    const dir = await makeTempDir();
    const payloadPath = path.join(dir, "dump.sql");
    const backupPath = path.join(dir, "backup.sql.enc");
    const restoredPath = path.join(dir, "restored.sql");
    const key = randomBytes(32);

    await writeFile(payloadPath, "SELECT 1;\n", "utf8");
    await writeEncryptedBackup({
      compressionEnabled: false,
      inputStream: createReadStream(payloadPath),
      key,
      outputPath: backupPath,
    });

    await decryptBackupToFile({
      inputPath: backupPath,
      key,
      outputPath: restoredPath,
    });

    expect(await readFile(restoredPath, "utf8")).toBe("SELECT 1;\n");
  });

  it("fails when the wrong key is used", async () => {
    const dir = await makeTempDir();
    const payloadPath = path.join(dir, "dump.sql");
    const backupPath = path.join(dir, "backup.sql.gz.enc");

    await writeFile(payloadPath, "SELECT 1;\n", "utf8");
    await writeEncryptedBackup({
      compressionEnabled: true,
      inputStream: createReadStream(payloadPath),
      key: randomBytes(32),
      outputPath: backupPath,
    });

    await expect(
      decryptBackupToFile({
        inputPath: backupPath,
        key: randomBytes(32),
        outputPath: path.join(dir, "wrong-key.sql"),
      }),
    ).rejects.toThrow();
  });

  it("fails when the ciphertext was tampered with", async () => {
    const dir = await makeTempDir();
    const payloadPath = path.join(dir, "dump.sql");
    const backupPath = path.join(dir, "backup.sql.gz.enc");
    const key = randomBytes(32);

    await writeFile(payloadPath, "SELECT 1;\n", "utf8");
    await writeEncryptedBackup({
      compressionEnabled: true,
      inputStream: createReadStream(payloadPath),
      key,
      outputPath: backupPath,
    });

    const raw = await readFile(backupPath);

    raw[BACKUP_HEADER_LENGTH + 1] ^= 0xff;
    await writeFile(backupPath, raw);

    await expect(
      decryptBackupToFile({
        inputPath: backupPath,
        key,
        outputPath: path.join(dir, "tampered.sql"),
      }),
    ).rejects.toThrow();
  });

  it("refuses obviously truncated files", async () => {
    const dir = await makeTempDir();
    const backupPath = path.join(dir, "truncated.enc");

    await writeFile(backupPath, randomBytes(20));

    await expect(
      decryptBackupToFile({
        inputPath: backupPath,
        key: randomBytes(32),
        outputPath: path.join(dir, "out.sql"),
      }),
    ).rejects.toThrow(/truncated/i);
  });
});

describe("plain backups", () => {
  it("does not report a plain SQL file as encrypted", async () => {
    const dir = await makeTempDir();
    const plainPath = path.join(dir, "plain.sql");

    await writeFile(plainPath, "SELECT 1;\n", "utf8");

    expect(await isEncryptedBackup(plainPath)).toBe(false);
  });
});
