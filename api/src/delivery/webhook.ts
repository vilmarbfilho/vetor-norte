// Generic webhook destination: POSTs the document as JSON (base64) to a URL fixed in the
// server configuration. It covers n8n/Make/Zapier flows and most WhatsApp gateways
// (through a small adapter on their side) without any code change here.

import { arquivoEmJson, ErroEntrega, type Destino, type Documento, type PedidoEnvio, type ResultadoEntrega } from './types.ts';

export interface OpcoesWebhook {
  nome: string;
  url: string;
  /** Sent as `Authorization: Bearer <token>` when present. */
  token?: string;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetch?: typeof globalThis.fetch;
}

export const EVENTO_PDF_PROPOSTA = 'protocolo.pdf_proposta';

export class DestinoWebhook implements Destino {
  readonly tipo = 'webhook';
  readonly nome: string;
  private readonly url: string;
  private readonly token: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetch: typeof globalThis.fetch;

  constructor(opcoes: OpcoesWebhook) {
    this.nome = opcoes.nome;
    this.url = opcoes.url;
    this.token = opcoes.token;
    this.timeoutMs = opcoes.timeoutMs ?? 15_000;
    this.fetch = opcoes.fetch ?? globalThis.fetch;
  }

  /** Body sent to the receiver. Personal data is limited to what the caller passed. */
  montarCorpo(doc: Documento, pedido: PedidoEnvio) {
    return {
      evento: EVENTO_PDF_PROPOSTA,
      protocolo: doc.protocolo,
      destinatario: pedido.destinatario ?? null,
      mensagem: pedido.mensagem ?? null,
      referencia: pedido.referencia ?? null,
      arquivo: arquivoEmJson(doc),
      enviadoEm: new Date().toISOString(),
    };
  }

  async enviar(doc: Documento, pedido: PedidoEnvio): Promise<ResultadoEntrega> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    let resposta: Response;
    try {
      resposta = await this.fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(this.montarCorpo(doc, pedido)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new ErroEntrega(this.nome, `Destino "${this.nome}" inacessível: ${(e as Error).message}`, { cause: e });
    }
    // Drain the body so the connection is released; its content is not relayed to the caller.
    await resposta.arrayBuffer().catch(() => undefined);
    if (!resposta.ok) {
      throw new ErroEntrega(this.nome, `Destino "${this.nome}" respondeu HTTP ${resposta.status}`);
    }
    return { status: resposta.status };
  }
}
