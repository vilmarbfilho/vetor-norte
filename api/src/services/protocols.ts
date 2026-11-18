// Business rules: list a CPF's protocols and get a protocol's PDF.
// Knows nothing about HTTP: the API (src/api) only maps this to requests/responses.

import { baixarPdfProposta, buscarProtocolos, type Protocolo } from '../scraper/portal.ts';
import type { SessaoBroker } from '../scraper/session.ts';
import { aplicarFiltros, type FiltrosListagem } from './filters.ts';

export type ResultadoPdf =
  | { tipo: 'ok'; protocolo: Protocolo; pdf: Buffer }
  | { tipo: 'nao_encontrado' }
  | { tipo: 'sem_pdf'; protocolo: Protocolo };

/** Contract used by the API (lets the API be tested with a fake implementation). */
export interface ServicoProtocolos {
  listarPorCpf(cpf: string, filtros: FiltrosListagem): Promise<Protocolo[]>;
  obterPdf(numeroProtocolo: string): Promise<ResultadoPdf>;
  status(): unknown;
}

export class ServicoProtocolosBroker implements ServicoProtocolos {
  constructor(private readonly sessao: SessaoBroker) {}

  async listarPorCpf(cpf: string, filtros: FiltrosListagem): Promise<Protocolo[]> {
    const todos = await this.sessao.executar(({ broker }) => buscarProtocolos(broker, { documento: cpf }));
    return aplicarFiltros(todos, filtros);
  }

  obterPdf(numeroProtocolo: string): Promise<ResultadoPdf> {
    // Search + download in the same operation: the PDF URL comes from the current session's table.
    return this.sessao.executar(async ({ broker, context }): Promise<ResultadoPdf> => {
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
    return this.sessao.status;
  }
}
