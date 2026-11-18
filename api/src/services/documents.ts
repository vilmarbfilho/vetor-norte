// Turns a protocol's PDF into a channel-agnostic Documento and delivers it to a destination.
// The delivery runs OUTSIDE the browser session queue: a slow or failing receiver must not
// hold the user's portal tab nor trigger SessaoBroker's re-login/retry.

import type { RegistroDestinos } from '../delivery/registry.ts';
import type { Documento, PedidoEnvio, ResultadoEntrega } from '../delivery/types.ts';
import type { ResultadoPdf, ServicoProtocolos } from './protocols.ts';

export function nomeArquivoPdf(protocolo: string): string {
  return `proposta_${protocolo}.pdf`;
}

export function documentoDoPdf(protocolo: string, pdf: Buffer): Documento {
  return { nome: nomeArquivoPdf(protocolo), mimeType: 'application/pdf', conteudo: pdf, protocolo };
}

export type ResultadoEnvio =
  | Exclude<ResultadoPdf, { tipo: 'ok' }>
  | { tipo: 'destino_desconhecido' }
  | { tipo: 'enviado'; destino: string; documento: Documento; entrega: ResultadoEntrega };

/**
 * Fetches the PDF and delivers it. Business outcomes are return values;
 * receiver failures throw `ErroEntrega`, portal failures throw whatever the session threw.
 */
export async function enviarPdf(
  servico: ServicoProtocolos,
  usuarioId: string,
  destinos: RegistroDestinos,
  numeroProtocolo: string,
  nomeDestino: string,
  pedido: PedidoEnvio,
): Promise<ResultadoEnvio> {
  // Check the destination before touching the browser.
  const destino = destinos.get(nomeDestino);
  if (!destino) return { tipo: 'destino_desconhecido' };

  const resultado = await servico.obterPdf(usuarioId, numeroProtocolo);
  if (resultado.tipo !== 'ok') return resultado;

  const documento = documentoDoPdf(resultado.protocolo.protocolo, resultado.pdf);
  const entrega = await destino.enviar(documento, pedido);
  return { tipo: 'enviado', destino: destino.nome, documento, entrega };
}
