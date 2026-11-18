// Users and login sessions in PostgreSQL.

import type { Sql } from 'postgres';
import type { Perfil, Tela } from '../auth/access.ts';
import type { Permissao } from '../auth/api-keys.ts';
import type { Idioma, RepositorioContas, Usuario } from './types.ts';

/** Columns of `usuarios` that make up a `Usuario` (use with the `u` alias). */
export interface LinhaUsuario {
  id: string; nome: string; email: string; idioma: Idioma; perfil: Perfil; telas: Tela[];
  permissoes_api: Permissao[]; trocar_senha: boolean;
}

export function paraUsuario(l: LinhaUsuario): Usuario {
  return {
    id: l.id, nome: l.nome, email: l.email, idioma: l.idioma, perfil: l.perfil, telas: l.telas,
    permissoesApi: l.permissoes_api, trocarSenha: l.trocar_senha,
  };
}

export class RepositorioContasPg implements RepositorioContas {
  constructor(private readonly sql: Sql) {}

  async buscarParaLogin(email: string) {
    const [u] = await this.sql<(LinhaUsuario & { senha_hash: string; ativo: boolean })[]>`
      SELECT u.* FROM usuarios u WHERE lower(u.email) = lower(${email.trim()})
    `;
    return u ? { ...paraUsuario(u), senhaHash: u.senha_hash, ativo: u.ativo } : null;
  }

  async registrarLogin(usuarioId: string): Promise<void> {
    await this.sql`UPDATE usuarios SET ultimo_login = now() WHERE id = ${usuarioId}`;
  }

  async criarSessao(s: { usuarioId: string; tokenHash: string; expiraEm: Date; ip: string | null; userAgent: string | null }) {
    await this.sql`
      INSERT INTO sessoes (usuario_id, token_hash, expira_em, ip, user_agent)
      VALUES (${s.usuarioId}, ${s.tokenHash}, ${s.expiraEm}, ${s.ip}, ${s.userAgent?.slice(0, 300) ?? null})
    `;
  }

  async sessaoValida(tokenHash: string, inatividadeMs: number) {
    const [linha] = await this.sql<(LinhaUsuario & { sessao_id: string })[]>`
      SELECT s.id AS sessao_id, u.id, u.nome, u.email, u.idioma, u.perfil, u.telas, u.permissoes_api, u.trocar_senha
      FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ${tokenHash}
        AND s.expira_em > now()
        AND s.ultimo_uso_em > now() - make_interval(secs => ${inatividadeMs / 1000})
        AND u.ativo
    `;
    if (!linha) return null;
    return { sessaoId: linha.sessao_id, usuario: paraUsuario(linha) };
  }

  async tocarSessao(sessaoId: string): Promise<void> {
    // At most one write per minute per session.
    await this.sql`
      UPDATE sessoes SET ultimo_uso_em = now()
      WHERE id = ${sessaoId} AND ultimo_uso_em < now() - interval '1 minute'
    `;
  }

  async encerrarSessao(tokenHash: string): Promise<void> {
    await this.sql`DELETE FROM sessoes WHERE token_hash = ${tokenHash}`;
  }

  async definirIdioma(usuarioId: string, idioma: Idioma): Promise<void> {
    await this.sql`UPDATE usuarios SET idioma = ${idioma} WHERE id = ${usuarioId}`;
  }

  async hashDaSenha(usuarioId: string): Promise<string | null> {
    const [u] = await this.sql<{ senha_hash: string }[]>`SELECT senha_hash FROM usuarios WHERE id = ${usuarioId}`;
    return u?.senha_hash ?? null;
  }

  async alterarSenha(usuarioId: string, senhaHash: string, manterSessaoId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`UPDATE usuarios SET senha_hash = ${senhaHash}, trocar_senha = false WHERE id = ${usuarioId}`;
      await tx`DELETE FROM sessoes WHERE usuario_id = ${usuarioId} AND id <> ${manterSessaoId}`;
    });
  }

  async purgarSessoesExpiradas(inatividadeMs: number): Promise<number> {
    const r = await this.sql`
      DELETE FROM sessoes
      WHERE expira_em <= now() OR ultimo_uso_em <= now() - make_interval(secs => ${inatividadeMs / 1000})
    `;
    return r.count;
  }
}
