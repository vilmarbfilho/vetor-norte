// Validated configuration of the API server.

import { obrigatoria } from './load.ts';

export { obrigatoria };

function inteiroPositivo(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === '') return padrao;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${nome} deve ser um inteiro positivo (recebido: ${bruto})`);
  return n;
}

export const config = {
  portalUrl: obrigatoria('PORTAL_URL'),
  headless: process.env.HEADLESS !== 'false',
  downloadDir: process.env.DOWNLOAD_DIR ?? 'downloads',
  porta: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
  // Path prefix added by the reverse proxy ("/broker" on the VPS); only used to build links in responses.
  prefixoPublico: (process.env.PREFIXO_PUBLICO ?? '').replace(/\/+$/, ''),
  rateLimit: {
    // Enabled unless explicitly set to "false".
    habilitado: process.env.RATE_LIMIT_HABILITADO !== 'false',
    porMinutoPadrao: inteiroPositivo('RATE_LIMIT_POR_MINUTO', 60),
  },
  sessoes: {
    // A user's portal session is closed after this idle time (the next request logs in again, ~7 s).
    ociosaMs: inteiroPositivo('SESSAO_OCIOSA_MINUTOS', 15) * 60_000,
    // Max portal sessions open at once (one per user); the most idle one is closed to make room.
    max: inteiroPositivo('SESSOES_MAX', 5),
  },
  retencao: {
    // LGPD: rows older than this are deleted daily.
    logsDias: inteiroPositivo('RETENCAO_LOGS_DIAS', 90),
    downloadsDias: inteiroPositivo('RETENCAO_DOWNLOADS_DIAS', 365),
    consultasDias: inteiroPositivo('RETENCAO_CONSULTAS_DIAS', 90),
  },
} as const;
