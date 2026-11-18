// Business rules: list a CPF's protocols and get a protocol's PDF.
// Knows nothing about HTTP: the API (src/api) only maps this to requests/responses.

import { baixarPdfProposta, buscarProtocolos, type Protocolo } from '../scraper/portal.ts';
import type { Recursos } from '../scraper/session.ts';
import type { GerenciadorSessoes } from '../scraper/sessions.ts';
import { aplicarFiltros, type FiltrosListagem } from './filters.ts';

export type ResultadoPdf =
  | { tipo: 'ok'; protocolo: Protocolo; pdf: Buffer }
  | { tipo: 'nao_encontrado' }
  | { tipo: 'sem_pdf'; protocolo: Protocolo };

/**
 * Contract used by the API (lets the API be tested with a fake implementation).
 * `usuarioId` = owner of the API key: the portal is queried with that user's own credentials
 * (may throw ErroCredenciais).
 */
export interface ServicoProtocolos {
  listarPorCpf(usuarioId: string, cpf: string, filtros: FiltrosListagem): Promise<Protocolo[]>;
  obterPdf(usuarioId: string, numeroProtocolo: string): Promise<ResultadoPdf>;
  status(): unknown;
}

export class ServicoProtocolosBroker implements ServicoProtocolos {
  constructor(private readonly sessoes: GerenciadorSessoes<Recursos>) {}

  async listarPorCpf(usuarioId: string, cpf: string, filtros: FiltrosListagem): Promise<Protocolo[]> {
    const todos = await this.sessoes.executar(usuarioId, ({ broker }) => buscarProtocolos(broker, { documento: cpf }));
    return aplicarFiltros(todos, filtros);
  }

  obterPdf(usuarioId: string, numeroProtocolo: string): Promise<ResultadoPdf> {
    // Search + download in the same operation: the PDF URL comes from the current session's table.
    return this.sessoes.executar(usuarioId, async ({ broker, context }): Promise<ResultadoPdf> => {
      const encontrados = (await buscarProtocolos(broker, { protocolo: numeroProtocolo })).filter(
        (p) => p.protocolo === numeroProtocolo,
      );
      if (!encontrados.length) return { tipo: 'nao_encontrado' };

      const comPdf = encontrados.find((p) => p.pdfUrl);
      if (!comPdf) return { tipo: 'sem_pdf', protocolo: encontrados[0]! };

      return { tipo: 'ok', protocolo: comPdf, pdf: await baixarPdfProposta(context, comPdf) };
    });
  }

  status() {
    return this.sessoes.status;
  }
}
