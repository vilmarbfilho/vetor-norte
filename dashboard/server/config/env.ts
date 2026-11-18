// Validated configuration of the dashboard server.

import { obrigatoria } from './load.ts';

function inteiroPositivo(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === '') return padrao;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${nome} deve ser um inteiro positivo (recebido: ${bruto})`);
  return n;
}

export const config = {
  databaseUrl: obrigatoria('DATABASE_URL'),
  porta: inteiroPositivo('PORT', 3100),
  // 127.0.0.1 by default: in production only the reverse proxy (Caddy) reaches it.
  host: process.env.HOST ?? '127.0.0.1',
  sessao: {
    // false only for local development over plain http on browsers that refuse Secure cookies on localhost.
    cookieSeguro: process.env.COOKIE_SECURE !== 'false',
    inatividadeMs: inteiroPositivo('SESSAO_INATIVIDADE_HORAS', 8) * 3_600_000,
    duracaoMaximaMs: inteiroPositivo('SESSAO_DURACAO_MAXIMA_DIAS', 7) * 86_400_000,
  },
  login: {
    maxTentativas: inteiroPositivo('LOGIN_MAX_TENTATIVAS', 5),
    bloqueioMs: inteiroPositivo('LOGIN_BLOQUEIO_MINUTOS', 15) * 60_000,
  },
} as const;
