#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import process from "node:process";

function printHelp() {
  globalThis.console.log(`
Generate pilot device key and hash.

Pemakaian:
  pnpm pilot:hash-key
  DEVICE_KEY="existing-key" pnpm pilot:hash-key

Catatan:
  - Simpan device key asli di tempat aman.
  - Jangan commit device key asli.
  - The database only needs the sha256 hash value:...
`);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const providedKey = process.env.DEVICE_KEY?.trim();
const generatedKey = providedKey || randomBytes(32).toString("hex");
const hash = `sha256:${sha256(generatedKey)}`;

if (providedKey) {
  globalThis.console.log("Mode: hash from DEVICE_KEY environment");
  globalThis.console.log("The raw device key is not printed again by the script.");
} else {
  globalThis.console.log("Mode: generate key baru");
  globalThis.console.log("");
  globalThis.console.log("DEVICE_KEY_ASLI_SIMPAN_AMAN:");
  globalThis.console.log(generatedKey);
}

globalThis.console.log("");
globalThis.console.log("API_KEY_HASH_UNTUK_DATABASE:");
globalThis.console.log(hash);
globalThis.console.log("");
globalThis.console.log(
  "Warning: do not commit the raw key, the .env.local file, or the local registry file.",
);
