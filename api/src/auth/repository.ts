// Where API keys come from. The interface lets HTTP tests use an in-memory fake;
// the real implementation reads the `api_keys` table in PostgreSQL.

import type { Sql } from 'postgres';
import type { ChaveApi, Permissao } from './keys.ts';

export interface RepositorioChaves {
  /**
   * Active key with this hash, or null (revoked, unknown, or owner deactivated).
   * Throws only on technical failure (DB down).
   */
  buscarPorHash(hash: string): Promise<ChaveApi | null>;
  /** Records that the key was used. Best effort: must never throw nor delay the request. */
  registrarUso(id: string): void;
}

export interface OpcoesRepositorio {
  /** How long a lookup (found or not) is cached. Bounds how long a revoked key keeps working. */
  cacheMs?: number;
  /** Minimum interval between `ultimo_uso_em` updates for the same key (avoids one write per request). */
  intervaloUsoMs?: number;
}

export class RepositorioChavesPg implements RepositorioChaves {
  private cache = new Map<string, { chave: ChaveApi | null; expira: number }>();
  private ultimoUsoGravado = new Map<string, number>();
  private readonly cacheMs: number;
  private readonly intervaloUsoMs: number;

  constructor(private readonly sql: Sql, opcoes: OpcoesRepositorio = {}) {
    this.cacheMs = opcoes.cacheMs ?? 10_000;
    this.intervaloUsoMs = opcoes.intervaloUsoMs ?? 60_000;
  }

  async buscarPorHash(hash: string): Promise<ChaveApi | null> {
    const agora = Date.now();
    const emCache = this.cache.get(hash);
    if (emCache && emCache.expira > agora) return emCache.chave;

    // Effective permissions = key ∩ owner's ceiling (admins have no ceiling). The dashboard already strips
    // permissions from keys when a ceiling shrinks; intersecting here too keeps that true even if it didn't.
    const [linha] = await this.sql<
      { id: string; nome: string; prefixo: string; usuario_id: string; permissoes: Permissao[]; limite_por_minuto: number | null }[]
    >`
      SELECT k.id, k.nome, k.prefixo, k.usuario_id, k.limite_por_minuto,
             CASE WHEN u.perfil = 'admin' THEN k.permissoes
                  ELSE ARRAY(SELECT p FROM unnest(k.permissoes) AS p WHERE p = ANY(u.permissoes_api)) END AS permissoes
      FROM api_keys k
      JOIN usuarios u ON u.id = k.usuario_id
      WHERE k.hash = ${hash} AND k.revogada_em IS NULL AND u.ativo
    `;
    const chave: ChaveApi | null = linha
      ? {
          id: linha.id, nome: linha.nome, prefixo: linha.prefixo, usuarioId: linha.usuario_id,
          permissoes: linha.permissoes, limitePorMinuto: linha.limite_por_minuto,
        }
      : null;

    // Unknown keys are cached too, so repeated bad keys don't hit the DB on every request.
    // Bounded size: drop everything if someone floods us with random keys.
    if (this.cache.size > 10_000) this.cache.clear();
    this.cache.set(hash, { chave, expira: agora + this.cacheMs });
    return chave;
  }

  registrarUso(id: string): void {
    const agora = Date.now();
    if (agora - (this.ultimoUsoGravado.get(id) ?? 0) < this.intervaloUsoMs) return;
    this.ultimoUsoGravado.set(id, agora);
    this.sql`UPDATE api_keys SET ultimo_uso_em = now() WHERE id = ${id}`.catch((e: Error) =>
      console.warn(`[auth] falha ao registrar uso da chave: ${e.message}`),
    );
  }
}
