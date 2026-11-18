// Encryption of the Broker portal passwords stored in `credenciais_portal.senha_cifrada`.
// The dashboard encrypts (users type the password here); the API decrypts it to log in to the portal.
// Same format in api/ (stage 17): keep both in sync (fixed test vector in both test suites).
//
// AES-256-GCM, key = CREDENCIAIS_CHAVE (32 random bytes, base64).
// Stored bytes: iv (12) || auth tag (16) || ciphertext.
// The user id is the additional authenticated data: a ciphertext copied into another user's row
// fails to decrypt, so someone with write access to the database cannot reuse a password for another user.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITMO = 'aes-256-gcm';
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;

/** Reads and validates CREDENCIAIS_CHAVE (required by the server). */
export function chaveCredenciais(valor: string | undefined): Buffer {
  const chave = valor ? Buffer.from(valor, 'base64') : Buffer.alloc(0);
  if (chave.length !== 32) {
    throw new Error('CREDENCIAIS_CHAVE ausente ou inválida (32 bytes em base64). Gere com: openssl rand -base64 32');
  }
  return chave;
}

export function cifrarSenha(senha: string, chave: Buffer, usuarioId: string): Buffer {
  const iv = randomBytes(TAMANHO_IV);
  const cifra = createCipheriv(ALGORITMO, chave, iv);
  cifra.setAAD(Buffer.from(usuarioId, 'utf8'));
  const texto = Buffer.concat([cifra.update(senha, 'utf8'), cifra.final()]);
  return Buffer.concat([iv, cifra.getAuthTag(), texto]);
}

/** Throws if the data was tampered with, belongs to another user, or was encrypted with another key. */
export function decifrarSenha(dado: Buffer, chave: Buffer, usuarioId: string): string {
  if (dado.length <= TAMANHO_IV + TAMANHO_TAG) throw new Error('Senha cifrada inválida');
  const decifra = createDecipheriv(ALGORITMO, chave, dado.subarray(0, TAMANHO_IV));
  decifra.setAAD(Buffer.from(usuarioId, 'utf8'));
  decifra.setAuthTag(dado.subarray(TAMANHO_IV, TAMANHO_IV + TAMANHO_TAG));
  return Buffer.concat([decifra.update(dado.subarray(TAMANHO_IV + TAMANHO_TAG)), decifra.final()]).toString('utf8');
}
