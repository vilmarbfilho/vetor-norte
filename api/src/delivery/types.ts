// Delivery layer contracts. A "destino" is any place a document can be pushed to
// (generic webhook, WhatsApp gateway, e-mail, storage...). Adding a new channel means
// implementing `Destino` and registering it; routes and services stay untouched.

/** A file ready to be delivered, independent of where it came from. */
export interface Documento {
  nome: string;
  mimeType: string;
  conteudo: Buffer;
  /** Protocol number the document belongs to (correlation for the receiver). */
  protocolo: string;
}

/** What the caller asked for. Every field is optional and interpreted by each destination. */
export interface PedidoEnvio {
  /** Channel-specific recipient: phone number, chat id, e-mail... */
  destinatario?: string;
  /** Text sent along with the file (e.g. WhatsApp caption). */
  mensagem?: string;
  /** Caller's correlation id, echoed back to the receiver. */
  referencia?: string;
}

export interface ResultadoEntrega {
  /** Receiver's HTTP status (or equivalent), useful for diagnostics. */
  status?: number;
}

export interface Destino {
  /** Public name used in requests (`{"destino": "<nome>"}`). */
  readonly nome: string;
  /** Adapter kind (e.g. "webhook"). Shown in GET /destinos. */
  readonly tipo: string;
  /** Delivers the document. Must throw `ErroEntrega` on failure. */
  enviar(documento: Documento, pedido: PedidoEnvio): Promise<ResultadoEntrega>;
}

/** Delivery failure (receiver down, rejected, timeout). Mapped to 502 by the API. */
export class ErroEntrega extends Error {
  constructor(
    readonly destino: string,
    mensagem: string,
    options?: { cause?: unknown },
  ) {
    super(mensagem, options);
    this.name = 'ErroEntrega';
  }
}

/** Shape of a file inside JSON payloads (API responses and webhook bodies). */
export function arquivoEmJson(doc: Documento) {
  return { nome: doc.nome, mimeType: doc.mimeType, tamanho: doc.conteudo.length, base64: doc.conteudo.toString('base64') };
}
