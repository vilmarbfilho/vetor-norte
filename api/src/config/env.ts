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
  email: obrigatoria('PORTAL_EMAIL'),
  senha: obrigatoria('PORTAL_SENHA'),
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
  keepAlive: {
    // Enabled unless explicitly set to "false".
    habilitado: process.env.KEEPALIVE_HABILITADO !== 'false',
    // Idle time after which the session is checked/renewed.
    intervaloMs: inteiroPositivo('KEEPALIVE_INTERVALO_MINUTOS', 10) * 60_000,
  },
  retencao: {
    // LGPD: rows older than this are deleted daily.
    logsDias: inteiroPositivo('RETENCAO_LOGS_DIAS', 90),
    downloadsDias: inteiroPositivo('RETENCAO_DOWNLOADS_DIAS', 365),
    consultasDias: inteiroPositivo('RETENCAO_CONSULTAS_DIAS', 90),
  },
} as const;
