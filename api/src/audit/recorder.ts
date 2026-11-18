// Persists error logs and PDF download history. Writes are fire-and-forget: a database failure
// is reported on the console and never fails or delays the HTTP request.

import type { Sql } from 'postgres';
import { textoSeguro } from './mask.ts';

export interface RegistroErro {
  /** HTTP method; null for background jobs (keep-alive). */
  metodo: string | null;
  /** Route template (e.g. /protocolos/:protocolo/pdf), never the raw URL with query string. */
  rota: string | null;
  /** Null for background jobs (keep-alive). */
  statusHttp: number | null;
  mensagem: string;
  detalhes?: Record<string, unknown>;
  apiKeyId?: string | null;
  requestId?: string;
}

export type TipoDownload = 'binario' | 'base64' | 'envio';
export type ResultadoDownload = 'ok' | 'nao_encontrado' | 'sem_pdf' | 'erro';

export interface RegistroDownload {
  protocolo: string;
  tipo: TipoDownload;
  destino?: string | null;
  resultado: ResultadoDownload;
  tamanhoBytes?: number | null;
  duracaoMs: number;
  apiKeyId?: string | null;
}

export interface Auditoria {
  erro(registro: RegistroErro): void;
  download(registro: RegistroDownload): void;
}

/** Recursively masks CPFs in every string of a JSON-like value. */
function detalhesSeguros(valor: unknown): unknown {
  if (typeof valor === 'string') return textoSeguro(valor, 4000);
  if (Array.isArray(valor)) return valor.map(detalhesSeguros);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, detalhesSeguros(v)]));
  }
  return valor;
}

export class AuditoriaPg implements Auditoria {
  constructor(private readonly sql: Sql) {}

  erro(r: RegistroErro): void {
    const detalhes = r.detalhes ? (detalhesSeguros(r.detalhes) as Record<string, string>) : null;
    this.gravar(
      'erro',
      this.sql`
        INSERT INTO logs_erro (origem, metodo, rota, status_http, mensagem, detalhes, api_key_id, request_id)
        VALUES ('api', ${r.metodo}, ${r.rota}, ${r.statusHttp}, ${textoSeguro(r.mensagem)},
                ${detalhes ? this.sql.json(detalhes) : null}, ${r.apiKeyId ?? null}, ${r.requestId ?? null})
      `,
    );
  }

  download(r: RegistroDownload): void {
    this.gravar(
      'download',
      this.sql`
        INSERT INTO downloads_pdf (protocolo, tipo, destino, resultado, tamanho_bytes, duracao_ms, api_key_id)
        VALUES (${r.protocolo}, ${r.tipo}, ${r.destino ?? null}, ${r.resultado}, ${r.tamanhoBytes ?? null},
                ${Math.round(r.duracaoMs)}, ${r.apiKeyId ?? null})
      `,
    );
  }

  private gravar(tipo: string, consulta: Promise<unknown>): void {
    consulta.catch((e: Error) => console.warn(`[auditoria] falha ao gravar ${tipo}: ${e.message}`));
  }
}
