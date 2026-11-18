// Per-user Broker portal credentials (table credenciais_portal, written by the dashboard).
// The API only reads them and records the outcome of its portal logins.

import type { Sql } from 'postgres';

export type StatusCredencial = 'nao_testada' | 'valida' | 'invalida';

export interface CredencialPortal {
  email: string;
  senhaCifrada: Buffer;
  status: StatusCredencial;
  /**
   * `atualizada_em` as text (keeps Postgres' microseconds). Status updates only apply to this version,
   * so a login result never overwrites credentials the user saved in the meantime.
   */
  versao: string;
}

export interface RepositorioCredenciais {
  obter(usuarioId: string): Promise<CredencialPortal | null>;
  marcarValida(usuarioId: string, versao: string): Promise<void>;
  marcarInvalida(usuarioId: string, versao: string): Promise<void>;
}

export class RepositorioCredenciaisPg implements RepositorioCredenciais {
  constructor(private readonly sql: Sql) {}

  async obter(usuarioId: string): Promise<CredencialPortal | null> {
    const [linha] = await this.sql<{ email_portal: string; senha_cifrada: Buffer; status: StatusCredencial; versao: string }[]>`
      SELECT email_portal, senha_cifrada, status, atualizada_em::text AS versao
      FROM credenciais_portal WHERE usuario_id = ${usuarioId}
    `;
    return linha
      ? { email: linha.email_portal, senhaCifrada: linha.senha_cifrada, status: linha.status, versao: linha.versao }
      : null;
  }

  async marcarValida(usuarioId: string, versao: string): Promise<void> {
    await this.sql`
      UPDATE credenciais_portal SET status = 'valida', ultimo_login_ok_em = now(), invalidada_em = NULL
      WHERE usuario_id = ${usuarioId} AND atualizada_em::text = ${versao}
    `;
  }

  async marcarInvalida(usuarioId: string, versao: string): Promise<void> {
    await this.sql`
      UPDATE credenciais_portal SET status = 'invalida', invalidada_em = now()
      WHERE usuario_id = ${usuarioId} AND atualizada_em::text = ${versao}
    `;
  }
}
