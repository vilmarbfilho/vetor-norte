// API keys management (the API reads the same table to authenticate requests).

import type { Sql } from 'postgres';
import type { Permissao } from '../auth/api-keys.ts';
import type { AlteracaoChave, ChaveApiResumo, NovaChave, RepositorioChaves, ResultadoAlteracaoChave } from './types.ts';

interface LinhaChave {
  id: string; nome: string; prefixo: string; permissoes: Permissao[]; limite_por_minuto: number | null;
  criada_em: Date; ultimo_uso_em: Date | null; revogada_em: Date | null;
  dono_id: string; dono_nome: string;
  criado_por_id: string | null; criado_por_nome: string | null;
  revogada_por_id: string | null; revogada_por_nome: string | null;
}

function paraChave(l: LinhaChave): ChaveApiResumo {
  return {
    id: l.id, nome: l.nome, prefixo: l.prefixo, permissoes: l.permissoes, limitePorMinuto: l.limite_por_minuto,
    criadaEm: l.criada_em.toISOString(), ultimoUsoEm: l.ultimo_uso_em?.toISOString() ?? null,
    revogadaEm: l.revogada_em?.toISOString() ?? null,
    dono: { id: l.dono_id, nome: l.dono_nome },
    criadaPor: l.criado_por_id ? { id: l.criado_por_id, nome: l.criado_por_nome! } : null,
    revogadaPor: l.revogada_por_id ? { id: l.revogada_por_id, nome: l.revogada_por_nome! } : null,
  };
}

export class RepositorioChavesPg implements RepositorioChaves {
  constructor(private readonly sql: Sql) {}

  /** Never selects `hash`: it is not needed outside the API. */
  private async buscar(f: { id?: string; usuarioId?: string }): Promise<ChaveApiResumo[]> {
    const sql = this.sql;
    const linhas = await sql<LinhaChave[]>`
      SELECT k.id, k.nome, k.prefixo, k.permissoes, k.limite_por_minuto, k.criada_em, k.ultimo_uso_em, k.revogada_em,
             d.id AS dono_id, d.nome AS dono_nome,
             c.id AS criado_por_id, c.nome AS criado_por_nome, r.id AS revogada_por_id, r.nome AS revogada_por_nome
      FROM api_keys k
      JOIN usuarios d ON d.id = k.usuario_id
      LEFT JOIN usuarios c ON c.id = k.criado_por
      LEFT JOIN usuarios r ON r.id = k.revogada_por
      WHERE TRUE
        ${f.id ? sql`AND k.id = ${f.id}` : sql``}
        ${f.usuarioId ? sql`AND k.usuario_id = ${f.usuarioId}` : sql``}
      ORDER BY k.revogada_em IS NOT NULL, k.criada_em DESC
    `;
    return linhas.map(paraChave);
  }

  listar(filtro: { usuarioId?: string } = {}): Promise<ChaveApiResumo[]> {
    return this.buscar({ usuarioId: filtro.usuarioId });
  }

  async obter(id: string): Promise<ChaveApiResumo | null> {
    return (await this.buscar({ id }))[0] ?? null;
  }

  async criar(n: NovaChave): Promise<ChaveApiResumo> {
    const [{ id }] = (await this.sql<{ id: string }[]>`
      INSERT INTO api_keys (nome, prefixo, hash, permissoes, limite_por_minuto, usuario_id, criado_por)
      VALUES (${n.nome}, ${n.prefixo}, ${n.hash}, ${n.permissoes}, ${n.limitePorMinuto}, ${n.usuarioId}, ${n.criadoPor})
      RETURNING id
    `) as unknown as [{ id: string }];
    return (await this.obter(id))!;
  }

  private async estado(id: string): Promise<ResultadoAlteracaoChave | null> {
    const atual = await this.obter(id);
    if (!atual) return { tipo: 'nao_encontrada' };
    if (atual.revogadaEm) return { tipo: 'revogada' };
    return null;
  }

  async alterar(id: string, a: AlteracaoChave): Promise<ResultadoAlteracaoChave> {
    const bloqueio = await this.estado(id);
    if (bloqueio) return bloqueio;
    const campos: Record<string, unknown> = {};
    if (a.nome !== undefined) campos.nome = a.nome;
    if (a.permissoes !== undefined) campos.permissoes = a.permissoes;
    if (a.limitePorMinuto !== undefined) campos.limite_por_minuto = a.limitePorMinuto;
    if (Object.keys(campos).length) {
      await this.sql`UPDATE api_keys SET ${this.sql(campos as Record<string, string>)} WHERE id = ${id} AND revogada_em IS NULL`;
    }
    return { tipo: 'ok', chave: (await this.obter(id))! };
  }

  async revogar(id: string, usuarioId: string): Promise<ResultadoAlteracaoChave> {
    const bloqueio = await this.estado(id);
    if (bloqueio) return bloqueio;
    await this.sql`
      UPDATE api_keys SET revogada_em = now(), revogada_por = ${usuarioId} WHERE id = ${id} AND revogada_em IS NULL
    `;
    return { tipo: 'ok', chave: (await this.obter(id))! };
  }
}
