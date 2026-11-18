// Session tokens: 256 random bits in the cookie; only their SHA-256 hash goes to the database,
// so a database leak does not give access to open sessions.

import { createHash, randomBytes } from 'node:crypto';

export const COOKIE_SESSAO = 'vn_sessao';

export function gerarToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
