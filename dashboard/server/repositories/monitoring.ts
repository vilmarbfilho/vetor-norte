// Error logs and PDF download history (written by the API, read here).

import type { PendingQuery, Row, Sql } from 'postgres';
import { textoSeguro } from '../utils/mask.ts';
import type {
  Download, FiltrosDownloads, FiltrosLogs, LogErro, LogErroDetalhado, Pagina,
  RegistroErroDashboard, RepositorioMonitoramento,
} from './types.ts';

type Fragmento = PendingQuery<Row[]>;

/** Joins conditions with AND (postgres.js fragments are safely parameterized). */
function onde(sql: Sql, condicoes: Fragmento[]): Fragmento {
  return condicoes.reduce((acc, c) => sql`${acc} AND ${c}`, sql`TRUE`);
}

interface LinhaLog {
  id: string; ocorrido_em: Date; origem: 'api' | 'dashboard'; metodo: string | null; rota: string | null;
  status_http: number | null; mensagem: string; request_id: string | null;
  chave_id: string | null; chave_nome: string | null; chave_prefixo: string | null;
  detalhes?: Record<string, unknown> | null;
}

function paraLog(l: LinhaLog): LogErro {
  return {
    id: l.id, ocorridoEm: l.ocorrido_em.toISOString(), origem: l.origem, metodo: l.metodo, rota: l.rota,
    statusHttp: l.status_http, mensagem: l.mensagem, requestId: l.request_id,
    apiKey: l.chave_id ? { id: l.chave_id, nome: l.chave_nome!, prefixo: l.chave_prefixo! } : null,
  };
}

export class RepositorioMonitoramentoPg implements RepositorioMonitoramento {
  constructor(private readonly sql: Sql) {}

  async listarLogs(f: FiltrosLogs): Promise<Pagina<LogErro>> {
    const sql = this.sql;
    const c: Fragmento[] = [];
    if (f.de) c.push(sql`l.ocorrido_em >= ${f.de}`);
    if (f.ate) c.push(sql`l.ocorrido_em <= ${f.ate}`);
    if (f.origem) c.push(sql`l.origem = ${f.origem}`);
    if (f.status) c.push(sql`l.status_http = ${f.status}`);
    if (f.busca) c.push(sql`(l.mensagem ILIKE ${'%' + f.busca + '%'} OR l.rota ILIKE ${'%' + f.busca + '%'})`);
    if (f.apiKeyId) c.push(sql`l.api_key_id = ${f.apiKeyId}`);
    const filtro = onde(sql, c);

    const [{ total }] = (await sql<{ total: number }[]>`
      SELECT count(*)::int AS total FROM logs_erro l WHERE ${filtro}
    `) as unknown as [{ total: number }];
    const linhas = await sql<LinhaLog[]>`
      SELECT l.id, l.ocorrido_em, l.origem, l.metodo, l.rota, l.status_http, l.mensagem, l.request_id,
             k.id AS chave_id, k.nome AS chave_nome, k.prefixo AS chave_prefixo
      FROM logs_erro l LEFT JOIN api_keys k ON k.id = l.api_key_id
      WHERE ${filtro}
      ORDER BY l.ocorrido_em DESC, l.id DESC
      LIMIT ${f.porPagina} OFFSET ${(f.pagina - 1) * f.porPagina}
    `;
    return { itens: linhas.map(paraLog), total, pagina: f.pagina, porPagina: f.porPagina };
  }

  async obterLog(id: string): Promise<LogErroDetalhado | null> {
    const [l] = await this.sql<LinhaLog[]>`
      SELECT l.id, l.ocorrido_em, l.origem, l.metodo, l.rota, l.status_http, l.mensagem, l.request_id, l.detalhes,
             k.id AS chave_id, k.nome AS chave_nome, k.prefixo AS chave_prefixo
      FROM logs_erro l LEFT JOIN api_keys k ON k.id = l.api_key_id
      WHERE l.id = ${id}
    `;
    return l ? { ...paraLog(l), detalhes: l.detalhes ?? null } : null;
  }

  async listarDownloads(f: FiltrosDownloads): Promise<Pagina<Download>> {
    const sql = this.sql;
    const c: Fragmento[] = [];
    if (f.de) c.push(sql`d.ocorrido_em >= ${f.de}`);
    if (f.ate) c.push(sql`d.ocorrido_em <= ${f.ate}`);
    if (f.protocolo) c.push(sql`d.protocolo = ${f.protocolo}`);
    if (f.tipo) c.push(sql`d.tipo = ${f.tipo}`);
    if (f.resultado) c.push(sql`d.resultado = ${f.resultado}`);
    if (f.apiKeyId) c.push(sql`d.api_key_id = ${f.apiKeyId}`);
    const filtro = onde(sql, c);

    const [{ total }] = (await sql<{ total: number }[]>`
      SELECT count(*)::int AS total FROM downloads_pdf d WHERE ${filtro}
    `) as unknown as [{ total: number }];
    const linhas = await sql<{
      id: string; ocorrido_em: Date; protocolo: string; tipo: Download['tipo']; destino: string | null;
      resultado: Download['resultado']; tamanho_bytes: number | null; duracao_ms: number | null;
      chave_id: string | null; chave_nome: string | null; chave_prefixo: string | null;
      usuario_id: string | null; usuario_nome: string | null;
    }[]>`
      SELECT d.id, d.ocorrido_em, d.protocolo, d.tipo, d.destino, d.resultado, d.tamanho_bytes, d.duracao_ms,
             k.id AS chave_id, k.nome AS chave_nome, k.prefixo AS chave_prefixo,
             u.id AS usuario_id, u.nome AS usuario_nome
      FROM downloads_pdf d
      LEFT JOIN api_keys k ON k.id = d.api_key_id
      LEFT JOIN usuarios u ON u.id = k.criado_por
      WHERE ${filtro}
      ORDER BY d.ocorrido_em DESC, d.id DESC
      LIMIT ${f.porPagina} OFFSET ${(f.pagina - 1) * f.porPagina}
    `;
    const itens = linhas.map((l): Download => ({
      id: l.id, ocorridoEm: l.ocorrido_em.toISOString(), protocolo: l.protocolo, tipo: l.tipo, destino: l.destino,
      resultado: l.resultado, tamanhoBytes: l.tamanho_bytes, duracaoMs: l.duracao_ms,
      apiKey: l.chave_id
        ? {
            id: l.chave_id, nome: l.chave_nome!, prefixo: l.chave_prefixo!,
            criadaPor: l.usuario_id ? { id: l.usuario_id, nome: l.usuario_nome! } : null,
          }
        : null,
    }));
    return { itens, total, pagina: f.pagina, porPagina: f.porPagina };
  }

  registrarErro(r: RegistroErroDashboard): void {
    const detalhes = r.detalhes
      ? Object.fromEntries(Object.entries(r.detalhes).map(([k, v]) => [k, typeof v === 'string' ? textoSeguro(v, 4000) : v]))
      : null;
    this.sql`
      INSERT INTO logs_erro (origem, metodo, rota, status_http, mensagem, detalhes, request_id)
      VALUES ('dashboard', ${r.metodo}, ${r.rota}, ${r.statusHttp}, ${textoSeguro(r.mensagem)},
              ${detalhes ? this.sql.json(detalhes as Record<string, string>) : null}, ${r.requestId ?? null})
    `.catch((e: Error) => console.warn(`[auditoria] falha ao gravar erro: ${e.message}`));
  }
}
