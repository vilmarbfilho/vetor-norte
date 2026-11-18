// API key format, generation and hashing. Pure functions (no DB), shared by the API and the key CLI.

import { createHash, randomBytes } from 'node:crypto';

/** Permissions a key can hold. Must match the CHECK constraint in db/migrations. */
export const PERMISSOES = ['protocolos:listar', 'pdf:baixar', 'pdf:enviar'] as const;
export type Permissao = (typeof PERMISSOES)[number];

/** A valid, non-revoked key as seen by the API (never contains the secret or its hash). */
export interface ChaveApi {
  id: string;
  nome: string;
  prefixo: string;
  /** Owner: their portal credentials are used, and their history rows carry this id. */
  usuarioId: string;
  /** Effective permissions: the key's, limited to the owner's ceiling (unless the owner is an admin). */
  permissoes: Permissao[];
  /** Requests per minute for this key; null = global default (RATE_LIMIT_POR_MINUTO). */
  limitePorMinuto: number | null;
}

const MARCADOR = 'vn_';
const TAMANHO_PREFIXO = MARCADOR.length + 8;

export function permissaoValida(p: string): p is Permissao {
  return (PERMISSOES as readonly string[]).includes(p);
}

/**
 * New random key: "vn_" + 32 random bytes in base64url (256 bits).
 * The "vn_" marker makes leaked keys easy to recognize (e.g. by secret scanners).
 */
export function gerarChave(): { chave: string; prefixo: string; hash: string } {
  const chave = MARCADOR + randomBytes(32).toString('base64url');
  return { chave, prefixo: prefixoDaChave(chave), hash: hashDaChave(chave) };
}

/** Visible part stored in plain text, so people can tell keys apart in listings. */
export function prefixoDaChave(chave: string): string {
  return chave.slice(0, TAMANHO_PREFIXO);
}

/**
 * SHA-256 is enough here (no bcrypt/argon2): keys have 256 bits of entropy, so they can't be
 * brute-forced, and a fast hash keeps per-request lookups cheap.
 */
export function hashDaChave(chave: string): string {
  return createHash('sha256').update(chave).digest('hex');
}

/** Reads the key from "Authorization: Bearer <key>" or "X-API-Key: <key>". */
export function chaveDosCabecalhos(cabecalhos: Record<string, string | string[] | undefined>): string | null {
  const auth = cabecalhos['authorization'];
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
    if (m) return m[1]!;
  }
  const x = cabecalhos['x-api-key'];
  return typeof x === 'string' && x.trim() ? x.trim() : null;
}
