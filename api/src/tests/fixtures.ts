// Fake data shared by the tests.
import type { Protocolo } from '../scraper/portal.ts';

export function protocoloFake(p: Partial<Protocolo> = {}): Protocolo {
  return {
    idInterno: '1', protocolo: '100', tipo: 'Principal',
    dataProtocolo: '20/04/2026 09:55:01', vigenciaInicio: '16/10/2026', vigenciaFim: '24/10/2026',
    seguradoNome: 'JOSÉ DA SILVA', seguradoDocumento: '529.982.247-25',
    seguradora: 'Allianz Seguros', ramo: 'Vida Individual', produto: 'Vida',
    statusProtocolo: 'Proposta Emitida', statusProposta: 'Proposta Vigente', statusSinistro: '',
    proposta: '1', apolice: '2', pdfUrl: 'https://x/arquivo.pdf',
    ...p,
  };
}
