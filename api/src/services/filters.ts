// Listing filters, applied in memory over the CPF's protocols.
// (A CPF search returns few records; filtering locally covers exactly the table
//  columns, without depending on the Broker's internal codes.)

import type { Protocolo } from '../scraper/portal.ts';

export interface FiltrosListagem {
  /** Exact protocol number. */
  protocolo?: string;
  /** Dates accept YYYY-MM-DD or DD/MM/YYYY. Ranges are inclusive. */
  dataProtocoloDe?: string;
  dataProtocoloAte?: string;
  vigenciaInicioDe?: string;
  vigenciaInicioAte?: string;
  vigenciaFimDe?: string;
  vigenciaFimAte?: string;
  /** Texts: "contains", case- and accent-insensitive. */
  segurado?: string;
  seguradora?: string;
  statusProtocolo?: string;
  statusProposta?: string;
  statusSinistro?: string;
}

/** "17/11/2026 09:12:18" | "17/11/2026" | "2026-11-17" -> "20261117" (comparable). */
export function chaveData(valor: string): string | null {
  const br = /(\d{2})\/(\d{2})\/(\d{4})/.exec(valor);
  if (br) return `${br[3]}${br[2]}${br[1]}`;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
  return null;
}

const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const contem = (valor: string, busca?: string) => !busca || normalizar(valor).includes(normalizar(busca));

function noIntervalo(valor: string, de?: string, ate?: string): boolean {
  if (!de && !ate) return true;
  const v = chaveData(valor);
  if (!v) return false; // a missing date never matches a date filter
  if (de && v < chaveData(de)!) return false;
  if (ate && v > chaveData(ate)!) return false;
  return true;
}

export function aplicarFiltros(protocolos: Protocolo[], f: FiltrosListagem): Protocolo[] {
  return protocolos.filter(
    (p) =>
      (!f.protocolo || p.protocolo === f.protocolo.trim()) &&
      noIntervalo(p.dataProtocolo, f.dataProtocoloDe, f.dataProtocoloAte) &&
      noIntervalo(p.vigenciaInicio, f.vigenciaInicioDe, f.vigenciaInicioAte) &&
      noIntervalo(p.vigenciaFim, f.vigenciaFimDe, f.vigenciaFimAte) &&
      contem(p.seguradoNome, f.segurado) &&
      contem(p.seguradora, f.seguradora) &&
      contem(p.statusProtocolo, f.statusProtocolo) &&
      contem(p.statusProposta, f.statusProposta) &&
      contem(p.statusSinistro, f.statusSinistro),
  );
}
