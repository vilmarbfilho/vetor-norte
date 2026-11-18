// Broker portal credentials (one row per user). The encrypted password is written here and never read back
// by the dashboard: only the API decrypts it (stage 17).

import type { Sql } from 'postgres';
import type { RepositorioCredenciais, ResumoCredencial, StatusCredencial } from './types.ts';

export interface LinhaCredencial {
  email_portal: string; status: StatusCredencial; atualizada_em: Date;
  atualizada_por_id: string | null; atualizada_por_nome: string | null;
  ultimo_login_ok_em: Date | null; invalidada_em: Date | null;
}

/** Columns for `LinhaCredencial`; use with `c` = credenciais_portal and `ap` = usuarios (who updated). */
export const COLUNAS_CREDENCIAL = `c.email_portal, c.status, c.atualizada_em, ap.id AS atualizada_por_id,
  ap.nome AS atualizada_por_nome, c.ultimo_login_ok_em, c.invalidada_em`;

export function paraCredencial(l: LinhaCredencial): ResumoCredencial {
  return {
    emailPortal: l.email_portal, status: l.status, atualizadaEm: l.atualizada_em.toISOString(),
    atualizadaPor: l.atualizada_por_id ? { id: l.atualizada_por_id, nome: l.atualizada_por_nome! } : null,
    ultimoLoginOkEm: l.ultimo_login_ok_em?.toISOString() ?? null,
    invalidadaEm: l.invalidada_em?.toISOString() ?? null,
  };
}

export class RepositorioCredenciaisPg implements RepositorioCredenciais {
  constructor(private readonly sql: Sql) {}

  async obter(usuarioId: string): Promise<ResumoCredencial | null> {
    const [l] = await this.sql<LinhaCredencial[]>`
      SELECT ${this.sql.unsafe(COLUNAS_CREDENCIAL)}
      FROM credenciais_portal c LEFT JOIN usuarios ap ON ap.id = c.atualizada_por
      WHERE c.usuario_id = ${usuarioId}
    `;
    return l ? paraCredencial(l) : null;
  }

  async salvar(c: { usuarioId: string; emailPortal: string; senhaCifrada: Buffer; atualizadaPor: string }) {
    const r = await this.sql`
      INSERT INTO credenciais_portal (usuario_id, email_portal, senha_cifrada, status, atualizada_em, atualizada_por)
      SELECT u.id, ${c.emailPortal}, ${c.senhaCifrada}, 'nao_testada', now(), ${c.atualizadaPor}
      FROM usuarios u WHERE u.id = ${c.usuarioId}
      ON CONFLICT (usuario_id) DO UPDATE SET
        email_portal = EXCLUDED.email_portal, senha_cifrada = EXCLUDED.senha_cifrada, status = 'nao_testada',
        atualizada_em = now(), atualizada_por = EXCLUDED.atualizada_por,
        ultimo_login_ok_em = NULL, invalidada_em = NULL
    `;
    return r.count === 0 ? null : this.obter(c.usuarioId);
  }
}
