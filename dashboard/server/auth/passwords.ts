// Password hashing with scrypt (built into Node: no native dependency).
// Stored format: scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>, so parameters can be raised later
// without breaking existing hashes.

import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (senha: string, salt: Buffer, tamanho: number, opcoes: ScryptOptions) =>
  new Promise<Buffer>((ok, falha) => scryptCb(senha, salt, tamanho, opcoes, (e, chave) => (e ? falha(e) : ok(chave))));

// N=2^15, r=8: ~32 MB and ~50-100 ms per hash. Slow on purpose (brute force), fine for 2 users.
const PADRAO = { N: 32_768, r: 8, p: 1 };
const TAMANHO = 64;
export const SENHA_MIN = 10;

export async function hashSenha(senha: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(senha, salt, TAMANHO, { ...PADRAO, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', PADRAO.N, PADRAO.r, PADRAO.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verificarSenha(senha: string, armazenado: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = armazenado.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const esperado = Buffer.from(hash, 'base64');
  const calculado = await scrypt(senha, Buffer.from(salt, 'base64'), esperado.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(calculado, esperado);
}

/** Hash of a random password, used to spend the same time when the e-mail does not exist
 *  (so response time does not reveal which e-mails are registered). */
export const HASH_FICTICIO = await hashSenha(randomBytes(16).toString('hex'));

/**
 * Temporary password for users created or reset by an admin (shown once, must be changed at the next
 * login). 12 random bytes in base64url = 16 characters, 96 bits.
 */
export function gerarSenhaTemporaria(): string {
  return randomBytes(12).toString('base64url');
}
