#!/usr/bin/env node
/**
 * Encrypts data/combinations.json into data/vault.json using a password.
 *
 *   node tools/build-vault.mjs "your-password"
 *
 * The site is static, so the ciphertext is public. The password is what turns
 * it back into readable text: without it the vault is just noise. Change the
 * password by re-running this script and committing the new vault.json.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { webcrypto as crypto } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ITERATIONS = 250000;

const password = process.argv[2];
if (!password) {
  console.error('Usage: node tools/build-vault.mjs "your-password"');
  process.exit(1);
}

const b64 = (buf) => Buffer.from(buf).toString('base64');

const source = JSON.parse(await readFile(resolve(ROOT, 'data/combinations.json'), 'utf8'));
const plaintext = new TextEncoder().encode(JSON.stringify(source));

const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));

const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
  baseKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt']
);
const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

const vault = {
  v: 1,
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: b64(salt) },
  cipher: 'AES-GCM',
  iv: b64(iv),
  data: b64(ciphertext),
  rows: source.rows.length,
  builtAt: new Date().toISOString(),
};

await writeFile(resolve(ROOT, 'data/vault.json'), JSON.stringify(vault));
console.log(`Encrypted ${vault.rows} combinations into data/vault.json (${(vault.data.length / 1024).toFixed(0)} KB).`);
