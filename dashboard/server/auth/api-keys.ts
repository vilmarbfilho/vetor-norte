// API key format for the keys the dashboard creates. MUST match api/src/auth/keys.ts
// (the API validates them): "vn_" + 32 random bytes base64url, prefix = first 11 chars, SHA-256 hex hash.

import { createHash, randomBytes } from 'node:crypto';

/** Permissions a key can hold. Must match api/src/auth/keys.ts and the DB CHECK constraint. */
export const PERMISSOES = ['protocolos:listar', 'pdf:baixar', 'pdf:enviar'] as const;
export type Permissao = (typeof PERMISSOES)[number];

export function gerarChaveApi(): { chave: string; prefixo: string; hash: string } {
  const chave = 'vn_' + randomBytes(32).toString('base64url');
  return { chave, prefixo: chave.slice(0, 11), hash: createHash('sha256').update(chave).digest('hex') };
}
