// Dashboard HTTP server (Fastify). Receives its repositories by injection, so routes are tested
// with in-memory fakes. JSON API under /api; the React frontend is served in stage 11.

import cookie from '@fastify/cookie';
import estaticos from '@fastify/static';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { registrarGuardas } from './auth/guard.ts';
import { BloqueioLogin } from './auth/login-throttle.ts';
import type { Repositorios } from './repositories/types.ts';
import { rotasAuth } from './routes/auth.ts';
import { rotasChaves } from './routes/keys.ts';
import { rotasMonitoramento } from './routes/monitoring.ts';
import { mascararCpf } from './utils/mask.ts';

export interface OpcoesApp {
  repositorios: Repositorios;
  sessao: { cookieSeguro: boolean; inatividadeMs: number; duracaoMaximaMs: number };
  login: { maxTentativas: number; bloqueioMs: number };
  logger?: boolean;
  /** Injectable for tests. */
  bloqueio?: BloqueioLogin;
  /** Folder with the built frontend (web/dist). Not served when missing (e.g. tests, before `npm run build`). */
  pastaWeb?: string;
}

// Content-Security-Policy: everything from this origin only; no inline scripts; no framing (clickjacking).
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
  "connect-src 'self'", "font-src 'self'", "object-src 'none'", "base-uri 'none'",
  "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

declare module 'fastify' {
  interface FastifyRequest {
    /** Error behind a 5xx response, kept for the error log. */
    erroCapturado?: Error;
  }
}

export function criarApp(o: OpcoesApp): FastifyInstance {
  const { contas, monitoramento, chaves } = o.repositorios;
  const app = Fastify({
    logger: o.logger
      ? {
          serializers: {
            // Headers (session cookie) are never logged; URLs are masked like in the API.
            req: (req) => ({ method: req.method, url: mascararCpf(req.url), remoteAddress: req.ip }),
          },
        }
      : false,
    ajv: { customOptions: { removeAdditional: false } },
    // Behind Caddy in production: use X-Forwarded-For for the client IP stored with each session.
    trustProxy: '127.0.0.1,::1,172.16.0.0/12,10.0.0.0/8,192.168.0.0/16',
  });

  app.register(cookie);
  const servirWeb = Boolean(o.pastaWeb && existsSync(o.pastaWeb));
  // wildcard: files are looked up on each request, so a rebuild (new hashed asset names) needs no restart.
  if (servirWeb) app.register(estaticos, { root: o.pastaWeb!, index: false });

  app.after(() => {
    // Security headers on every response (HTML and JSON).
    app.addHook('onSend', async (req, reply) => {
      reply
        .header('Content-Security-Policy', CSP)
        .header('X-Content-Type-Options', 'nosniff')
        .header('X-Frame-Options', 'DENY')
        .header('Referrer-Policy', 'no-referrer')
        .header('Cross-Origin-Opener-Policy', 'same-origin');
      // API answers carry personal data and keys: never cache them.
      if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    });

    // "/" is a directory for the static plugin (403 without index): serve the app explicitly.
    if (servirWeb) app.get('/', (_req, reply) => reply.header('Cache-Control', 'no-cache').sendFile('index.html'));

    // SPA: any other GET that is not /api returns index.html (client-side routes like /logs, /chaves).
    app.setNotFoundHandler((req, reply) => {
      // Paths with a file extension (missing /assets/x.js) are real 404s, not app routes.
      const ehArquivo = /\.[a-z0-9]+$/i.test(req.url.split('?')[0]!);
      if (servirWeb && req.method === 'GET' && !req.url.startsWith('/api/') && !ehArquivo) {
        return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      }
      return reply.status(404).send({ erro: 'Não encontrado', codigo: 'nao_encontrado' });
    });

    registrarGuardas(app, { contas, inatividadeMs: o.sessao.inatividadeMs, cookieSeguro: o.sessao.cookieSeguro });

    app.setErrorHandler<FastifyError>((erro, req, reply) => {
      if (erro.validation) {
        return reply.status(400).send({ erro: 'Parâmetros inválidos', codigo: 'parametros_invalidos', detalhes: erro.message });
      }
      if (erro.statusCode && erro.statusCode < 500) {
        return reply.status(erro.statusCode).send({ erro: erro.message, codigo: 'requisicao_invalida' });
      }
      req.erroCapturado = erro;
      req.log.error(erro);
      return reply.status(500).send({ erro: 'Erro interno. Tente novamente.', codigo: 'erro_interno' });
    });

    // Dashboard failures go to the same error log as the API's (origem = 'dashboard').
    app.addHook('onResponse', async (req, reply) => {
      if (reply.statusCode < 500) return;
      const erro = req.erroCapturado;
      monitoramento.registrarErro({
        metodo: req.method, rota: req.routeOptions.url ?? null, statusHttp: reply.statusCode,
        mensagem: erro?.message || `HTTP ${reply.statusCode}`,
        detalhes: { url: req.url, ...(erro ? { tipo: erro.name, stack: erro.stack ?? '' } : {}) },
        requestId: req.id,
      });
    });

    app.get('/api/health', { config: { publica: true } }, async () => ({ ok: true }));
    rotasAuth(app, {
      contas, cookieSeguro: o.sessao.cookieSeguro, duracaoMaximaMs: o.sessao.duracaoMaximaMs,
      bloqueio: o.bloqueio ?? new BloqueioLogin(o.login.maxTentativas, o.login.bloqueioMs),
    });
    rotasMonitoramento(app, monitoramento);
    rotasChaves(app, chaves);
  });

  return app;
}
