// Keyed CPF hash for the protocol query history (LGPD: searchable without storing the CPF).
// Same algorithm in api/src/audit/cpf-hash.ts (the API writes the hash): keep them in sync.

import { createHmac } from 'node:crypto';

/** Minimum CPF_HMAC_CHAVE length: a short key would let anyone brute-force the ~10^9 CPFs offline. */
export const TAMANHO_MINIMO_CHAVE = 32;

/** HMAC-SHA256(chave, CPF digits) in hex. Formatting does not matter: 529.982.247-25 = 52998224725. */
export function hashCpf(cpf: string, chave: string): string {
  return createHmac('sha256', chave).update(cpf.replace(/\D/g, '')).digest('hex');
}

/** Reads and validates CPF_HMAC_CHAVE (required by the server). */
export function chaveHmacCpf(valor: string | undefined): string {
  if (!valor || valor.length < TAMANHO_MINIMO_CHAVE) {
    throw new Error(
      `CPF_HMAC_CHAVE ausente ou curta (mínimo ${TAMANHO_MINIMO_CHAVE} caracteres). Gere com: openssl rand -hex 32`,
    );
  }
  return valor;
}
