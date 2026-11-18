// User management by admins (create, edit profile/permissions, activate, reset password).

import type { Sql, TransactionSql } from 'postgres';
import { paraUsuario, type LinhaUsuario } from './accounts.ts';
import { COLUNAS_CREDENCIAL, paraCredencial, type LinhaCredencial } from './credentials.ts';
import type {
  AlteracaoUsuario, NovoUsuario, RepositorioUsuarios, ResultadoUsuario, UsuarioResumo,
} from './types.ts';

type LinhaResumo = LinhaUsuario & { ativo: boolean; criado_em: Date; ultimo_login: Date | null }
  & ({ email_portal: null } | LinhaCredencial);

function paraResumo(l: LinhaResumo): UsuarioResumo {
  return {
    ...paraUsuario(l), ativo: l.ativo, criadoEm: l.criado_em.toISOString(),
    ultimoLogin: l.ultimo_login?.toISOString() ?? null,
    credencialPortal: l.email_portal === null ? null : paraCredencial(l as LinhaCredencial),
  };
}

/** Unique e-mail index violation (usuarios_email_unico). */
function emailDuplicado(e: unknown): boolean {
  return (e as { code?: string; constraint_name?: string }).code === '23505'
    && (e as { constraint_name?: string }).constraint_name === 'usuarios_email_unico';
}

export class RepositorioUsuariosPg implements RepositorioUsuarios {
  constructor(private readonly sql: Sql) {}

  private async buscar(db: Sql | TransactionSql, id?: string): Promise<UsuarioResumo[]> {
    const linhas = await db<LinhaResumo[]>`
      SELECT u.id, u.nome, u.email, u.idioma, u.perfil, u.telas, u.permissoes_api, u.trocar_senha,
             u.ativo, u.criado_em, u.ultimo_login, ${db.unsafe(COLUNAS_CREDENCIAL)}
      FROM usuarios u
      LEFT JOIN credenciais_portal c ON c.usuario_id = u.id
      LEFT JOIN usuarios ap ON ap.id = c.atualizada_por
      ${id ? db`WHERE u.id = ${id}` : db``}
      ORDER BY u.ativo DESC, lower(u.nome)
    `;
    return linhas.map(paraResumo);
  }

  listar(): Promise<UsuarioResumo[]> {
    return this.buscar(this.sql);
  }

  async obter(id: string): Promise<UsuarioResumo | null> {
    return (await this.buscar(this.sql, id))[0] ?? null;
  }

  async criar(n: NovoUsuario): Promise<ResultadoUsuario> {
    try {
      const [{ id }] = (await this.sql<{ id: string }[]>`
        INSERT INTO usuarios (nome, email, senha_hash, perfil, telas, permissoes_api, trocar_senha)
        VALUES (${n.nome}, ${n.email}, ${n.senhaHash}, ${n.perfil}, ${n.telas}, ${n.permissoesApi}, true)
        RETURNING id
      `) as unknown as [{ id: string }];
      return { tipo: 'ok', usuario: (await this.obter(id))! };
    } catch (e) {
      if (emailDuplicado(e)) return { tipo: 'email_em_uso' };
      throw e;
    }
  }

  async alterar(id: string, a: AlteracaoUsuario): Promise<ResultadoUsuario> {
    const campos: Record<string, unknown> = {};
    if (a.nome !== undefined) campos.nome = a.nome;
    if (a.email !== undefined) campos.email = a.email;
    if (a.perfil !== undefined) campos.perfil = a.perfil;
    if (a.telas !== undefined) campos.telas = a.telas;
    if (a.permissoesApi !== undefined) campos.permissoes_api = a.permissoesApi;
    try {
      return await this.sql.begin(async (tx) => {
        const r = await tx`UPDATE usuarios SET ${tx(campos as Record<string, string>)} WHERE id = ${id} RETURNING perfil`;
        if (r.count === 0) return { tipo: 'nao_encontrado' } as const;
        if (r[0]!.perfil === 'corretor') {
          // Removing a permission from the ceiling removes it from the keys too (decided with the owner:
          // granting it again later must not silently re-enable old keys).
          await tx`
            UPDATE api_keys k
            SET permissoes = ARRAY(SELECT p FROM unnest(k.permissoes) AS p WHERE p = ANY(u.permissoes_api))
            FROM usuarios u
            WHERE u.id = k.usuario_id AND k.usuario_id = ${id} AND k.revogada_em IS NULL
              AND NOT (k.permissoes <@ u.permissoes_api)
          `;
        }
        return { tipo: 'ok', usuario: (await this.buscar(tx, id))[0]! } as const;
      });
    } catch (e) {
      if (emailDuplicado(e)) return { tipo: 'email_em_uso' };
      throw e;
    }
  }

  async definirAtivo(id: string, ativo: boolean): Promise<ResultadoUsuario> {
    return this.sql.begin(async (tx) => {
      const r = await tx`UPDATE usuarios SET ativo = ${ativo} WHERE id = ${id}`;
      if (r.count === 0) return { tipo: 'nao_encontrado' } as const;
      if (!ativo) await tx`DELETE FROM sessoes WHERE usuario_id = ${id}`;
      return { tipo: 'ok', usuario: (await this.buscar(tx, id))[0]! } as const;
    });
  }

  async redefinirSenha(id: string, senhaHash: string): Promise<ResultadoUsuario> {
    return this.sql.begin(async (tx) => {
      const r = await tx`UPDATE usuarios SET senha_hash = ${senhaHash}, trocar_senha = true WHERE id = ${id}`;
      if (r.count === 0) return { tipo: 'nao_encontrado' } as const;
      await tx`DELETE FROM sessoes WHERE usuario_id = ${id}`;
      return { tipo: 'ok', usuario: (await this.buscar(tx, id))[0]! } as const;
    });
  }
}
